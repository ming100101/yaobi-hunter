import assert from 'node:assert/strict';
import type { CoinLite } from '../src/types';
import { buildScanRecord, recCoinField } from '../src/lib/recording';
import {
  appendSnapshot,
  backfillFromRecords,
  getRecentSeries,
  oiQtyChangeFromStore,
  seedFromHist,
} from '../src/data/oiStore';

const MIN5 = 5 * 60_000;
const MIN15 = 15 * 60_000;
const now = Math.floor(Date.now() / MIN15) * MIN15;

// Legacy USD-only history remains readable but can never satisfy a quantity read.
for (let k = 20; k >= 0; k--) {
  appendSnapshot([{ instId: '__Q_LEGACY', oiUsd: 1_000_000 + k }], now - k * MIN15);
}
assert.ok(getRecentSeries('__Q_LEGACY', now));
assert.equal(oiQtyChangeFromStore('__Q_LEGACY', now), null);

// A quantity series uses no USD fallback, excludes future points, and measures
// its references relative to the latest causal observation.
for (let k = 20; k >= 0; k--) {
  appendSnapshot(
    [{ instId: '__Q_ASOF', oiUsd: 2_000_000 + (20 - k), oiQty: 100 + (20 - k) }],
    now - k * MIN15,
  );
}
appendSnapshot([{ instId: '__Q_ASOF', oiUsd: 9_999_999, oiQty: 999 }], now + MIN5);
const asOf = oiQtyChangeFromStore('__Q_ASOF', now);
assert.ok(asOf);
assert.equal(asOf.observedAt, now);
assert.equal(asOf.current, 120);
assert.ok(Math.abs(asOf.change1h - (120 / 116 - 1) * 100) < 1e-10);
assert.ok(Math.abs(asOf.change4h - (120 / 104 - 1) * 100) < 1e-10);

for (let k = 20; k >= 0; k--) {
  appendSnapshot([{ instId: '__Q_STALE', oiUsd: 1_000, oiQty: 50 + (20 - k) }], now - k * MIN15);
}
assert.equal(oiQtyChangeFromStore('__Q_STALE', now + 11 * 60_000), null);

// Upgrade seam: an already-warm USD store can seed missing quantity from the
// same cold history without rewriting or scaling USD.
for (let k = 20; k >= 0; k--) {
  appendSnapshot([{ instId: '__Q_UPGRADE', oiUsd: 10_000 + (20 - k) }], now - k * MIN15);
}
appendSnapshot([{ instId: '__Q_UPGRADE', oiUsd: 10_020, oiQty: 220 }], now);
const hist: Array<{ t: number; v: number; q: number }> = [];
for (let k = 60; k >= 0; k--) {
  hist.push({ t: Math.floor((now - k * MIN5) / 1000), v: 10_000 + (60 - k) / 3, q: 200 + (60 - k) / 3 });
}
assert.equal(seedFromHist('__Q_UPGRADE', hist, now), true);
const upgraded = oiQtyChangeFromStore('__Q_UPGRADE', now);
assert.ok(upgraded);
assert.equal(upgraded.current, 220);

// Recording backfill reads the appended v5 quantity index independently of USD.
const lines: string[] = [];
for (let k = 16; k >= 0; k--) {
  const row = new Array<unknown>(28).fill(null);
  row[0] = '__Q_RECORD';
  row[2] = 5_000_000 + (16 - k);
  row[25] = 500 + (16 - k);
  lines.push(JSON.stringify({ v: 5, ts: now - k * MIN15, slot: 1, source: 'binance', coins: [row] }));
}
assert.equal(backfillFromRecords(lines.join('\n')), 17);
const recorded = oiQtyChangeFromStore('__Q_RECORD', now);
assert.ok(recorded);
assert.equal(recorded.current, 516);

const lite: CoinLite = {
  symbol: 'TEST',
  regime: 'accumulate',
  strength: 75,
  change1h: 1,
  change24h: 2,
  oi4h: 3,
  oiTrusted: true,
  oiQty: 1234.56789,
  oiQty1h: 0.625,
  oiQty4h: 2.75,
  funding: 0.01,
  volZ: 1.2,
  vol24h: 10_000_000,
  lastPrice: 1.5,
  oiUsd: 20_000_000,
  flushBreakout: false,
  earlyAccum: false,
  earlyPump: true,
  riskFlags: [],
  signals: { fundsFirst: false, mildRise: true, oiHealthy: true, buyHealthy: true },
};
const rec = buildScanRecord([lite], now, 'binance');
assert.equal(rec.v, 7);
assert.equal(rec.coins[0].length, 30);
assert.equal(recCoinField(rec.coins[0], 24), 1);
assert.equal(recCoinField(rec.coins[0], 25), 1234.56789);
assert.equal(recCoinField(rec.coins[0], 26), 0.625);
assert.equal(recCoinField(rec.coins[0], 27), 2.75);

console.log('OI quantity store/as-of/recording tests PASS');
