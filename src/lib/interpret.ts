import type { Coin, VolumeBar } from '../types';
import { aggregateCandles, aggregateLast, aggregateVolume } from './aggregate';
import { detectFlushBreakout } from './analyze';
import { ema } from './indicators';
import { fmtPct } from './format';

// ---------------------------------------------------------------------------
// Pattern interpretation library (型態解讀).
// Detects notable changes in funding / OI / price / volume structure and
// explains their market meaning. Detection rules and thresholds distilled from
// perp-microstructure research; all series are read at the scanner's native
// 15m resolution so insights don't shift with the display timeframe.
// Educational heuristics — not investment advice.
// ---------------------------------------------------------------------------

export type InsightTone = 'bull' | 'bear' | 'warn' | 'info';

export interface Insight {
  id: string;
  title: string; // short zh-TW tag
  detail: string; // interpretation with live numbers baked in
  tone: InsightTone;
  priority: number; // 1-10, higher = shown first
  atTime?: number; // anchor candle time (unix seconds) — the bar this read marks
  next?: string; // conditional watch-point:「若後續 A → 行動 B;若 A' → 失效」(heuristic, not advice)
}

interface Ctx {
  last: number;
  change1h: number; // %
  ret4h: number; // fraction
  ret24h: number; // fraction
  fNow: number; // funding % per 8h
  f8h: number;
  f24h: number;
  oi4h: number; // %
  volZ: number;
  pos: number; // 0..1 in 24h range
  buyShare4h: number; // 0..1
  greenShare24h: number;
  maxPullback24h: number; // fraction, <= 0
  priceNewHigh24h: boolean;
  brokeHigh24h: boolean;
  emaAbove20: boolean;
  emaAbove50: boolean;
  crossRecent: -1 | 0 | 1; // EMA20 x EMA50 within last 8 bars
  recentBelowEma20: boolean;
  devEma20: number; // fraction distance from EMA20
  bbPctile: number; // 0..1 rank of current BB bandwidth in 48h window
  upperWick4: number; // max upper-wick ratio, last 4 bars
  lowerWick4: number;
  upthrustBarRed: boolean; // the max-upper-wick bar closed at/below its open
  capBarStrongClose: boolean; // the max-lower-wick bar closed in its upper half
  rangeLast: number;
  avgRange24h: number;
  // anchor times (unix seconds) for marking the corresponding candle on the chart
  lastTime: number; // latest analyzed bar — the detection moment for state reads
  crossTime: number; // the EMA20×EMA50 cross bar (0 if none)
  upWickTime: number; // the max-upper-wick bar in the last 4
  lowWickTime: number; // the max-lower-wick bar in the last 4
  // ---- S2 spot cross-source metrics; null unless a candidate spot series is attached ----
  spotVolZ: number | null; // z of 15m spot volume vs its prior 24h
  spotVolRatio: number | null; // spot vol last-8h mean / prior-40h mean
  basisPct: number | null; // perp/spot basis % (from Coin.basisPct)
  spotBuyShare: number | null; // spot taker buy share over 24h (from Coin.spotTakerBuyShare24h)
  // ---- S6 squeeze, evaluated on the 1H aggregation to mirror the backtest
  // (scripts/backtest.ts --mode squeeze, def D3, confirm either) exactly ----
  sqzSetup: boolean; // TTM squeeze (BB20,2 inside Keltner 20,1.5·ATR) + direction confirm, latest bar
  sqzBreakout: { volZ1h: number; sinceH: number } | null; // setup within 6h resolved up through the range high on volume
  // ---- S7 boarding B2 (EMA 收復), 1H mirror of backtest --mode boarding ----
  boardingB2: { volZ1h: number; hoursBelow: number } | null;
  // ---- S9 rebuild R1 (增倉突破), 1H mirror of backtest --mode rebuild ----
  rebuildR1: { volZ1h: number; oi4h: number } | null;
  // ---- S13 virgin V2 (處女增倉突破), 1H mirror of backtest --mode virgin ----
  virginV2: { volZ1h: number; oi4h: number; oi24h: number } | null;
}

// funding formatted at 3 decimals, percents at sensible precision
const fp = (x: number) => fmtPct(x, 3);
const p1 = (x: number) => fmtPct(x, 1);
const r1 = (x: number) => fmtPct(x * 100, 1); // fraction -> %

function buildCtx(coin: Coin): Ctx | null {
  const c15 = aggregateCandles(coin.candles, 3);
  const v15 = aggregateVolume(coin.volume, c15, 3);
  const f15 = aggregateLast(coin.fundingHist, 3);
  const M = c15.length;
  if (M < 60) return null;
  // Under 429 throttling the funding fetch can fail and come back shorter than
  // the candles (binance.ts scan path falls back to an empty series). Every f15
  // index below derives from c15.length, so a short series would throw — skip
  // this coin's reads for the sweep instead.
  if (f15.length < M) return null;
  const at = (k: number) => Math.max(0, M - k);

  const last = c15[M - 1].close;
  const change1h = (last / c15[at(5)].close - 1) * 100;
  const ret4h = last / c15[at(17)].close - 1;
  const ret24h = last / c15[at(97)].close - 1;

  const fNow = f15[M - 1].value;
  const f8h = f15[at(33)].value;
  const f24h = f15[at(97)].value;

  // P1: use the store-corrected oi4h computed by analyze (coin.oi4h) instead of
  // recomputing from the possibly-hours-stale cold-path `oi` series. When the
  // data layer marks OI untrusted (oiTrusted === false), poison with NaN: every
  // numeric comparison against NaN is false, so ALL OI-gated reads fail closed
  // without touching each detector. Because of this sentinel, NEVER gate on a
  // negated oi4h comparison (e.g. `!(c.oi4h > x)`) — it would pass on NaN.
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;

  const vols = v15.map((v) => v.value);
  const prior = vols.slice(at(97), M - 1);
  const mean = prior.reduce((a, b) => a + b, 0) / Math.max(1, prior.length);
  const sd = Math.sqrt(
    prior.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, prior.length),
  );
  const volZ = sd > 0 ? (vols[M - 1] - mean) / sd : 0;

  const win = c15.slice(at(97));
  const lo = Math.min(...win.map((c) => c.low));
  const hi = Math.max(...win.map((c) => c.high));
  const pos = hi > lo ? (last - lo) / (hi - lo) : 0.5;

  const last16 = v15.slice(at(17), M - 1 + 1).slice(-16);
  const tot16 = last16.reduce((a, v) => a + v.value, 0);
  const buyShare4h =
    tot16 > 0 ? last16.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / tot16 : 0.5;

  const last96 = v15.slice(at(97));
  const tot96 = last96.reduce((a, v) => a + v.value, 0);
  const greenShare24h =
    tot96 > 0 ? last96.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / tot96 : 0.5;

  let peak = -Infinity;
  let maxPullback24h = 0;
  for (const c of win) {
    peak = Math.max(peak, c.close);
    maxPullback24h = Math.min(maxPullback24h, c.close / peak - 1);
  }

  const prevHighs = c15.slice(at(97), M - 2).map((c) => c.high);
  const priorMax = prevHighs.length ? Math.max(...prevHighs) : hi;
  const priceNewHigh24h = last >= priorMax * 0.999;

  const before4 = c15.slice(at(101), M - 4).map((c) => c.high);
  const priorMax4 = before4.length ? Math.max(...before4) : hi;
  const maxClose4 = Math.max(...c15.slice(M - 4).map((c) => c.close));
  const brokeHigh24h = maxClose4 >= priorMax4 * 0.997;

  // EMA structure — series start at their period offset
  const e20 = ema(c15, 20);
  const e50 = ema(c15, 50);
  const e20At = (i: number) => e20[i - 19]?.value;
  const e50At = (i: number) => e50[i - 49]?.value;
  const e20Last = e20At(M - 1);
  const e50Last = e50At(M - 1);
  if (e20Last == null || e50Last == null) return null;
  const emaAbove20 = last > e20Last;
  const emaAbove50 = last > e50Last;
  let crossRecent: -1 | 0 | 1 = 0;
  let crossTime = 0;
  for (let j = M - 8; j < M; j++) {
    const dPrev = (e20At(j - 1) ?? 0) - (e50At(j - 1) ?? 0);
    const dCur = (e20At(j) ?? 0) - (e50At(j) ?? 0);
    if (dPrev <= 0 && dCur > 0) {
      crossRecent = 1;
      crossTime = c15[j].time;
    } else if (dPrev >= 0 && dCur < 0) {
      crossRecent = -1;
      crossTime = c15[j].time;
    }
  }
  let recentBelowEma20 = false;
  for (let j = Math.max(19, M - 8); j < M - 1; j++) {
    const e = e20At(j);
    if (e != null && c15[j].close < e) recentBelowEma20 = true;
  }
  const devEma20 = (last - e20Last) / e20Last;

  // Bollinger bandwidth percentile across the window
  const widths: number[] = [];
  for (let i = 19; i < M; i++) {
    let m = 0;
    for (let j = i - 19; j <= i; j++) m += c15[j].close;
    m /= 20;
    let v = 0;
    for (let j = i - 19; j <= i; j++) v += (c15[j].close - m) ** 2;
    widths.push(m > 0 ? (4 * Math.sqrt(v / 20)) / m : 0);
  }
  const bwNow = widths[widths.length - 1];
  const bbPctile = widths.filter((w) => w <= bwNow).length / widths.length;

  // wick anatomy over the last 4 bars
  let upperWick4 = 0;
  let lowerWick4 = 0;
  let upthrustBarRed = false;
  let capBarStrongClose = false;
  let upWickTime = 0;
  let lowWickTime = 0;
  for (const c of c15.slice(M - 4)) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    const uw = (c.high - Math.max(c.open, c.close)) / range;
    const lw = (Math.min(c.open, c.close) - c.low) / range;
    if (uw > upperWick4) {
      upperWick4 = uw;
      upthrustBarRed = c.close <= c.open;
      upWickTime = c.time;
    }
    if (lw > lowerWick4) {
      lowerWick4 = lw;
      capBarStrongClose = c.close > c.low + 0.5 * range;
      lowWickTime = c.time;
    }
  }
  const lastBar = c15[M - 1];
  const rangeLast = lastBar.high - lastBar.low;
  const avgRange24h =
    win.reduce((a, c) => a + (c.high - c.low), 0) / Math.max(1, win.length);

  // S2 spot cross-source metrics — computed only when a candidate spot series is
  // attached (spotCandles/spotVolume from binance.ts). null on demo/older coins and
  // pure-perp listings, so the spot detectors no-op there. Aggregated to 15m to
  // match the perp volZ math above (same window: prior 24h / last-8h vs 40h).
  let spotVolZ: number | null = null;
  let spotVolRatio: number | null = null;
  if (coin.spotCandles && coin.spotVolume && coin.spotCandles.length >= 60) {
    const sc15 = aggregateCandles(coin.spotCandles, 3);
    const sv15 = aggregateVolume(coin.spotVolume, sc15, 3);
    const sVols = sv15.map((v) => v.value);
    const sm = sVols.length;
    if (sm >= 96) {
      const sPrior = sVols.slice(sm - 97, sm - 1);
      const sMean = sPrior.reduce((a, b) => a + b, 0) / Math.max(1, sPrior.length);
      const sSd = Math.sqrt(
        sPrior.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(1, sPrior.length),
      );
      spotVolZ = sSd > 0 ? (sVols[sm - 1] - sMean) / sSd : 0;
    }
    if (sm >= 192) {
      const recent8h = sVols.slice(sm - 32);
      const prior40h = sVols.slice(sm - 192, sm - 32);
      const rMean = recent8h.reduce((a, b) => a + b, 0) / 32;
      const pMean = prior40h.reduce((a, b) => a + b, 0) / 160;
      spotVolRatio = pMean > 0 ? rMean / pMean : null;
    }
  }
  const basisPct = coin.basisPct ?? null;
  const spotBuyShare = coin.spotTakerBuyShare24h ?? null;

  return {
    last,
    change1h,
    ret4h,
    ret24h,
    fNow,
    f8h,
    f24h,
    oi4h,
    volZ,
    pos,
    buyShare4h,
    greenShare24h,
    maxPullback24h,
    priceNewHigh24h,
    brokeHigh24h,
    emaAbove20,
    emaAbove50,
    crossRecent,
    recentBelowEma20,
    devEma20,
    bbPctile,
    upperWick4,
    lowerWick4,
    upthrustBarRed,
    capBarStrongClose,
    rangeLast,
    avgRange24h,
    lastTime: lastBar.time,
    crossTime,
    upWickTime,
    lowWickTime,
    spotVolZ,
    spotVolRatio,
    basisPct,
    spotBuyShare,
    ...computeSqueeze(coin),
    boardingB2: computeBoardingB2(coin),
    rebuildR1: computeRebuildR1(coin),
    virginV2: computeVirginV2(coin),
  };
}

