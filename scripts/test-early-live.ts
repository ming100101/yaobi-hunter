// S14 end-to-end live check: one real sweep (Binance live), no notify/paper/liq
// side effects — just verifies earlyPump computes live, the record is v4, and
// idx24 carries the flag. Prints the live firing rate (sanity: should be a
// handful, not a big fraction). Run: npm run test-early-live
import { BN_LIVE, runRollingScan, toLite } from '../src/data/binance';
import { buildScanRecord } from '../src/lib/recording';
import type { CoinLite } from '../src/types';

const now = Date.now();
const coins: CoinLite[] = [];
await runRollingScan(BN_LIVE, now, [], (batch) => {
  for (const c of batch) coins.push(toLite(c));
  return true;
});
const early = coins.filter((c) => c.earlyPump);
const rec = buildScanRecord(coins, now, 'binance');
const sampleRow = rec.coins[0];
const earlyRow = early.length ? rec.coins.find((r) => r[0] === early[0].symbol) : null;
console.log(`swept ${coins.length} coins · earlyPump fired on ${early.length} (${((early.length / coins.length) * 100).toFixed(1)}%)`);
console.log(`fired: ${early.slice(0, 20).map((c) => c.symbol).join(', ')}${early.length > 20 ? ' …' : ''}`);
console.log(`record v=${rec.v} · row length ${sampleRow.length} (expect 25 for v4) · idx24 of a fired coin = ${earlyRow ? earlyRow[24] : 'n/a'}`);
