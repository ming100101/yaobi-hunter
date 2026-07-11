// S12-5m harness — flush-wick reversal re-test on Binance Vision 5m dumps.
// The 1H gate killed F1-F3 (×0.34-0.78, all below baseline); the declared
// caveat was that 5m microstructure can't be expressed in 1H bars. This
// harness tests the pre-registered 5m definitions (S12 spec appendix) on
// data.binance.vision monthly 5m klines — free, keyless, months of depth.
//
//   npm run backtest5m -- --fw-def F1 --target 10 --json
//   knobs: --fw-def F1|F2 · --fw-wick 0.6 · --fw-lookback 96 · --fw-close-pos 0.5
//          --volz 2 · --target 10 · --horizon 288 (5m bars = 24h) · --max-coins 100
//          --months 2026-05,2026-06 · --refresh
//
// Zero deps: zip entries are single-file deflate — node:zlib inflateRawSync on
// the local-file-header slice (format probed live 2026-07-07: sig PK\x03\x04,
// method 8, compSize present). Coins stream one at a time — nothing holds two
// months × 100 coins of bars in memory at once.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'backtest-data');
const DATA5_DIR = path.join(ROOT, 'backtest-data', '5m');
const BV = 'https://data.binance.vision/data/futures/um/monthly/klines';

interface Args {
  fwDef: 'F1' | 'F2';
  fwWick: number;
  fwLookback: number;
  fwClosePos: number;
  volz: number;
  target: number;
  horizon: number; // 5m bars
  cooldown: number; // 5m bars
  maxCoins: number;
  months: string[];
  json: boolean;
  refresh: boolean;
  symbols: string[]; // explicit override (e.g. TRIA cross-check)
  metrics: boolean; // fetch Vision daily metrics (5m OI/LS/taker) and align onto bars
  probe: string; // print one coin's metrics coverage + OI trajectory, then exit
  // ---- early-拉盤 experiment (detect the pump BEFORE the base-high break) ----
  exp: 'flushwick' | 'breakout' | 'early'; // which detector to run
  earlyBelowHigh: number; // early: price ≥ this % BELOW the 24h high (still pre-breakout)
  earlyBelowHighMax: number; // early: … and ≤ this % below (close enough to matter)
  earlyPosMin: number; // early: pos in the 24h range ≥ this (upper/markup half, not the base)
  earlyRet4Cap: number; // early: ret over last 4 bars ∈ (0, cap%] (rising, anti-chase)
  earlyVolz: number; // early: first volume-impulse z floor
  earlyTaker: number; // early: taker buy ratio ≥ this (metrics; 0 = ignore)
  earlyOiUp: boolean; // early: require OI rising over the last hour (metrics)
  matched: boolean; // --matched: state-matched baseline = bars in the early GEOMETRY envelope (below/pos/rising/ret4) but WITHOUT the vol/OI/taker trigger — isolates the trigger's incremental edge over the markup geometry
}

function parseArgs(): Args {
  const a: Args = {
    fwDef: 'F1',
    fwWick: 0.6,
    fwLookback: 96,
    fwClosePos: 0.5,
    volz: 2,
    target: 10,
    horizon: 288,
    cooldown: 288,
    maxCoins: 100,
    months: ['2026-05', '2026-06'],
    json: false,
    refresh: false,
    symbols: [],
    metrics: false,
    probe: '',
    exp: 'flushwick',
    earlyBelowHigh: 2,
    earlyBelowHighMax: 12,
    earlyPosMin: 0.5,
    earlyRet4Cap: 5,
    earlyVolz: 1.5,
    earlyTaker: 0,
    earlyOiUp: false,
    matched: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const num = () => {
      i++;
      return Number(v);
    };
    if (k === '--fw-def') {
      i++;
      if (v !== 'F1' && v !== 'F2') throw new Error(`bad --fw-def ${v}`);
      a.fwDef = v;
    } else if (k === '--fw-wick') a.fwWick = num();
    else if (k === '--fw-lookback') a.fwLookback = num();
    else if (k === '--fw-close-pos') a.fwClosePos = num();
    else if (k === '--volz') a.volz = num();
    else if (k === '--target') a.target = num();
    else if (k === '--horizon') a.horizon = num();
    else if (k === '--cooldown') a.cooldown = num();
    else if (k === '--max-coins') a.maxCoins = num();
    else if (k === '--months') {
      i++;
      a.months = v.split(',');
    } else if (k === '--symbols') {
      i++;
      a.symbols = v.split(',');
    } else if (k === '--json') a.json = true;
    else if (k === '--refresh') a.refresh = true;
    else if (k === '--metrics') a.metrics = true;
    else if (k === '--probe') {
      i++;
      a.probe = v;
      a.metrics = true;
    } else if (k === '--exp') {
      i++;
      if (v !== 'flushwick' && v !== 'breakout' && v !== 'early') throw new Error(`bad --exp ${v}`);
      a.exp = v;
    } else if (k === '--early-below-high') a.earlyBelowHigh = num();
    else if (k === '--early-below-high-max') a.earlyBelowHighMax = num();
    else if (k === '--early-pos-min') a.earlyPosMin = num();
    else if (k === '--early-ret4-cap') a.earlyRet4Cap = num();
    else if (k === '--early-volz') a.earlyVolz = num();
    else if (k === '--early-taker') a.earlyTaker = num();
    else if (k === '--early-oi-up') a.earlyOiUp = true;
    else if (k === '--matched') a.matched = true;
    else throw new Error(`unknown arg ${k}`);
  }
  return a;
}