// ---- S9 rebuild R1 (增倉突破) on the 1H aggregation, mirroring backtest
// --mode rebuild --rb-def R1 bar-for-bar. Gate 2026-07-06 (150 幣, ~37d @1H,
// +10%/24h): ×2.60 (n=86, hit 26.7% vs base 10.3%), ALL robustness cells
// ≥×1.83 (flush±25% ×2.78/×2.22 · oi4h±25% ×2.27/×2.67 · volZ±25% ×2.47/×2.60
// · t15/h24 ×3.64 · t10/h48 ×1.83), overlap ⚡ 9% / sqD3 35%, medTTH 8h.
// 申報: meanRet@24h 僅 +0.3%; flush10 cell meanRet −1.5% (lift 仍 ×2.22).
// Live≠eval caveats (same class as ⚡/S6): scan tier has ~48 1H bars (flush
// window uses what's available; harness warmup 54) and the cold-path oi series
// tail can lag hours (P1) — so the flush SHAPE reads from the series but the
// freshness-critical oi4h leg uses the store-corrected coin.oi4h with the NaN
// fail-closed rule (untrusted ⇒ never fires).
const RB_FLUSH = 8; // % OI drop (high→low) within the past 48 bars
const RB_OI4H = 3; // % oi4h floor at the breakout bar (rebuilding/expanding)
const RB_VOLZ = 1.5;

function vol60Z(v60: VolumeBar[], i: number): number {
  const win = v60.slice(Math.max(0, i - 24), i).map((b) => b.value);
  if (win.length < 8) return 0;
  const m = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
  return sd > 0 ? (v60[i].value - m) / sd : 0;
}

function computeRebuildR1(coin: Coin): Ctx['rebuildR1'] {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 26) return null;
  const i = H - 1;
  // common trigger: close breaks the prior 24h high on expanded volume
  let hi24 = -Infinity;
  for (let j = Math.max(0, i - 24); j < i; j++) hi24 = Math.max(hi24, c60[j].high);
  if (!(c60[i].close > hi24)) return null;
  const z = vol60Z(v60, i);
  if (z < RB_VOLZ) return null;
  // freshness-critical leg: store-corrected oi4h, NaN-poisoned when untrusted
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  if (!(oi4h >= RB_OI4H)) return null;
  // flush shape: OI high THEN ≥8% lower low within the past 48 bars
  let mxV = 0;
  let mxJ = -1;
  for (let j = Math.max(0, i - 48); j <= i; j++) {
    if (o60[j].value > mxV) {
      mxV = o60[j].value;
      mxJ = j;
    }
  }
  if (!(mxV > 0)) return null;
  let mnV = Infinity;
  for (let j = mxJ; j <= i; j++) if (o60[j].value > 0) mnV = Math.min(mnV, o60[j].value);
  if (!Number.isFinite(mnV) || !(mnV <= mxV * (1 - RB_FLUSH / 100))) return null;
  return { volZ1h: z, oi4h };
}

// ---- S13 virgin V2 (處女增倉突破) on the 1H aggregation, mirroring backtest
// --mode virgin --vg-def V2 bar-for-bar. Gate 2026-07-07 (296 幣, ~37d @1H,
// Binance data, +10%/24h): ×2.76 (n=516, hit 39.9% vs base 14.5%), ALL
// robustness cells ≥×1.85 (oi4h±25% ×2.78/×2.83 · oi24h±25% ×2.59/×2.98 ·
// volZ±25% ×2.73/×2.80 · t15/h24 ×3.71 · t10/h48 ×1.85), overlap ⚡ 0% ·
// R1 0% (定義互斥 by construction) · R2 32% · sqD3 29%. 申報: meanRet@24h
// ≈ +0.01% — 呢個窗全家族都薄 (R1 同窗 re-gate 都係 +0.01%), 出場紀律行先。
// EVAA 07-07 零調參 cross-check: 09:00/12:00/16:00/17:00/18:00 HKT 全亮 ✓。
// Same live≠eval caveats as R1 (48-bar scan window vs harness warmup 54); the
// freshness-critical oi4h leg uses store-corrected coin.oi4h with the NaN
// fail-closed rule, while the day-scale oi24h leg reads the series (lag-
// tolerant at 24h scale).
const VG_OI4H = 3;
const VG_OI24H = 8;
const VG_VOLZ = 1.5;
const VG_FLUSH = 8; // the R1 flush shape that must be ABSENT (V∩R1 = ∅)

