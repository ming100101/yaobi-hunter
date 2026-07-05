# P0 — 持久化根治 (file-backed KV):修好 PIN 唔見 + 保護 OI warmup

**層級**: 第1層 數據護城河 · **工作量**: M · **依賴**: 無 — 一定要最先做

## zh-HK TL;DR
PIN 其實有儲低,只係 exe 個 port 由 4780 跳咗去 4781 時,IndexedDB(按 origin 分家)嘅資料就「搵唔返」。連 48 小時暖身嘅 OI store 都會一齊冇埋,掃描由 87 秒退返 269 秒。呢個 spec 將重要 state 搬去 server 端一個 `kv.json` file,port 點跳都唔會再唔見嘢。同時係之後所有 spec(settings、paper trading、通知 config)嘅儲存基建。

## Context (verified facts — do NOT re-explore)
- Pins are saved to IndexedDB db `yaobi-hunter`, store `kv`, key `pinned` — see `src/data/cache.ts:70-77` (`loadPinned`/`savePinned`), written fire-and-forget at `src/App.tsx:241`.
- The exe server starts at port 4780 and increments to 4781+ when the port is held by a FOREIGN process — `scripts/server.cjs:266-289` (`listen()`); it already probe-reuses its own instances via `GET /__yaobi_ping__` (`server.cjs:107-108, 250-264`).
- IndexedDB is **per-origin**. `http://localhost:4780` and `http://localhost:4781` are different origins → all IndexedDB keys become invisible after a port change: `pinned`, `recent`, `signal-times`, `fb-notified`, and `oi-snapshots` (the warm bulk-OI store, `src/data/oiStore.ts`).
- The browser profile `%LOCALAPPDATA%\YaobiHunter\app-profile` persists fine; data is orphaned, not deleted.
- Precedent to copy: the `POST /record` endpoint exists in BOTH `scripts/server.cjs:65-80,122` (CJS) and `vite.config.ts:9-32` (vite plugin middleware). This spec adds `GET/POST /kv` the same dual way.
- `kvGet`/`kvSet` in `src/data/cache.ts:23-50` are the single IndexedDB read/write choke points — every persisted key goes through them.

## Design (all decisions made — implement as written)
- KV file: `%LOCALAPPDATA%/YaobiHunter/kv.json` — one JSON object `{ [key: string]: any }`.
- Server-backed keys (exactly these): `pinned`, `recent`, `signal-times`, `fb-notified`, `oi-snapshots`. Everything else (`scan`, `full:*`) stays IndexedDB-only (heavy, loss is cosmetic).
- Client strategy: on boot fetch the whole KV once into a memory snapshot; reads come from the snapshot; writes update snapshot + fire-and-forget `POST /kv` + still write IndexedDB (keeps the fallback fresh).
- If `GET /kv` fails (404/network — e.g. static hosting), silently stay IndexedDB-only. No error UI.
- One-time migration: for each server-backed key missing from the server snapshot but present in IndexedDB → POST it up.

## Steps

### 1. New shared Node module `scripts/kvFile.ts`
Used by the vite plugin (and later by R2/M1 headless code). Mirror the style of `scripts/recordFile.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function kvFilePath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'kv.json');
}

export function readKvFile(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(kvFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

// reread-merge-write + atomic rename so concurrent instances can't produce a torn file
export function writeKvKey(key: string, value: unknown): void {
  const p = kvFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cur = readKvFile();
  cur[key] = value;
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur));
  fs.renameSync(tmp, p);
}
```

### 2. Routes in `scripts/server.cjs`
`server.cjs` is CJS inside the SEA — it cannot import `kvFile.ts`. Duplicate the ~20 lines inline (same as it already inlines the recordFile logic). Add next to `appendRecord` (`server.cjs:65-80`):

```js
function kvFilePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'kv.json');
}
function readKvFile() {
  try { return JSON.parse(fs.readFileSync(kvFilePath(), 'utf8')); } catch { return {}; }
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
    } catch { /* best-effort, like /record */ }
    res.writeHead(204);
    res.end();
  });
}
```

Register the route in the request handler next to the `/record` line (`server.cjs:122`):

```js
if (rawUrl === '/kv' && (req.method === 'GET' || req.method === 'POST')) return handleKv(req, res);
```

### 3. Vite plugin in `vite.config.ts`
Add a `kvEndpoint()` plugin next to `recordEndpoint()` (`vite.config.ts:9-32`), importing `readKvFile`/`writeKvKey` from `./scripts/kvFile`:

```ts
function kvEndpoint(): PluginOption {
  return {
    name: 'yaobi-kv',
    configureServer(server) {
      server.middlewares.use('/kv', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(readKvFile()));
        }
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { key, value } = JSON.parse(body);
            if (typeof key === 'string') writeKvKey(key, value);
          } catch { /* best-effort */ }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
```

Add it to `plugins: [react(), recordEndpoint(), kvEndpoint()]`.

### 4. Client layer in `src/data/cache.ts`
Add ABOVE the existing `kvGet`/`kvSet` (keep both IndexedDB functions unchanged, rename nothing):

