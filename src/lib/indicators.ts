import type { Candle, SeriesPoint } from '../types';

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