function computeVirginV2(coin: Coin): Ctx['virginV2'] {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 26) return null;
  const i = H - 1;
  let hi24 = -Infinity;
  for (let j = Math.max(0, i - 24); j < i; j++) hi24 = Math.max(hi24, c60[j].high);
  if (!(c60[i].close > hi24)) return null;
  const z = vol60Z(v60, i);
  if (z < VG_VOLZ) return null;
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  if (!(oi4h >= VG_OI4H)) return null;
  // virgin precondition: NO flush shape (OI high THEN ≥8% lower low) in window
  let mxV = 0;
  let mxJ = -1;
  for (let j = Math.max(0, i - 48); j <= i; j++) {
    if (o60[j].value > mxV) {
      mxV = o60[j].value;
      mxJ = j;
    }
  }
  if (!(mxV > 0)) return null;
  let mnV = Infinity;
  for (let j = mxJ; j <= i; j++) if (o60[j].value > 0) mnV = Math.min(mnV, o60[j].value);
  if (Number.isFinite(mnV) && mnV <= mxV * (1 - VG_FLUSH / 100)) return null; // flush present → R1 territory
  // V2 leg: day-scale OI build from the series
  if (!(i >= 24 && o60[i - 24].value > 0)) return null;
  const oi24h = (o60[i].value / o60[i - 24].value - 1) * 100;
  if (!(oi24h >= VG_OI24H)) return null;
  return { volZ1h: z, oi4h, oi24h };
}

// S9/S10/S11 recording flags — sweep-meta evidence streams (E1 revalidation).
// Shipped status is IRRELEVANT here: flags record whether each pre-registered
// def's condition held, exactly like squeezeSignals for the unshipped setup.
// Defs mirror scripts/backtest.ts modes rebuild/top/wbottom bar-for-bar on the
// 1H aggregation (same eval≠live caveat class as ⚡/S2/S6).

// [R1, R2, R3] — R1 shipped ×2.60; R2 ×1.46 / R3 ×2.31 recording-only.
// H deliberately EXCLUDES f60 so the R1 leg evaluates the exact same bar as
// computeRebuildR1 (a 429-shortened funding series must not shift i — that
// desynced the badge from the flags on the first live sweep, 2026-07-07).
// R3's funding read degrades to 0 when the funding series is short.
export function rebuildSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1] | null {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const f60 = aggregateLast(coin.fundingHist, 12);
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 26) return null;
  const i = H - 1;
  let hi24 = -Infinity;
  for (let j = Math.max(0, i - 24); j < i; j++) hi24 = Math.max(hi24, c60[j].high);
  if (!(c60[i].close > hi24) || vol60Z(v60, i) < RB_VOLZ) return [0, 0, 0];
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  if (!(oi4h >= RB_OI4H)) return [0, 0, 0];
  const r1 = computeRebuildR1(coin) != null;
  const ret4h = i >= 4 && c60[i - 4].close > 0 ? (c60[i].close / c60[i - 4].close - 1) * 100 : NaN;
  const r2 = ret4h >= 0 && ret4h <= 6;
  const r3 = r1 && f60.length > i && f60[i].value <= 0.02;
  return [r1 ? 1 : 0, r2 ? 1 : 0, r3 ? 1 : 0];
}

// [T1, T2, T3, T4] 派貨/頂部拒絕 — ALL recording-only (gate 2026-07-06: n=6/3/0/0,
// 全部 < 20 floor; T1 headline ×6.31 但 meanRet +2.0% 正 — 插完即彈, 樣本不足未定案)
export function distTopSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1, 0 | 1] | null {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const f60 = aggregateLast(coin.fundingHist, 12);
  // H excludes f60 (same bar-desync guard as rebuildSignals); T4's funding
  // reads degrade to 0 when the funding series came back short (429 fallback)
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 33) return null;
  const i = H - 1;
  const b = c60[i];
  const px = b.close;
  // common precondition: pumped ∧ near the high ∧ volume
  if (!(c60[i - 24].close > 0) || (px / c60[i - 24].close - 1) * 100 < 15) return [0, 0, 0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, c60[j].low);
    hi = Math.max(hi, c60[j].high);
  }
  const pos24 = hi > lo ? (px - lo) / (hi - lo) : 0.5;
  if (pos24 < 0.8 || vol60Z(v60, i) < 1.5) return [0, 0, 0, 0];
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  // T1 雙頂拒絕
  let hPrev = -Infinity;
  for (let j = i - 24; j <= i - 3; j++) hPrev = Math.max(hPrev, c60[j].high);
  const t1 = hPrev > 0 && Math.abs(b.high / hPrev - 1) <= 0.01 && b.close <= b.high * 0.99 && b.close <= b.open;
  // T2 新高背離拒絕
  let hiPrev = -Infinity;
  for (let j = i - 24; j < i; j++) hiPrev = Math.max(hiPrev, c60[j].high);
  const range = b.high - b.low;
  const t2 =
    b.high > hiPrev && range > 0 && (b.high - Math.max(b.open, b.close)) / range >= 0.5 && oi4h <= -1.5;
  // T3 量能高潮反轉
  const p = c60[i - 1];
  let lo2 = Infinity;
  let hi2 = -Infinity;
  for (let j = i - 24; j <= i - 1; j++) {
    lo2 = Math.min(lo2, c60[j].low);
    hi2 = Math.max(hi2, c60[j].high);
  }
  const posC = hi2 > lo2 ? (p.close - lo2) / (hi2 - lo2) : 0.5;
  const t3 = vol60Z(v60, i - 1) >= 2.5 && posC >= 0.85 && b.close < p.low;
  // T4 過熱滯漲
  const t4 =
    f60[i].value >= 0.015 &&
    f60[i].value > f60[i - 8].value &&
    (px / c60[i - 4].close - 1) * 100 <= 1;
  return [t1 ? 1 : 0, t2 ? 1 : 0, t3 ? 1 : 0, t4 ? 1 : 0];
}

// [W1, W2, W3] 雙底接人 — ALL recording-only (gate 2026-07-06: W2 主 ×1.41 過
// 但 t10/h48 ×1.14 < 1.15 cross-target floor → 死於 robustness, S6-D2 同款;
// W1 ×1.21 / W3 ×1.22 唔過主 gate). E1 新窗重驗.
export function wbottomSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1] | null {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 30) return null;
  const i = H - 1;
  const px = c60[i].close;
  // anti-knife: pullback-in-pump only. Scan tier has no EMA50(1H) (needs ≥52
  // bars of long series) — the ret24h branch alone applies, a declared strict
  // subset (S7-B2 limitation class).
  const ret24 = c60[i - 24]?.close > 0 ? (px / c60[i - 24].close - 1) * 100 : 0;
  if (!(ret24 >= 10)) return [0, 0, 0];
  const isMin = (j: number) => j >= 1 && j + 1 < H && c60[j].low <= c60[j - 1].low && c60[j].low <= c60[j + 1].low;
  const z = vol60Z(v60, i);
  // W2 spring
  let w2 = false;
  if (z >= 1.25 && c60[i].close > c60[i].open) {
    const s = i - 1;
    for (let j1 = s - 12; j1 <= s - 2; j1++) {
      if (!isMin(j1)) continue;
      if (c60[s].low < c60[j1].low && c60[s].close > c60[j1].low) {
        w2 = true;
        break;
      }
    }
  }
  // W1/W3 classic double bottom
  let w1 = false;
  if (z >= 1.5) {
    outer: for (let j2 = i - 1; j2 >= i - 6; j2--) {
      if (j2 < 3) break;
      if (!isMin(j2)) continue;
      for (let sep = 2; sep <= 12; sep++) {
        const j1 = j2 - sep;
        if (j1 < 1) break;
        if (!isMin(j1)) continue;
        if (Math.abs(c60[j2].low / c60[j1].low - 1) > 0.01) continue;
        let neck = -Infinity;
        for (let j = j1 + 1; j < j2; j++) neck = Math.max(neck, c60[j].high);
        if (neck > 0 && px > neck) {
          w1 = true;
          break outer;
        }
      }
    }
  }
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  const w3 = w1 && oi4h >= 0;
  return [w1 ? 1 : 0, w2 ? 1 : 0, w3 ? 1 : 0];
}

