// Standalone runtime for the packaged app: serves the built dist/ (from SEA
// assets when running as a single executable, from disk in dev), proxies
// /okx/* and /bnv/* upstream so the browser stays same-origin, and presents
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
      res.writeHead(ur.statusCode || 502, {
        'content-type': ur.headers['content-type'] || 'application/octet-stream',
      });
      ur.pipe(res);
    },
  );
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: '502', msg: `${hostname} proxy error: ${e.message}` }));
  });
  up.end();
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  if (rawUrl.startsWith('/okx/')) return proxyTo('www.okx.com', '/okx', req, res);
  if (rawUrl.startsWith('/bnv/')) {
    // S3 XML listing endpoint for the Binance public data bucket
    return proxyTo('s3-ap-northeast-1.amazonaws.com', '/bnv', req, res, '/data.binance.vision');
  }

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

function openAppWindow(url) {
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

function listen() {
  server.once('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && port < 4790) {
      port += 1;
      listen();
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
