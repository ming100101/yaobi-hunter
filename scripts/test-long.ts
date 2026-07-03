// Verify the 1H long-history series: bar counts per timeframe, cross-series
// alignment (ChartSync needs equal lengths), OHLC validity, strength finite.
import { fetchLiveCoin } from '../src/data/okx';
import { aggregateForTf } from '../src/lib/aggregate';

const OKX = 'https://www.okx.com';
const hit = (b: string) => ({ instId: `${b}-USDT-SWAP`, base: b, last: 0, change24h: 0, vol24hUsd: 0 });

for (const sym of ['DOGE', 'SOL']) {
  const coin = await fetchLiveCoin(OKX, hit(sym), Date.now());
  const days = (arr: { time: number }[]) =>
    ((arr[arr.length - 1].time - arr[0].time) / 86400).toFixed(1);
  console.log(
    `\n${sym}: 5m base ${coin.candles.length} bars (${days(coin.candles)}d), ` +
      `long ${coin.long ? coin.long.candles.length + ' bars (' + days(coin.long.candles) + 'd)' : 'MISSING'}`,
  );
  for (const tf of ['5m', '15m', '1h', '4h'] as const) {
    const v = aggregateForTf(coin, tf);
    const aligned =
      new Set([
        v.candles.length,
        v.volume.length,
        v.oi.length,
        v.fundingHist.length,
        v.strengthHist.length,
      ]).size === 1;
    let badOhlc = 0;
    for (const c of v.candles)
      if (c.high < Math.max(c.open, c.close) - 1e-12 || c.low > Math.min(c.open, c.close) + 1e-12) badOhlc++;
    const lastStr = v.strengthHist[v.strengthHist.length - 1].value;
    console.log(
      `  ${tf.padEnd(3)}: ${String(v.candles.length).padStart(4)} bars | aligned=${aligned} | badOHLC=${badOhlc} | lastStrength=${lastStr.toFixed(1)}`,
    );
  }
}