interface Bar5 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  q: number; // quote (USDT) volume
  // Vision daily-metrics alignment (5m grid, forward-filled; null before the
  // first metrics row or when --metrics is off). oi = sum_open_interest_value
  // (USD) — the same unit class as the app's bulk-OI snapshots.
  oi: number | null;
  lsTop: number | null; // top-trader long/short POSITION ratio
  lsG: number | null; // global long/short account ratio
  taker: number | null; // taker buy/sell volume ratio
}

// single-entry zip → CSV text (probed format; throws on anything unexpected)
function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + compSize);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`zip method ${method}`);
}

async function fetchMonth(sym: string, month: string, refresh: boolean): Promise<Bar5[] | null> {
  fs.mkdirSync(DATA5_DIR, { recursive: true });
  const cache = path.join(DATA5_DIR, `${sym}-${month}.csv`);
  let csv: string | null = null;
  if (!refresh && fs.existsSync(cache)) csv = fs.readFileSync(cache, 'utf8');
  if (csv == null) {
    const url = `${BV}/${sym}USDT/5m/${sym}USDT-5m-${month}.zip`;
    const res = await fetch(url);
    if (res.status === 404) return null; // not listed that month
    if (!res.ok) throw new Error(`${sym} ${month}: http ${res.status}`);
    csv = unzipSingle(Buffer.from(await res.arrayBuffer()));
    fs.writeFileSync(cache, csv);
  }
  const bars: Bar5[] = [];
  for (const line of csv.split('\n')) {
    if (!line || line.startsWith('open_time')) continue;
    const p = line.split(',');
    if (p.length < 8) continue;
    const t = Number(p[0]);
    if (!Number.isFinite(t)) continue;
    bars.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], q: +p[7], oi: null, lsTop: null, lsG: null, taker: null });
  }
  return bars;
}

// ---- Vision daily metrics (5m OI / top-trader LS / global LS / taker ratio) --
// Daily zips only (no monthly dump exists — probed 2026-07-07). One coin-month
// is concatenated into a single cache CSV; missing days (T+1 lag, delistings)
// are skipped and counted. Fetches 10 days at a time.
const dayList = (month: string): string[] => {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, k) => `${month}-${String(k + 1).padStart(2, '0')}`);
};

