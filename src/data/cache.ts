import type { Coin, ScanResult, SignalTimes } from '../types';

// Best-effort IndexedDB persistence: the last good live scan (so startup can
// render instantly instead of waiting ~30s for the throttled fetch) and the
// recently-viewed symbol list (used to prioritise refresh order). Every call
// swallows failures — private browsing or quota errors just degrade to the
// old always-fetch behaviour.

const DB_NAME = 'yaobi-hunter';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- IndexedDB primitives (per-origin; the fallback layer) ------------------
async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(key);
      rq.onsuccess = () => resolve((rq.result as T) ?? null);
      rq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

// ---- server-backed KV (port-agnostic; the primary layer) --------------------
// IndexedDB is per-origin, so the exe's port drift (4780 -> 4781 when the port
// is briefly held) orphaned every persisted key — pins, recently-viewed, signal
// ages, notify cooldowns, and the 48h-warmed OI store — making them look lost.
// These keys instead live in a single %LOCALAPPDATA%/YaobiHunter/kv.json served
// by the exe (scripts/server.cjs) and the dev server (vite.config.ts) at
// GET/POST /kv, so they survive any port. If /kv is unreachable (e.g. a static
// host with no backend) we silently fall back to IndexedDB-only — the old
// behaviour. IndexedDB is still written in parallel so the fallback stays fresh.
const SERVER_KEYS = new Set([
  'pinned',
  'recent',
  'signal-times',
  'fb-notified',
  'oi-snapshots',
  'notify', // 設定 tab writes here; the headless recorder reads it from kv.json
  'paper-state', // M1 paper book — shared with the recorder so app+recorder accrue one ledger
  'signal-log', // 24h Signal Read history per coin — survives reload / exe port drift
]);

// The /kv path only makes sense in the browser (a relative fetch resolves
// against the page origin). In Node — the headless recorder, which reaches here
// via oiStore -> cache — there is no origin and no server, so stay strictly on
// the IndexedDB primitives (which themselves no-op in Node) exactly as before.
const IS_BROWSER = typeof window !== 'undefined';

let serverSnap: Record<string, unknown> | null = null; // populated once; null = unavailable
let serverInit: Promise<void> | null = null;

function timeoutSignal(ms: number): AbortSignal {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac.signal;
}

function postKv(key: string, value: unknown): void {
  void fetch('/kv', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

// Fetch the whole KV once into a memory snapshot; migrate any key IndexedDB has
// but the server file doesn't (first run after this upgrade) so nothing is lost.
// Cached promise: runs at most once, never blocks first paint beyond the fetch
// timeout, and a failure pins serverSnap to null (IndexedDB-only from then on).
function initServerKv(): Promise<void> {
  if (!serverInit) {
    serverInit = (async () => {
      try {
        const res = await fetch('/kv', { signal: timeoutSignal(1500) });
        if (!res.ok) return; // serverSnap stays null -> IndexedDB-only
        serverSnap = (await res.json()) as Record<string, unknown>;
        for (const key of SERVER_KEYS) {
          if (serverSnap[key] === undefined) {
            const v = await idbGet(key);
            if (v != null) {
              serverSnap[key] = v;
              postKv(key, v);
            }
          }
        }
      } catch {
        serverSnap = null; // network error / no backend -> IndexedDB-only
      }
    })();
  }
  return serverInit;
}

// Public KV: server-first for SERVER_KEYS (with IndexedDB fallback + mirror),
// IndexedDB-only for everything else (heavy caches: 'scan', 'full:*').
export async function kvGet<T>(key: string): Promise<T | null> {
  if (IS_BROWSER && SERVER_KEYS.has(key)) {
    await initServerKv();
    if (serverSnap && serverSnap[key] !== undefined) return serverSnap[key] as T;
  }
  return idbGet<T>(key);
}

// Fresh single-key read straight from the server file, bypassing the cached
// snapshot. serverSnap is populated once and only reflects THIS session's own
// writes, so it can't see another process's updates (e.g. the headless recorder
// driving the paper book). The M1 single-driver guard needs the other process's
// most recent write, so it reads through here. Refreshes the snapshot as a side
// effect; falls back to the cached path (and IndexedDB) when /kv is unreachable.
export async function kvGetFresh<T>(key: string): Promise<T | null> {
  if (IS_BROWSER && SERVER_KEYS.has(key)) {
    try {
      const res = await fetch('/kv', { signal: timeoutSignal(1500) });
      if (res.ok) {
        const all = (await res.json()) as Record<string, unknown>;
        if (serverSnap) serverSnap[key] = all[key];
        if (all[key] !== undefined) return all[key] as T;
        return null;
      }
    } catch {
      /* no backend / timeout — fall through to the cached + IndexedDB path */
    }
  }
  return kvGet<T>(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  // Always write IndexedDB first (fast, no network wait) so a value is never
  // lost if the process closes before the server round-trip completes.
  await idbSet(key, value);
  if (IS_BROWSER && SERVER_KEYS.has(key)) {
    postKv(key, value);
    await initServerKv();
    if (serverSnap) serverSnap[key] = value;
  }
}

export function loadCachedScan(): Promise<ScanResult | null> {
  return kvGet<ScanResult>('scan');
}

export function saveCachedScan(scan: ScanResult): Promise<void> {
  // only real data is worth persisting — demo regenerates instantly anyway
  if (scan.source !== 'okx') return Promise.resolve();
  return kvSet('scan', scan);
}

export async function loadRecentViewed(): Promise<string[]> {
  return (await kvGet<string[]>('recent')) ?? [];
}

export function saveRecentViewed(symbols: string[]): Promise<void> {
  return kvSet('recent', symbols);
}

// user-pinned symbols — explicit, persistent, order = pin order (newest last)
export async function loadPinned(): Promise<string[]> {
  return (await kvGet<string[]>('pinned')) ?? [];
}

export function savePinned(symbols: string[]): Promise<void> {
  return kvSet('pinned', symbols);
}

export function loadSignalTimes(): Promise<SignalTimes | null> {
  return kvGet('signal-times');
}

export function saveSignalTimes(times: SignalTimes): Promise<void> {
  return kvSet('signal-times', times);
}

// full-series coin snapshots for instant detail re-opens
export function loadFullCoin(symbol: string): Promise<{ coin: Coin; at: number } | null> {
  return kvGet(`full:${symbol}`);
}

export function saveFullCoin(symbol: string, coin: Coin, at: number): Promise<void> {
  return kvSet(`full:${symbol}`, { coin, at });
}
