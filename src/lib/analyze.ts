import type {
  Candle,
  EarlyAccum,
  EntryKind,
  ExitPlan,
  Regime,
  SeriesPoint,
  Signals,
  VolumeBar,
} from '../types';
import { aggregateCandles, aggregateLast, aggregateVolume } from './aggregate';
import { ema } from './indicators';

// Turns real market series (5m base) into the same derived fields the mock
// generator produced, so the rest of the app is source-agnostic. The strength
// score and regime call are a transparent demo heuristic over real inputs, not
// investment advice.

const H1 = 12; // 1h in 5m bars
const H4 = 48; // 4h in 5m bars
const W = 96; // 8h lookback window in 5m bars

// ---- 縮倉突破 (flush-context breakout) ------------------------------------
// Backtested 2026-07 on 154 Binance-listed small caps, ~37d @1H (see
// scripts/backtest.ts): OI flushed ≥8% below its 48h max + 24h close range
// ≤6% + |funding| ≤0.01% + OI rising over the last 6h + close breaking the
// base high on volZ ≥1.5 hit +15%/24h at 9.1% vs 4.5% base rate (lift ×2.04),
// mean ret@24h +1.9% vs -0.2%. The quiet setup ALONE backtested below base
// rate (×0.77) — the breakout trigger is what carries the information.
const FB_FLUSH_PCT = 8;
const FB_INFLECT_H = 6;
const FB_BASE_HOURS = 24;
const FB_BASE_RANGE = 6;
const FB_FUNDING = 0.01;
const FB_VOLZ = 1.5;

export interface FlushBreakout {
  oiDropPct: number;
  volZ1h: number;
}

// The flush+basing context shared by ⚡ (breakout trigger) and the early-
// accumulation watchlist check: OI flushed below its 48h max but turning up,
// price in a tight 24h base, funding neutral. Evaluated at 1H aggregation to
// mirror the backtests exactly.
function flushBaseContext(
  candles: Candle[],
  oi: SeriesPoint[],
  fundingHist: SeriesPoint[],
): { c1: Candle[]; n: number; oiDropPct: number; cMax: number } | null {
  const c1 = aggregateCandles(candles, 12);
  const o1 = aggregateLast(oi, 12);
  const f1 = aggregateLast(fundingHist, 12);
  const n = c1.length;
  if (n < FB_BASE_HOURS + 8) return null;

  // OI flush: current OI well below the window (~48h) high, but turning up
  let oiMax = 0;
  for (const p of o1) oiMax = Math.max(oiMax, p.value);
  const oiNow = o1[n - 1].value;
  if (!(oiMax > 0) || oiNow > oiMax * (1 - FB_FLUSH_PCT / 100)) return null;
  if (!(oiNow > o1[Math.max(0, n - 1 - FB_INFLECT_H)].value * 1.005)) return null;

  // tight base over the prior 24h (excluding the trigger bar)
  let cMax = -Infinity;
  let cMin = Infinity;
  for (let j = n - 1 - FB_BASE_HOURS; j < n - 1; j++) {
    cMax = Math.max(cMax, c1[j].close);
    cMin = Math.min(cMin, c1[j].close);
  }
  if (!(cMin > 0) || (cMax / cMin - 1) * 100 > FB_BASE_RANGE) return null;

  if (Math.abs(f1[n - 1].value) > FB_FUNDING) return null;

  return { c1, n, oiDropPct: (1 - oiNow / oiMax) * 100, cMax };
}

// Returns the live numbers for interpretation text, or null when the trigger
// isn't on.
export function detectFlushBreakout(
  candles: Candle[],
  volume: VolumeBar[],
  oi: SeriesPoint[],
  fundingHist: SeriesPoint[],
): FlushBreakout | null {
  const ctx = flushBaseContext(candles, oi, fundingHist);
  if (!ctx) return null;
  const { c1, n, cMax } = ctx;

  // trigger: close breaks the base high on expanded volume
  if (!(c1[n - 1].close > cMax)) return null;
  const v1 = aggregateVolume(volume, c1, 12);
  const win = v1.slice(n - 1 - FB_BASE_HOURS, n - 1).map((b) => b.value);
  const [vm, vsd] = meanStd(win);
  const z = vsd > 0 ? (v1[n - 1].value - vm) / vsd : 0;
  if (z < FB_VOLZ) return null;

  return { oiDropPct: ctx.oiDropPct, volZ1h: z };
}

