import type {
  Candle,
  Coin,
  CoinLite,
  LongSeries,
  ScanProgress,
  SearchHit,
  SeriesPoint,
  VolumeBar,
} from '../types';
import {
  analyze,
  computeStrengthSeries,
  confirmEarlyAccum,
  detectEarlyPump,
  detectIgnition,
  detectEarlySetup,
  EA_RS_MIN_PCT,
  featureVector,
} from '../lib/analyze';
import {
  appendSnapshot,
  backfillFromRecords,
  getRecentSeries,
  getSeries as getWarmOi,
  hydrate as hydrateOi,
  oiQtyChangeFromStore,
  seedFromHist,
  storeSize,
  type OiQtyChange,
} from './oiStore';
import { rebuildFires, spotPumpFires, virginFires } from '../lib/interpret';

// Real USD-M perp + spot data from Binance (fapi + api/v3). Replaces the OKX v5
// client on 2026-07-07 (fapi became reachable for the user; OKX rubik's hours-
// lagging OI — the P1 root cause — has no Binance analogue: openInterestHist is
// a first-class endpoint). Liquidation polling is the ONE thing still on OKX,
// because Binance removed its public REST force-order endpoint (WS-only now) —
// see ./okx.ts, consumed only by the headless recorder.
//
// Hosts: perp data lives on fapi.binance.com, spot on api.binance.com — two
// budgets, two hosts, so every fetcher takes a BnBase pair. In the browser both
// are same-origin proxy prefixes (vite.config.ts / scripts/server.cjs); Node
// callers (recorder, tests, backtest) pass the real hosts via BN_LIVE.
export interface BnBase {
  fapi: string;
  spot: string;
}
export const BN_LIVE: BnBase = { fapi: 'https://fapi.binance.com', spot: 'https://api.binance.com' };
export const BN_PROXY: BnBase = { fapi: '/bnf', spot: '/bns' };

const BASE_BARS = 576; // 2 days of 5m bars
const MIN_BARS = 300; // drop freshly-listed coins without enough history
const BATCH_SIZE = 20; // coins per rolling-scan batch
const LONG_BARS = 600; // ~25 days of 1H bars for the detail chart's long timeframes
const LONG_MIN_BARS = 120; // need a few days of 1H history for 1h/4h to be worth it
const SPOT_CAND_STRENGTH = 70; // S2: spot-fetch a coin if strength ≥ this (proxy for the sweep's strength leaders)
const SPOT_CAND_BUDGET = 30; // S2: max candidate spot-series fetches per sweep

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// S3: HTTP 429/418 counter so the micro-scan can back off when throttled (it
// reads the delta across a cycle). Incremented in bnGet's throttle branch.
let rate429Count = 0;
export function get429Count(): number {
  return rate429Count;
}

// Per-request hard timeout — same rationale as the OKX-era client: a hung
// socket must become a normal failure the retry/backoff absorbs, or one dead
// request freezes the whole awaited sweep batch (the 2026-07-06 "stuck at
// 220/360" symptom).
const BN_TIMEOUT_MS = 15_000;

// Soft weight guard. Binance meters REST by IP: fapi 2400 weight/min, spot
// 6000/min, reported back on every response as x-mbx-used-weight-1m (fapi) /
// x-mbx-used-weight (spot). When the last response on a host says we're near
// the cap inside the current minute, sleep out the minute instead of eating a
// 429 (or worse, a 418 IP ban). 2000 is conservative for spot but spot usage
// is tiny (one bulk ticker + a few candidate kline pulls), so one shared
// threshold keeps this simple.
const WEIGHT_SOFT_CAP = 2000;
const usedWeight = new Map<string, { atMin: number; used: number }>();

async function bnGet(host: string, path: string, tries = 3): Promise<any> {
  let lastErr: unknown;
  for (let k = 0; k < tries; k++) {
    try {
      const gw = usedWeight.get(host);
      const nowMin = Math.floor(Date.now() / 60_000);
      if (gw && gw.atMin === nowMin && gw.used >= WEIGHT_SOFT_CAP) {
        // Bounded pause (measured 2026-07-07: Binance's reported window does
        // not reset exactly on the local wall-clock minute, so sleeping to the
        // minute boundary over-waited ~60s). 10s probes re-read the counter on
        // the next response; the atMin check expires the state at rollover.
        const waitMs = Math.min(10_000, 60_000 - (Date.now() % 60_000) + 500);
        console.warn(`[bn] weight ${gw.used} near cap — pausing ${(waitMs / 1000).toFixed(1)}s`);
        await sleep(waitMs);
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), BN_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(host + path, { signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
      const w = Number(res.headers.get('x-mbx-used-weight-1m') ?? res.headers.get('x-mbx-used-weight'));
      if (Number.isFinite(w) && w > 0) usedWeight.set(host, { atMin: Math.floor(Date.now() / 60_000), used: w });
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        if (res.status === 429 || res.status === 418) rate429Count++; // S3 micro-scan backoff signal
        const ra = Number(res.headers.get('retry-after'));
        // visible in prod/dev console so a throttle regression isn't silent
        console.warn(`[bn] ${res.status} on ${path} (retry ${k + 1}/${tries})`);
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 90) * 1000 : (res.status === 418 ? 5000 : 800) * (k + 1));
        continue;
      }
      const j = await res.json();
      // Binance errors are {code:<negative>, msg} objects (success bodies never
      // carry a negative code)
      if (j && !Array.isArray(j) && typeof j.code === 'number' && j.code < 0) {
        throw new Error(`binance ${j.code} ${j.msg ?? ''}`);
      }
      if (!res.ok) throw new Error(`binance http ${res.status}: ${path}`);
      return j;
    } catch (e) {
      lastErr = e; // includes AbortError on timeout — treated like any transient failure
      await sleep(300 * (k + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`binance failed: ${path}`);
}

// concurrency-limited map with optional per-worker spacing to respect rate limits
export async function mapPool<T, R>(
  items: T[],
  conc: number,
  fn: (item: T, i: number) => Promise<R>,
  spacing = 0,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
      if (spacing) await sleep(spacing);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

// forward-fill a sparse/native-resolution series onto the canonical 5m grid;
// values before the first source point are back-filled from it
function resample(times: number[], src: Array<{ t: number; v: number }>): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let j = 0;
  let cur = src.length ? src[0].v : 0;
  for (const time of times) {
    while (j < src.length && src[j].t <= time) {
      cur = src[j].v;
      j++;
    }
    out.push({ time, value: cur });
  }
  return out;
}

// Binance symbol -> base coin + price multiplier. Binance multiplies micro-
// priced coins (1000PEPE, 1000000MOG, 1MBABYDOGE); every price this module
// hands out is normalised back to per-coin by dividing by mult, so the UI,
// recordings, paper marks and perp/spot basis stay continuous with the OKX era
// (which listed the bare base). Applies to BOTH perp and spot symbols (spot
// also lists 1000SATS-style packs).
export function parseUmSymbol(sym: string): { base: string; mult: number } | null {
  if (!sym.endsWith('USDT')) return null; // skip USDC/BUSD-margined
  let b = sym.slice(0, -4);
  if (!b || b.includes('_')) return null; // dated delivery contracts, e.g. BTCUSDT_240628
  let mult = 1;
  if (b.startsWith('1000000')) {
    b = b.slice(7);
    mult = 1_000_000;
  } else if (b.startsWith('1M') && b.length > 3) {
    b = b.slice(2);
    mult = 1_000_000;
  } else if (b.startsWith('1000')) {
    b = b.slice(4);
    mult = 1000;
  }
  if (b === 'LUNA2') b = 'LUNA'; // Terra 2.0 — same asset as spot LUNA
  return b ? { base: b, mult } : null;
}

interface PerpInfo {
  symbol: string; // raw Binance symbol, e.g. 1000PEPEUSDT
  base: string; // normalised base coin, e.g. PEPE — the app-wide identity
  mult: number;
}

// Tradeable USDT perp instrument map from exchangeInfo, cached 6h (weight 1;
// listings change rarely). underlyingType filter drops the index perps
// (BTCDOMUSDT-style baskets) — no spot leg, not 妖幣.
let perpMapCache: { at: number; bySymbol: Map<string, PerpInfo>; byBase: Map<string, PerpInfo> } | null = null;

async function getPerpMap(bn: BnBase): Promise<{ bySymbol: Map<string, PerpInfo>; byBase: Map<string, PerpInfo> }> {
  if (perpMapCache && Date.now() - perpMapCache.at < 6 * 3600_000) return perpMapCache;
  const j = await bnGet(bn.fapi, '/fapi/v1/exchangeInfo');
  const bySymbol = new Map<string, PerpInfo>();
  const byBase = new Map<string, PerpInfo>();
  for (const s of j.symbols ?? []) {
    if (s.contractType !== 'PERPETUAL' || s.status !== 'TRADING' || s.quoteAsset !== 'USDT') continue;
    if (s.underlyingType && s.underlyingType !== 'COIN') continue;
    const p = parseUmSymbol(s.symbol);
    if (!p) continue;
    const info: PerpInfo = { symbol: s.symbol, base: p.base, mult: p.mult };
    bySymbol.set(info.symbol, info);
    if (!byBase.has(p.base)) byBase.set(p.base, info);
  }
  if (bySymbol.size < 50) throw new Error(`binance perp universe suspiciously small (${bySymbol.size})`);
  perpMapCache = { at: Date.now(), bySymbol, byBase };
  return perpMapCache;
}

async function resolvePerp(bn: BnBase, base: string): Promise<PerpInfo> {
  const { byBase } = await getPerpMap(bn);
  const info = byBase.get(base.toUpperCase());
  if (!info) throw new Error(`${base} 冇 Binance USD-M 永續上市`);
  return info;
}

// Native, clock-aligned CLOSED perp candles for the post-push entry watcher.
// Unlike the rolling scanner's 5m display grid, these bars are consumed as
// execution evidence, so an in-progress final bar must never participate.
export async function fetchClosedPerpCandles(
  bn: BnBase,
  base: string,
  interval: '15m' | '1h',
  limit = 64,
): Promise<Candle[]> {
  const p = await resolvePerp(bn, base);
  const rows: any[] = await bnGet(
    bn.fapi,
    `/fapi/v1/klines?symbol=${p.symbol}&interval=${interval}&limit=${Math.max(2, Math.min(500, limit))}`,
  );
  const now = Date.now();
  return rows
    .filter((r) => Number(r[6]) < now)
    .map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]) / p.mult,
      high: Number(r[2]) / p.mult,
      low: Number(r[3]) / p.mult,
      close: Number(r[4]) / p.mult,
    }))
    .filter((c) => Number.isFinite(c.close) && c.close > 0);
}

