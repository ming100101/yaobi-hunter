import { TIMEFRAMES, type Candle, type Coin, type SeriesPoint, type Timeframe, type VolumeBar } from '../types';

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
    let takerBuy = 0;
    let hasTakerBuy = true;
    for (let j = i; j < end; j++) {
      sum += base[j].value;
      if (base[j].takerBuy == null) hasTakerBuy = false;
      else takerBuy += base[j].takerBuy!;
    }
    const c = candles[b];
    out.push({
      time: base[i].time,
      value: sum,
      up: c ? c.close >= c.open : base[end - 1].up,
      ...(hasTakerBuy ? { takerBuy } : {}),
    });
  }
  return out;
}

// Aggregate the four series + strength by `mult` buckets of the given base.
function aggregateFrom(
  coin: Coin,
  src: { candles: Candle[]; volume: VolumeBar[]; oi: SeriesPoint[]; fundingHist: SeriesPoint[]; strengthHist: SeriesPoint[] },
  mult: number,
): Coin {
  if (mult <= 1) {
    return { ...coin, ...src, long: undefined, deep: undefined };
  }
  const candles = aggregateCandles(src.candles, mult);
  return {
    ...coin,
    candles,
    volume: aggregateVolume(src.volume, candles, mult),
    oi: aggregateLast(src.oi, mult),
    fundingHist: aggregateLast(src.fundingHist, mult),
    strengthHist: aggregateLast(src.strengthHist, mult),
    long: undefined, // the aggregated view is self-contained; don't carry the raw series
    deep: undefined,
  };
}

// Produce the display Coin for a timeframe: 5m/15m from the 14d deep series
// when present (detail fetch), else the 48h 5m base; 1h/4h from the 1H long
// series when present (weeks of history), else a graceful fallback to
// aggregating the base. Detectors/interpret never read these display series.
export function aggregateForTf(coin: Coin, tf: Timeframe): Coin {
  const spec = TIMEFRAMES.find((t) => t.key === tf) ?? TIMEFRAMES[0];
  if (spec.base === '1h' && coin.long) return aggregateFrom(coin, coin.long, spec.mult);
  if (spec.base === '5m' && coin.deep) return aggregateFrom(coin, coin.deep, spec.mult);
  return aggregateFrom(coin, coin, spec.mult5);
}

// retained for backwards compatibility / tests
export function aggregateCoin(coin: Coin, mult: number): Coin {
  return aggregateFrom(coin, coin, mult);
}
