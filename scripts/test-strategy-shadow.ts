import assert from 'node:assert/strict';
import type { CoinLite } from '../src/types';
import { collectExistingSignalShadowCandidates, collectSpotShadowCandidates } from './strategyShadowFile';

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

console.log('strategy-shadow tests passed');
