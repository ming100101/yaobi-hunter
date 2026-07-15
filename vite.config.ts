import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { appendRecordLine, recordingsDir } from './scripts/recordFile';
import { readKvFile, writeKvKey } from './scripts/kvFile';
import { sendTelegram, sendToast, detectChatId } from './scripts/notifyHeadless';
import { serveRecordings } from './scripts/recordingsServe';
import { serveSignalEvents } from './scripts/signalEventsServe';
import { deepReclaimFilePath } from './scripts/deepReclaimFile';
import { defaultStrategyLabPath } from './scripts/strategyShadowFile';

// Dev-mode mirror of the exe's POST /record endpoint: the app fire-and-forgets
// a compact JSONL snapshot after each completed sweep; this appends it to the
// same recordings dir the packaged app uses, so dev and exe accumulate one
// shared dataset.
function recordEndpoint(): PluginOption {
  return {
    name: 'yaobi-record',
    configureServer(server) {
      server.middlewares.use('/record', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            appendRecordLine(body);
          } catch {
            /* recording is best-effort */
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// Dev-mode mirror of the exe's GET/POST /kv endpoint: a single kv.json under
// LOCALAPPDATA holds the small persisted keys (pins, recently-viewed, signal
// ages, notify cooldowns, warm OI store) so they survive a port change, which
// IndexedDB — being per-origin — could not. GET returns the whole object; POST
// merges one {key, value}.
function kvEndpoint(): PluginOption {
  return {
    name: 'yaobi-kv',
    configureServer(server) {
      server.middlewares.use('/kv', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(readKvFile()));
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { key, value } = JSON.parse(body);
            if (typeof key === 'string') writeKvKey(key, value);
          } catch {
            /* best-effort, like /record */
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// Dev-mode mirror of the exe's GET /recordings endpoint: serves concatenated
// daily JSONL for a date range so the in-app 策略/記錄 tabs read the same data
// the CLI reads from disk. fs logic lives in scripts/recordingsServe.ts (shared
// with the CJS mirror in server.cjs). Uses the full req.url so the ?from&to
// query survives (connect strips the mount path).
function recordingsEndpoint(): PluginOption {
  return {
    name: 'yaobi-recordings',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/recordings')) return next();
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        const q = new URL(req.url, 'http://localhost');
        const { code, body } = serveRecordings(q.searchParams.get('from') ?? '', q.searchParams.get('to') ?? '');
        res.statusCode = code;
        res.setHeader('content-type', code === 200 ? 'application/x-ndjson' : 'text/plain; charset=utf-8');
        res.end(body);
      });
    },
  };
}

function signalEventsEndpoint(): PluginOption {
  return {
    name: 'yaobi-signal-events',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/signal-events')) return next();
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        const q = new URL(req.url, 'http://localhost');
        const { code, body } = serveSignalEvents(
          q.searchParams.get('symbol') ?? '',
          q.searchParams.get('from') ?? '',
          q.searchParams.get('to') ?? '',
        );
        res.statusCode = code;
        res.setHeader('content-type', code === 200 ? 'application/x-ndjson' : 'text/plain; charset=utf-8');
        res.end(body);
      });
    },
  };
}

function strategyLabEndpoint(): PluginOption {
  return {
    name: 'yaobi-strategy-lab',
    configureServer(server) {
      server.middlewares.use('/strategy-lab', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '{"v":1,"generatedAt":0,"rows":[],"candidates":[],"outcomes":[],"policy":{"id":"balanced-v1","leverage":1,"riskPerTradePct":0.5,"maxPositionNotionalPct":20,"maxOpenPositions":4,"maxOpenRiskPct":2,"dailyLossBlockPct":1.5,"drawdownLockPct":10}}';
        try { body = fs.readFileSync(defaultStrategyLabPath(), 'utf8'); } catch { /* first run */ }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(body);
      });
    },
  };
}