async function fetchMetricsMonth(sym: string, month: string, refresh: boolean): Promise<string> {
  const cache = path.join(DATA5_DIR, `${sym}-metrics-${month}.csv`);
  if (!refresh && fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
  const days = dayList(month);
  const parts: string[] = [];
  for (let s = 0; s < days.length; s += 10) {
    const chunk = await Promise.all(
      days.slice(s, s + 10).map(async (day) => {
        try {
          const res = await fetch(
            `https://data.binance.vision/data/futures/um/daily/metrics/${sym}USDT/${sym}USDT-metrics-${day}.zip`,
          );
          if (!res.ok) return '';
          return unzipSingle(Buffer.from(await res.arrayBuffer()));
        } catch {
          return '';
        }
      }),
    );
    parts.push(...chunk);
  }
  const joined = parts.filter(Boolean).join('\n');
  fs.writeFileSync(cache, joined);
  return joined;
}

// align metrics rows onto the 5m bar grid by timestamp, then forward-fill —
// the same resample discipline as the app's OI store (values persist until the
// next observation; nothing is interpolated).
async function attachMetrics(sym: string, bars: Bar5[], months: string[], refresh: boolean): Promise<number> {
  if (!bars.length) return 0;
  const t0 = bars[0].t;
  const idxOf = (ts: number) => Math.round((ts - t0) / 300_000);
  let rows = 0;
  for (const month of months) {
    const csv = await fetchMetricsMonth(sym, month, refresh);
    for (const line of csv.split('\n')) {
      if (!line || line.startsWith('create_time')) continue;
      const p = line.split(',');
      if (p.length < 8) continue;
      const ts = Date.parse(p[0].replace(' ', 'T') + 'Z'); // UTC timestamps
      if (!Number.isFinite(ts)) continue;
      const i = idxOf(ts);
      if (i < 0 || i >= bars.length) continue;
      bars[i].oi = +p[3]; // sum_open_interest_value (USD)
      bars[i].lsTop = +p[5];
      bars[i].lsG = +p[6];
      bars[i].taker = +p[7];
      rows++;
    }
  }
  // forward-fill
  let oi: number | null = null;
  let lsTop: number | null = null;
  let lsG: number | null = null;
  let taker: number | null = null;
  for (const b of bars) {
    if (b.oi != null) ({ oi, lsTop, lsG, taker } = b);
    else {
      b.oi = oi;
      b.lsTop = lsTop;
      b.lsG = lsG;
      b.taker = taker;
    }
  }
  return rows;
}

// same volZ shape as the 1H harness, on the prior `win` bars' quote volume
function volZAt(bars: Bar5[], i: number, win: number): number {
  const s = Math.max(0, i - win);
  const xs: number[] = [];
  for (let j = s; j < i; j++) xs.push(bars[j].q);
  if (xs.length < 48) return 0;
  const m = xs.reduce((x, y) => x + y, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((x, y) => x + (y - m) ** 2, 0) / xs.length);
  return sd > 0 ? (bars[i].q - m) / sd : 0;
}

function ema(bars: Bar5[], p: number): Float64Array {
  const out = new Float64Array(bars.length).fill(NaN);
  if (bars.length < p) return out;
  const k = 2 / (p + 1);
  let e = 0;
  for (let j = 0; j < p; j++) e += bars[j].c;
  e /= p;
  out[p - 1] = e;
  for (let j = p; j < bars.length; j++) {
    e = bars[j].c * k + e * (1 - k);
    out[j] = e;
  }
  return out;
}

function signalAt(bars: Bar5[], i: number, a: Args, e600: Float64Array): boolean {
  const s = i - 1; // wick bar
  const w = bars[s];
  const range = w.h - w.l;
  if (!(range > 0)) return false;
  let loPrev = Infinity;
  for (let j = s - a.fwLookback; j < s; j++) loPrev = Math.min(loPrev, bars[j].l);
  if (!(w.l < loPrev)) return false;
  if ((Math.min(w.o, w.c) - w.l) / range < a.fwWick) return false;
  if (!(w.c >= w.l + a.fwClosePos * range)) return false;
  if (!(bars[i].c > w.h)) return false;
  if (Math.max(volZAt(bars, s, 288), volZAt(bars, i, 288)) < a.volz) return false;
  if (a.fwDef === 'F2') return Number.isFinite(e600[i]) && bars[i].c > e600[i];
  return true;
}

// prior-24h high/low (288 5m bars), EXCLUDING the current bar
function rangeHiLo(bars: Bar5[], i: number, win: number): { hi: number; lo: number } {
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = Math.max(0, i - win); j < i; j++) {
    if (bars[j].h > hi) hi = bars[j].h;
    if (bars[j].l < lo) lo = bars[j].l;
  }
  return { hi, lo };
}

// 5m ⚡-proxy: close breaks the prior-24h high on a volume impulse. This is the
// "late" reference the early detector is measured against (both lift and lead).
function signalBreakoutAt(bars: Bar5[], i: number, a: Args): boolean {
  const { hi } = rangeHiLo(bars, i, 288);
  if (!(hi > 0) || !(bars[i].c > hi)) return false;
  return volZAt(bars, i, 288) >= a.volz;
}