// ---- S7 boarding B2 (EMA 收復) on the 1H aggregation, mirroring backtest
// --mode boarding --bd-def B2 bar-for-bar. Gate 2026-07-06: ×2.04, ALL
// robustness cells ≥×1.40, anti-chase ablation causal (capped ×2.04 vs
// uncapped ×1.48), overlap ⚡ 0% / squeeze 15%, median 11h to +10% touch.
// NOTE: B2 needs ~100 1H bars (EMA50 warm + 48 below-bars) but the 48h 5m base
// aggregates to only ~48 — so the live mirror runs off the coin's LONG 1H
// series (~25d, attached by fetchLiveCoin on detail views). Scan/recorder
// coins carry no long series → null there; the read is detail-view-only and
// sweep-meta recording flags are deferred until long-series plumbing exists
// (E1 re-tests via the harness directly, no recordings dependency).
function computeBoardingB2(coin: Coin): Ctx['boardingB2'] {
  const c60 = coin.long?.candles ?? aggregateCandles(coin.candles, 12);
  const v60 = coin.long?.volume ?? aggregateVolume(coin.volume, c60, 12);
  const H = Math.min(c60.length, v60.length);
  const NEED_BELOW = 48;
  if (H < NEED_BELOW + 52) return null; // EMA50 warm + 48 below-bars + cross bar
  const closes = c60.map((c) => c.close);
  const emaAt = (p: number): number[] => {
    const out = new Array<number>(H).fill(NaN);
    const k = 2 / (p + 1);
    let e = closes.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out[p - 1] = e;
    for (let j = p; j < H; j++) {
      e = closes[j] * k + e * (1 - k);
      out[j] = e;
    }
    return out;
  };
  const e20 = emaAt(20);
  const e50 = emaAt(50);
  const i = H - 1;
  const px = closes[i];
  // anti-chase (structural)
  if (!((px / closes[i - 4] - 1) * 100 <= 6)) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, c60[j].low);
    hi = Math.max(hi, c60[j].high);
  }
  if (hi > lo && (px - lo) / (hi - lo) > 0.7) return null;
  // fresh EMA20 cross after ≥48h below EMA50
  if (!(px > e20[i]) || !(closes[i - 1] <= e20[i - 1])) return null;
  for (let j = i - NEED_BELOW; j < i; j++) {
    if (!(closes[j] < e50[j])) return null;
  }
  const win = v60.slice(Math.max(0, i - 24), i).map((b) => b.value);
  if (win.length < 8) return null;
  const m = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
  const z = sd > 0 ? (v60[i].value - m) / sd : 0;
  if (z < 1.5) return null;
  return { volZ1h: z, hoursBelow: NEED_BELOW };
}

// ---- S6 squeeze on the 1H aggregation, mirroring scripts/backtest.ts
// --mode squeeze (def D3, confirm either) bar-for-bar. Gate 2026-07-06: D3
// breakout ×1.42, robust ×1.29-1.39 (see docs/roadmap/S6-bb-squeeze.md results).
// Live approximation vs eval: the oi-confirm leg uses the coin's oi series
// (store-fresh on warm coins post-P1, laggy on cold) and up-volume share in
// place of rubik taker share — same eval≠live caveat class as ⚡/S2.
const SQZ_BB_P = 20;
const SQZ_KT_MULT = 1.5;
const SQZ_RECENT_H = 6;
const SQZ_VOLZ = 1.5;
function computeSqueeze(coin: Coin): { sqzSetup: boolean; sqzBreakout: Ctx['sqzBreakout'] } {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const f60 = aggregateLast(coin.fundingHist, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const H = c60.length;
  if (H < SQZ_BB_P + 2) return { sqzSetup: false, sqzBreakout: null };
  // throttled partial coin — funding/oi/volume shorter than the candles would
  // throw inside setupAt (every j derives from c60.length); fail closed, no read
  if (f60.length < H || o60.length < H || v60.length < H)
    return { sqzSetup: false, sqzBreakout: null };

  // D3 geometry at bar j: BB(20,2) inside Keltner(20, 1.5·ATR) with a shared
  // SMA centre reduces to 2·sd ≤ 1.5·ATR ⇔ bw ≤ 2·1.5·atrN (backtest sqSeries).
  const squeezedAt = (j: number): boolean => {
    if (j < SQZ_BB_P) return false; // needs a previous close for true range
    let m = 0;
    for (let k = j - SQZ_BB_P + 1; k <= j; k++) m += c60[k].close;
    m /= SQZ_BB_P;
    if (!(m > 0)) return false;
    let vv = 0;
    let tr = 0;
    for (let k = j - SQZ_BB_P + 1; k <= j; k++) {
      vv += (c60[k].close - m) ** 2;
      const pc = c60[k - 1].close;
      tr += Math.max(c60[k].high - c60[k].low, Math.abs(c60[k].high - pc), Math.abs(c60[k].low - pc));
    }
    const bw = (4 * Math.sqrt(vv / SQZ_BB_P)) / m;
    const atrN = tr / SQZ_BB_P / m;
    return atrN > 0 && bw <= 2 * SQZ_KT_MULT * atrN;
  };
  // direction confirm (either): funding ≤ 0 OR (oi 4h not falling ∧ up-volume share ≥ 0.5)
  const setupAt = (j: number): boolean => {
    if (!squeezedAt(j)) return false;
    if (f60[j].value <= 0) return true;
    if (j < 4 || !(o60[j - 4].value > 0)) return false;
    if (!(o60[j].value / o60[j - 4].value - 1 >= 0)) return false;
    let up = 0;
    let tot = 0;
    for (let k = j - 3; k <= j; k++) {
      tot += v60[k].value;
      if (v60[k].up) up += v60[k].value;
    }
    return tot > 0 && up / tot >= 0.5;
  };

  const i = H - 1;
  const sqzSetup = setupAt(i);
  // breakout: setup WAS on within the last 6 bars (bandwidth explodes on the
  // breakout bar itself — "still squeezed now" would never fire), close breaks
  // the high of the range since that setup bar, on expanded 1H volume.
  let sqzBreakout: Ctx['sqzBreakout'] = null;
  let firstSq = -1;
  for (let j = Math.max(SQZ_BB_P, i - SQZ_RECENT_H); j < i; j++) {
    if (setupAt(j)) {
      firstSq = j;
      break;
    }
  }
  if (firstSq >= 0) {
    let hi = -Infinity;
    for (let j = firstSq; j < i; j++) hi = Math.max(hi, c60[j].high);
    if (c60[i].close > hi) {
      const win = v60.slice(Math.max(0, i - 24), i).map((b) => b.value);
      if (win.length >= 8) {
        const mv = win.reduce((a, b) => a + b, 0) / win.length;
        const sdv = Math.sqrt(win.reduce((a, b) => a + (b - mv) ** 2, 0) / win.length);
        const z = sdv > 0 ? (v60[i].value - mv) / sdv : 0;
        if (z >= SQZ_VOLZ) sqzBreakout = { volZ1h: z, sinceH: i - firstSq };
      }
    }
  }
  return { sqzSetup, sqzBreakout };
}

// S2 spot cross-source detectors. Gated PER detector by the backtest gate
// (scripts/backtest.ts --mode spot-*): spot-led-pump PASSED and is live;
// stealth-spot-accum FAILED and stays recording-only. Both are still computed
// for recording (spotSignals) regardless of these ship flags. basis-anomaly (the
// 3rd read) needs basis history and lands with the recording-eval work — not here.
const SPOT_PUMP_SHIPPED = true; // gate: +10%/24h lift ×1.79 — spotVolZ the causal driver (momentum-only ×1.27), robust ±25% (×1.70-1.90), 76/114 coins, look-ahead clean
const SPOT_ACCUM_SHIPPED = false; // gate: ×0.54 (worse than baseline) — recording-only

// S6 squeeze detectors (scripts/backtest.ts --mode squeeze; gate run 2026-07-06,
// ~37d @1H, 114 coins, +10%/24h): D3 breakout ×1.42, robust (kt±25% ×1.29/1.33,
// volZ±25% ×1.36/1.39, t15h24 ×1.31), 113 coins, meanRet +1.3% vs base −0.1%.
// squeeze-setup ALONE tested ×0.85-0.97 on every def → no read, recording-only.
// D2 收斂比 headline ×1.73 but FAILED robustness (thresh−25% ×0.58) → not shipped.
const SQUEEZE_BREAKOUT_SHIPPED = true;
const SQUEEZE_SETUP_SHIPPED = false; // below baseline — iron rule, no UI

// S7 boarding (docs/roadmap/S7-boarding.md; gate 2026-07-06, ~37d @1H, 114 coins):
// B2 EMA收復 ×2.04, ALL robustness ≥×1.40, cross-target ×1.40/×1.49, meanRet
// +3.9%/signal, ⚡ overlap 0% / squeeze 15%, median 11h to +10% touch → SHIPPED
// (detail-view only, needs the long 1H series). B1 深跌首彈 meanRet −3.4% (knife)
// and B3 核心線 composite ×0.74 (below baseline) → dead, not even recording flags.
const BOARDING_B2_SHIPPED = true;
// D1-setup (bbPctile≤0.1) is the old volatility-squeeze read's metric: ×0.85 as
// a standalone setup → the read is retired below (kept in code, gate off).
const VOL_SQUEEZE_RETIRED = true;

// S9 rebuild (docs/roadmap/S9-rebuild-breakout.md; gate 2026-07-06, 150 幣 ~37d
// @1H, +10%/24h): R1 ×2.60, ALL robustness ≥×1.83, overlap ⚡ 9%/sqD3 35%,
// medTTH 8h → SHIPPED (badge + Telegram, 用戶拍板過 gate 即通知). R2 ×1.46 /
// R3 ×2.31 recording-only. 申報: meanRet@24h +0.3% 薄.
const REBUILD_R1_SHIPPED = true;
// S13 virgin (docs/roadmap/S13-virgin-expansion.md; gate 2026-07-07, 296 幣
// ~37d @1H Binance, +10%/24h): V2 ×2.76, ALL robustness ≥×1.85, overlap ⚡ 0%
// / R1 0% / R2 32% / sqD3 29% → SHIPPED. V1 ×2.27 / V3 ×2.19 recording-only.
// 申報: meanRet@24h ≈ +0.01% (呢個窗全家族都薄; R1 同窗 re-gate 都係 +0.01%).
const VIRGIN_V2_SHIPPED = true;
// S10 top (SHORT): T1-T4 全部 n<20 (6/3/0/0) → recording-only, NO ship, NO
// short card, NO paper S-arm until E1 accumulates samples.
// S11 wbottom: W2 主 ×1.41 過但 t10/h48 ×1.14 敗 cross-target → recording-only.
// S9-R2 升班覆核 2026-07-07 (Binance 窗): ×1.33 主 cell 但 t10/h48 ×1.07 敗
// cross-target → 維持 recording-only (同 S11-W2 死法).
// (All enforced by simply having no SHIPPED consts / insights here.)

// 現貨帶動拉升 — real spot buying leads the perp breakout: price up, OI flat,
// spot volume spikes, spot not lagging (basis ≤ +0.05%).
function spotLedPump(c: Ctx): boolean {
  return (
    c.spotVolZ != null &&
    c.basisPct != null &&
    c.ret4h >= 0.02 &&
    Math.abs(c.oi4h) < 1.5 &&
    c.spotVolZ >= 2 &&
    c.basisPct <= 0.05
  );
}

// 現貨暗中吸籌 — sustained spot volume + buy-share while price is flat and
// leverage is quiet: the earlier-than-蓄 accumulation candidate.
function stealthSpotAccum(c: Ctx): boolean {
  return (
    c.spotVolRatio != null &&
    c.spotBuyShare != null &&
    Math.abs(c.ret4h) < 0.01 &&
    c.spotVolRatio >= 1.5 &&
    c.spotBuyShare >= 0.55 &&
    Math.abs(c.oi4h) < 2
  );
}

// S2: the spot cross-source reads as 0/1 flags for a candidate coin's recorded
// sweep-meta (spotSignals map: [pump, accum, basis]). Computes regardless of the
// ship flags — recording-only is the point. basis (idx 2) needs basis history,
// so it stays 0 until the recording-eval work.
export function spotSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1] | null {
  if (coin.spotCandles == null) return null;
  const ctx = buildCtx(coin);
  if (!ctx) return null;
  return [spotLedPump(ctx) ? 1 : 0, stealthSpotAccum(ctx) ? 1 : 0, 0];
}

