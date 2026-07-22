import assert from 'node:assert/strict';
import { classifyEvidenceHoldoutGate } from './evidenceHoldout';

const passing = {
  completeEvents: 10,
  completeCoins: 10,
  completeDays: 7,
  primaryLift: 1.3,
  netAfterCost: 0.000001,
  worstLift: 1.150001,
  bootstrapLower95: 0.000001,
};

assert.deepEqual(classifyEvidenceHoldoutGate(passing), {
  status: 'holdout-pass',
  gates: {
    sample: true,
    primaryLift: true,
    netAfterCost: true,
    robustness: true,
    bootstrap: true,
  },
});
assert.equal(classifyEvidenceHoldoutGate({ ...passing, completeEvents: 9 }).status, 'insufficient-sample');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, completeCoins: 9 }).status, 'insufficient-sample');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, completeDays: 6 }).status, 'insufficient-sample');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, primaryLift: 1.299999 }).status, 'holdout-fail');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, netAfterCost: 0 }).status, 'holdout-fail');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, worstLift: 1.15 }).status, 'holdout-fail');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, bootstrapLower95: 0 }).status, 'holdout-fail');
assert.equal(classifyEvidenceHoldoutGate({ ...passing, primaryLift: null }).gates.primaryLift, false);
assert.equal(classifyEvidenceHoldoutGate({ ...passing, netAfterCost: null }).gates.netAfterCost, false);

console.log('frozen July evidence holdout gates PASS');