// EARLY 拉盤 initiation: price climbing in the upper half of the 24h range but
// STILL below the high (pre-breakout), first volume impulse, rising-not-vertical.
// The whole point is to fire BEFORE signalBreakoutAt. Optional OI-up / taker-buy
// confirmations engage only under --metrics.
function signalEarlyAt(bars: Bar5[], i: number, a: Args): boolean {
  if (i < 289) return false;
  const { hi, lo } = rangeHiLo(bars, i, 288);
  if (!(hi > 0) || !(lo > 0) || !(hi > lo)) return false;
  const c = bars[i].c;
  const below = (hi / c - 1) * 100; // % below the 24h high
  if (!(below >= a.earlyBelowHigh && below <= a.earlyBelowHighMax)) return false; // pre-breakout band
  const pos = (c - lo) / (hi - lo);
  if (!(pos >= a.earlyPosMin)) return false; // upper (markup) half of the range, not the base
  if (!(c > bars[i - 12].c)) return false; // rising over the last hour
  const ret4 = (c / bars[i - 4].c - 1) * 100;
  if (!(ret4 > 0 && ret4 <= a.earlyRet4Cap)) return false; // rising, anti-chase
  if (volZAt(bars, i, 288) < a.earlyVolz) return false; // first volume impulse
  if (a.earlyTaker > 0 && !(bars[i].taker != null && (bars[i].taker as number) >= a.earlyTaker)) return false;
  if (a.earlyOiUp && !(bars[i].oi != null && bars[i - 12].oi != null && (bars[i].oi as number) > (bars[i - 12].oi as number)))
    return false;
  return true;
}

// dispatch: which detector fires at bar i
function firesAt(bars: Bar5[], i: number, a: Args, e600: Float64Array): boolean {
  if (a.exp === 'breakout') return signalBreakoutAt(bars, i, a);
  if (a.exp === 'early') return signalEarlyAt(bars, i, a);
  return signalAt(bars, i, a, e600);
}

// --matched baseline envelope for --exp early: signalEarlyAt's GEOMETRY (upper-
// range, pre-breakout band, rising, anti-chase) WITHOUT the volume/OI/taker
// TRIGGER. Baseline sampled over these bars isolates whether the trigger adds
// edge beyond the markup geometry (the S14 adversarial lesson: an unconditional
// baseline inflates any geometry-conditioned detector).
function earlyEnvelope(bars: Bar5[], i: number, a: Args): boolean {
  if (i < 289) return false;
  const { hi, lo } = rangeHiLo(bars, i, 288);
  if (!(hi > 0) || !(lo > 0) || !(hi > lo)) return false;
  const c = bars[i].c;
  const below = (hi / c - 1) * 100;
  if (!(below >= a.earlyBelowHigh && below <= a.earlyBelowHighMax)) return false;
  const pos = (c - lo) / (hi - lo);
  if (!(pos >= a.earlyPosMin)) return false;
  if (!(c > bars[i - 12].c)) return false;
  const ret4 = (c / bars[i - 4].c - 1) * 100;
  return ret4 > 0 && ret4 <= a.earlyRet4Cap;
}