// Dev-mode mirror of the exe's notification setup endpoints. The 設定 tab calls
// these; all Telegram/toast I/O runs here in Node so the browser never hits CORS
// and the test exercises the real path. POST /notify-detect-chat {token} ->
// {chatId,name}; POST /notify-test {token,chatId,toast} -> {telegram,toast}.
function readJsonBody(req: import('http').IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function notifyEndpoints(): PluginOption {
  return {
    name: 'yaobi-notify',
    configureServer(server) {
      server.middlewares.use('/notify-detect-chat', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readJsonBody(req).then(async (b) => {
          const r = await detectChatId(b.token);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(r));
        });
      });
      server.middlewares.use('/notify-test', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readJsonBody(req).then(async (b) => {
          const telegram = await sendTelegram(
            b.token,
            b.chatId,
            '⚡ 縮倉突破 — <b>測試</b>/USDT\n呢個係測試通知,設定成功。',
          );
          const toast =
            b.toast !== false
              ? await sendToast('⚡ 縮倉突破 — 測試', '呢個係測試通知,設定成功。')
              : { ok: true, error: 'skipped' };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ telegram, toast }));
        });
      });
      server.middlewares.use('/notify-test-entry', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readJsonBody(req).then(async (b) => {
          const first = await sendTelegram(
            b.token,
            b.chatId,
            '📈 增倉突破 — <b>測試</b>/USDT\n結構入場區 0.1170–0.1190\n狀態：⏳ 已開啟推送後入場監察',
          );
          const follow = first.ok
            ? await sendTelegram(
                b.token,
                b.chatId,
                '🟢 <b>入場區到價</b> — 測試/USDT\n現價 0.1182 · 已於15m回踩企穩\n到價只代表結構價位已到，請重新評估風險，並非買入指令。',
                { replyToMessageId: first.messageId },
              )
            : { ok: false, error: 'initial test failed' };
          const toast =
            b.toast !== false
              ? await sendToast('🟢 入場區到價 — 測試', '15m回踩企穩 · 請重新評估風險')
              : { ok: true, error: 'skipped' };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ initial: first, followup: follow, toast }));
        });
      });
      server.middlewares.use('/notify-test-deep-reclaim', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readJsonBody(req).then(async (b) => {
          const initial = await sendTelegram(
            b.token,
            b.chatId,
            '🟡 <b>深跌收復早察（測試）</b> — TEST/USDT\n回撤 -10.2% · quantity OI 1h +1.4% / 4h +5.8%\n確認線 0.1180 · 失效參考 0.1090\n市場研究提醒，並非買入指令。',
          );
          const followup = initial.ok
            ? await sendTelegram(
                b.token,
                b.chatId,
                '🟢 <b>阻力收復確認（測試）</b> — TEST/USDT\n確認價 0.1183 · 確認線 0.1180\n等待 1小時15分 · quantity OI 4h +6.1%\n請重新評估風險，並非買入指令。',
                { replyToMessageId: initial.messageId },
              )
            : { ok: false, error: 'initial test failed' };
          const toast =
            b.toast !== false
              ? await sendToast('🟢 阻力收復確認 — 測試', 'TEST/USDT · 請重新評估風險')
              : { ok: true, error: 'skipped' };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ initial, followup, toast }));
        });
      });
    },
  };
}

function deepReclaimEndpoint(): PluginOption {
  const readState = (): unknown => {
    try {
      return JSON.parse(fs.readFileSync(deepReclaimFilePath(), 'utf8'));
    } catch {
      return { v: 1, updatedAt: 0, active: {} };
    }
  };
  const recentEvents = (): unknown[] => {
    const out: unknown[] = [];
    try {
      const dir = recordingsDir();
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().slice(-8)) {
        const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
        for (const line of lines) {
          if (!line.includes('"type":"deep-reclaim"')) continue;
          try { out.push(JSON.parse(line)); } catch { /* skip malformed audit line */ }
        }
      }
    } catch {
      /* no recordings yet */
    }
    return out.slice(-1500);
  };
  return {
    name: 'yaobi-deep-reclaim',
    configureServer(server) {
      server.middlewares.use('/deep-reclaim', (req, res) => {
        if (req.method === 'GET') {
          const kv = readKvFile();
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify({ state: readState(), events: recentEvents(), references: kv['ref-signals'] ?? [] }));
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        readJsonBody(req).then((b) => {
          const sym = typeof b.sym === 'string' ? b.sym.trim().toUpperCase() : '';
          const ts = Number(b.ts);
          const px = Number(b.px);
          const refStrength = Number(b.refStrength);
          if (!/^[A-Z0-9]{1,24}$/.test(sym) || !Number.isFinite(ts) || !(px > 0) || !Number.isFinite(refStrength)) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify({ ok: false, error: 'invalid reference signal' }));
          }
          const signal = {
            ts: Math.trunc(ts),
            tsProvisional: b.tsProvisional === true,
            src: 'laozhan',
            sym,
            side: 'LONG',
            kind: typeof b.kind === 'string' && b.kind.trim() ? b.kind.trim().slice(0, 60) : '參考訊號',
            refStrength,
            px,
            anchorMethod: b.tsProvisional === true ? 'chart-entry-cross-estimate' : 'actual-message',
            uncertaintyMs: b.tsProvisional === true ? 15 * 60_000 : 0,
            notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 400) : undefined,
          };
          const current = ((readKvFile()['ref-signals'] as any[]) ?? []).filter(
            (x) => !(x && x.sym === signal.sym && Number(x.ts) === signal.ts),
          );
          current.push(signal);
          writeKvKey('ref-signals', current);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, signal }));
        });
      });
    },
  };
}

// Proxy Binance public market-data through the dev server so the browser makes
// same-origin requests (no CORS) and the upstream call originates from the
// user's machine. Perp data (fapi + futures/data paths) lives on
// fapi.binance.com; spot on api.binance.com — hence two prefixes, matching
// BN_PROXY in src/data/binance.ts.
const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  plugins: [react(), recordEndpoint(), kvEndpoint(), recordingsEndpoint(), signalEventsEndpoint(), strategyLabEndpoint(), notifyEndpoints(), deepReclaimEndpoint()],
  server: {
    // Port auto-switch: local `npm run dev` prefers 5173 but, when it's already
    // taken (another dev server or the packaged exe running), Vite falls through
    // to the next free port (5174, 5175, …) because strictPort is false. When a
    // harness/CI assigns a known-free PORT, bind it exactly (strictPort) so the
    // caller can find the server on the port it chose.
    port: envPort ?? 5173,
    strictPort: envPort !== undefined,
    proxy: {
      '/bnf': {
        target: 'https://fapi.binance.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/bnf/, ''),
      },
      '/bns': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/bns/, ''),
      },
    },
  },
});
