import type { Candle, SeriesPoint, VolumeBar } from '../types';

export function ema(candles: Candle[], period: number): SeriesPoint[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  const out: SeriesPoint[] = [{ time: candles[period - 1].time, value: prev }];
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

export function bollinger(
  candles: Candle[],
  period = 20,
  mult = 2,
): { upper: SeriesPoint[]; lower: SeriesPoint[] } {
  const upper: SeriesPoint[] = [];
  const lower: SeriesPoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += candles[j].close;
    mean /= period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (candles[j].close - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    upper.push({ time: candles[i].time, value: mean + mult * sd });
    lower.push({ time: candles[i].time, value: mean - mult * sd });
  }
  return { upper, lower };
}

// S8 — anchored VWAP: running Σ(quote USD)/Σ(base coin) from anchorIdx onward.
// This is the TRUE volume-weighted average price paid since the anchor bar — the
// dimension a plain EMA can't express (volume weighting). quote = VolumeBar.value
// (USD notional); base = per-coin base volume (the kline idx5 leg, ÷/×mult-
// normalised to the same per-coin space as the candle closes). Exact by
// construction — never approximate with quote×typical-price (double-counts price;
// see the S8 spec 陷阱). Points before anchorIdx are omitted (VWAP is undefined
// pre-anchor); a bar with zero base volume is skipped. Same SeriesPoint shape as
// ema/bollinger. NOTE: the spec sketched `anchoredVwap(candles, baseVol, …)`, but
// the exact Σquote/Σbase needs quote volume too, which lives on VolumeBar — so we
// take VolumeBar[] (time + quote) plus the parallel baseVol[] array.
export function anchoredVwap(volume: VolumeBar[], baseVol: number[], anchorIdx: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let q = 0;
  let b = 0;
  for (let i = Math.max(0, anchorIdx); i < volume.length; i++) {
    q += volume[i].value;
    b += baseVol[i] ?? 0;
    if (b > 0) out.push({ time: volume[i].time, value: q / b });
  }
  return out;
}

// S8 — rolling VWAP over the trailing `win` bars (A3 control; expected to be
// ~collinear with EMA — that's the point of the ablation). Same Σquote/Σbase math.
export function rollingVwap(volume: VolumeBar[], baseVol: number[], win: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < volume.length; i++) {
    let q = 0;
    let b = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++) {
      q += volume[j].value;
      b += baseVol[j] ?? 0;
    }
    if (b > 0) out.push({ time: volume[i].time, value: q / b });
  }
  return out;
}