export async function fetchClosedPerpOhlcv(
  bn: BnBase,
  base: string,
  interval: '15m' | '1h',
  limit = 120,
): Promise<{ candles: Candle[]; volume: VolumeBar[] }> {
  const p = await resolvePerp(bn, base);
  const rows: any[] = await bnGet(
    bn.fapi,
    `/fapi/v1/klines?symbol=${p.symbol}&interval=${interval}&limit=${Math.max(2, Math.min(500, limit))}`,
  );
  const now = Date.now();
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  for (const r of rows) {
    if (Number(r[6]) >= now) continue;
    const time = Math.floor(Number(r[0]) / 1000);
    const open = Number(r[1]) / p.mult;
    const high = Number(r[2]) / p.mult;
    const low = Number(r[3]) / p.mult;
    const close = Number(r[4]) / p.mult;
    const value = Number(r[7]);
    const takerBuy = Number(r[10]);
    if (![open, high, low, close, value].every(Number.isFinite) || !(close > 0)) continue;
    candles.push({ time, open, high, low, close });
    volume.push({ time, value, up: close >= open, ...(Number.isFinite(takerBuy) ? { takerBuy } : {}) });
  }
  return { candles, volume };
}

// Funding cashflows for a long position over an exact research horizon.
// Binance returns decimal rates (for example 0.0001 = 1 bp).  Keeping this
// beside the native-bar fetch guarantees the evaluator never mixes symbols or
// multiplier-normalised prices when it accounts for carrying cost.
export async function fetchPerpFundingCharges(
  bn: BnBase,
  base: string,
  startTs: number,
  endTs: number,
): Promise<Array<{ ts: number; rate: number }>> {
  const p = await resolvePerp(bn, base);
  if (!(Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs)) return [];
  const rows: any[] = await bnGet(
    bn.fapi,
    `/fapi/v1/fundingRate?symbol=${p.symbol}&startTime=${Math.floor(startTs)}` +
      `&endTime=${Math.floor(endTs)}&limit=100`,
  );
  return rows
    .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.rate) && r.ts >= startTs && r.ts <= endTs)
    .sort((a, b) => a.ts - b.ts);
}

// Fresh normalized mark used as the price frozen into a successful Telegram
// push/watch. One cached bulk ticker request serves every alert in the sweep.
export async function fetchPerpMark(bn: BnBase, base: string): Promise<number> {
  const p = await resolvePerp(bn, base);
  const rows = await getAllTickers(bn);
  const row = rows.find((r) => r.symbol === p.symbol);
  const px = Number(row?.lastPrice) / p.mult;
  if (!(px > 0)) throw new Error(`no fresh mark for ${base}`);
  return px;
}

// bulk perp tickers cached briefly so the search tab filters client-side per
// keystroke. One request, weight 40.
let tickersCache: { at: number; rows: any[] } | null = null;

async function getAllTickers(bn: BnBase): Promise<any[]> {
  if (tickersCache && Date.now() - tickersCache.at < 60_000) return tickersCache.rows;
  const rows = await bnGet(bn.fapi, '/fapi/v1/ticker/24hr');
  tickersCache = { at: Date.now(), rows };
  return rows;
}

// S1: one bulk request → every spot USDT pair's last price + 24h USD volume,
// keyed by NORMALISED base coin (1000SATSUSDT → SATS with price ÷1000, so the
// perp/spot basis math needs no special-casing). Spot quoteVolume is quote-
// currency (USDT) volume = USD directly. 60s cache; zero-volume rows dropped —
// a delisted pair's stale lastPrice would corrupt the basis.
export interface SpotInfo {
  symbol: string;
  mult: number;
  last: number; // per-coin (÷mult)
  volUsd: number;
}
let spotTickersCache: { at: number; rows: Map<string, SpotInfo> } | null = null;

export async function getSpotTickers(bn: BnBase): Promise<Map<string, SpotInfo>> {
  if (spotTickersCache && Date.now() - spotTickersCache.at < 60_000) return spotTickersCache.rows;
  const rows = await bnGet(bn.spot, '/api/v3/ticker/24hr');
  const map = new Map<string, SpotInfo>();
  for (const r of rows) {
    const p = parseUmSymbol(r.symbol);
    if (!p) continue;
    const last = Number(r.lastPrice) / p.mult;
    const volUsd = Number(r.quoteVolume);
    if (!Number.isFinite(last) || last <= 0 || !(volUsd > 0)) continue;
    const prev = map.get(p.base);
    if (prev && prev.volUsd >= volUsd) continue; // rare normalisation collision — keep the liquid one
    map.set(p.base, { symbol: r.symbol, mult: p.mult, last, volUsd });
  }
  spotTickersCache = { at: Date.now(), rows: map };
  return map;
}

