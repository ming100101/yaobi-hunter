import type { Candle, VolumeBar } from '../types';

export const BOARDING_B2_RULESET_ID = 'boarding-b2-v1@2026-07-15';
export const BOARDING_B2_MIN_BARS = 100;

export interface BoardingB2Signal {
  rulesetId: typeof BOARDING_B2_RULESET_ID;
  decisionTs: number;
  signalPx: number;
  ema20: number;
  ema50: number;
  atr14: number;
  volZ1h: number;
  hoursBelow: 48;
  ret4hPct: number;
  pos24: number;
}

function ema(xs: number[], period: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  if (xs.length < period) return out;
  const k = 2 / (period + 1);
  let e = xs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < xs.length; i++) {
    e = xs[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function atr14(bars: Candle[], i: number): number {
  if (i < 14) return NaN;
  let total = 0;
  for (let j = i - 13; j <= i; j++) {
    const prev = bars[j - 1]?.close ?? bars[j].open;
    total += Math.max(bars[j].high - bars[j].low, Math.abs(bars[j].high - prev), Math.abs(bars[j].low - prev));
  }
  return total / 14;
}

function alignedTail(candles: Candle[], volume: VolumeBar[]): { candles: Candle[]; volume: VolumeBar[] } | null {
  const n = Math.min(candles.length, volume.length);
  if (n < BOARDING_B2_MIN_BARS) return null;
  const c = candles.slice(candles.length - n);
  const v = volume.slice(volume.length - n);
  for (let i = Math.max(1, n - BOARDING_B2_MIN_BARS); i < n; i++) {
    if (c[i].time - c[i - 1].time !== 3600 || v[i].time !== c[i].time) return null;
  }
  return { candles: c, volume: v };
}

export function evaluateEma20ReclaimControl(candles: Candle[], volume: VolumeBar[]): BoardingB2Signal | null {
  const aligned = alignedTail(candles, volume);
  if (!aligned) return null;
  const c = aligned.candles;
  const v = aligned.volume;
  const i = c.length - 1;
  const closes = c.map((x) => x.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const px = closes[i];
  const ret4hPct = (px / closes[i - 4] - 1) * 100;
  if (!(ret4hPct <= 6)) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, c[j].low);
    hi = Math.max(hi, c[j].high);
  }
  const pos24 = hi > lo ? (px - lo) / (hi - lo) : 0.5;
  if (!(pos24 <= 0.7)) return null;
  if (!(px > e20[i] && closes[i - 1] <= e20[i - 1])) return null;
  const win = v.slice(i - 24, i).map((x) => x.value);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
  const volZ1h = sd > 0 ? (v[i].value - mean) / sd : 0;
  if (volZ1h < 1.5) return null;
  const atr = atr14(c, i);
  if (!(atr > 0)) return null;
  return {
    rulesetId: BOARDING_B2_RULESET_ID,
    decisionTs: (c[i].time + 3600) * 1000,
    signalPx: px,
    ema20: e20[i],
    ema50: e50[i],
    atr14: atr,
    volZ1h,
    hoursBelow: 48,
    ret4hPct,
    pos24,
  };
}

export function evaluateBoardingB2(candles: Candle[], volume: VolumeBar[]): BoardingB2Signal | null {
  const base = evaluateEma20ReclaimControl(candles, volume);
  if (!base) return null;
  const closes = candles.map((x) => x.close);
  const e50 = ema(closes, 50);
  const i = candles.length - 1;
  for (let j = i - 48; j < i; j++) if (!(closes[j] < e50[j])) return null;
  return base;
}

export function boardingB2QuantityOiQualified(oiQty1h: number | null | undefined, oiQty4h: number | null | undefined): boolean {
  return oiQty1h != null && oiQty4h != null && oiQty1h > 0 && oiQty4h >= 3;
}
