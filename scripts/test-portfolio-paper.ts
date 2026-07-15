import assert from 'node:assert/strict';
import type { StrategyCandidate } from '../src/types';
import { createBalancedPaperState, openBalancedPaperPosition, settleBalancedPaperPosition } from '../src/lib/portfolioPaper';

const H = 3_600_000;
const decisionTs = Date.UTC(2026, 6, 15, 1, 0);
const candidate = (sym: string, strategyId: StrategyCandidate['strategyId'] = 'boarding-b2-v1'): StrategyCandidate => ({
  type: 'strategy-candidate', v: 1, id: `${strategyId}:${sym}:${decisionTs}`, strategyId,
  rulesetId: 'test', sym, decisionTs, signalPx: 100, status: 'shadow', source: 'forward',
});
const bar = { openTs: decisionTs, closeTs: decisionTs + 900_000, open: 100, high: 101, low: 99, close: 100 };

let state = createBalancedPaperState(10_000, ['boarding-b2-v1']);
const first = openBalancedPaperPosition(state, candidate('AAA'), bar);
assert.ok(first.opened);
assert.equal(Math.round(first.opened!.notional * 100) / 100, 1666.67);
assert.equal(first.opened!.riskAmount, 50);
state = first.state;

assert.match(openBalancedPaperPosition(state, candidate('AAA'), bar).reason ?? '', /already/);
assert.match(openBalancedPaperPosition(state, candidate('BBB', 'spot-led-v1'), bar).reason ?? '', /promotion/);

for (const sym of ['BBB', 'CCC', 'DDD']) {
  const opened = openBalancedPaperPosition(state, candidate(sym), bar);
  assert.ok(opened.opened);
  state = opened.state;
}
assert.match(openBalancedPaperPosition(state, candidate('EEE'), bar).reason ?? '', /four-position/);

// Four 0.5% stop losses trip both the -1.5% daily guard and remove positions.
for (const p of [...state.positions]) state = settleBalancedPaperPosition(state, p.id, -0.03, decisionTs + H);
assert.equal(state.dayBlocked, true);
assert.match(openBalancedPaperPosition(state, candidate('NEW'), { ...bar, openTs: decisionTs + H }).reason ?? '', /daily/);

// The UTC guard resets, but a true 10% portfolio drawdown remains version locked.
state = { ...state, day: '', dayBlocked: false, equity: 8_900, peakEquity: 10_000 };
state = settleBalancedPaperPosition(state, 'missing', 0, decisionTs + 24 * H);
// Missing settlement cannot manufacture a lock; settling a real position does.
state.positions = [{ ...first.opened!, id: 'lock-test', notional: 1000 }];
state = settleBalancedPaperPosition(state, 'lock-test', -0.01, decisionTs + 24 * H);
assert.equal(state.drawdownLocked, true);

console.log('portfolio-paper tests passed');
