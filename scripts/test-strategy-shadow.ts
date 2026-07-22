import assert from 'node:assert/strict';
import type { CoinLite } from '../src/types';
import type { HourlyMarketStore } from './hourlyMarketFile';
import { collectExistingSignalShadowCandidates, collectRemediatedSignalShadowCandidates, collectSpotShadowCandidates } from './strategyShadowFile';

const base: CoinLite = {
  symbol: 'TEST', regime: 'accumulate', strength: 70, change1h: 1, change24h: 3,
  oi4h: 2, funding: 0, volZ: 2, vol24h: 10_000_000, lastPrice: 1,
  oiUsd: 1_000_000, flushBreakout: false, earlyAccum: false, riskFlags: [], signals: {},
  feat: {
    ret4h: 2.5, pos: 0.6, buyShare4h: 0.7, takerBuyShare4h: 0.2, spotTakerBuyShare4h: 0.56,
    f8h: 0, bbPctile: 0.5, spotVol24h: 11_000_000, basisPct: -0.1,
  },
};
const decisionTs = Date.UTC(2026, 6, 15);

let rows = collectSpotShadowCandidates([base], decisionTs);
assert.deepEqual(rows.map((x) => x.strategyId), ['spot-led-v1']);
assert.equal(rows[0].takerBuyShare4h, 0.56);

rows = collectSpotShadowCandidates([{ ...base, spotPump: true }], decisionTs);
assert.deepEqual(rows.map((x) => x.strategyId), ['organic-spot-v0', 'spot-led-v1']);

assert.equal(collectSpotShadowCandidates([{ ...base, feat: { ...base.feat!, spotTakerBuyShare4h: null } }], Date.now()).length, 0);
assert.equal(collectSpotShadowCandidates([{ ...base, feat: { ...base.feat!, basisPct: 0.01 } }], Date.now()).length, 0);
assert.equal(collectSpotShadowCandidates([{ ...base, feat: { ...base.feat!, spotVol24h: 9_000_000 } }], Date.now()).length, 0);

const shipped = collectExistingSignalShadowCandidates([{ ...base, flushBreakout: true, rebuildBreakout: true, virginBreakout: true }], decisionTs);
assert.deepEqual(shipped.map((x) => x.strategyId), ['virgin-v2', 'rebuild-r1', 'flush-breakout']);

const firstHour = Date.UTC(2026, 6, 20, 0) / 1000;
const closes = Array.from({ length: 25 }, (_, i) => i === 24 ? 122 : 100 + i);
const hourly = {
  candles: closes.map((close, i) => ({ time: firstHour + i * 3600, open: i === 24 ? 123 : close - 0.2, high: close + 0.5, low: close - 0.5, close })),
  volume: closes.map((_, i) => ({ time: firstHour + i * 3600, value: 100 + i, takerBuy: 55 + i / 10 })),
};
const store = { get: () => hourly } as unknown as HourlyMarketStore;
const remediationCoin: CoinLite = { ...base, oiQty4h: 2, funding: 0 };
const remediationDecision = (hourly.candles.at(-1)!.time + 3600) * 1000;
const remediated = collectRemediatedSignalShadowCandidates(
  store,
  remediationCoin,
  [1, 0, 0, 0],
  [0, 1, 0],
  1,
  remediationDecision + 5 * 60_000,
);
assert.deepEqual(remediated.map((x) => [x.strategyId, x.side]), [
  ['top-t1-reversal-v2', 'short'],
  ['wbottom-w2-uncrowded-v2', 'long'],
]);
assert.equal(remediated[0].decisionTs, remediationDecision, 'candidate is anchored to the completed UTC hour');
assert.equal(collectRemediatedSignalShadowCandidates(store, remediationCoin, [1, 0, 0, 0], [0, 1, 0], 1, remediationDecision + 16 * 60_000).length, 0, 'partial-hour/backfill guard');
assert.deepEqual(
  collectRemediatedSignalShadowCandidates(store, remediationCoin, [1, 0, 0, 0], [0, 1, 0], null, remediationDecision + 5 * 60_000).map((x) => x.strategyId),
  ['top-t1-reversal-v2'],
  'W2 fails closed without the as-of BTC return while T1 does not invent a dependency',
);

console.log('strategy-shadow tests passed');