// S6: squeeze reads as 0/1 flags for sweep-meta recording ([setup, breakout]).
// Computed regardless of the ship flags — the un-shipped setup stage keeps
// accumulating evidence for E1 revalidation. Null when the coin lacks the bars.
export function squeezeSignals(coin: Coin): [0 | 1, 0 | 1] | null {
  const c60 = aggregateCandles(coin.candles, 12);
  if (c60.length < SQZ_BB_P + 2) return null;
  const sq = computeSqueeze(coin);
  return [sq.sqzSetup ? 1 : 0, sq.sqzBreakout ? 1 : 0];
}

// S2: does spot-led-pump fire AND is it shipped? Used by toLite to set the
// screener-row badge flag, so the badge honours the per-detector gate above.
export function spotPumpFires(coin: Coin): boolean {
  if (!SPOT_PUMP_SHIPPED || coin.spotCandles == null) return false;
  const ctx = buildCtx(coin);
  return ctx ? spotLedPump(ctx) : false;
}

// S9: does rebuild-R1 fire AND is it shipped? toLite badge flag + the recorder's
// Telegram rising-edge source (user decision 2026-07-06: gate-passers notify).
export function rebuildFires(coin: Coin): boolean {
  return REBUILD_R1_SHIPPED && computeRebuildR1(coin) != null;
}

// S13: does virgin-V2 fire AND is it shipped? Same tier as R1 (badge + Telegram
// via the recorder's rising-edge class; gate-passers notify per the standing
// 2026-07-06 拍板).
export function virginFires(coin: Coin): boolean {
  return VIRGIN_V2_SHIPPED && computeVirginV2(coin) != null;
}

// [V1, V2, V3] — V2 shipped ×2.76; V1 ×2.27 / V3 ×2.19 recording-only (E1
// evidence stream). Same H/bar-desync guard as rebuildSignals; V3's funding
// read degrades to 0 when the funding series came back short.
export function virginSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1] | null {
  const c60 = aggregateCandles(coin.candles, 12);
  const v60 = aggregateVolume(coin.volume, c60, 12);
  const o60 = aggregateLast(coin.oi, 12);
  const f60 = aggregateLast(coin.fundingHist, 12);
  const H = Math.min(c60.length, v60.length, o60.length);
  if (H < 26) return null;
  const i = H - 1;
  let hi24 = -Infinity;
  for (let j = Math.max(0, i - 24); j < i; j++) hi24 = Math.max(hi24, c60[j].high);
  if (!(c60[i].close > hi24) || vol60Z(v60, i) < VG_VOLZ) return [0, 0, 0];
  const oi4h = coin.oiTrusted === false ? NaN : coin.oi4h;
  if (!(oi4h >= VG_OI4H)) return [0, 0, 0];
  let mxV = 0;
  let mxJ = -1;
  for (let j = Math.max(0, i - 48); j <= i; j++) {
    if (o60[j].value > mxV) {
      mxV = o60[j].value;
      mxJ = j;
    }
  }
  if (!(mxV > 0)) return [0, 0, 0];
  let mnV = Infinity;
  for (let j = mxJ; j <= i; j++) if (o60[j].value > 0) mnV = Math.min(mnV, o60[j].value);
  if (Number.isFinite(mnV) && mnV <= mxV * (1 - VG_FLUSH / 100)) return [0, 0, 0]; // flush → R1 territory
  const v1 = 1;
  const oi24h = i >= 24 && o60[i - 24].value > 0 ? (o60[i].value / o60[i - 24].value - 1) * 100 : NaN;
  const v2 = oi24h >= VG_OI24H;
  const v3 = f60.length > i && f60[i].value <= 0.02;
  return [v1, v2 ? 1 : 0, v3 ? 1 : 0];
}

// Which candle a given read marks: event reads point at their event bar; every
// other (state) read points at the latest analyzed bar — the moment it fired.
function anchorTime(id: string, ctx: Ctx): number {
  if (id === 'ema-golden-cross' || id === 'ema-death-cross') return ctx.crossTime || ctx.lastTime;
  if (id === 'upthrust-rejection') return ctx.upWickTime || ctx.lastTime;
  if (id === 'capitulation-wick') return ctx.lowWickTime || ctx.lastTime;
  return ctx.lastTime;
}

type Detector = (c: Ctx) => Insight | null;