// ---- 早期蓄力 (early-accumulation watchlist) --------------------------------
// Backtested 2026-07 on the same harness as ⚡: the quiet flush+basing setup
// ALONE tests below base rate at every target/horizon (×0.60-0.88), but with
// retail long/short ratio falling ≥5% over 24h AND ≥2% relative strength vs
// BTC it turns consistently (if modestly) positive: lift ×1.03-1.24 across
// four specs, forward returns +1.1~1.3% vs -0.6~-1.4% baseline in ALL specs,
// MAE ~30% shallower. (A best-spec ×1.61 did not survive the robustness
// sweep — treat it as selection noise, not the effect size.)
// WATCHLIST TIER ONLY: it ranks coins worth watching before any trigger; it
// does not time anything. No notification, info tone.
export const EA_LS_DROP_PCT = 5; // retail long/short ratio drop over 24h
export const EA_RS_MIN_PCT = 2; // outperformance vs BTC over 24h

// Cheap pre-filter using only data every scanned coin already has (no extra
// requests). Coins passing this get the expensive confirmations fetched.
export function detectEarlySetup(
  candles: Candle[],
  oi: SeriesPoint[],
  fundingHist: SeriesPoint[],
): { oiDropPct: number } | null {
  const ctx = flushBaseContext(candles, oi, fundingHist);
  return ctx ? { oiDropPct: ctx.oiDropPct } : null;
}

// Full check: cheap setup + the two backtested confirmations. lsDropPct and
// rsPct are computed by the data layer (long/short ratio needs its own fetch;
// BTC 24h return is one scalar per sweep).
export function confirmEarlyAccum(
  setup: { oiDropPct: number },
  lsDropPct: number | null,
  rsPct: number | null,
): EarlyAccum | null {
  if (lsDropPct == null || rsPct == null) return null;
  if (lsDropPct < EA_LS_DROP_PCT || rsPct < EA_RS_MIN_PCT) return null;
  return { oiDropPct: setup.oiDropPct, lsDropPct, rsPct };
}
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// map any real number into (-1, 1); gentle saturation
function squash(x: number): number {
  return x / (1 + Math.abs(x));
}

function meanStd(xs: number[]): [number, number] {
  if (xs.length === 0) return [0, 0];
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return [m, Math.sqrt(v)];
}

function rangePos(candles: Candle[], i: number): number {
  const s = Math.max(0, i - W);
  let lo = candles[s].low;
  let hi = candles[s].high;
  for (let j = s + 1; j <= i; j++) {
    if (candles[j].low < lo) lo = candles[j].low;
    if (candles[j].high > hi) hi = candles[j].high;
  }
  return hi > lo ? (candles[i].close - lo) / (hi - lo) : 0.5;
}

// Rolling composite strength [0..100] at the base resolution — rewards rising
// open interest, constructive trend, active buying and room in the range, and
// penalizes overheated funding.
function strengthSeries(
  candles: Candle[],
  volume: VolumeBar[],
  oi: SeriesPoint[],
  funding: SeriesPoint[],
): SeriesPoint[] {
  const n = candles.length;
  const out: SeriesPoint[] = new Array(n);
  let firstIdx = -1;

  for (let i = 0; i < n; i++) {
    if (i < H1) {
      out[i] = { time: candles[i].time, value: NaN };
      continue;
    }
    const c = candles[i].close;
    const ret4 = c / candles[Math.max(0, i - H4)].close - 1;
    const oiRef = oi[Math.max(0, i - H4)].value;
    const oi4 = oiRef > 0 ? oi[i].value / oiRef - 1 : 0;
    const pos = rangePos(candles, i);

    const vs = Math.max(0, i - W);
    const prior: number[] = [];
    for (let j = vs; j < i; j++) prior.push(volume[j].value);
    const [vm, vsd] = meanStd(prior);
    const z = vsd > 0 ? (volume[i].value - vm) / vsd : 0;

    const bs = Math.max(0, i - H4);
    let up = 0;
    let tot = 0;
    for (let j = bs; j <= i; j++) {
      tot += volume[j].value;
      if (volume[j].up) up += volume[j].value;
    }
    const buyShare = tot > 0 ? up / tot : 0.5;
    const fund = funding[i].value;

    const val =
      50 +
      24 * squash(oi4 / 0.05) +
      16 * squash(ret4 / 0.06) +
      14 * clamp((buyShare - 0.5) * 2, -1, 1) +
      10 * (0.5 - pos) * 2 +
      8 * squash(z / 2) -
      14 * clamp((fund - 0.03) / 0.05, 0, 1);

    out[i] = { time: candles[i].time, value: clamp(val, 3, 98) };
    if (firstIdx < 0) firstIdx = i;
  }

  const fill = firstIdx >= 0 ? out[firstIdx].value : 50;
  const end = firstIdx < 0 ? n : firstIdx;
  for (let i = 0; i < end; i++) out[i] = { time: candles[i].time, value: fill };
  return out;
}

