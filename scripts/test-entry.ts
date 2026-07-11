// Verify the structural entry anchor: fetching the same coin twice (seconds
// apart, live prices moving) must yield the SAME entry/kind — the old
// price-anchored behaviour changed on every fetch.
import { BN_LIVE, fetchLiveCoin } from '../src/data/binance';

for (const sym of ['DOGE', 'PEPE', 'SOL']) {
  const a = await fetchLiveCoin(BN_LIVE, sym, Date.now());
  await new Promise((r) => setTimeout(r, 4000));
  const b = await fetchLiveCoin(BN_LIVE, sym, Date.now());
  const lastA = a.candles[a.candles.length - 1].close;
  const lastB = b.candles[b.candles.length - 1].close;
  const stable = a.plan.entry === b.plan.entry && a.plan.kind === b.plan.kind;
  console.log(
    `${sym.padEnd(5)} regime=${a.regime.padEnd(10)} kind=${a.plan.kind.padEnd(8)} ` +
      `entry A=${a.plan.entry.toPrecision(6)} B=${b.plan.entry.toPrecision(6)} ` +
      `(live px moved ${lastA !== lastB ? 'YES' : 'no'}: ${lastA} -> ${lastB}) ` +
      (stable ? 'STABLE ✓' : 'UNSTABLE ✗'),
  );
}
