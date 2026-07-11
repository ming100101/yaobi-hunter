// Standalone runtime for the packaged app: serves the built dist/ (from SEA
// assets when running as a single executable, from disk in dev), proxies
// /bnf/* (fapi.binance.com) and /bns/* (api.binance.com) upstream so the
// browser stays same-origin, and presents
// itself as a desktop app: the visible console respawns itself hidden, then
// launches Edge/Chrome in --app mode with a dedicated profile — closing that
// window shuts the whole thing down. CJS on purpose — Node SEA requires it.
//
// Flags: --no-open (serve only), --console (keep console + default browser),
//        --daemon (internal: the hidden respawned instance)
'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

let sea = null;
try {
  const m = require('node:sea');
  if (m.isSea()) sea = m;
} catch {
  sea = null;
}

const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function getFile(rel) {
  if (sea) {
    try {
      return Buffer.from(sea.getAsset(rel));
    } catch {
      return null;
    }
  }
  const p = path.resolve(DIST, rel);
  if (!p.startsWith(path.resolve(DIST))) return null;
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

// Append a posted scan snapshot as one JSONL line under LOCALAPPDATA (same dir
// the recorder + dev middleware use). Best-effort; never fails the request.
function recordingsDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'recordings');
}

function appendRecord(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const dir = recordingsDir();
      fs.mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(path.join(dir, `${day}.jsonl`), body.replace(/\s*\n\s*/g, ' ').trim() + '\n');
    } catch {
      /* recording is best-effort */
    }
    res.writeHead(204);
    res.end();
  });
}

// GET /recordings?from=YYYY-MM-DD&to=YYYY-MM-DD → concatenated raw JSONL for the
// daily files in range (application/x-ndjson). CJS mirror of scripts/
// recordingsServe.ts (SEA can't import the ESM module — keep the two in sync).
// Range capped at 92 days (413); missing files just absent.
function handleRecordings(req, res) {
  const q = new URL(req.url, 'http://localhost');
  const from = q.searchParams.get('from') || '';
  const to = q.searchParams.get('to') || '';
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(from) || !isDate(to)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('from/to must be YYYY-MM-DD');
  }
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const toMs = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('invalid range (to before from?)');
  }
  if ((toMs - fromMs) / 86400000 > 92) {
    res.writeHead(413, { 'content-type': 'text/plain' });
    return res.end('range too wide (> 92 days)');
  }
  let out = '';
  try {
    const dir = recordingsDir();
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const day = f.slice(0, -6); // strip '.jsonl'; lexical compare == date compare
      if (day < from || day > to) continue;
      out += fs.readFileSync(path.join(dir, f), 'utf8');
      if (!out.endsWith('\n')) out += '\n';
    }
  } catch {
    /* no recordings dir → empty body, still 200 */
  }
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.end(out);
}

// Single kv.json under LOCALAPPDATA: the port-agnostic home for the small
// persisted keys (pins, recently-viewed, signal ages, notify cooldowns, warm OI
// store). IndexedDB is per-origin, so the port drift (4780 -> 4781 when the port
// is briefly held) used to orphan all of it; this file survives any port. GET
// returns the whole object, POST merges one {key, value}. Atomic write (tmp +
// rename); best-effort, never fails the request.
function kvFilePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'kv.json');
}

function readKvFile() {
  try {
    return JSON.parse(fs.readFileSync(kvFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

function handleKv(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(readKvFile()));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { key, value } = JSON.parse(body);
      if (typeof key === 'string') {
        const p = kvFilePath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const cur = readKvFile();
        cur[key] = value;
        fs.writeFileSync(p + '.tmp', JSON.stringify(cur));
        fs.renameSync(p + '.tmp', p);
      }
    } catch {
      /* kv is best-effort */
    }
    res.writeHead(204);
    res.end();
  });
}

// --- notification setup endpoints (mirror of vite's notifyEndpoints) --------
// The 設定 tab calls these; all Telegram/toast I/O runs here in Node so the
// browser avoids CORS and a test exercises the real send path.
function tgEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tgSend(token, chatId, text, cb) {
  if (!token || !chatId) return cb({ ok: false, error: 'missing token or chat id' });
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const r = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    },
    (resp) => {
      let d = '';
      resp.on('data', (c) => (d += c));
      resp.on('end', () => {
        try {
          const j = JSON.parse(d);
          cb(j.ok ? { ok: true } : { ok: false, error: j.description || `http ${resp.statusCode}` });
        } catch {
          cb({ ok: false, error: `http ${resp.statusCode}` });
        }
      });
    },
  );
  r.on('error', (e) => cb({ ok: false, error: e.message }));
  r.write(payload);
  r.end();
}