// Score each regime from the dynamics and take the best fit, rather than a
// position-first cascade — in a broad rally almost every coin sits near its
// range high, so "high position" alone must not mean distribution. change1h is
// percent, ret4h a fraction, oi4h percent, buyShare a 0..1 share.
function classify(m: {
  pos: number;
  change1h: number;
  ret4h: number;
  oi4h: number;
  funding: number;
  volZ: number;
  buyShare: number;
}): Regime {
  const { pos, change1h, ret4h, oi4h, funding, volZ, buyShare } = m;

  // 拉升 — needs REAL thrust: the -0.8 baseline keeps broad-market drift
  // (+0.3% 1h everywhere) from reading as a pump
  const pump =
    1.2 * clamp(change1h / 2.0, -1, 1.5) +
    0.9 * clamp(ret4h / 0.05, -1, 1.5) +
    0.8 * clamp(volZ / 2, -0.5, 1.5) +
    0.5 * clamp(oi4h / 5, -1, 1.5) +
    0.6 * clamp((buyShare - 0.55) / 0.2, -1, 1.5) -
    0.8;

  // 出貨 — high in range and fading: price stalling, OI rolling over,
  // funding hot, or heavy volume without progress
  const dist =
    0.9 * clamp((pos - 0.65) / 0.3, 0, 1) +
    1.0 * clamp(-change1h / 1.2, 0, 1.5) +
    0.8 * clamp(-oi4h / 2.5, 0, 1.5) +
    0.5 * (funding > 0.045 ? 1 : 0) +
    0.5 * clamp(volZ / 2, 0, 1) * clamp(-change1h / 0.5, 0, 1) +
    0.3 * clamp((0.45 - buyShare) / 0.15, 0, 1);

  // 蓄力 — quiet building: OI creeping up while price is calm; low range
  // position helps but quietness matters more (soft floor on the pos term)
  const acc =
    0.6 * clamp((0.7 - pos) / 0.35, -0.4, 1.2) +
    0.8 * clamp(oi4h / 3, -1, 1.2) +
    0.7 * clamp((0.8 - Math.abs(change1h)) / 0.8, -1, 1) +
    0.4 * clamp((1 - Math.abs(volZ)) / 1, -1, 1) +
    0.3 * (funding < 0.02 ? 1 : 0);

  if (pump >= dist && pump >= acc) return 'pump';
  if (acc >= dist) return 'accumulate';
  return 'distribute';
}

export interface AnalyzeInput {
  candles: Candle[];
  volume: VolumeBar[];
  oi: SeriesPoint[];
  fundingHist: SeriesPoint[];
}

export interface Derived {
  regime: Regime;
  strength: number;
  change1h: number;
  oi4h: number;
  funding: number;
  volZ: number;
  vol24h: number;
  flushBreakout: boolean; // backtested 縮倉突破 trigger (see detectFlushBreakout)
  riskFlags: string[];
  signals: Signals;
  plan: ExitPlan;
  strengthHist: SeriesPoint[];
}