```ts
const SERVER_KEYS = new Set(['pinned', 'recent', 'signal-times', 'fb-notified', 'oi-snapshots']);

let serverSnap: Record<string, unknown> | null = null; // null = unavailable
let serverInit: Promise<void> | null = null;

function initServerKv(): Promise<void> {
  if (!serverInit) {
    serverInit = (async () => {
      try {
        const res = await fetch('/kv');
        if (!res.ok) return;
        serverSnap = await res.json();
        // one-time migration: IndexedDB has it, server doesn't → upload
        for (const key of SERVER_KEYS) {
          if (serverSnap![key] === undefined) {
            const v = await idbGet(key);
            if (v != null) {
              serverSnap![key] = v;
              postKv(key, v);
            }
          }
        }
      } catch { serverSnap = null; }
    })();
  }
  return serverInit;
}

function postKv(key: string, value: unknown): void {
  void fetch('/kv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}
```

Then rename the current IndexedDB `kvGet`→`idbGet` and `kvSet`→`idbSet` (internal only), and re-create `kvGet`/`kvSet` with the same exported signatures so **no other file changes**:

```ts
export async function kvGet<T>(key: string): Promise<T | null> {
  if (SERVER_KEYS.has(key)) {
    await initServerKv();
    if (serverSnap && serverSnap[key] !== undefined) return serverSnap[key] as T;
  }
  return idbGet<T>(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (SERVER_KEYS.has(key)) {
    if (serverSnap) serverSnap[key] = value;
    postKv(key, value);
  }
  await idbSet(key, value);
}
```

`oiStore.ts` and `notify.ts` already import `kvGet`/`kvSet` from cache.ts, so they get server persistence for free. Verify with grep that nothing else imports IndexedDB directly.

## Verification
1. `npm run typecheck` — clean.
2. `npm run dev` → open app → pin a coin (📌) → check `%LOCALAPPDATA%\YaobiHunter\kv.json` now contains `"pinned":["..."]`.
3. Stop dev server, restart with `npm run dev -- --port 5174` → open `http://localhost:5174` → **pin still shows** (this simulates the port-drift bug; before this fix it disappears).
4. Let one scan complete → kv.json contains `oi-snapshots`.
5. Rebuild exe path unaffected: `npm run build` succeeds (server.cjs route is runtime-only).

## Acceptance checklist
- [ ] Pins survive a port change (step 3).
- [ ] kv.json created and updated atomically (no `.tmp` residue after writes).
- [ ] `/kv` unreachable (e.g. `vite preview` without plugin) → app still works, IndexedDB-only, zero console errors from this code path (wrap in catch).
- [ ] No API change for callers of `loadPinned`/`savePinned`/`loadSignalTimes`/etc.

## 陷阱 / Do-NOT
- Do NOT change the IndexedDB schema/version — leave `openDb` (`cache.ts:12-21`) untouched.
- Do NOT move `scan` or `full:*` keys to the server file (megabytes; kv.json must stay small and fast to reread on every POST).
- Do NOT make `kvGet` block the UI when the server is slow: `initServerKv` runs once and caches its promise; a hung `/kv` would hang first paint — add `AbortSignal.timeout(1500)` to the boot fetch: `fetch('/kv', { signal: AbortSignal.timeout(1500) })`.
- server.cjs must stay pure CJS (Node SEA constraint, `server.cjs:6`) — no `import`, no TS.
- Keep zh-TW UI labels; this task has no UI copy anyway.

## ✅ Results (2026-07-04, implemented)
Implemented exactly as specced, plus one robustness guard beyond the spec.
- New `scripts/kvFile.ts` (readKvFile/writeKvKey/kvFilePath, atomic tmp+rename); `/kv` route added to `scripts/server.cjs` (inline CJS) and `vite.config.ts` (`kvEndpoint()` plugin); `src/data/cache.ts` renamed the IndexedDB primitives to `idbGet/idbSet` and re-exported `kvGet/kvSet` server-first (SERVER_KEYS = pinned, recent, signal-times, fb-notified, oi-snapshots) with IndexedDB fallback + mirror, boot snapshot via `initServerKv()` (1500ms `AbortController` timeout + one-time IndexedDB→file migration).
- **Beyond spec:** added `IS_BROWSER = typeof window !== 'undefined'` guard so the headless Node recorder (reaches cache.ts via oiStore) never fires a relative `fetch('/kv')` — it stays IndexedDB-only/in-memory exactly as before, avoiding any unhandled rejection in the 24/7 process.
- **Verified:** `npm run typecheck` clean. Live endpoint test across two ports — POST to `:5199/kv` was readable via `:5173/kv` (both backed by the same fixed-path `kv.json`), which is the port-drift fix; POST merges without clobbering existing keys; atomic write leaves no `.tmp` residue. The running app already persisted `recent`/`signal-times`/`oi-snapshots` through the client→`/kv`→file path during testing, confirming the write path end-to-end.
- **Known cost:** `oi-snapshots` in kv.json measured 158KB at ~5h warmup (394 instruments), so ~2MB at full 48h. Every small-key POST rereads+rewrites the whole file. Fine for a single-user desktop app and fire-and-forget writes; if it ever bites, split `oi-snapshots` into its own sidecar file.
- **User-facing manual check (optional):** pin a coin, close the exe, reopen — even if the port drifts to 4781 the pin now survives (previously it vanished).