const DETECTORS: Detector[] = [
  // ---- funding ----
  // long leverage froth washing out while price holds — healthier structure
  (c) =>
    c.f8h >= 0.008 && c.fNow >= 0 && c.fNow <= 0.003 && c.fNow < c.f8h * 0.6 && c.ret4h > -0.01 && c.change1h > -1
      ? {
          id: 'funding-cooling',
          next: '若價續守穩、費率維持低位 → 回檔至 EMA20 係留意位；若費率急速回升而價滯漲 → 降溫失效，提防再過熱。',
          title: '資金降溫',
          tone: 'bull',
          priority: 7,
          detail: `資金費率由 ${fp(c.f8h)} 降至 ${fp(c.fNow)}，多頭槓桿降溫但價格守穩，行情轉為現貨買盤主導，上行結構更健康。`,
        }
      : null,
  // shorts now paying longs — squeeze fuel if price holds
  (c) =>
    c.f8h > 0 && c.fNow < -0.001 && c.ret4h > -0.005
      ? {
          id: 'funding-flip-negative',
          next: '若價格放量上攻 → 軋空啟動，可依出場計畫追蹤；若跌破近期低點 → 空方主導，訊號失效。',
          title: '費率轉負',
          tone: 'bull',
          priority: 8,
          detail: `資金費率由 ${fp(c.f8h)} 轉負至 ${fp(c.fNow)}，空頭開始付息給多頭，價格未破低，空單存在被軋出場的燃料。`,
        }
      : null,
  // crowded longs + rising OI — liquidation cascade risk
  (c) =>
    c.fNow >= 0.015 && c.fNow > c.f8h && c.f8h > c.f24h && c.oi4h > 3
      ? {
          id: 'funding-overheat',
          next: '若價格滯漲或轉跌 → 提防多殺多，宜先減倉、收緊停損；若費率回落且價守穩 → 風險解除。',
          title: '資金過熱',
          tone: 'warn',
          priority: 9,
          detail: `資金費率升至 ${fp(c.fNow)} 且持續走高，多單擁擠度極高，若價格轉弱恐引發連環多殺多。`,
        }
      : null,
  // disbelief rally — crowd still short and being proven wrong
  (c) =>
    c.fNow <= -0.005 && c.f8h <= -0.002 && c.ret4h >= 0.02 && c.ret24h > 0
      ? {
          id: 'disbelief-rally',
          next: '若費率仍負而價續創高 → 軋空未完，以持有為主；若費率轉正 → 軋空燃料耗盡，留意動能衰竭。',
          title: '軋空行情',
          tone: 'bull',
          priority: 8,
          detail: `資金費率持續為負（${fp(c.fNow)}）但價格逆勢走高 ${r1(c.ret4h)}（4h），市場仍普遍看空，軋空可能尚未結束。`,
        }
      : null,
  // longs paying to hold losing positions — latent liquidation supply below
  (c) =>
    c.fNow >= 0.006 && c.oi4h > -1 && c.ret4h <= -0.02 && c.change1h < -0.5
      ? {
          id: 'long-trap',
          next: '若跌破近期支撐 → 連環平倉風險，LONG ONLY 宜離場觀望；若放量收復失地且費率降溫 → 陷阱解除。',
          title: '多頭陷阱',
          tone: 'bear',
          priority: 7,
          detail: `價格 4h 已跌 ${r1(c.ret4h)} 但資金費率仍為正（${fp(c.fNow)}），套牢多單未離場，續破位恐觸發骨牌式平倉。`,
        }
      : null,
  // contrarian sentiment extreme — shorts pay a steep premium
  (c) =>
    c.fNow <= -0.02 && c.f24h > c.fNow && c.ret24h < 0.03
      ? {
          id: 'extreme-negative-funding',
          next: '若價止跌回升 → 軋空反轉啟動，可小注試探；若續破低 → 接刀風險，等企穩再講。',
          title: '極端負費率',
          tone: 'bull',
          priority: 6,
          detail: `資金費率跌至極端負值 ${fp(c.fNow)}，空頭付出高額成本維持部位，情緒極度悲觀，軋空反轉機率上升。`,
        }
      : null,

  // ---- open interest ----
  // healthy leveraged demand joining an uptrend, not yet overheated
  (c) =>
    c.fNow > 0 && c.fNow <= 0.008 && c.fNow >= c.f8h && c.oi4h >= 2 && c.ret4h >= 0.015 && c.pos > 0.6
      ? {
          id: 'double-confirmation',
          next: '若回檔至 EMA20 不破 → 分批進場機會；若 OI 掉頭下降或費率急升過熱 → 確認失效，收緊停損。',
          title: '雙重確認',
          tone: 'bull',
          priority: 9,
          detail: `資金費率溫和走升（${fp(c.fNow)}）、OI 4h +${c.oi4h.toFixed(1)}% 與價格同步上行，多頭趨勢獲資金面與籌碼面雙重確認。`,
        }
      : null,
  // new long money confirming the move (skipped when double-confirmation fires)
  (c) =>
    c.oi4h >= 2 && c.ret4h >= 0.015 && c.buyShare4h > 0.52 &&
    !(c.fNow > 0 && c.fNow <= 0.008 && c.fNow >= c.f8h && c.pos > 0.6)
      ? {
          id: 'oi-up-price-up',
          next: '若量能與 OI 同步續增 → 趨勢延續，回檔係機會；若價滯漲而 OI 續升 → 轉為擁擠，提防甩尾。',
          title: '增倉上漲',
          tone: 'bull',
          priority: 6,
          detail: `OI 4h +${c.oi4h.toFixed(1)}% 與價格同步上升，新資金積極做多推升行情，趨勢動能受到確認。`,
        }
      : null,
  // new shorts building or longs trapped
  (c) =>
    c.oi4h >= 2 && c.ret4h <= -0.015
      ? {
          id: 'oi-up-price-down',
          next: '若跌勢放緩且 OI 轉降 → 空頭回補反彈可期；若續增倉續跌 → 賣壓未完，勿接刀。',
          title: '增倉下跌',
          tone: 'bear',
          priority: 7,
          detail: `價格下跌但 OI 4h +${c.oi4h.toFixed(1)}%，新空單積極進場或多單被套牢，賣壓可能延續。`,
        }
      : null,
  // short-covering rally — weaker fuel
  (c) =>
    c.oi4h <= -2 && c.ret4h >= 0.015
      ? {
          id: 'oi-down-price-up',
          next: '若之後 OI 轉增且量能放大 → 升級為真趨勢，可再評估；若量縮價滯 → 回補近尾聲，勿追高。',
          title: '減倉上漲',
          tone: 'info',
          priority: 4,
          detail: `價格上漲但 OI 4h ${c.oi4h.toFixed(1)}%，上漲主因空頭回補而非新多進場，動能較弱，追高宜謹慎。`,
        }
      : null,
  // deleveraging flush — painful but cleans the book
  (c) =>
    c.oi4h <= -2 && c.ret4h <= -0.015
      ? {
          id: 'oi-down-price-down',
          next: '若 OI 止跌且低位出現長下影 → 出清近尾聲，留意築底型態；若續減倉續跌 → 繼續觀望。',
          title: '減倉下跌',
          tone: 'bear',
          priority: 5,
          detail: `OI 4h ${c.oi4h.toFixed(1)}% 與價格同步下降，多單停損去槓桿中，籌碼出清後才易見底。`,
        }
      : null,
  // the classic pre-move coil: positions accumulating under a flat price
  (c) =>
    c.oi4h >= 3 && c.oi4h < 8 && Math.abs(c.change1h) < 0.5 && Math.abs(c.ret4h) < 0.008 && c.pos > 0.3 && c.pos < 0.7
      ? {
          id: 'oi-coil',
          next: '若放量向上突破盤整區 → 順向跟進（留意 ⚡ 觸發）；若向下破位 → LONG ONLY 迴避。',
          title: '持倉盤整',
          tone: 'info',
          priority: 6,
          detail: `價格橫盤但 OI 4h +${c.oi4h.toFixed(1)}% 持續增加，籌碼正悄悄堆積，波動率可能即將放大。`,
        }
      : null,
  // leverage piling in faster than price can absorb
  (c) =>
    c.oi4h >= 8 && Math.abs(c.ret4h) < 0.025
      ? {
          id: 'oi-spike',
          next: '若價急拉後回落 → 提防雙向插針，勿追價；若價穩步消化增倉 → 風險下降，再觀察。',
          title: '持倉暴增',
          tone: 'warn',
          priority: 7,
          detail: `OI 4h 暴增 +${c.oi4h.toFixed(1)}% 遠快於價格變動，槓桿堆積過快，留意反向甩尾與雙向插針風險。`,
        }
      : null,
  // new price high without new participation
  (c) =>
    c.priceNewHigh24h && c.oi4h <= -1.5
      ? {
          id: 'oi-divergence-high',
          next: '若跌回前高之下 → 假突破確認，宜退出；若 OI 回升跟上價格 → 背離解除。',
          title: '新高背離',
          tone: 'warn',
          priority: 8,
          detail: `價格創 24h 新高但 OI 4h ${c.oi4h.toFixed(1)}% 走低，追價力道減弱，留意假突破與動能背離風險。`,
        }
      : null,
  // breakout without leverage — cleaner structure, less unwind risk
  (c) =>
    c.ret4h >= 0.02 && Math.abs(c.oi4h) < 1.5 && c.buyShare4h > 0.55 && c.volZ > 1
      ? {
          id: 'spot-led-breakout',
          next: '若回測突破位不破 → 進場機會（現貨主導結構較耐震）；若跌回突破位下 → 假突破，離場。',
          title: '現貨帶動',
          tone: 'bull',
          priority: 5,
          detail: `價格 4h ${r1(c.ret4h)} 但 OI 幾乎未變（${p1(c.oi4h)}），突破由現貨買盤帶動而非槓桿堆疊，籌碼結構較乾淨。`,
        }
      : null,
  // S2 現貨帶動拉升 — SHIPPED (gate PASSED, lift ×1.79); gated by SPOT_PUMP_SHIPPED.
  (c) =>
    SPOT_PUMP_SHIPPED && spotLedPump(c)
      ? {
          id: 'spot-led-pump',
          next: '若基差維持中性或轉負 → 現貨主導續航；若基差走正放闊 → 槓桿接手，結構轉弱。',
          title: '現貨帶動',
          tone: 'bull',
          priority: 8,
          detail:
            `價格 4h ${r1(c.ret4h)}、OI 幾乎未動（${p1(c.oi4h)}），但現貨量爆升（量Z ${c.spotVolZ!.toFixed(1)}）且現貨不落後（基差 ${c.basisPct!.toFixed(2)}%），升勢由真實現貨買盤扛住。` +
            `回測（114 幣、37 日）：+10%/24h 命中率 17.3% vs 基準 9.6%（lift ×1.79，現貨量Z 為驅動；純動能僅 ×1.27），僅供排序參考，非進場訊號。`,
        }
      : null,
  // S2 現貨暗中吸籌 — recording-only (gate FAILED ×0.54); gated by SPOT_ACCUM_SHIPPED.
  (c) =>
    SPOT_ACCUM_SHIPPED && stealthSpotAccum(c)
      ? {
          id: 'stealth-spot-accum',
          next: '若之後帶量突破盤整高點 → 升級關注；若現貨量回落至常態 → 吸籌結束。',
          title: '現貨吸籌',
          tone: 'info',
          priority: 6,
          detail: `價格橫盤（4h ${r1(c.ret4h)}）但現貨量持續放大（近8h 均量達前40h 的 ${c.spotVolRatio!.toFixed(1)}×）、主動買盤佔 ${(c.spotBuyShare! * 100).toFixed(0)}%，而槓桿靜止（OI ${p1(c.oi4h)}），疑似現貨暗中吸籌。`,
        }
      : null,

  // ---- price / volume / volatility ----
  // volume ignition from low in the range — early-stage move
  (c) =>
    c.volZ >= 2 && c.pos < 0.4 && c.change1h >= 1.5 && c.ret4h > 0
      ? {
          id: 'volume-ignition',
          next: '若下一根續放量收高 → 啟動確認，可依計畫評估進場；若量退價回 → 一次性脈衝，觀望。',
          title: '量能啟動',
          tone: 'bull',
          priority: 8,
          detail: `區間低位（${Math.round(c.pos * 100)}% 位置）出現異常放量（量Z ${c.volZ.toFixed(1)}）且 1h +${c.change1h.toFixed(1)}%，具早期啟動特徵。`,
        }
      : null,
  // climax at highs after an extended run
  (c) =>
    c.volZ >= 2.5 && c.pos > 0.85 && c.ret4h > 0.03 && c.rangeLast >= 1.5 * c.avgRange24h
      ? {
          id: 'volume-climax',
          next: '若隨後出現長上影或滯漲 → 行情尾段，分批止盈；若有量續強 → 可續持但停損要跟上。',
          title: '量能高潮',
          tone: 'warn',
          priority: 9,
          detail: `高位區爆量長 K（量Z ${c.volZ.toFixed(1)}，4h ${r1(c.ret4h)}），常見於行情末段，留意獲利了結賣壓。`,
        }
      : null,
  // heavy volume, no progress at highs — supply absorbing demand
  (c) =>
    c.pos > 0.75 && c.volZ >= 1.5 && Math.abs(c.change1h) < 0.5 && c.ret4h < 0.01 && c.upperWick4 > 0.3 &&
    !(c.volZ >= 2.5 && c.ret4h > 0.03)
      ? {
          id: 'absorption-stall',
          next: '若放量仍推唔郁 → 賣壓佔優，宜減倉；若吸收完成後放量上破 → 轉為突破訊號，再評估。',
          title: '高位滯漲',
          tone: 'warn',
          priority: 7,
          detail: `價格處高位（${Math.round(c.pos * 100)}% 位置）且放量（量Z ${c.volZ.toFixed(1)}）卻無漲幅，上方賣壓正吸收買盤，突破力道存疑。`,
        }
      : null,
  // S6 壓縮突破 — TTM squeeze (BB inside Keltner) resolved upward on volume.
  // Backtest-gated: ×1.42 lift, robust ±25% (see SQUEEZE_BREAKOUT_SHIPPED note).
  (c) =>
    SQUEEZE_BREAKOUT_SHIPPED && c.sqzBreakout
      ? {
          id: 'squeeze-breakout',
          next: '若回踩盤整高點不破 → 順勢佈局位；若收返入盤整區內 → 假突破，訊號失效。',
          title: '壓縮突破',
          tone: 'bull',
          priority: 7,
          detail: `布林帶收入 Keltner 通道（TTM 壓縮）${c.sqzBreakout.sinceH} 小時後，放量升穿盤整高點（1H 量Z ${c.sqzBreakout.volZ1h.toFixed(1)}）。回測 lift ×1.42（±25% 穩健 ×1.29-1.39），排序參考，非進場訊號。`,
        }
      : null,
  // S9 增倉突破 — flush→rebuild→breakout, the CAP-shaped complement of ⚡.
  // Backtest-gated: ×2.60, all robustness ≥×1.83 (see REBUILD_R1_SHIPPED note).
  (c) =>
    REBUILD_R1_SHIPPED && c.rebuildR1
      ? {
          id: 'rebuild-breakout',
          next: '若回踩突破位(24h 高)不破 → 順勢位;若收返 24h 高之下 → 假突破,訊號失效。期望值薄 — 出場紀律比入場更重要。',
          title: '增倉突破',
          tone: 'bull',
          priority: 8,
          detail:
            `48h 內 OI 曾縮倉 ≥8% 之後重建(oi4h ${p1(c.rebuildR1.oi4h)}),帶量突破 24h 高(1H 量Z ${c.rebuildR1.volZ1h.toFixed(1)})— ⚡ 嘅互補形態(CAP 型:縮完倉、重建晒先突破)。` +
            `回測(150 幣、37 日):+10%/24h 命中 26.7% vs 基準 10.3%(lift ×2.60,全穩健 ≥×1.83,中位 8h 掂 +10%);惟 24h 平均回報僅 +0.3%,排序參考,非進場訊號。`,
        }
      : null,
  // S13 處女增倉 — virgin OI expansion (no flush anywhere in the window) breaks
  // the 24h high on volume. Backtest-gated: ×2.76, all robustness ≥×1.85 (see
  // VIRGIN_V2_SHIPPED note). EVAA-shaped: the no-flush complement of 增倉突破.
  (c) =>
    VIRGIN_V2_SHIPPED && c.virginV2
      ? {
          id: 'virgin-breakout',
          next: '若回踩突破位(24h 高)不破 → 順勢位;若收返 24h 高之下 → 假突破,訊號失效。期望值薄 — 出場紀律比入場更重要。',
          title: '處女增倉',
          tone: 'bull',
          priority: 8,
          detail:
            `48h 內 OI 從未冚倉(零 flush)、純增倉擴張(oi24h ${p1(c.virginV2.oi24h)}、oi4h ${p1(c.virginV2.oi4h)}),帶量突破 24h 高(1H 量Z ${c.virginV2.volZ1h.toFixed(1)})— 增倉突破嘅互補形態(EVAA 型:由頭到尾冇人冚倉)。` +
            `回測(296 幣、37 日 Binance):+10%/24h 命中 39.9% vs 基準 14.5%(lift ×2.76,全穩健 ≥×1.85);惟 24h 平均回報極薄,排序參考,非進場訊號。`,
        }
      : null,
  // S7 上車位 — long-suppressed coin fresh-crosses EMA20 on volume, pre-pump
  // (anti-chase gated). The one boarding def that survived the full gate.
  (c) =>
    BOARDING_B2_SHIPPED && c.boardingB2
      ? {
          id: 'boarding-reclaim',
          next: '若回踩 EMA20 唔破 → 上車位成立；若收返落 EMA20 之下 → 假收復，訊號失效。',
          title: '上車位',
          tone: 'bull',
          priority: 7,
          detail: `連續 ${c.boardingB2.hoursBelow}h 收喺 EMA50 之下後，放量收復 EMA20（1H 量Z ${c.boardingB2.volZ1h.toFixed(1)}），且未追價（4h 未拉、唔喺區間頂）。回測 lift ×2.04（全 robustness ≥×1.40，中位提前 11h 掂 +10%），排序參考，非進場訊號。`,
        }
      : null,
  // squeeze-setup — recording-only (×0.85-0.97, below baseline); gate off.
  (c) =>
    SQUEEZE_SETUP_SHIPPED && c.sqzSetup
      ? {
          id: 'squeeze-setup',
          next: '等突破方向確認。',
          title: '壓縮蓄勢',
          tone: 'info',
          priority: 6,
          detail: '布林帶收入 Keltner 通道，波動壓縮中。',
        }
      : null,
  // compression before expansion — RETIRED 2026-07-06: its metric (D1 48h-pctile
  // ≤0.1) backtested ×0.85 standalone (below baseline) and never lit on the ARX
  // motivating case; superseded by the gated squeeze-breakout above.
  (c) =>
    !VOL_SQUEEZE_RETIRED && c.bbPctile <= 0.1 && c.volZ <= -0.3 && Math.abs(c.change1h) < 0.8
      ? {
          id: 'volatility-squeeze',
          next: '若放量向上突破 → 跟進突破方向（留意 ⚡）；若向下破位 → LONG ONLY 迴避，等回穩。',
          title: '波動壓縮',
          tone: 'info',
          priority: 6,
          detail: `布林帶寬處於 48h 最低 ${Math.round(c.bbPctile * 100)}% 分位且量能萎縮，市場正醞釀方向性突破，宜雙向設防。`,
        }
      : null,
  // EMA regime change
  (c) =>
    c.crossRecent === 1
      ? {
          id: 'ema-golden-cross',
          next: '若回踩 EMA20 不破 → 順勢佈局位；若跌回 EMA50 之下 → 假交叉，訊號失效。',
          title: '均線多排',
          tone: 'bull',
          priority: 7,
          detail: `15m EMA20 上穿 EMA50${c.emaAbove20 ? '，價格站穩 EMA20 之上' : ''}，短線趨勢結構轉多。`,
        }
      : null,
  (c) =>
    c.crossRecent === -1
      ? {
          id: 'ema-death-cross',
          next: 'LONG ONLY 宜觀望；若重新站回 EMA20/EMA50 之上 → 空排解除，再重新評估。',
          title: '均線空排',
          tone: 'bear',
          priority: 7,
          detail: `15m EMA20 下穿 EMA50${!c.emaAbove20 ? '，價格失守 EMA20' : ''}，短線趨勢結構轉空。`,
        }
      : null,
  // breakout quality — with vs without volume
  (c) =>
    c.brokeHigh24h && c.volZ >= 1.8 && c.buyShare4h > 0.55
      ? {
          id: 'breakout-confirmed',
          next: '若回測前高不破 → 屬加碼位；若跌回盤整區內 → 假突破，依停損紀律離場。',
          title: '放量突破',
          tone: 'bull',
          priority: 9,
          detail: `突破 24h 高點且量能同步放大（量Z ${c.volZ.toFixed(1)}、主動買盤 ${Math.round(c.buyShare4h * 100)}%），站穩機率較高。`,
        }
      : null,
  (c) =>
    c.brokeHigh24h && c.volZ < 0.8
      ? {
          id: 'breakout-thin',
          next: '若補量續漲 → 升級為有效突破；若無量滯漲 → 等回測確認先好講，勿追。',
          title: '縮量突破',
          tone: 'warn',
          priority: 6,
          detail: `價格突破 24h 高點但量能未跟上（量Z ${c.volZ.toFixed(1)}），假突破風險偏高，等回測確認再進場較穩。`,
        }
      : null,
  // rejection at highs
  (c) =>
    c.pos > 0.85 && c.upperWick4 >= 0.55 && c.volZ >= 1.5 && c.ret4h < 0.015 && c.upthrustBarRed
      ? {
          id: 'upthrust-rejection',
          next: '若再測高點無力（更低高點）→ 短線見頂訊號，宜先止盈；若放量收復影線高點 → 拒絕失效。',
          title: '上影拒絕',
          tone: 'bear',
          priority: 8,
          detail: `高位區出現放量長上影（影線占比 ${Math.round(c.upperWick4 * 100)}%），買盤遭強力賣壓打回，短線反轉風險升高。`,
        }
      : null,
  // seller exhaustion at lows
  (c) =>
    c.pos < 0.15 && c.lowerWick4 >= 0.55 && c.volZ >= 2 && c.capBarStrongClose
      ? {
          id: 'capitulation-wick',
          next: '若守住下影低點且賣壓量縮 → 築底訊號，可留意反轉進場位；若再破低 → 洗盤變趨勢，離場。',
          title: '恐慌洗盤',
          tone: 'bull',
          priority: 8,
          detail: `低位區爆量長下影（影線占比 ${Math.round(c.lowerWick4 * 100)}%），恐慌拋售遭承接，賣壓可能已近尾聲。`,
        }
      : null,
  // aggressive buying not moving price — stealth accumulation or hidden supply
  (c) =>
    c.buyShare4h > 0.6 && c.ret4h <= 0.005 && c.ret4h >= -0.01 && c.pos < 0.85
      ? {
          id: 'buy-pressure-divergence',
          next: '若價格向上脫離平台 → 吸籌確認，訊號轉強；若買壓退卻且價跌 → 隱性賣壓佔優，觀望。',
          title: '買壓背離',
          tone: 'info',
          priority: 6,
          detail: `近 4h 主動買盤占比 ${Math.round(c.buyShare4h * 100)}% 但價格持平，可能是吸籌蓄勢，也可能有隱性賣壓，觀察量價後續變化。`,
        }
      : null,
  // sustainable grind vs parabola
  (c) =>
    c.ret24h > 0.03 && c.greenShare24h >= 0.55 && c.maxPullback24h > -0.08 && c.emaAbove20 && c.emaAbove50
      ? {
          id: 'trend-health',
          next: '若回檔至 EMA20 附近且量縮 → 逢回布局位；若跌破 EMA50 → 趨勢轉弱，退出觀望。',
          title: '健康趨勢',
          tone: 'bull',
          priority: 7,
          detail: `24h ${r1(c.ret24h)}、綠量占比 ${Math.round(c.greenShare24h * 100)}%、最大回檔僅 ${r1(c.maxPullback24h)}，趨勢穩健，宜逢回布局而非追高。`,
        }
      : null,
  // failed breakdown reclaimed — bear trap
  (c) =>
    c.pos < 0.3 && c.recentBelowEma20 && c.emaAbove20 && c.change1h > 1 && c.volZ >= 1.2
      ? {
          id: 'failed-breakdown-reclaim',
          next: '若企穩於收復位之上 → 軋空延伸可期；若再度失守 EMA20 → 回收失敗，離場。',
          title: '假跌破回收',
          tone: 'bull',
          priority: 7,
          detail: `價格一度跌破支撐後迅速收復 EMA20（1h +${c.change1h.toFixed(1)}%），空頭陷阱特徵，留意軋空延伸。`,
        }
      : null,
  // parabolic extension losing fuel
  (c) =>
    c.ret4h > 0.08 && c.pos > 0.9 && c.bbPctile > 0.9 && c.devEma20 > 0.05 && c.volZ < 1
      ? {
          id: 'parabolic-overextension',
          next: '若出現首根放量陰 K → 動能透支確認，止盈離場；若橫盤消化乖離 → 可續觀察，唔追價。',
          title: '過熱乖離',
          tone: 'warn',
          priority: 8,
          detail: `4h 暴漲 ${r1(c.ret4h)}、乖離 EMA20 達 ${r1(c.devEma20)}，但量能未同步放大（量Z ${c.volZ.toFixed(1)}），追價動能可能已透支。`,
        }
      : null,
];