export function analyze({ candles, volume, oi, fundingHist }: AnalyzeInput): Derived {
  const strengthHist = strengthSeries(candles, volume, oi, fundingHist);

  // stable metrics on the 15m aggregation (the scanner's native resolution)
  const c15 = aggregateCandles(candles, 3);
  const v15 = aggregateVolume(volume, c15, 3);
  const oi15 = aggregateLast(oi, 3);
  const f15 = aggregateLast(fundingHist, 3);
  const M = c15.length;
  const at = (k: number) => Math.max(0, M - k);

  const last = c15[M - 1].close;
  const change1h = (last / c15[at(5)].close - 1) * 100;
  const ret4h = last / c15[at(17)].close - 1;
  const oiRef = oi15[at(17)].value;
  const oi4h = oiRef > 0 ? (oi15[M - 1].value / oiRef - 1) * 100 : 0;

  const vols = v15.map((v) => v.value);
  const prior = vols.slice(at(97), M - 1);
  const [vm, vsd] = meanStd(prior);
  const volZ = vsd > 0 ? (vols[M - 1] - vm) / vsd : 0;
  const vol24h = vols.slice(at(96)).reduce((a, b) => a + b, 0);

  const funding = f15[M - 1].value;

  const w = c15.slice(at(96));
  const lo = Math.min(...w.map((c) => c.low));
  const hi = Math.max(...w.map((c) => c.high));
  const pos = hi > lo ? (last - lo) / (hi - lo) : 0.5;

  const last4h = v15.slice(at(16));
  const tot4h = last4h.reduce((a, v) => a + v.value, 0);
  const buyShare4h =
    tot4h > 0 ? last4h.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / tot4h : 0.5;

  const regime = classify({ pos, change1h, ret4h, oi4h, funding, volZ, buyShare: buyShare4h });

  const signals: Signals = {
    fundsFirst: pos < 0.5 && oi4h > 1.2,
    mildRise: change1h > 0.2 && change1h < 3.2,
    oiHealthy: oi4h > 0.8 && oi4h < 14,
    buyHealthy: buyShare4h > 0.55,
  };

  const riskFlags: string[] = [];
  if (funding > 0.05) riskFlags.push('資金費率過熱');
  if (oi4h > 20) riskFlags.push('OI 4h 增速過快');
  if (regime === 'pump' && ret4h > 0.12) riskFlags.push('離進場價過遠，追高風險');
  if (pos > 0.72 && volZ > 1 && change1h < 0) riskFlags.push('高位放量滯漲');
  if (buyShare4h < 0.42) riskFlags.push('主動買盤枯竭');

  // Entry anchored to STRUCTURE computed from CLOSED bars only. The old
  // behaviour (entry = live price at fetch time) re-anchored on every 20s
  // refresh and every detail open — noise, not a plan. 蓄力: breakout of the
  // 24h base high. 拉升: pullback to the 1H EMA20 (consistent with the
  // 「宜逢回布局而非追高」 insight). 出貨: LONG ONLY stands aside; the level
  // shown is the reclaim of the base high.
  const closed1h = aggregateCandles(candles, 12).slice(0, -1); // drop in-progress hour
  const baseCloses = c15.slice(at(97), M - 1).map((c) => c.close); // 24h of closed 15m bars
  const baseHigh = baseCloses.length ? Math.max(...baseCloses) : last;
  const ema1h = ema(closed1h, 20);
  const pullback = ema1h.length ? ema1h[ema1h.length - 1].value : last;
  let entry: number;
  let kind: EntryKind;
  if (regime === 'pump') {
    entry = pullback;
    kind = 'pullback';
  } else if (regime === 'accumulate') {
    entry = baseHigh * 1.001;
    kind = 'breakout';
  } else {
    entry = baseHigh;
    kind = 'reclaim';
  }
  if (!(entry > 0)) entry = last;

  const plan: ExitPlan = {
    entry,
    kind,
    tp1: entry * 1.04,
    tp2: entry * 1.08,
    tp3: entry * 1.15,
    sl: entry * 0.97,
    runnerPct: 5,
  };

  return {
    regime,
    strength: Math.round(strengthHist[strengthHist.length - 1].value),
    change1h,
    oi4h,
    funding,
    volZ,
    vol24h,
    flushBreakout: !!detectFlushBreakout(candles, volume, oi, fundingHist),
    riskFlags,
    signals,
    plan,
    strengthHist,
  };
}
