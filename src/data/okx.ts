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
  detectEarlySetup,
  EA_RS_MIN_PCT,
} from '../lib/analyze';

// Real USDT-perp data from OKX v5. Reachable where Binance/Bybit are geo-blocked.
// In the browser BASE is the Vite proxy path (/okx); a node dry-run can pass the
// real host. See vite.config.ts for the proxy.

const BASE_BARS = 576; // 2 days of 5m bars
const MIN_BARS = 300; // drop freshly-listed coins without enough history
const BATCH_SIZE = 20; // coins per rolling-scan batch
const LONG_BARS = 600; // ~25 days of 1H bars for the detail chart's long timeframes
const LONG_MIN_BARS = 120; // need a few days of 1H history for 1h/4h to be worth it

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function okxGet(base: string, path: string, tries = 3): Promise<any[]> {
  let lastErr: unknown;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(base + path);
      if (res.status === 429 || res.status >= 500) {
        // visible in prod/dev console so a throttle regression isn't silent
        console.warn(`[okx] ${res.status} on ${path} (retry ${k + 1}/${tries})`);
        await sleep(500 * (k + 1));
        continue;
      }
      const j = await res.json();
      if (j.code !== undefined && j.code !== '0') throw new Error(`okx ${j.code} ${j.msg}`);
      return j.data ?? [];
    } catch (e) {
      lastErr = e;
      await sleep(300 * (k + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`okx failed: ${path}`);
}

// concurrency-limited map with optional per-worker spacing to respect rate limits
async function mapPool<T, R>(
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

interface Ticker {
  instId: string;
  base: string;
  last: number;
  volCcy24h: number;
}

// bulk tickers cached briefly so the search tab filters client-side per keystroke
let tickersCache: { at: number; rows: any[] } | null = null;

async function getAllTickers(baseUrl: string): Promise<any[]> {
  if (tickersCache && Date.now() - tickersCache.at < 60_000) return tickersCache.rows;
  const rows = await okxGet(baseUrl, '/api/v5/market/tickers?instType=SWAP');
  tickersCache = { at: Date.now(), rows };
  return rows;
}

// Search every listed USDT perp by symbol substring. Empty query = top by
// volume (discovery). Prefix matches rank above substring matches.
export async function searchInstruments(baseUrl: string, query: string): Promise<SearchHit[]> {
  const rows = await getAllTickers(baseUrl);
  const q = query.trim().toUpperCase();
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const instId: string = r.instId;
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const b = instId.slice(0, -'-USDT-SWAP'.length);
    if (q && !b.includes(q)) continue;
    const last = Number(r.last);
    const open = Number(r.open24h);
    const volCcy = Number(r.volCcy24h);
    if (!Number.isFinite(last) || !Number.isFinite(volCcy)) continue;
    hits.push({
      instId,
      base: b,
      last,
      change24h: open > 0 ? (last / open - 1) * 100 : 0,
      vol24hUsd: last * volCcy,
    });
  }
  hits.sort((a, b) => {
    const ap = q && a.base.startsWith(q) ? 0 : 1;
    const bp = q && b.base.startsWith(q) ? 0 : 1;
    return ap - bp || b.vol24hUsd - a.vol24hUsd;
  });
  return hits.slice(0, 30);
}

// On-demand fetch + analysis for one perp picked in the search tab. OI or
// funding may be missing for tiny listings — degrade to a flat zero series
// rather than failing the whole view.
export async function fetchLiveCoin(baseUrl: string, hit: SearchHit, nowMs: number): Promise<Coin> {
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  const { candles, volume, times } = await getCandles(baseUrl, hit.instId, tzShift);
  if (candles.length < MIN_BARS) throw new Error(`${hit.base} 上市時間過短，歷史 K 線不足`);
  const flat = (): SeriesPoint[] => times.map((t) => ({ time: t, value: 0 }));
  // 5m analysis series + the 1H long-history series fetched together
  const [oi, fundingHist, long] = await Promise.all([
    getOi(baseUrl, hit.base, tzShift, times).catch(() => flat()),
    getFunding(baseUrl, hit.instId, tzShift, times).catch(() => flat()),
    getLongSeries(baseUrl, hit.instId, hit.base, tzShift),
  ]);
  const derived = analyze({ candles, volume, oi, fundingHist });
  const coin: Coin = { symbol: hit.base, candles, volume, oi, fundingHist, ...derived, earlyAccum: null, long };

  // 早期蓄力 watchlist check for on-demand opens too (cheap gate first, the
  // two extra requests only when the setup is actually on)
  const setup = detectEarlySetup(candles, oi, fundingHist);
  if (setup) {
    const [btcRet, lsDrop] = await Promise.all([getBtcRet24h(baseUrl), getLsDrop24h(baseUrl, hit.base)]);
    const ret = coinRet24h(candles);
    if (btcRet !== null && ret !== null) {
      coin.earlyAccum = confirmEarlyAccum(setup, lsDrop, ret - btcRet);
    }
  }
  return coin;
}

// Full scan universe: every OKX USDT perp whose base coin also has a Binance
// USD-M perp listing, ranked by live 24h USD volume. No size cap — the rolling
// scan works through all of them in batches.
async function getUniverse(base: string, bnBases: Set<string>): Promise<Ticker[]> {
  const rows = await getAllTickers(base);
  const byBase = new Map<string, Ticker>();
  for (const r of rows) {
    const instId: string = r.instId;
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const b = instId.slice(0, -'-USDT-SWAP'.length);
    if (!bnBases.has(b)) continue;
    const last = Number(r.last);
    const volCcy24h = Number(r.volCcy24h);
    if (!Number.isFinite(last) || !Number.isFinite(volCcy24h)) continue;
    byBase.set(b, { instId, base: b, last, volCcy24h });
  }
  return [...byBase.values()].sort((a, b) => b.last * b.volCcy24h - a.last * a.volCcy24h);
}

async function getCandles(
  base: string,
  instId: string,
  tzShift: number,
): Promise<{ candles: Candle[]; volume: VolumeBar[]; times: number[] }> {
  const page1 = await okxGet(base, `/api/v5/market/candles?instId=${instId}&bar=5m&limit=300`);
  let rows = page1;
  if (page1.length) {
    const oldest = page1[page1.length - 1][0];
    const page2 = await okxGet(
      base,
      `/api/v5/market/candles?instId=${instId}&bar=5m&after=${oldest}&limit=300`,
    );
    rows = page1.concat(page2);
  }
  // OKX returns newest-first; sort ascending and dedup by timestamp
  const seen = new Set<string>();
  const asc = rows
    .filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)))
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const tail = asc.slice(-BASE_BARS);

  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  const times: number[] = [];
  for (const r of tail) {
    const time = Math.floor(Number(r[0]) / 1000) + tzShift;
    const open = Number(r[1]);
    const high = Number(r[2]);
    const low = Number(r[3]);
    const close = Number(r[4]);
    const quoteVol = Number(r[7]); // volCcyQuote = USDT notional
    times.push(time);
    candles.push({ time, open, high, low, close });
    volume.push({ time, value: quoteVol, up: close >= open });
  }
  return { candles, volume, times };
}