const MAX_INSIGHTS = 6;

export function interpret(coin: Coin): Insight[] {
  const ctx = buildCtx(coin);
  if (!ctx) return [];
  const out: Insight[] = [];

  // 縮倉突破 — the one detector validated by backtest (scripts/backtest.ts):
  // flush-context breakout hit +15%/24h at 9.1% vs 4.5% base rate (lift ×2.04)
  // over 154 Binance-listed small caps, 37d @1H. The quiet setup alone tested
  // BELOW base rate, so this fires only on the confirmed trigger.
  const fb = detectFlushBreakout(coin.candles, coin.volume, coin.oi, coin.fundingHist);
  if (fb) {
    out.push({
      id: 'flush-breakout',
      title: '縮倉突破',
      tone: 'bull',
      priority: 10,
      detail:
        `未平倉量自 48h 高位縮 ${fb.oiDropPct.toFixed(1)}% 後，帶量突破 24h 盤整區（1H 量Z ${fb.volZ1h.toFixed(1)}）。` +
        `回測（154 幣、37 日）：+15%/24h 命中率 9.1% vs 基準 4.5%（lift ×2.0），僅供排序參考。`,
      next: '若回測突破位不破 → 依出場計畫（TP1/TP2/SL）分批執行；若收回盤整區內 → 假突破，訊號失效。',
    });
  }

  // 早期蓄力 — watchlist tier, backtested weaker than ⚡ and labeled as such:
  // consistently positive forward returns across specs, but lift only
  // ×1.0-1.24 (the flashy ×1.61 didn't survive robustness checks).
  if (coin.earlyAccum) {
    const ea = coin.earlyAccum;
    out.push({
      id: 'early-accum',
      title: '早期蓄力',
      tone: 'info',
      priority: 8,
      detail:
        `縮倉築底中，且散戶多空比 24h 降 ${ea.lsDropPct.toFixed(1)}%、相對 BTC 強 ${fmtPct(ea.rsPct, 1)}。` +
        `回測（154 幣、37 日）：後續 72-96h 平均回報 +1.1~1.3%（基準 -1%）、回撤淺 30%，但命中 lift 僅 ×1.0-1.2 — 觀察名單參考，非進場訊號。`,
      next: '若之後帶量突破盤整高點（升級為 ⚡）→ 先等訊號再談進場；若 OI 回升但價轉弱 → 移出觀察名單。',
    });
  }

  for (const d of DETECTORS) {
    const ins = d(ctx);
    if (ins) out.push(ins);
  }
  // stamp each read with the candle it marks (for the chart + the hh:mm label)
  for (const ins of out) ins.atTime = anchorTime(ins.id, ctx);
  // the backtested trigger supersedes the generic volume-confirmed breakout
  const deduped = fb ? out.filter((i) => i.id !== 'breakout-confirmed') : out;
  deduped.sort((a, b) => b.priority - a.priority);
  return deduped.slice(0, MAX_INSIGHTS);
}