// Perp/spot basis + spot USD volume for one coin (perp last is per-coin here,
// like every price in this module). undefined spot = pure-perp listing → all
// null. Positive basis = perp premium (槓桿主導); negative = spot premium.
function spotFields(
  perpLast: number,
  s: SpotInfo | undefined,
): { spotVol24h: number | null; basisPct: number | null } {
  if (!s) return { spotVol24h: null, basisPct: null };
  return {
    spotVol24h: Math.round(s.volUsd),
    basisPct: s.last > 0 && perpLast > 0 ? Number(((perpLast / s.last - 1) * 100).toFixed(3)) : null,
  };
}

// Per-sweep OI snapshot for the warm store. Binance has NO bulk-OI endpoint, so
// this fans out /fapi/v1/openInterest (weight 1 each; contracts are base-asset
// units, × the ticker's raw lastPrice = USD notional — mult cancels). conc 4 /
// 350ms ≈ 10 req/s clears the 528-coin universe in ~55s at ~600 weight/min,
// leaving the minute's budget to the kline pool that follows. (Measured
// 2026-07-07: request latency on this pipe is ~50-100ms, so throughput is
// spacing-bound — pace for THAT, not for an assumed 250ms latency.) Per-coin
// best-effort so one dead symbol can't kill the snapshot.
// Returned rows are keyed by BASE coin — the warm store's key since the
// 2026-07-07 Binance migration (OKX-era `X-USDT-SWAP` keys are never touched,
// so the two exchanges' OI levels can never splice into one series).
export async function fetchBulkOi(
  bn: BnBase,
  universe: Array<{ instId: string; base: string; last: number }>,
): Promise<Array<{ instId: string; oiQty: number; oiUsd: number }>> {
  const out: Array<{ instId: string; oiQty: number; oiUsd: number }> = [];
  await mapPool(
    universe,
    4,
    async (u) => {
      try {
        const j = await bnGet(bn.fapi, `/fapi/v1/openInterest?symbol=${u.instId}`, 2);
        const oiQty = Number(j.openInterest);
        const oiUsd = oiQty * u.last;
        if (Number.isFinite(oiQty) && oiQty > 0 && Number.isFinite(oiUsd) && oiUsd > 0) {
          out.push({ instId: u.base, oiQty, oiUsd: Math.round(oiUsd) });
        }
      } catch {
        /* per-coin best effort */
      }
    },
    350,
  );
  return out;
}

// Search every listed USDT perp by symbol substring. Empty query = top by
// volume (discovery). Prefix matches rank above substring matches.
export async function searchInstruments(bn: BnBase, query: string): Promise<SearchHit[]> {
  const [{ bySymbol }, rows] = await Promise.all([getPerpMap(bn), getAllTickers(bn)]);
  const q = query.trim().toUpperCase();
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const info = bySymbol.get(r.symbol);
    if (!info) continue;
    if (q && !info.base.includes(q)) continue;
    const last = Number(r.lastPrice);
    const vol = Number(r.quoteVolume);
    if (!(last > 0) || !Number.isFinite(vol)) continue;
    hits.push({
      instId: info.symbol,
      base: info.base,
      last: last / info.mult,
      change24h: Number(r.priceChangePercent) || 0,
      vol24hUsd: vol,
    });
  }
  hits.sort((a, b) => {
    const ap = q && a.base.startsWith(q) ? 0 : 1;
    const bp = q && b.base.startsWith(q) ? 0 : 1;
    return ap - bp || b.vol24hUsd - a.vol24hUsd;
  });
  return hits.slice(0, 30);
}

// P1: trustworthy recent 4h OI %change from the warm store (fully warm OR ≥4.5h
// partial-warm), or null when the store can't serve a fresh recent trend. The
// analyze() call prefers this over the openInterestHist series for the oi4h
// field + the OI-gated signals. Store keys are base coins.
function oi4hLiveFromStore(base: string, nowMs: number): number | null {
  const arr = getRecentSeries(base, nowMs);
  if (!arr) return null;
  const refT = Math.floor(nowMs / 1000) - 4 * 3600;
  let ref: number | null = null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].t <= refT) {
      ref = arr[i].v;
      break;
    }
  }
  if (ref == null || !(ref > 0)) return null;
  return (arr[arr.length - 1].v / ref - 1) * 100;
}

function oiQtyFieldsFromStore(
  base: string,
  asOfMs: number,
): Pick<Coin, 'oiQty' | 'oiQty1h' | 'oiQty4h'> {
  const q = oiQtyChangeFromStore(base, asOfMs);
  return {
    oiQty: q?.current ?? null,
    oiQty1h: q?.change1h ?? null,
    oiQty4h: q?.change4h ?? null,
  };
}

// P1: on the first scan, warm the OI store from persisted recordings so coins
// are trustworthy right after app open instead of waiting hours of live sweeps.
// Browser-only: the dev/exe server serves GET /recordings (UTC-day files); in
// the Node recorder the relative-URL fetch throws and is ignored (the recorder
// warms from its own continuous sweeps). Runs once per process. Only
// source==='binance' lines are applied (oiStore filters) — OKX-era oiUsd is a
// different exchange's OI and must not splice into Binance series.
let oiBackfilled = false;
async function backfillOiOnce(nowMs: number): Promise<void> {
  if (oiBackfilled) return;
  oiBackfilled = true;
  try {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const res = await fetch(`/recordings?from=${day(nowMs - 3 * 86400000)}&to=${day(nowMs)}`);
    if (!res.ok) return;
    const text = await res.text();
    if (!text.trim()) return;
    const n = backfillFromRecords(text);
    console.log(`[oi] backfilled ${n} recorded sweeps into the warm store (${storeSize()} coins)`);
  } catch {
    /* no server (Node recorder) / offline — the store warms from live sweeps */
  }
}