// The 1H long-history series for a detail coin's higher timeframes. Independent
// of the 5m series above; failures are non-fatal (1h/4h fall back to the 48h
// 5m base). ~25d candles, 30d OI (rubik 1H), 91d funding — all real, resampled
// onto the candle grid.
async function getLongSeries(
  base: string,
  instId: string,
  ccy: string,
  tzShift: number,
): Promise<LongSeries | undefined> {
  try {
    const page1 = await okxGet(base, `/api/v5/market/candles?instId=${instId}&bar=1H&limit=300`);
    let rows = page1;
    if (page1.length) {
      const oldest = page1[page1.length - 1][0];
      const page2 = await okxGet(base, `/api/v5/market/candles?instId=${instId}&bar=1H&after=${oldest}&limit=300`);
      rows = page1.concat(page2);
    }
    const seen = new Set<string>();
    const asc = rows
      .filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(-LONG_BARS);
    if (asc.length < LONG_MIN_BARS) return undefined;

    const candles: Candle[] = [];
    const volume: VolumeBar[] = [];
    const times: number[] = [];
    for (const r of asc) {
      const time = Math.floor(Number(r[0]) / 1000) + tzShift;
      const open = Number(r[1]);
      const close = Number(r[4]);
      times.push(time);
      candles.push({ time, open, high: Number(r[2]), low: Number(r[3]), close });
      volume.push({ time, value: Number(r[7]), up: close >= open });
    }

    const [oi, fundingHist] = await Promise.all([
      okxGet(base, `/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1H`)
        .then((oiRows) => {
          const src = oiRows
            .map((r) => ({ t: Math.floor(Number(r[0]) / 1000) + tzShift, v: Number(r[1]) }))
            .filter((p) => Number.isFinite(p.v))
            .sort((a, b) => a.t - b.t);
          return src.length ? resample(times, src) : times.map((t) => ({ time: t, value: 0 }));
        })
        .catch(() => times.map((t) => ({ time: t, value: 0 }))),
      okxGet(base, `/api/v5/public/funding-rate-history?instId=${instId}&limit=300`)
        .then((fRows) => {
          const src = fRows
            .map((r) => ({ t: Math.floor(Number(r.fundingTime) / 1000) + tzShift, v: Number(r.fundingRate) * 100 }))
            .filter((p) => Number.isFinite(p.v))
            .sort((a, b) => a.t - b.t);
          return resample(times, src);
        })
        .catch(() => times.map((t) => ({ time: t, value: 0 }))),
    ]);

    const strengthHist = computeStrengthSeries(candles, volume, oi, fundingHist, 1);
    return { candles, volume, oi, fundingHist, strengthHist };
  } catch {
    return undefined;
  }
}

