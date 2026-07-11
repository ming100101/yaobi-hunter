// Gate for the OI warm store: (1) unit-safety / warmth guards with no
// network, (2) real per-symbol OI snapshot fan-out, (3) a fully-warm full
// sweep to prove the speed target. Bundle with esbuild, run node.
// Store keys are BASE coins since the 2026-07-07 Binance migration.
import { BN_LIVE, fetchBulkOi, getUniverse, runRollingScan, toLite } from '../src/data/binance';
import { appendSnapshot, getRecentSeries, getSeries, seedFromHist } from '../src/data/oiStore';

const MIN15 = 15 * 60 * 1000;
const now = Date.now();

// ---- (1) unit safety (no network) ----------------------------------------
const warmSym = '__WARM';
for (let k = 199; k >= 0; k--) appendSnapshot([{ instId: warmSym, oiUsd: 100 + (199 - k) * 0.1 }], now - k * MIN15);
console.log('warm 200pts/~50h   ->', getSeries(warmSym, now) ? 'WARM ✓' : 'NULL ✗bug');

const shortSym = '__SHORT';
for (let k = 99; k >= 0; k--) appendSnapshot([{ instId: shortSym, oiUsd: 100 }], now - k * MIN15);
console.log('short 100pts/~25h  ->', getSeries(shortSym, now) === null ? 'NULL ✓' : 'WARM ✗bug');

const staleSym = '__STALE';
for (let k = 200; k >= 4; k--) appendSnapshot([{ instId: staleSym, oiUsd: 100 }], now - k * MIN15); // ends ~1h ago
console.log('stale (last 1h old)->', getSeries(staleSym, now) === null ? 'NULL ✓' : 'WARM ✗bug');

// warm-path oi4h sanity: ramp so 4h-ago is lower — expect small positive, no cliff
const rampSym = '__RAMP';
for (let k = 199; k >= 0; k--) appendSnapshot([{ instId: rampSym, oiUsd: 100 * (1 + (199 - k) * 0.0005) }], now - k * MIN15);
const s = getSeries(rampSym, now)!;
const oi4hRatio = s[s.length - 1].v / s[s.length - 17].v - 1; // 16 pts = 4h at 15min
console.log(`warm oi4h ratio    -> ${(oi4hRatio * 100).toFixed(2)}% (finite, no cliff: ${Number.isFinite(oi4hRatio) && Math.abs(oi4hRatio) < 0.5 ? '✓' : '✗'})`);

// ---- (1b) cold-start seed guards (no network) ------------------------------
// synthetic 41h of 5m hist in a DIFFERENT unit (×0.99 of snapshot level, like
// the probed snapshot-vs-hist derivation gap), ramping +0.01%/5m
const nowS = Math.floor(now / 1000);
const hist = (mult: number) => {
  const out: Array<{ t: number; v: number }> = [];
  for (let k = 492; k >= 1; k--) out.push({ t: nowS - k * 300, v: 100 * mult * (1 + (492 - k) * 0.0001) });
  return out;
};
const seedSym = '__SEED';
appendSnapshot([{ instId: seedSym, oiUsd: 101 }], now); // one live snapshot, cold store
const seeded = seedFromHist(seedSym, hist(0.99), now);
const rec = getRecentSeries(seedSym, now);
console.log('\nseed cold coin      ->', seeded && rec ? `SEEDED ✓ (${rec.length} pts)` : 'FAIL ✗');
const seam = rec ? Math.abs(rec[rec.length - 1].v / rec[rec.length - 2].v - 1) : 1;
console.log(`seed seam vs snap   -> ${(seam * 100).toFixed(2)}% (scaled: expect ≪1%: ${seam < 0.005 ? '✓' : '✗'})`);

const warmAlready = '__SEEDWARM'; // already partial-warm → seed must no-op
for (let k = 30; k >= 0; k--) appendSnapshot([{ instId: warmAlready, oiUsd: 100 }], now - k * MIN15);
console.log('seed already-warm   ->', seedFromHist(warmAlready, hist(0.99), now) === false ? 'SKIP ✓' : 'SEEDED ✗bug');

const badScale = '__SEEDBAD'; // 2x unit mismatch → scale guard must refuse
appendSnapshot([{ instId: badScale, oiUsd: 200 }], now);
console.log('seed 2x unit gap    ->', seedFromHist(badScale, hist(0.5), now) === false ? 'SKIP ✓' : 'SEEDED ✗bug');

console.log('seed empty store    ->', seedFromHist('__SEEDNONE', hist(1), now) === false ? 'SKIP ✓' : 'SEEDED ✗bug');

// ---- (2) OI snapshot fan-out ----------------------------------------------
const universe = await getUniverse(BN_LIVE);
console.log(`\nuniverse: ${universe.length} binance usdt perps`);
const t1 = Date.now();
const bulk = await fetchBulkOi(BN_LIVE, universe);
console.log(`oi snapshot: ${bulk.length} coins in ${((Date.now() - t1) / 1000).toFixed(1)}s, sample ${JSON.stringify(bulk[0])}`);
const btc = bulk.find((r) => r.instId === 'BTC');
console.log(`BTC oiUsd ${btc ? '$' + (btc.oiUsd / 1e9).toFixed(2) + 'B' : 'MISSING ✗'} (sanity: expect $B-scale)`);

// ---- (3) fully-warm speed sweep -------------------------------------------
// inject 199 historical points for every snapshot coin (the sweep appends #200)
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
await runRollingScan(BN_LIVE, now, [], (batch, prog) => {
  done = prog.done;
  if (!firstLite && batch.length) firstLite = toLite(batch[0]);
  return true;
});
console.warn = ow;
console.log(`\nWARM SWEEP: ${done} coins in ${((Date.now() - t0) / 1000).toFixed(1)}s, 429s=${warn429}`);
console.log(`sample lite: ${firstLite ? JSON.stringify({ sym: firstLite.symbol, oiUsd: firstLite.oiUsd, oi4h: firstLite.oi4h?.toFixed(1) }) : 'none'}`);