// One kline request → candles + quote-USD volume + the canonical time grid.
// Binance returns ASCENDING rows [openTime, o, h, l, c, baseVol, closeTime,
// quoteVol, trades, takerBuyBase, takerBuyQuote, _] with the in-progress bar
// last, up to limit 1500 (fapi) / 1000 (spot) — so the OKX two-page pagination
// is gone entirely. Prices are normalised per-coin (÷mult).
async function fetchKlines(
  host: string,
  path: string,
  symbol: string,
  interval: string,
  limit: number,
  mult: number,
  tzShift: number,
): Promise<{ candles: Candle[]; volume: VolumeBar[]; times: number[] }> {
  const rows: any[] = await bnGet(host, `${path}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  const times: number[] = [];
  for (const r of rows) {
    const time = Math.floor(Number(r[0]) / 1000) + tzShift;
    const open = Number(r[1]) / mult;
    const high = Number(r[2]) / mult;
    const low = Number(r[3]) / mult;
    const close = Number(r[4]) / mult;
    const quoteVol = Number(r[7]); // quote (USDT) notional — mult-agnostic
    times.push(time);
    candles.push({ time, open, high, low, close });
    const takerBuy = Number(r[10]);
    volume.push({ time, value: quoteVol, up: close >= open, ...(Number.isFinite(takerBuy) ? { takerBuy } : {}) });
  }
  return { candles, volume, times };
}

function getCandles(bn: BnBase, p: { symbol: string; mult: number }, tzShift: number) {
  return fetchKlines(bn.fapi, '/fapi/v1/klines', p.symbol, '5m', BASE_BARS, p.mult, tzShift);
}

// Funding history, cached raw for 30 min. Funding events land every 4-8h, so a
// per-sweep refetch of 355 coins is pure waste — and /fapi/v1/fundingRate has
// its own shared 500-req/5min budget that two instances on one IP could blow.
// Cached points are raw epoch-seconds + % — callers add tzShift at resample
// time. limit=300 (~100d at 8h) serves both the 48h base grid and the long
// series from one entry.
const FUNDING_TTL_MS = 30 * 60_000;
const fundingCache = new Map<string, { at: number; src: Array<{ t: number; v: number }> }>();

async function getFundingSrc(bn: BnBase, symbol: string): Promise<Array<{ t: number; v: number }>> {
  const c = fundingCache.get(symbol);
  if (c && Date.now() - c.at < FUNDING_TTL_MS) return c.src;
  const rows: any[] = await bnGet(bn.fapi, `/fapi/v1/fundingRate?symbol=${symbol}&limit=300`);
  const src = rows
    .map((r) => ({ t: Math.floor(Number(r.fundingTime) / 1000), v: Number(r.fundingRate) * 100 }))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  fundingCache.set(symbol, { at: Date.now(), src });
  return src;
}

async function getFunding(bn: BnBase, symbol: string, tzShift: number, times: number[]): Promise<SeriesPoint[]> {
  const src = await getFundingSrc(bn, symbol);
  return resample(
    times,
    src.map((p) => ({ t: p.t + tzShift, v: p.v })),
  ); // empty -> flat 0 line, acceptable
}

// Cold-path 5m OI series from openInterestHist (limit 500 ≈ 41h; 30d retention).
// It parses USD (`sumOpenInterestValue`) for the legacy chart/analyze series and
// raw quantity (`sumOpenInterest`) for the independent confirmation store.
// Unlike OKX rubik this endpoint's tail is
// FRESH (probed 2026-07-07: lag ≤6.7min), but the P1 discipline is unchanged:
// gates still read oi4h from the warm store only, this series is display/
// analyze history. The SAME response also cold-start-seeds the warm store
// (seedFromHist, scaled onto the snapshot level) so a first-seen coin's oi4h
// is trustworthy this very sweep — the EPIC 2026-07-07 miss class. futures/
// data budget: ~1000 req/5min IP-wide — the cold pool in runRollingScan is
// paced for it.
let seededThisSweep = 0; // reset per runRollingScan, reported in its final log

interface OiHistPoint {
  t: number;
  v: number; // sumOpenInterestValue (USD display/history unit)
  q: number; // sumOpenInterest (raw contract quantity)
}

function qtyChangeFromHist(
  src: Array<{ t: number; q: number }>,
  asOfMs: number,
  refMaxLagS: number,
): OiQtyChange | null {
  if (!Number.isFinite(asOfMs)) return null;
  const asOf = Math.floor(asOfMs / 1000);
  const points = src.filter((p) => p.t <= asOf && Number.isFinite(p.q) && p.q > 0).sort((a, b) => a.t - b.t);
  if (points.length < 3) return null;
  const current = points[points.length - 1];
  if (asOf - current.t > 10 * 60) return null;
  const refAt = (seconds: number): number | null => {
    const target = current.t - seconds;
    for (let i = points.length - 2; i >= 0; i--) {
      if (points[i].t <= target) return target - points[i].t <= refMaxLagS ? points[i].q : null;
    }
    return null;
  };
  const q1 = refAt(3600);
  const q4 = refAt(4 * 3600);
  if (!(q1 != null && q1 > 0 && q4 != null && q4 > 0)) return null;
  return {
    observedAt: current.t * 1000,
    current: current.q,
    change1h: (current.q / q1 - 1) * 100,
    change4h: (current.q / q4 - 1) * 100,
  };
}

// Targeted exact-as-of quantity read for a completed 15m close. Recorder uses
// this only for price-qualified candidates/active watches, avoiding another
// full-universe snapshot fan-out. Quantity is read from sumOpenInterest only;
// sumOpenInterestValue is deliberately ignored.
export async function fetchOiQtyChange(
  bn: BnBase,
  base: string,
  asOfMs: number,
): Promise<OiQtyChange | null> {
  const p = await resolvePerp(bn, base);
  const rows: any[] = await bnGet(
    bn.fapi,
    `/futures/data/openInterestHist?symbol=${p.symbol}&period=5m&limit=500`,
  );
  const src = rows
    .map((r) => ({ t: Math.floor(Number(r.timestamp) / 1000), q: Number(r.sumOpenInterest) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.q) && r.q > 0);
  return qtyChangeFromHist(src, asOfMs, 10 * 60);
}

async function getOiSrc(bn: BnBase, symbol: string): Promise<OiHistPoint[]> {
  const rows: any[] = await bnGet(bn.fapi, `/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=500`);
  return rows
    .map((r) => ({
      t: Math.floor(Number(r.timestamp) / 1000),
      v: Number(r.sumOpenInterestValue),
      q: Number(r.sumOpenInterest),
    }))
    .filter((p) => Number.isFinite(p.v) && p.v > 0 && Number.isFinite(p.q) && p.q > 0)
    .sort((a, b) => a.t - b.t);
}

async function getOi(bn: BnBase, symbol: string, base: string, tzShift: number, times: number[]): Promise<SeriesPoint[]> {
  const src = await getOiSrc(bn, symbol);
  if (!src.length) throw new Error(`no OI history for ${symbol}`);
  if (seedFromHist(base, src, Date.now())) seededThisSweep++;
  return resample(
    times,
    src.map((p) => ({ t: p.t + tzShift, v: p.v })),
  );
}

// ---- deep 5m history (the 5m/15m CHART tabs' 14-day depth) -----------------
// Display-only depth (Coin.deep): the 48h base stays the one and only detector
// grid. The HISTORY parts never change, so they're cached 10 min per symbol —
// the 20s detail poll pays ~0 for depth, and tail freshness comes from merging
// the freshly-fetched 48h base over the cached history at assembly time.
const DEEP_DAYS = 14;
const DEEP_BARS = DEEP_DAYS * 288; // 4032 5m bars
const DEEP_TTL_MS = 10 * 60_000;
interface DeepParts {
  at: number;
  candles: Candle[]; // ~14d of 5m, prices per-coin, times tz-shifted
  volume: VolumeBar[];
  oi1hSrc: OiHistPoint[]; // raw 1h openInterestHist (~20d), epoch-s
}
const deepCache = new Map<string, DeepParts>();

// 5m klines paged backwards via endTime: 3 × limit-1500 (weight 10 each) ≈ 14d.
async function fetchKlines5mDeep(bn: BnBase, p: { symbol: string; mult: number }, tzShift: number) {
  let rows: any[] = [];
  let endTime: number | null = null;
  for (let page = 0; page < 3; page++) {
    const q =
      `/fapi/v1/klines?symbol=${p.symbol}&interval=5m&limit=1500` + (endTime ? `&endTime=${endTime}` : '');
    const pg: any[] = await bnGet(bn.fapi, q);
    if (!pg.length) break;
    rows = pg.concat(rows);
    endTime = Number(pg[0][0]) - 1;
    if (rows.length >= DEEP_BARS || pg.length < 1500) break;
  }
  const seen = new Set<number>();
  const asc = rows
    .filter((r) => (seen.has(Number(r[0])) ? false : (seen.add(Number(r[0])), true)))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-DEEP_BARS);
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  for (const r of asc) {
    const time = Math.floor(Number(r[0]) / 1000) + tzShift;
    const open = Number(r[1]) / p.mult;
    const close = Number(r[4]) / p.mult;
    candles.push({ time, open, high: Number(r[2]) / p.mult, low: Number(r[3]) / p.mult, close });
    const takerBuy = Number(r[10]);
    volume.push({ time, value: Number(r[7]), up: close >= open, ...(Number.isFinite(takerBuy) ? { takerBuy } : {}) });
  }
  return { candles, volume };
}

async function getDeepParts(bn: BnBase, p: PerpInfo, tzShift: number): Promise<DeepParts> {
  const hit = deepCache.get(p.symbol);
  if (hit && Date.now() - hit.at < DEEP_TTL_MS) return hit;
  const [klines, oiRows] = await Promise.all([
    fetchKlines5mDeep(bn, p, tzShift),
    bnGet(bn.fapi, `/futures/data/openInterestHist?symbol=${p.symbol}&period=1h&limit=500`).catch(() => [] as any[]),
  ]);
  const oi1hSrc = (oiRows as any[])
    .map((r) => ({
      t: Math.floor(Number(r.timestamp) / 1000),
      v: Number(r.sumOpenInterestValue),
      q: Number(r.sumOpenInterest),
    }))
    .filter((pt) => Number.isFinite(pt.v) && pt.v > 0 && Number.isFinite(pt.q) && pt.q > 0)
    .sort((a, b) => a.t - b.t);
  const parts: DeepParts = { at: Date.now(), candles: klines.candles, volume: klines.volume, oi1hSrc };
  deepCache.set(p.symbol, parts);
  return parts;
}

// Merge cached history below the fresh 48h base, resample OI (1h history below
// the 41h 5m window — same endpoint, same USD unit, coarser buckets) + funding
// onto the merged grid, and derive the strength line. Pure CPU.
function assembleDeep(
  parts: DeepParts,
  base: { candles: Candle[]; volume: VolumeBar[]; times: number[] },
  oiSrc5m: OiHistPoint[],
  fundingSrc: Array<{ t: number; v: number }>,
  tzShift: number,
): LongSeries {
  const firstBaseT = base.times[0];
  const candles = parts.candles.filter((c) => c.time < firstBaseT).concat(base.candles);
  const volume = parts.volume.filter((v) => v.time < firstBaseT).concat(base.volume);
  const times = candles.map((c) => c.time);
  const first5m = oiSrc5m.length ? oiSrc5m[0].t : Infinity;
  const oiMerged = parts.oi1hSrc.filter((pt) => pt.t < first5m).concat(oiSrc5m);
  const oi = oiMerged.length
    ? resample(
        times,
        oiMerged.map((pt) => ({ t: pt.t + tzShift, v: pt.v })),
      )
    : times.map((t) => ({ time: t, value: 0 }));
  const fundingHist = resample(
    times,
    fundingSrc.map((pt) => ({ t: pt.t + tzShift, v: pt.v })),
  );
  const strengthHist = computeStrengthSeries(candles, volume, oi, fundingHist);
  return { candles, volume, oi, fundingHist, strengthHist };
}

// The 1H long-history series for a detail coin's higher timeframes. Independent
// of the 5m series above; failures are non-fatal (1h/4h fall back to the 48h
// 5m base). ~25d candles, ~20d OI (openInterestHist 1h ×500), ~100d funding —
// all real, resampled onto the candle grid.
async function getLongSeries(bn: BnBase, p: PerpInfo, tzShift: number): Promise<LongSeries | undefined> {
  try {
    const { candles, volume, times } = await fetchKlines(bn.fapi, '/fapi/v1/klines', p.symbol, '1h', LONG_BARS, p.mult, tzShift);
    if (candles.length < LONG_MIN_BARS) return undefined;

    const [oi, fundingHist] = await Promise.all([
      bnGet(bn.fapi, `/futures/data/openInterestHist?symbol=${p.symbol}&period=1h&limit=500`)
        .then((rows: any[]) => {
          const src = rows
            .map((r) => ({ t: Math.floor(Number(r.timestamp) / 1000) + tzShift, v: Number(r.sumOpenInterestValue) }))
            .filter((pt) => Number.isFinite(pt.v))
            .sort((a, b) => a.t - b.t);
          return src.length ? resample(times, src) : times.map((t) => ({ time: t, value: 0 }));
        })
        .catch(() => times.map((t) => ({ time: t, value: 0 }))),
      getFunding(bn, p.symbol, tzShift, times).catch(() => times.map((t) => ({ time: t, value: 0 }))),
    ]);

    const strengthHist = computeStrengthSeries(candles, volume, oi, fundingHist, 1);
    return { candles, volume, oi, fundingHist, strengthHist };
  } catch {
    return undefined;
  }
}

// ---- 早期蓄力 confirmation data (fetched only for pre-filtered candidates) --

// BTC 24h return in % — one scalar per sweep, shared by every coin's
// relative-strength check. Null on failure (EA checks then skip silently).
async function getBtcRet24h(bn: BnBase): Promise<number | null> {
  try {
    const rows: any[] = await bnGet(bn.fapi, '/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=25');
    if (rows.length < 25) return null;
    const then = Number(rows[0][4]); // ascending — oldest first
    const now = Number(rows[rows.length - 1][4]);
    return then > 0 ? (now / then - 1) * 100 : null;
  } catch {
    return null;
  }
}

// E3: BTC market regime for per-regime lift stratification. 1H closes, last 200
// bars; ret7d = close / close[168h ago] − 1. up ≥ +5%, down ≤ −5%, else chop.
// FROZEN rule (comparability — threshold changes require editing docs/roadmap/
// E3-regime.md). Module-cached 15 min so the sweep's two meta writers share one
// klines call. Null on failure → writers omit the tag (untagged slots are excluded
// from regime-filtered eval, never mislabelled).
export interface BtcRegime {
  regime: 'up' | 'down' | 'chop';
  ret7d: number;
}
let btcRegimeCache: { at: number; val: BtcRegime } | null = null;
export async function getBtcRegime(bn: BnBase): Promise<BtcRegime | null> {
  if (btcRegimeCache && Date.now() - btcRegimeCache.at < 15 * 60_000) return btcRegimeCache.val;
  try {
    const rows: any[] = await bnGet(bn.fapi, '/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=200');
    if (rows.length < 169) return null;
    const now = Number(rows[rows.length - 1][4]);
    const then = Number(rows[rows.length - 1 - 168][4]); // 168h = 7d ago
    if (!(then > 0) || !(now > 0)) return null;
    const ret7d = (now / then - 1) * 100;
    const val: BtcRegime = { regime: ret7d >= 5 ? 'up' : ret7d <= -5 ? 'down' : 'chop', ret7d: Number(ret7d.toFixed(2)) };
    btcRegimeCache = { at: Date.now(), val };
    return val;
  } catch {
    return null;
  }
}

// Retail long/short account ratio drop over 24h, in % (positive = retail gave
// up longs). futures/data endpoint (30d retention), ascending rows — call only
// for candidates.
async function getLsDrop24h(bn: BnBase, symbol: string): Promise<number | null> {
  try {
    const rows: any[] = await bnGet(
      bn.fapi,
      `/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=25`,
    );
    if (rows.length < 25) return null;
    const then = Number(rows[0].longShortRatio);
    const now = Number(rows[rows.length - 1].longShortRatio);
    if (!(now > 0) || !(then > 0)) return null;
    return (1 - now / then) * 100;
  } catch {
    return null;
  }
}

// S2: a candidate's spot 5m klines (~48h) + volume. null when the coin has no
// spot pair or the fetch fails (caller filters by the spot map anyway).
async function getSpotCandles(
  bn: BnBase,
  base: string,
  tzShift: number,
): Promise<{ candles: Candle[]; volume: VolumeBar[]; times: number[] } | null> {
  try {
    const s = (await getSpotTickers(bn)).get(base);
    if (!s) return null;
    return await fetchKlines(bn.spot, '/api/v3/klines', s.symbol, '5m', BASE_BARS, s.mult, tzShift);
  } catch {
    return null;
  }
}

// S2: spot taker BUY share over the last 24h, straight from spot 1h klines
// (takerBuyQuoteVol idx10 / quoteVol idx7) — no separate stats endpoint needed
// on Binance, and it's a clean USD-over-USD ratio (the OKX rubik unit caveat is
// gone). Spot budget, weight 2.
async function getSpotTakerBuyShare24h(bn: BnBase, base: string): Promise<number | null> {
  try {
    const s = (await getSpotTickers(bn)).get(base);
    if (!s) return null;
    const rows: any[] = await bnGet(bn.spot, `/api/v3/klines?symbol=${s.symbol}&interval=1h&limit=24`);
    let buy = 0;
    let tot = 0;
    for (const r of rows) {
      buy += Number(r[10]) || 0;
      tot += Number(r[7]) || 0;
    }
    return tot > 0 ? buy / tot : null;
  } catch {
    return null;
  }
}

// On-demand fetch + analysis for one perp picked in the search tab. OI or
// funding may be missing for tiny listings — degrade to a flat zero series
// rather than failing the whole view.
//
// Latency shape (user-felt detail-open time): everything that does NOT need the
// 5m candle time grid — the 1H long series, the bulk spot map and the spot
// series — is kicked off IMMEDIATELY and awaited late, same as the OKX-era
// flow (single-request klines already removed one page round-trip).
export async function fetchLiveCoin(bn: BnBase, baseSym: string, nowMs: number): Promise<Coin> {
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  const p = await resolvePerp(bn, baseSym);
  const pLong = getLongSeries(bn, p, tzShift);
  const pDeep = getDeepParts(bn, p, tzShift).catch(() => null); // 10-min cached history for the 5m/15m depth
  const pSpotMap = getSpotTickers(bn).catch(() => new Map<string, SpotInfo>());
  const pSpotExtras = pSpotMap
    .then((m) =>
      m.get(p.base)
        ? Promise.all([getSpotCandles(bn, p.base, tzShift), getSpotTakerBuyShare24h(bn, p.base)])
        : null,
    )
    .catch(() => null);
  // if candles throw below (too-new listing), these are already in flight —
  // mark them handled so the abort doesn't surface as an unhandled rejection
  pLong.catch(() => {});

  const { candles, volume, times } = await getCandles(bn, p, tzShift);
  if (candles.length < MIN_BARS) throw new Error(`${p.base} 上市時間過短，歷史 K 線不足`);
  const flat = (): SeriesPoint[] => times.map((t) => ({ time: t, value: 0 }));
  // raw sources fetched once, shared by the 48h base grid AND the deep grid
  const [oiSrc, fundingSrc] = await Promise.all([
    getOiSrc(bn, p.symbol).catch(() => [] as OiHistPoint[]),
    getFundingSrc(bn, p.symbol).catch(() => [] as Array<{ t: number; v: number }>),
  ]);
  if (oiSrc.length && seedFromHist(p.base, oiSrc, Date.now())) seededThisSweep++;
  const shift = (src: Array<{ t: number; v: number }>) => src.map((pt) => ({ t: pt.t + tzShift, v: pt.v }));
  const oi = oiSrc.length ? resample(times, shift(oiSrc)) : flat();
  const fundingHist = fundingSrc.length ? resample(times, shift(fundingSrc)) : flat();
  const derived = analyze({ candles, volume, oi, fundingHist, oi4hLive: oi4hLiveFromStore(p.base, nowMs) ?? undefined });
  const qty = oiQtyFieldsFromStore(p.base, nowMs);
  const coldQty = qtyChangeFromHist(oiSrc, nowMs, 10 * 60);
  const coin: Coin = {
    symbol: p.base,
    candles,
    volume,
    oi,
    fundingHist,
    ...derived,
    oiQty1h: qty.oiQty1h ?? coldQty?.change1h ?? null,
    oiQty4h: qty.oiQty4h ?? coldQty?.change4h ?? null,
    // The cold response carries real quantity even when this on-demand coin
    // has no live store anchor yet; trends remain null until trusted.
    oiQty: qty.oiQty ?? coldQty?.current ?? oiSrc[oiSrc.length - 1]?.q ?? null,
    earlyAccum: null,
    long: await pLong,
  };
  const deepParts = await pDeep;
  if (deepParts) {
    try {
      coin.deep = assembleDeep(deepParts, { candles, volume, times }, oiSrc, fundingSrc, tzShift);
    } catch {
      /* depth is best-effort — the 5m/15m tabs fall back to the 48h base */
    }
  }

  // 早期蓄力 watchlist check for on-demand opens too (cheap gate first, the
  // two extra requests only when the setup is actually on)
  const setup = detectEarlySetup(candles, oi, fundingHist);
  if (setup) {
    const [btcRet, lsDrop] = await Promise.all([getBtcRet24h(bn), getLsDrop24h(bn, p.symbol)]);
    const ret = coinRet24h(candles);
    if (btcRet !== null && ret !== null) {
      coin.earlyAccum = confirmEarlyAccum(setup, lsDrop, ret - btcRet);
    }
  }
  // S1: perp/spot basis for the detail header (bulk spot map is 60s-cached).
  const spot = await pSpotMap;
  const sf = spotFields(candles[candles.length - 1].close, spot.get(p.base));
  coin.spotVol24h = sf.spotVol24h;
  coin.basisPct = sf.basisPct;
  const extras = await pSpotExtras;
  if (extras) {
    const [sc, taker] = extras;
    if (sc) {
      coin.spotCandles = sc.candles;
      coin.spotVolume = sc.volume;
    }
    coin.spotTakerBuyShare24h = taker;
  }
  return coin;
}

// S3 micro-scan: warm-only single-coin fetch. Same candle/funding/analyze path
// as fetchLiveCoin (so flushBreakout is computed identically), but OI comes
// from the WARM STORE only — a cold coin (store empty/stale) returns null so
// the caller skips it. Do NOT route the detail view through this: its OI
// series is coarser than the openInterestHist pull.
export async function fetchLiveCoinWarm(bn: BnBase, baseSym: string, nowMs: number): Promise<Coin | null> {
  const warm = getWarmOi(baseSym, nowMs);
  if (!warm) return null; // cold — warm store can't serve OI; skip (hard warm-only rule)
  let p: PerpInfo;
  try {
    p = await resolvePerp(bn, baseSym);
  } catch {
    return null;
  }
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  const { candles, volume, times } = await getCandles(bn, p, tzShift);
  if (candles.length < MIN_BARS) return null;
  const oi = resample(
    times,
    warm.map((pt) => ({ t: pt.t + tzShift, v: pt.v })),
  );
  const fundingHist = await getFunding(bn, p.symbol, tzShift, times).catch(
    () => times.map((t) => ({ time: t, value: 0 })),
  );
  const derived = analyze({ candles, volume, oi, fundingHist, oi4hLive: oi4hLiveFromStore(p.base, nowMs) ?? undefined });
  return {
    symbol: p.base,
    candles,
    volume,
    oi,
    fundingHist,
    ...derived,
    ...oiQtyFieldsFromStore(p.base, nowMs),
    earlyAccum: null,
  };
}

// Full scan universe: every tradeable Binance USDT perp (exchangeInfo-filtered),
// ranked by live 24h USD volume. No size cap — the rolling scan works through
// all of them in batches. The old OKX∩Binance intersection is gone: Binance IS
// the universe now.
interface Ticker {
  instId: string; // raw Binance symbol
  base: string;
  mult: number;
  last: number; // RAW last price (× mult) — used for OI USD-ization
  vol24hUsd: number;
}

export async function getUniverse(bn: BnBase): Promise<Ticker[]> {
  const [{ bySymbol }, rows] = await Promise.all([getPerpMap(bn), getAllTickers(bn)]);
  const byBase = new Map<string, Ticker>();
  for (const r of rows) {
    const info = bySymbol.get(r.symbol);
    if (!info) continue;
    const last = Number(r.lastPrice);
    const vol = Number(r.quoteVolume);
    if (!(last > 0) || !Number.isFinite(vol)) continue;
    const t: Ticker = { instId: info.symbol, base: info.base, mult: info.mult, last, vol24hUsd: vol };
    const prev = byBase.get(info.base);
    if (!prev || vol > prev.vol24hUsd) byBase.set(info.base, t);
  }
  return [...byBase.values()].sort((a, b) => b.vol24hUsd - a.vol24hUsd);
}

// coin's own 24h return from its 5m candles, in %
function coinRet24h(candles: Candle[]): number | null {
  const n = candles.length;
  if (n < 289) return null;
  const then = candles[n - 289].close;
  return then > 0 ? (candles[n - 1].close / then - 1) * 100 : null;
}

// Stable reorder: items whose key appears in `priority` come first (in priority
// order), everything else keeps its original relative order.
export function prioritize<T>(items: T[], key: (t: T) => string, priority: string[]): T[] {
  const rank = new Map(priority.map((s, i) => [s, i]));
  return [...items].sort(
    (a, b) => (rank.get(key(a)) ?? Infinity) - (rank.get(key(b)) ?? Infinity),
  );
}

// 24h close sparkline @ 30-min resolution — the sweep already has the full
// series here; keep ~48 points so the screener can draw a trend thumbnail
function sparkOf(candles: Candle[]): number[] {
  const win = candles.slice(Math.max(0, candles.length - 289));
  const pts: number[] = [];
  for (let i = 0; i < win.length; i += 6) pts.push(win[i].close);
  const last = win[win.length - 1].close;
  if (pts[pts.length - 1] !== last) pts.push(last);
  return pts.map((v) => Number(v.toPrecision(5)));
}

function completedSpotTakerBuyShare4h(coin: Coin): number | null {
  if (!coin.spotVolume?.length || coin.candles.length < 2) return null;
  // Both feeds include the currently forming 5m bar. Freeze the calculation at
  // the previous perp open time so only 48 completed, clock-aligned spot bars
  // can enter the research feature.
  const formingOpen = coin.candles[coin.candles.length - 1].time;
  const rows = coin.spotVolume.filter((v) => v.time < formingOpen).slice(-48);
  if (rows.length !== 48 || rows.some((v, i) => v.takerBuy == null || (i > 0 && v.time - rows[i - 1].time !== 300))) return null;
  const total = rows.reduce((a, v) => a + v.value, 0);
  return total > 0 ? rows.reduce((a, v) => a + (v.takerBuy ?? 0), 0) / total : null;
}

// Strip the heavy per-bar series down to screener-row metrics.
export function toLite(coin: Coin): CoinLite {
  const n = coin.candles.length;
  const last = coin.candles[n - 1].close;
  const ref = coin.candles[Math.max(0, n - 289)].close; // 24h ago at 5m bars
  return {
    symbol: coin.symbol,
    regime: coin.regime,
    strength: coin.strength,
    change1h: coin.change1h,
    change24h: ref > 0 ? (last / ref - 1) * 100 : 0,
    oi4h: coin.oi4h,
    oiTrusted: coin.oiTrusted, // P1
    oiQty1h: coin.oiQty1h ?? null,
    oiQty4h: coin.oiQty4h ?? null,
    f24h: coin.f24h, // R3
    funding: coin.funding,
    volZ: coin.volZ,
    vol24h: coin.vol24h,
    lastPrice: last,
    spark: sparkOf(coin.candles),
    oiUsd: coin.oiUsd ?? null,
    oiQty: coin.oiQty ?? null,
    flushBreakout: coin.flushBreakout,
    earlyAccum: !!coin.earlyAccum,
    spotPump: spotPumpFires(coin), // S2 現貨帶動 — only candidates carry spotCandles; else false
    rebuildBreakout: rebuildFires(coin), // S9 增倉突破 — gate-shipped R1, badge + notify tier
    virginBreakout: virginFires(coin), // S13 處女增倉 — gate-shipped V2, badge + notify tier
    earlyPump: detectEarlyPump(coin.candles, coin.volume), // S14 — recorded (RecCoin idx24) for a corrected state-matched E1 re-test; badge gated on EARLY_PUMP_SHIPPED (now false after adversarial downgrade)
    igniting: detectIgnition(coin.candles, coin.volume), // 5m 點火 (2026-07-09) — real-time ignition ramp, catches pumps 15-55 min earlier than 1H; badge on, notify gated pending FP measurement

    riskFlags: coin.riskFlags,
    signals: coin.signals,
    // recording-v2 feature vector + EA confirmation numbers (recording.ts logs
    // these; spot fields are filled by S1). Uses the same 15m aggregation as
    // analyze/interpret, so recorded == live detector inputs.
    feat: {
      ...featureVector(coin.candles, coin.volume, coin.fundingHist),
      lsDropPct: coin.earlyAccum?.lsDropPct ?? null,
      rsPct: coin.earlyAccum?.rsPct ?? null,
      oiDropPct: coin.earlyAccum?.oiDropPct ?? null,
      spotVol24h: coin.spotVol24h ?? null, // S1: recording.ts idx 19 reads this
      basisPct: coin.basisPct ?? null, // S1: recording.ts idx 20 reads this
      spotTakerBuyShare4h: completedSpotTakerBuyShare4h(coin),
    },
  };
}

// Rolling full-market scan: works through the whole universe in batches,
// emitting each batch's FULL coins to the callback (the caller keeps what it
// needs — typically the lite projection — so ~350 coins of series never live
// in memory at once). Returning false from onBatch aborts the sweep.
//
// The sweep is PIPELINED like the OKX-era client: the next batch's candles are
// prefetched while the current batch's OI/funding pools run.
//
// Rate budget (Binance meters by IP): fapi REST = 2400 weight/min, reported
// back on every response (x-mbx-used-weight-1m; bnGet pauses at 2000). The
// universe is ~528 USDT perps (2026-07-07), so one sweep ≈ 40 (tickers) + 528
// (per-coin OI snapshot) + 528×5 (5m klines) + ≤528 (funding, 30-min cached so
// ~0 on later sweeps) ≈ 3200-3700 weight ≈ two minutes of budget — the pools
// below are paced to ~1650-1950 weight/min so the guard never stalls the
// sweep. futures/data endpoints (openInterestHist cold path, LS ratio) have a
// separate ~1000 req/5min IP budget — the cold pool's conc 2 / 400ms pacing
// keeps a fully-cold sweep inside it with headroom for detail opens. Spot
// (api.binance.com) is its own 6000/min budget — one bulk ticker + ≤30
// candidate kline pulls is nothing.
export async function runRollingScan(
  bn: BnBase,
  nowMs: number,
  priority: string[],
  onBatch: (batch: Coin[], progress: ScanProgress) => boolean,
): Promise<void> {
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  await hydrateOi();
  await backfillOiOnce(nowMs);
  // recently-viewed coins land in the first batches so their data is freshest
  const universe = prioritize(await getUniverse(bn), (t) => t.base, priority);
  if (!universe.length) throw new Error('empty universe');

  // Per-coin OI snapshot fan-out → warm store (keyed by base coin). Coins with
  // enough accumulated history read their OI trend from there instead of the
  // cold openInterestHist pool.
  const bulkOi = new Map<string, { oiUsd: number; oiQty: number }>();
  try {
    const rows = await fetchBulkOi(bn, universe);
    appendSnapshot(rows, nowMs);
    for (const r of rows) bulkOi.set(r.instId, { oiUsd: r.oiUsd, oiQty: r.oiQty });
  } catch {
    /* no snapshot this sweep — warm coins go stale-guarded, cold path is used */
  }

  // S1: one bulk request → every spot USDT pair's price + 24h USD volume, for
  // the perp/spot basis and spot-volume signal. 60s-cached, best-effort.
  const spot = await getSpotTickers(bn).catch(() => new Map<string, SpotInfo>());

  // one scalar shared by every coin's 早期蓄力 relative-strength check
  const btcRet24 = await getBtcRet24h(bn);

  const slices: Ticker[][] = [];
  for (let s = 0; s < universe.length; s += BATCH_SIZE) slices.push(universe.slice(s, s + BATCH_SIZE));

  const total = universe.length;
  let done = 0;
  let emitted = 0;
  let warmCount = 0; // coins served from the OI store (no openInterestHist request)
  let coldCount = 0; // coins that still needed an openInterestHist fetch
  seededThisSweep = 0; // cold-start seeds applied during this sweep's cold pool

  // S2: candidate-tier spot fetch — one shared budget across the whole sweep
  const prioritySet = new Set(priority);
  let spotBudget = SPOT_CAND_BUDGET;
  let spotCandFetched = 0;

  // one dead symbol must skip that coin, not kill the whole sweep. klines are
  // weight 5 each — conc 3 / 600ms ≈ 4.6 req/s ≈ 1385 weight/min, which plus
  // the funding pool (~340/min) stays under the 2000 soft cap so the guard
  // never stalls the sweep (measured 2026-07-07: at ~50-100ms latency,
  // conc4/250 and even conc3/300 sat AT the cap and thrashed the guard).
  const fetchCandles = (slice: Ticker[]) =>
    mapPool(slice, 3, (t) => getCandles(bn, { symbol: t.instId, mult: t.mult }, tzShift).catch(() => null), 600);

  let candlesInFlight = fetchCandles(slices[0]);

  for (let bi = 0; bi < slices.length; bi++) {
    const slice = slices[bi];
    const candleData = await candlesInFlight;
    // start the NEXT batch's candles now — they download while this batch's
    // OI/funding pools run
    if (bi + 1 < slices.length) candlesInFlight = fetchCandles(slices[bi + 1]);

    // Resolve OI: WARM coins come straight from the local snapshot history —
    // free, synchronous, no request. Only COLD coins fall through to the paced
    // openInterestHist pool.
    const oiData: (SeriesPoint[] | null)[] = new Array(slice.length).fill(null);
    const coldIdx: number[] = [];
    const histIdx: number[] = [];
    for (let i = 0; i < slice.length; i++) {
      const cd = candleData[i];
      if (!cd) continue;
      const warm = getWarmOi(slice[i].base, nowMs);
      if (warm) {
        oiData[i] = resample(
          cd.times,
          warm.map((p) => ({ t: p.t + tzShift, v: p.v })),
        );
        warmCount++;
        // Upgrade seam: legacy persisted stores contain USD only. Fetch the
        // same cold history once so seedFromHist can populate quantity without
        // waiting another 4h of live snapshots.
        if (!oiQtyChangeFromStore(slice[i].base, nowMs)) histIdx.push(i);
      } else {
        coldIdx.push(i);
        histIdx.push(i);
      }
    }
    coldCount += coldIdx.length;

    const [coldOi, fundingData] = await Promise.all([
      // futures/data budget is ~1000 req/5min (3.3/s sustained) — conc 2 /
      // 600ms ≈ 3.1/s keeps a fully-cold sweep inside it
      mapPool(
        histIdx,
        2,
        (i) => {
          const cd = candleData[i]!;
          return getOi(bn, slice[i].instId, slice[i].base, tzShift, cd.times).catch(() => null);
        },
        600,
      ),
      // weight 1 each, 30-min cached — conc 2 / 300ms ≈ 5.7/s ≈ 340 weight/min
      // on the first sweep, ~0 after
      mapPool(
        slice,
        2,
        (t, i) => {
          const cd = candleData[i];
          return cd
            ? getFunding(bn, t.instId, tzShift, cd.times).catch(() => [] as SeriesPoint[])
            : Promise.resolve([] as SeriesPoint[]);
        },
        300,
      ),
    ]);
    histIdx.forEach((i, k) => {
      if (oiData[i] == null) oiData[i] = coldOi[k];
    });

    const batch: Coin[] = [];
    for (let i = 0; i < slice.length; i++) {
      const cd = candleData[i];
      const oi = oiData[i];
      const fundingHist = fundingData[i];
      if (!cd || cd.candles.length < MIN_BARS || !oi) continue;
      const derived = analyze({
        candles: cd.candles,
        volume: cd.volume,
        oi,
        fundingHist,
        oi4hLive: oi4hLiveFromStore(slice[i].base, nowMs) ?? undefined,
      });
      const qty = oiQtyFieldsFromStore(slice[i].base, nowMs);
      const bulk = bulkOi.get(slice[i].base);
      const sf = spotFields(cd.candles[cd.candles.length - 1].close, spot.get(slice[i].base));
      batch.push({
        symbol: slice[i].base,
        candles: cd.candles,
        volume: cd.volume,
        oi,
        fundingHist,
        ...derived,
        ...qty,
        oiUsd: bulk?.oiUsd ?? null,
        oiQty: bulk?.oiQty ?? qty.oiQty,
        spotVol24h: sf.spotVol24h,
        basisPct: sf.basisPct,
        earlyAccum: null,
      });
    }

    // 早期蓄力 confirmations: the cheap setup + relative-strength checks use
    // data already in hand; only survivors cost a long/short-ratio fetch
    // (single-flight — candidates are few, typically 0-3 per batch)
    if (btcRet24 !== null) {
      const symOf = new Map(slice.map((t) => [t.base, t.instId]));
      for (const coin of batch) {
        const setup = detectEarlySetup(coin.candles, coin.oi, coin.fundingHist);
        if (!setup) continue;
        const ret = coinRet24h(coin.candles);
        const rsPct = ret === null ? null : ret - btcRet24;
        if (rsPct === null || rsPct < EA_RS_MIN_PCT) continue;
        const lsDrop = await getLsDrop24h(bn, symOf.get(coin.symbol) ?? `${coin.symbol}USDT`);
        coin.earlyAccum = confirmEarlyAccum(setup, lsDrop, rsPct);
        await sleep(300);
      }
    }

    // S2: candidate-tier spot series for the cross-source detectors. Candidates =
    // 早期蓄力-flagged ∪ prioritized (recently-viewed/pinned) ∪ strength leaders,
    // that have a spot pair. Spot budget is roomy (6000/min) but keep the sweep
    // cap so a weird market doesn't turn every batch into 20 extra fetches.
    const spotCands = batch
      .filter(
        (c) =>
          c.basisPct != null &&
          (c.earlyAccum != null || prioritySet.has(c.symbol) || c.strength >= SPOT_CAND_STRENGTH),
      )
      .slice(0, spotBudget);
    if (spotCands.length) {
      const spotData = await mapPool(
        spotCands,
        2,
        (c) =>
          Promise.all([
            getSpotCandles(bn, c.symbol, tzShift),
            getSpotTakerBuyShare24h(bn, c.symbol),
          ]),
        300,
      );
      spotCands.forEach((c, k) => {
        const [sc, taker] = spotData[k];
        if (sc) {
          c.spotCandles = sc.candles;
          c.spotVolume = sc.volume;
        }
        c.spotTakerBuyShare24h = taker;
      });
      spotBudget -= spotCands.length;
      spotCandFetched += spotCands.length;
    }

    done += slice.length;
    emitted += batch.length;
    if (!onBatch(batch, { done, total, btcRet24h: btcRet24 })) {
      // aborted mid-sweep: let the floating prefetch settle without an
      // unhandled-rejection (its per-item catches make it safe anyway)
      void candlesInFlight.catch(() => {});
      return;
    }
  }

  console.log(`[scan] OI: ${warmCount} warm (store), ${coldCount} cold (oiHist), ${seededThisSweep} seeded; ${spotCandFetched} spot-candidate fetches; store holds ${storeSize()} coins`);
  if (emitted === 0) throw new Error('no coins assembled');
}