async function main(): Promise<void> {
  const a = parseArgs();
  // universe: same Binance-listed coins the 1H harness cached, minus anything
  // without a Vision dump for the window (404 → skipped, counted)
  let syms = a.symbols;
  if (!syms.length) {
    syms = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.slice(0, -5))
      .slice(0, a.maxCoins);
  }
  if (!syms.length) throw new Error('no universe — run the 1H backtest once to build backtest-data/');

  // --probe SYM: verify the metrics alignment on one coin, print an OI/LS
  // trajectory sample, exit. (Kline monthly zips lag the current month, so
  // probe with completed months.)
  if (a.probe) {
    const sym = a.probe;
    let bars: Bar5[] = [];
    for (const m of a.months) {
      const mb = await fetchMonth(sym, m, a.refresh);
      if (mb) bars = bars.concat(mb);
    }
    if (!bars.length) {
      console.log(`no kline data for ${sym} in ${a.months.join(',')}`);
      return;
    }
    const rows = await attachMetrics(sym, bars, a.months, a.refresh);
    const withOi = bars.filter((b) => b.oi != null).length;
    console.log(
      `${sym}: ${bars.length} bars · metrics rows ${rows} · oi coverage ${((withOi / bars.length) * 100).toFixed(1)}%`,
    );
    const tail = bars.slice(-1728); // last 6 days, sampled every 8h
    for (let i = 0; i < tail.length; i += 96) {
      const b = tail[i];
      console.log(
        new Date(b.t).toISOString().slice(5, 16),
        'px', b.c,
        'oi', b.oi == null ? '—' : `$${(b.oi / 1e6).toFixed(2)}M`,
        'lsTop', b.lsTop == null ? '—' : b.lsTop.toFixed(2),
        'lsG', b.lsG == null ? '—' : b.lsG.toFixed(2),
        'taker', b.taker == null ? '—' : b.taker.toFixed(2),
      );
    }
    return;
  }

  const signals: {
    sym: string;
    t: number;
    mfe: number;
    mae: number;
    retH: number;
    hit: boolean;
    barsToTgt: number | null; // 5m bars from signal to first +target touch (hit-only)
    lead: number | null; // early exp: 5m bars from this early fire to the ⚡-breakout (null = no breakout followed)
  }[] = [];
  let baseN = 0;
  let baseHit = 0;
  let skipped = 0;
  let loaded = 0;
  const perCoin = new Map<string, number>();
  const warmup = Math.max(a.fwLookback + 2, 600 + 1, 288 + 1);

  for (const sym of syms) {
    let bars: Bar5[] = [];
    let missing = false;
    for (const m of a.months) {
      const mb = await fetchMonth(sym, m, a.refresh);
      if (!mb) {
        missing = true;
        break;
      }
      bars = bars.concat(mb);
    }
    if (missing || bars.length < warmup + a.horizon + 10) {
      skipped++;
      continue;
    }
    loaded++;
    // 5m OI/LS/taker series for detectors that declare them (S4a/S4b-grade
    // inputs; the F defs don't read them — infrastructure parity with the 1H
    // harness, opt-in because it's ~30 requests per coin-month uncached)
    if (a.metrics) await attachMetrics(sym, bars, a.months, a.refresh);
    const e600 = a.fwDef === 'F2' ? ema(bars, 600) : new Float64Array(0);
    const lastEval = bars.length - a.horizon - 1;
    let cooldownUntil = -1;
    for (let i = warmup; i <= lastEval; i++) {
      // baseline: streaming counts only (no object per bar). Default = fixed
      // every-12-bar stride (unbiased, keeps 5m runtime sane). --matched = only
      // bars in the early GEOMETRY envelope (no trigger), so lift measures the
      // trigger's incremental edge over the markup geometry.
      const entryB = bars[i].c;
      let hiB = -Infinity;
      if (a.matched ? earlyEnvelope(bars, i, a) : i % 12 === 0) {
        for (let j = i + 1; j <= i + a.horizon; j++) hiB = Math.max(hiB, bars[j].h);
        baseN++;
        if (hiB / entryB - 1 >= a.target / 100) baseHit++;
      }
      if (i < cooldownUntil) continue;
      if (!firesAt(bars, i, a, e600)) continue;
      cooldownUntil = i + a.cooldown;
      const entry = bars[i].c;
      const tgt = entry * (1 + a.target / 100);
      let hi = -Infinity;
      let lo = Infinity;
      let barsToTgt: number | null = null;
      for (let j = i + 1; j <= i + a.horizon; j++) {
        hi = Math.max(hi, bars[j].h);
        lo = Math.min(lo, bars[j].l);
        if (barsToTgt == null && bars[j].h >= tgt) barsToTgt = j - i;
      }
      // early exp: how many bars until the ⚡-breakout would fire on this coin —
      // the lead the early detector buys you (null = no breakout within horizon)
      let lead: number | null = null;
      if (a.exp === 'early') {
        for (let j = i + 1; j <= i + a.horizon; j++) {
          if (signalBreakoutAt(bars, j, a)) {
            lead = j - i;
            break;
          }
        }
      }
      signals.push({
        sym,
        t: bars[i].t,
        mfe: hi / entry - 1,
        mae: lo / entry - 1,
        retH: bars[i + a.horizon].c / entry - 1,
        hit: hi / entry - 1 >= a.target / 100,
        barsToTgt,
        lead,
      });
      perCoin.set(sym, (perCoin.get(sym) ?? 0) + 1);
    }
    if (!a.json) console.error(`${sym}: ${bars.length} bars, ${perCoin.get(sym) ?? 0} signals`);
  }

  const n = signals.length;
  const hitRate = n ? signals.filter((s) => s.hit).length / n : 0;
  const baseRate = baseN ? baseHit / baseN : 0;
  const lift = baseRate > 0 ? hitRate / baseRate : 0;
  const meanRet = n ? signals.reduce((x, s) => x + s.retH, 0) / n : 0;
  const meanMfe = n ? signals.reduce((x, s) => x + s.mfe, 0) / n : 0;
  const med = (xs: number[]): number | null => {
    const s = [...xs].sort((x, y) => x - y);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
  };
  const barsToTgtMed = med(signals.filter((s) => s.hit && s.barsToTgt != null).map((s) => s.barsToTgt as number));
  // early exp: lead = 5m bars from the early fire to the ⚡-breakout it front-ran
  const leadArr = signals.filter((s) => s.lead != null).map((s) => s.lead as number);
  const leadInfo =
    a.exp === 'early'
      ? {
          followRate: n ? leadArr.length / n : 0, // fraction of early fires a breakout later confirmed
          medLeadBars: med(leadArr),
          medLeadMin: (() => {
            const m = med(leadArr);
            return m == null ? null : m * 5;
          })(),
        }
      : null;
  const result = {
    params: a,
    universe: loaded,
    skipped,
    signal: { n, hitRate, meanRet, meanMfe, medBarsToTarget: barsToTgtMed, medMinToTarget: barsToTgtMed == null ? null : barsToTgtMed * 5 },
    baseline: { n: baseN, hitRate: baseRate },
    lift,
    lead: leadInfo,
    coinsWithSignals: perCoin.size,
    topSignals: [...signals]
      .sort((x, y) => y.mfe - x.mfe)
      .slice(0, 8)
      .map((s) => ({ sym: s.sym, time: new Date(s.t).toISOString().slice(0, 16), mfePct: +(s.mfe * 100).toFixed(1) })),
  };
  if (a.json) console.log(JSON.stringify(result, null, 2));
  else {
    const label = a.exp === 'flushwick' ? `flushwick (${a.fwDef})` : a.exp === 'breakout' ? '⚡-breakout ref' : 'EARLY 拉盤 initiation';
    console.log(`\n=== 5m ${label} — Binance Vision ${a.months.join('+')} ===`);
    console.log(`universe ${loaded} loaded / ${skipped} skipped · outcome MFE ≥ +${a.target}% in ${a.horizon}×5m (${((a.horizon * 5) / 60).toFixed(0)}h)`);
    if (a.matched) console.log('baseline: STATE-MATCHED — early geometry envelope only (below/pos/rising/ret4, NO vol/OI/taker trigger)');
    if (a.exp === 'early')
      console.log(
        `early band: ${a.earlyBelowHigh}-${a.earlyBelowHighMax}% below 24h-high · pos≥${a.earlyPosMin} · ret4∈(0,${a.earlyRet4Cap}%] · volZ≥${a.earlyVolz}` +
          (a.earlyTaker > 0 ? ` · taker≥${a.earlyTaker}` : '') +
          (a.earlyOiUp ? ' · OI↑1h' : ''),
      );
    console.log(`signals ${n} · hit ${(hitRate * 100).toFixed(1)}% vs baseline ${(baseRate * 100).toFixed(1)}% · lift ×${lift.toFixed(2)} · meanRet ${(meanRet * 100).toFixed(1)}% · meanMFE ${(meanMfe * 100).toFixed(1)}%`);
    if (barsToTgtMed != null) console.log(`median time signal→+${a.target}%: ${barsToTgtMed} bars (${(barsToTgtMed * 5 / 60).toFixed(1)}h)`);
    if (leadInfo)
      console.log(
        `LEAD vs ⚡-breakout: ${(leadInfo.followRate * 100).toFixed(0)}% of early fires were later confirmed by a breakout · median lead ${leadInfo.medLeadBars ?? '—'} bars (${leadInfo.medLeadMin ?? '—'} min)`,
      );
  }
}

void main();