function tgDetectChat(token, cb) {
  if (!token) return cb({ error: 'missing token' });
  const r = https.get({ hostname: 'api.telegram.org', path: `/bot${token}/getUpdates` }, (resp) => {
    let d = '';
    resp.on('data', (c) => (d += c));
    resp.on('end', () => {
      try {
        const j = JSON.parse(d);
        if (!j.ok) return cb({ error: j.description || `http ${resp.statusCode}` });
        const u = j.result || [];
        for (let i = u.length - 1; i >= 0; i--) {
          const m = u[i].message || u[i].edited_message || u[i].channel_post;
          const chat = m && m.chat;
          if (chat && chat.id != null) {
            const name =
              [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
              chat.title ||
              chat.username ||
              '';
            return cb({ chatId: String(chat.id), name });
          }
        }
        cb({ error: '未搵到訊息 — 請先喺 Telegram 傳一句俾你個 bot,再試' });
      } catch {
        cb({ error: `http ${resp.statusCode}` });
      }
    });
  });
  r.on('error', (e) => cb({ error: e.message }));
}

function winToast(title, body, cb) {
  // SINGLE-quoted here-string (@'...'@): no PowerShell $-/backtick expansion, so a
  // symbol with $() or ` can't inject. tgEscape still XML-escapes. Keep it @'...'@.
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @'
<toast><visual><binding template='ToastGeneric'><text>${tgEscape(title)}</text><text>${tgEscape(body)}</text></binding></visual></toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('YaobiHunter').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`;
  execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) =>
    cb(err ? { ok: false, error: String((err && err.message) || err) } : { ok: true }),
  );
}

function readJsonBody(req, cb) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      cb(JSON.parse(body || '{}'));
    } catch {
      cb({});
    }
  });
}

function handleNotifyDetect(req, res) {
  readJsonBody(req, (b) =>
    tgDetectChat(b.token, (r) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r));
    }),
  );
}

function handleNotifyTest(req, res) {
  readJsonBody(req, (b) => {
    tgSend(b.token, b.chatId, '⚡ 縮倉突破 — <b>測試</b>/USDT\n呢個係測試通知,設定成功。', (telegram) => {
      const done = (toast) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ telegram, toast }));
      };
      if (b.toast === false) done({ ok: true, error: 'skipped' });
      else winToast('⚡ 縮倉突破 — 測試', '呢個係測試通知,設定成功。', done);
    });
  });
}

function proxyTo(hostname, prefix, req, res, pathBase = '') {
  const upstreamPath = pathBase + (req.url.slice(prefix.length) || '/');
  const up = https.request(
    {
      hostname,
      path: upstreamPath,
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'yaobi-hunter/1.0' },
    },
    (ur) => {
      // forward Binance's rate-limit telemetry — the client's weight guard
      // (bnGet in src/data/binance.ts) reads these to pace itself
      const fwd = { 'content-type': ur.headers['content-type'] || 'application/octet-stream' };
      for (const h of ['x-mbx-used-weight', 'x-mbx-used-weight-1m', 'retry-after']) {
        if (ur.headers[h]) fwd[h] = ur.headers[h];
      }
      res.writeHead(ur.statusCode || 502, fwd);
      ur.pipe(res);
    },
  );
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: '502', msg: `${hostname} proxy error: ${e.message}` }));
  });
  up.end();
}

// magic health endpoint so a second launch can tell "is 4780 held by ANOTHER
// yaobi-hunter, or by some unrelated program?" before deciding what to do
const PING_PATH = '/__yaobi_ping__';
const PING_TOKEN = 'yaobi-hunter-ok';

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  if (rawUrl === PING_PATH) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(PING_TOKEN);
    return;
  }
  if (rawUrl.startsWith('/bnf/')) return proxyTo('fapi.binance.com', '/bnf', req, res);
  if (rawUrl.startsWith('/bns/')) return proxyTo('api.binance.com', '/bns', req, res);
  if (rawUrl === '/record' && req.method === 'POST') return appendRecord(req, res);
  if (rawUrl === '/kv' && (req.method === 'GET' || req.method === 'POST')) return handleKv(req, res);
  if (rawUrl === '/notify-detect-chat' && req.method === 'POST') return handleNotifyDetect(req, res);
  if (rawUrl === '/notify-test' && req.method === 'POST') return handleNotifyTest(req, res);
  if (rawUrl.startsWith('/recordings') && req.method === 'GET') return handleRecordings(req, res);

  let rel = rawUrl.split('?')[0];
  rel = rel === '/' ? 'index.html' : decodeURIComponent(rel.slice(1));
  let buf = getFile(rel);
  if (!buf) {
    // SPA fallback
    rel = 'index.html';
    buf = getFile(rel);
  }
  if (!buf) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(rel)] || 'application/octet-stream',
    'cache-control': rel === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(buf);
});

let port = 4780;
const noOpen = process.argv.includes('--no-open');
const forceConsole = process.argv.includes('--console');
const isDaemon = process.argv.includes('--daemon');
const isAuto = process.argv.includes('--auto');

// Master off-switch. When launched by the logon auto-start task (--auto) and the
// KILL file exists, do not open — so the kill switch stays in effect across
// reboots. A manual double-click (no --auto) always opens, KILL or not.
if (isAuto) {
  try {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    if (fs.existsSync(path.join(base, 'YaobiHunter', 'KILL'))) {
      console.log('KILL file present — auto-launch aborted');
      process.exit(0);
    }
  } catch {
    /* ignore */
  }
}

// Chromium binary for --app mode (own window, own taskbar entry, no tabs)
function findChromium() {
  const cands = [
    [process.env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe'],
    [process.env.ProgramFiles, 'Microsoft\\Edge\\Application\\msedge.exe'],
    [process.env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe'],
    [process.env['ProgramFiles(x86)'], 'Google\\Chrome\\Application\\chrome.exe'],
    [process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'],
  ];
  for (const [base, rel] of cands) {
    if (!base) continue;
    const p = path.join(base, rel);
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const chromium = process.platform === 'win32' && !noOpen && !forceConsole ? findChromium() : null;

// App mode available and we're the visible console instance: respawn ourselves
// hidden and exit, so the user never sees a terminal window.
if (chromium && !isDaemon) {
  const child = spawn(process.execPath, [...process.argv.slice(1), '--daemon'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  process.exit(0);
}

// how many browser processes are still using our dedicated app profile
function countProfileBrowsers(cb) {
  execFile(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*YaobiHunter*app-profile*' }).Count",
    ],
    { windowsHide: true },
    (err, stdout) => cb(err ? -1 : Number(String(stdout).trim()) || 0),
  );
}

function openAppWindow(url, opts) {
  const standalone = opts && opts.standalone;
  const profile = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'YaobiHunter', 'app-profile');
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    chromium,
    [
      `--app=${url}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,940',
    ],
    { stdio: 'ignore' },
  );
  // standalone = a second launch that owns NO server; it just opens a window
  // against the existing instance and the caller exits right away. Don't attach
  // the profile-wide shutdown poll below (it can't tell windows apart and would
  // keep this process alive as long as the FIRST instance's window is open).
  if (standalone) {
    child.on('error', () => execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }));
    return;
  }
  // Edge/Chrome's launcher process may exit immediately while the real window
  // lives on in a re-parented process — so on launcher exit, poll for browser
  // processes still holding our profile and shut down only when none remain
  // for two consecutive checks (window really closed).
  child.on('exit', () => {
    let zeros = 0;
    const poll = () =>
      countProfileBrowsers((n) => {
        if (n === 0) {
          zeros += 1;
          if (zeros >= 2) {
            server.close();
            process.exit(0);
          }
        } else {
          zeros = 0;
        }
        setTimeout(poll, 2500);
      });
    setTimeout(poll, 2000);
  });
  child.on('error', () => {
    // launch failed — fall back to the default browser, keep serving
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
  });
}