async function getOi(base: string, ccy: string, tzShift: number, times: number[]): Promise<SeriesPoint[]> {
  const rows = await okxGet(
    base,
    `/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=5m`,
  );
  const src = rows
    .map((r) => ({ t: Math.floor(Number(r[0]) / 1000) + tzShift, v: Number(r[1]) }))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (!src.length) throw new Error(`no OI history for ${ccy}`);
  return resample(times, src);
}

async function getFunding(
  base: string,
  instId: string,
  tzShift: number,
  times: number[],
): Promise<SeriesPoint[]> {
  const rows = await okxGet(
    base,
    `/api/v5/public/funding-rate-history?instId=${instId}&limit=90`,
  );
  const src = rows
    .map((r) => ({ t: Math.floor(Number(r.fundingTime) / 1000) + tzShift, v: Number(r.fundingRate) * 100 }))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  return resample(times, src); // empty -> flat 0 line, acceptable
}

// ---- 早期蓄力 confirmation data (fetched only for pre-filtered candidates) --

// BTC 24h return in % — one scalar per sweep, shared by every coin's
// relative-strength check. Null on failure (EA checks then skip silently).
async function getBtcRet24h(base: string): Promise<number | null> {
  try {
    const rows = await okxGet(base, '/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1H&limit=25');
    if (rows.length < 25) return null;
    const now = Number(rows[0][4]);
    const then = Number(rows[24][4]);
    return then > 0 ? (now / then - 1) * 100 : null;
  } catch {
    return null;
  }
}

// Retail long/short account ratio drop over 24h, in % (positive = retail
// gave up longs). Rubik endpoint, rate-limited — call only for candidates.
async function getLsDrop24h(base: string, ccy: string): Promise<number | null> {
  try {
    const rows = await okxGet(
      base,
      `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${ccy}&period=1H`,
    );
    if (rows.length < 25) return null;
    const now = Number(rows[0][1]);
    const then = Number(rows[24][1]);
    if (!(now > 0) || !(then > 0)) return null;
    return (1 - now / then) * 100;
  } catch {
    return null;
  }
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
    funding: coin.funding,
    volZ: coin.volZ,
    vol24h: coin.vol24h,
    lastPrice: last,
    flushBreakout: coin.flushBreakout,
    earlyAccum: !!coin.earlyAccum,
    riskFlags: coin.riskFlags,
    signals: coin.signals,
  };
}

