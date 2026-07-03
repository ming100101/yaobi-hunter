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

export async function kvGet<T>(key: string): Promise<T | null> {
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

export async function kvSet(key: string, value: unknown): Promise<void> {
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
