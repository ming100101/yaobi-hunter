import type { Coin, CoinLite, ScanProgress, ScanSource, SearchHit } from '../types';
import { fetchLiveCoin, runRollingScan, searchInstruments, toLite } from './okx';
import { runMicroCycle, type MicroResult } from '../lib/microScan';
import { getBinancePerpBases } from './binanceUniverse';
import { generateScan } from './mockData';
import { loadFullCoin, saveFullCoin } from './cache';

// Vite dev server and the packaged exe both proxy these prefixes
// (see vite.config.ts and scripts/server.cjs)
const OKX_BASE = '/okx';
const BNV_BASE = '/bnv';

const MEM_FULL_CAP = 12;

// full-series coins for detail views: in-memory LRU backed by IndexedDB
const memFull = new Map<string, { coin: Coin; at: number }>();
// demo fulls from the last synthetic scan (offline detail views)
let demoFull = new Map<string, Coin>();

function rememberFull(coin: Coin, at: number) {
  memFull.delete(coin.symbol);
  memFull.set(coin.symbol, { coin, at });
  while (memFull.size > MEM_FULL_CAP) {
    const oldest = memFull.keys().next().value as string;
    memFull.delete(oldest);
  }
  void saveFullCoin(coin.symbol, coin, at);
}

export function searchPerps(query: string): Promise<SearchHit[]> {
  return searchInstruments(OKX_BASE, query);
}

// S3 browser micro-scan cycle — wraps runMicroCycle with the proxy base so App
// never touches OKX_BASE directly. Warm-only, so it's safe to run every ~75s.
export function runMicroScan(
  candidates: string[],
  curFb: Set<string>,
  onFire: (c: Coin) => void,
  nowMs: number,
): Promise<MicroResult> {
  return runMicroCycle(OKX_BASE, candidates, curFb, onFire, nowMs);
}

export interface ScanHandle {
  promise: Promise<{ error?: string }>;
  abort: () => void;
}

// Rolling full-market scan (every OKX USDT perp that is also Binance-listed).
// Emits progressively-growing lite results via onUpdate; on total failure
// falls back to a synthetic demo scan. `priority` symbols are scanned first,
// and their full series are cached for instant detail opens.
export function startScan(
  nowMs: number,
  nonce: number,
  priority: string[],
  onUpdate: (coins: CoinLite[], progress: ScanProgress | null, source: ScanSource) => void,
): ScanHandle {
  let aborted = false;
  const prioritySet = new Set(priority);

  const promise = (async (): Promise<{ error?: string }> => {
    try {
      const bnBases = await getBinancePerpBases(BNV_BASE);
      const collected: CoinLite[] = [];
      await runRollingScan(OKX_BASE, nowMs, bnBases, priority, (batch, progress) => {
        if (aborted) return false;
        const at = Date.now();
        for (const coin of batch) {
          collected.push(toLite(coin));
          // keep fulls for recently-viewed coins — likely to be opened again
          if (prioritySet.has(coin.symbol)) rememberFull(coin, at);
        }
        onUpdate([...collected], progress, 'okx');
        return true;
      });
      if (aborted) return {};
      if (!collected.length) throw new Error('no coins assembled');
      return {};
    } catch (e) {
      if (aborted) return {};
      const demo = generateScan(nowMs, nonce);
      demoFull = new Map(demo.coins.map((c) => [c.symbol, c]));
      onUpdate(demo.coins.map(toLite), null, 'demo');
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
    },
  };
}

// Cached full coin (memory first, then IndexedDB), or null.
export async function getCachedFull(symbol: string): Promise<{ coin: Coin; at: number } | null> {
  const mem = memFull.get(symbol);
  if (mem) return mem;
  const idb = await loadFullCoin(symbol);
  if (idb) {
    memFull.set(symbol, idb);
    return idb;
  }
  return null;
}

// Fresh full coin: instant from the demo map in demo mode, network otherwise.
export async function fetchFullCoin(symbol: string, source: ScanSource): Promise<Coin> {
  if (source === 'demo') {
    const c = demoFull.get(symbol);
    if (c) return c;
    throw new Error(`demo 資料中沒有 ${symbol}`);
  }
  const coin = await fetchLiveCoin(
    OKX_BASE,
    { instId: `${symbol}-USDT-SWAP`, base: symbol, last: 0, change24h: 0, vol24hUsd: 0 },
    Date.now(),
  );
  rememberFull(coin, Date.now());
  return coin;
}
