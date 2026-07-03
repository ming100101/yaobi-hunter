import type { Candle, Coin, SeriesPoint, VolumeBar } from '../types';

// Bar times are labeled by bucket-open time (OHLC convention). The base series
// length divides evenly by every timeframe multiplier, so bucket boundaries
// align and the final bucket always ends on the last base bar — which keeps the
// latest close/OI/funding/strength identical across timeframes.

export function aggregateCandles(base: Candle[], mult: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < base.length; i += mult) {
    const end = Math.min(i + mult, base.length);
    let high = base[i].high;
    let low = base[i].low;
    for (let j = i + 1; j < end; j++) {
      if (base[j].high > high) high = base[j].high;
      if (base[j].low < low) low = base[j].low;
    }
    out.push({ time: base[i].time, open: base[i].open, high, low, close: base[end - 1].close });
  }
  return out;
}

export function aggregateLast(base: SeriesPoint[], mult: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < base.length; i += mult) {
    const end = Math.min(i + mult, base.length);
    out.push({ time: base[i].time, value: base[end - 1].value });
  }
  return out;
}

// Volume sums within the bucket; direction follows the bucket's aggregated
// candle so the bar color matches the candle it sits under.
export function aggregateVolume(base: VolumeBar[], candles: Candle[], mult: number): VolumeBar[] {
  const out: VolumeBar[] = [];
  let b = 0;
  for (let i = 0; i < base.length; i += mult, b++) {
    const end = Math.min(i + mult, base.length);
    let sum = 0;
    for (let j = i; j < end; j++) sum += base[j].value;
    const c = candles[b];
    out.push({ time: base[i].time, value: sum, up: c ? c.close >= c.open : base[end - 1].up });
  }
  return out;
}

export function aggregateCoin(coin: Coin, mult: number): Coin {
  if (mult <= 1) return coin;
  const candles = aggregateCandles(coin.candles, mult);
  return {
    ...coin,
    candles,
    volume: aggregateVolume(coin.volume, candles, mult),
    oi: aggregateLast(coin.oi, mult),
    fundingHist: aggregateLast(coin.fundingHist, mult),
    strengthHist: aggregateLast(coin.strengthHist, mult),
  };
}
