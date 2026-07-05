// Gate for the bulk-OI warm store: (1) unit-safety / warmth guards with no
// network, (2) real bulk fetch, (3) a fully-warm full sweep to prove the speed
// target (~1min vs the ~4.5min cold baseline). Bundle with esbuild, run node.
import { fetchBulkOi, runRollingScan, toLite } from '../src/data/okx';
import { appendSnapshot, getSeries } from '../src/data/oiStore';
import { getBinancePerpBases } from '../src/data/binanceUniverse';

const OKX = 'https://www.okx.com';
const BNV = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const MIN15 = 15 * 60 * 1000;
const now = Date.now();

// ---- (1) unit safety (no network) ----------------------------------------
const warmInst = '__WARM-USDT-SWAP';
for (let k = 199; k >= 0; k--) appendSnapshot([{ instId: warmInst, oiUsd: 100 + (199 - k) * 0.1 }], now - k * MIN15);
console.log('warm 200pts/~50h   ->', getSeries(warmInst, now) ? 'WARM ✓' : 'NULL ✗bug');

const shortInst = '__SHORT-USDT-SWAP';
for (let k = 99; k >= 0; k--) appendSnapshot([{ instId: shortInst, oiUsd: 100 }], now - k * MIN15);
console.log('short 100pts/~25h  ->', getSeries(shortInst, now) === null ? 'NULL ✓' : 'WARM ✗bug');

const staleInst = '__STALE-USDT-SWAP';
for (let k = 200; k >= 4; k--) appendSnapshot([{ instId: staleInst, oiUsd: 100 }], now - k * MIN15); // ends ~1h ago
console.log('stale (last 1h old)->', getSeries(staleInst, now) === null ? 'NULL ✓' : 'WARM ✗bug');

// warm-path oi4h sanity: ramp so 4h-ago is lower — expect small positive, no cliff
const rampInst = '__RAMP-USDT-SWAP';
for (let k = 199; k >= 0; k--) appendSnapshot([{ instId: rampInst, oiUsd: 100 * (1 + (199 - k) * 0.0005) }], now - k * MIN15);
const s = getSeries(rampInst, now)!;
const oi4hRatio = s[s.length - 1].v / s[s.length - 17].v - 1; // 16 pts = 4h at 15min
console.log(`warm oi4h ratio    -> ${(oi4hRatio * 100).toFixed(2)}% (finite, no cliff: ${Number.isFinite(oi4hRatio) && Math.abs(oi4hRatio) < 0.5 ? '✓' : '✗'})`);

// ---- (2) bulk fetch -------------------------------------------------------
const bulk = await fetchBulkOi(OKX);
console.log(`\nbulk fetch: ${bulk.length} usdt swaps, sample ${JSON.stringify(bulk[0])}`);

// ---- (3) fully-warm speed sweep -------------------------------------------
const bn = await getBinancePerpBases(BNV);
// inject 199 historical points for every bulk instId (the sweep appends #200)
for (let k = 199; k >= 1; k--) {
  const ts = now - k * MIN15;
  appendSnapshot(bulk.map((r) => ({ instId: r.instId, oiUsd: r.oiUsd * (0.92 + 0.0004 * (199 - k)) })), ts);
}
let warn429 = 0;
const ow = console.warn;
console.warn = (...a: unknown[]) => {
  if (String(a[0]).includes('429')) warn429++;
  ow(...a);
};
const t0 = Date.now();
let done = 0;
let firstLite: ReturnType<typeof toLite> | null = null;
await runRollingScan(OKX, now, bn, [], (batch, prog) => {
  done = prog.done;
  if (!firstLite && batch.length) firstLite = toLite(batch[0]);
  return true;
});
console.warn = ow;
console.log(`\nWARM SWEEP: ${done} coins in ${((Date.now() - t0) / 1000).toFixed(1)}s, 429s=${warn429}`);
console.log(`sample lite: ${firstLite ? JSON.stringify({ sym: firstLite.symbol, oiUsd: firstLite.oiUsd, oi4h: firstLite.oi4h?.toFixed(1) }) : 'none'}`);
