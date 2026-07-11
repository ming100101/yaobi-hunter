import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { appendRecordLine } from './scripts/recordFile';
import { readKvFile, writeKvKey } from './scripts/kvFile';
import { sendTelegram, sendToast, detectChatId } from './scripts/notifyHeadless';
import { serveRecordings } from './scripts/recordingsServe';

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
  plugins: [react(), recordEndpoint(), kvEndpoint(), recordingsEndpoint(), notifyEndpoints()],
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
