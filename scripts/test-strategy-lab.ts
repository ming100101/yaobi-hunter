import assert from 'node:assert/strict';
import type { StrategyCandidate } from '../src/types';
import {
  BALANCED_PORTFOLIO_POLICY,
  EXECUTION_POLICIES,
  evaluatePromotion,
  evaluateStrategyCandidate,
  nextNative15mOpen,
  summarizeStrategyOutcomes,
  type Native15mBar,
} from '../src/lib/strategyLab';

const SLOT = 15 * 60_000;
const start = Date.UTC(2026, 6, 1, 0, 0);
const candidate: StrategyCandidate = {
  type: 'strategy-candidate', v: 1, id: 'b2:TEST:1', strategyId: 'boarding-b2-v1',
  rulesetId: 'boarding-b2-v1', sym: 'TEST', decisionTs: start, signalPx: 100,
  status: 'shadow', source: 'historical',
};

function bars(n: number, mutate?: (b: Native15mBar, i: number) => void): Native15mBar[] {
  return Array.from({ length: n }, (_, i) => {
    const b: Native15mBar = {
      openTs: start + i * SLOT,
      closeTs: start + (i + 1) * SLOT,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    };
    mutate?.(b, i);
    return b;
  });
}

assert.equal(nextNative15mOpen(start), start, 'an exact close boundary fills at the newly-opened native bar');
assert.equal(nextNative15mOpen(start + 1), start + SLOT, 'a mid-slot decision waits for the next native open');

const missing = evaluateStrategyCandidate(candidate, bars(95), EXECUTION_POLICIES['time24-sl3-v1']);
assert.equal(missing.terminal, 'insufficient-data');
assert.equal(missing.coverage.complete, false);

const time = evaluateStrategyCandidate(candidate, bars(96), EXECUTION_POLICIES['time24-sl3-v1']);
assert.equal(time.terminal, 'time');
assert.equal(time.entryPx, 100);
assert.ok(Math.abs(time.grossReturn - 0.005) < 1e-12);
assert.ok(Math.abs(time.netReturn - 0.002) < 1e-12, '30bps is deducted from the result');

const tie = evaluateStrategyCandidate(
  candidate,
  bars(96, (b, i) => { if (i === 2) { b.high = 110; b.low = 96; } }),
  EXECUTION_POLICIES['time24-sl3-v1'],
);
assert.equal(tie.terminal, 'stop');
assert.ok(Math.abs(tie.grossReturn + 0.03) < 1e-12);
assert.equal(tie.ordering.plus4BeforeMinus3, false, 'same-candle ambiguity is stop-first');

const ladder = evaluateStrategyCandidate(
  candidate,
  bars(192, (b, i) => {
    if (i === 2) b.high = 104.1;
    if (i === 4) b.high = 108.1;
    if (i === 6) b.high = 115.1;
  }),
  EXECUTION_POLICIES['ladder-4-8-15-sl3-v1'],
);
assert.equal(ladder.terminal, 'ladder-complete');
assert.ok(Math.abs(ladder.grossReturn - 0.074) < 1e-12, '50/30/20 ladder is frozen');

const charged = evaluateStrategyCandidate(candidate, bars(96), EXECUTION_POLICIES['time24-sl3-v1'], [
  { ts: start + 8 * 3600_000, rate: 0.0001 },
]);
assert.ok(Math.abs(charged.fundingReturn - 0.0001) < 1e-12);

const summary = summarizeStrategyOutcomes([time, tie, ladder]);
assert.equal(summary.trades, 3);
assert.equal(summary.coins, 1);
assert.ok(summary.maxDrawdown > 0);

const thin = evaluatePromotion({ strategyId: 'boarding-b2-v1', stage: 'shadow', outcomes: [time], matchedLift: 2, sensitivityLifts: [1.2] });
assert.equal(thin.pass, false);
assert.ok(thin.reasons.some((x) => x.startsWith('trades ')));

assert.deepEqual(BALANCED_PORTFOLIO_POLICY, {
  id: 'balanced-v1', leverage: 1, riskPerTradePct: 0.5, maxPositionNotionalPct: 20,
  maxOpenPositions: 4, maxOpenRiskPct: 2, dailyLossBlockPct: 1.5, drawdownLockPct: 10,
});

console.log('strategy-lab tests passed');