// Is the port held by ANOTHER yaobi-hunter instance? Resolves the base URL if
// so, null if it's some unrelated program (or nothing answers in time).
function probeExisting(p, cb) {
  const req = http.get(
    { hostname: '127.0.0.1', port: p, path: PING_PATH, timeout: 1500 },
    (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => cb(body.trim() === PING_TOKEN ? `http://localhost:${p}` : null));
    },
  );
  req.on('error', () => cb(null));
  req.on('timeout', () => {
    req.destroy();
    cb(null);
  });
}

function listen() {
  server.once('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      // Single-instance guard: if OUR app already owns this port, don't spin up
      // a second server (two servers = two 15-min scans fighting for the same
      // Binance per-IP rate budget). Point a window at the existing one and exit.
      probeExisting(port, (existingUrl) => {
        if (existingUrl) {
          console.log(`already running at ${existingUrl} — opening another window there`);
          if (!noOpen && process.platform === 'win32') {
            if (chromium) openAppWindow(existingUrl, { standalone: true });
            else execFile('cmd', ['/c', 'start', '', existingUrl], { windowsHide: true });
          }
          // give the spawned window a beat to launch before this process exits
          setTimeout(() => process.exit(0), noOpen ? 0 : 1200);
        } else if (port < 4790) {
          // port held by something else — try the next one
          port += 1;
          listen();
        } else {
          console.error('failed to start: no free port in 4780-4790');
          process.exit(1);
        }
      });
    } else {
      console.error(`failed to start: ${e && e.message}`);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  ============================================');
    console.log('   YAOBI HUNTER (yao bi lie shou)');
    console.log(`   running at  ${url}`);
    console.log('   keep this window open; close it to stop');
    console.log('  ============================================');
    console.log('');
    if (!noOpen && process.platform === 'win32') {
      if (chromium && isDaemon) openAppWindow(url);
      else execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
    }
  });
}

listen();