// Rolling full-market scan: works through the whole universe in batches,
// emitting each batch's FULL coins to the callback (the caller keeps what it
// needs — typically the lite projection — so ~250 coins of series never live
// in memory at once). Returning false from onBatch aborts the sweep.
//
// The sweep is PIPELINED: the OI endpoint is by far the slowest pool, so the
// next batch's candles are prefetched while the current batch's OI is in
// flight — total wall time collapses to roughly the OI time alone (measured:
// this + the paced OI pool below took the full sweep from ~8min to ~4min).
//
// Throttles are empirically probed (scratchpad rate-probe*.mjs), not guessed:
// - candles / funding-rate-history: 0/20 429s even at 12x-concurrency bursts —
//   never the bottleneck, so generous-but-not-maximal concurrency.
// - rubik OI (the fragile one): officially documented "5 requests per 2
//   seconds, rule: IP" (grep the docs-v5 HTML near the endpoint path — the
//   SPA hides it from naive fetching). conc=2 with 500ms pacing attempts
//   ~1.74/s = 70% of that cap, leaving ~30% headroom for the app's own
//   detail-view live poll on the same IP. Measured full sweep: 355/355 in
//   269s. 429s only appear when a SECOND instance shares the IP (e.g. dev
//   preview + exe both scanning): tested 650ms pacing under that double load
//   and it was strictly worse (309s, same 429 count), so 500ms is kept —
//   okxGet's retry/backoff absorbs multi-instance residue invisibly.
// - funding-rate-history: "10 req / 2s, rule: IP + Instrument ID" — we hit
//   each instrument once per sweep, so this can never collide.
export async function runRollingScan(
  base: string,
  nowMs: number,
  bnBases: Set<string>,
  priority: string[],
  onBatch: (batch: Coin[], progress: ScanProgress) => boolean,
): Promise<void> {
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  // recently-viewed coins land in the first batches so their data is freshest
  const universe = prioritize(await getUniverse(base, bnBases), (t) => t.base, priority);
  if (!universe.length) throw new Error('empty universe');

  // one scalar shared by every coin's 早期蓄力 relative-strength check
  const btcRet24 = await getBtcRet24h(base);

  const slices: Ticker[][] = [];
  for (let s = 0; s < universe.length; s += BATCH_SIZE) slices.push(universe.slice(s, s + BATCH_SIZE));

  const total = universe.length;
  let done = 0;
  let emitted = 0;

  // one dead symbol must skip that coin, not kill the whole sweep
  const fetchCandles = (slice: Ticker[]) =>
    mapPool(slice, 8, (t) => getCandles(base, t.instId, tzShift).catch(() => null), 40);

  let candlesInFlight = fetchCandles(slices[0]);

  for (let bi = 0; bi < slices.length; bi++) {
    const slice = slices[bi];
    const candleData = await candlesInFlight;
    // start the NEXT batch's candles now — they download while this batch's
    // OI pool (the long pole) runs
    if (bi + 1 < slices.length) candlesInFlight = fetchCandles(slices[bi + 1]);

    const [oiData, fundingData] = await Promise.all([
      mapPool(
        slice,
        2,
        (t, i) => {
          const cd = candleData[i];
          return cd ? getOi(base, t.base, tzShift, cd.times).catch(() => null) : Promise.resolve(null);
        },
        500,
      ),
      mapPool(
        slice,
        6,
        (t, i) => {
          const cd = candleData[i];
          return cd
            ? getFunding(base, t.instId, tzShift, cd.times).catch(() => [] as SeriesPoint[])
            : Promise.resolve([] as SeriesPoint[]);
        },
        80,
      ),
    ]);

    const batch: Coin[] = [];
    for (let i = 0; i < slice.length; i++) {
      const cd = candleData[i];
      const oi = oiData[i];
      const fundingHist = fundingData[i];
      if (!cd || cd.candles.length < MIN_BARS || !oi) continue;
      const derived = analyze({ candles: cd.candles, volume: cd.volume, oi, fundingHist });
      batch.push({
        symbol: slice[i].base,
        candles: cd.candles,
        volume: cd.volume,
        oi,
        fundingHist,
        ...derived,
        earlyAccum: null,
      });
    }

    // 早期蓄力 confirmations: the cheap setup + relative-strength checks use
    // data already in hand; only survivors cost a long/short-ratio fetch
    // (single-flight — candidates are few, typically 0-3 per batch)
    if (btcRet24 !== null) {
      for (const coin of batch) {
        const setup = detectEarlySetup(coin.candles, coin.oi, coin.fundingHist);
        if (!setup) continue;
        const ret = coinRet24h(coin.candles);
        const rsPct = ret === null ? null : ret - btcRet24;
        if (rsPct === null || rsPct < EA_RS_MIN_PCT) continue;
        const lsDrop = await getLsDrop24h(base, coin.symbol);
        coin.earlyAccum = confirmEarlyAccum(setup, lsDrop, rsPct);
        await sleep(300);
      }
    }

    done += slice.length;
    emitted += batch.length;
    if (!onBatch(batch, { done, total })) {
      // aborted mid-sweep: let the floating prefetch settle without an
      // unhandled-rejection (its per-item catches make it safe anyway)
      void candlesInFlight.catch(() => {});
      return;
    }
  }

  if (emitted === 0) throw new Error('no coins assembled');
}
