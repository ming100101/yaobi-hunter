import assert from 'node:assert/strict';
import { DEEP_RECLAIM_RULESET_ID, DEEP_RECLAIM_SELECTION_POLICY_ID } from '../src/lib/deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from '../src/lib/researchGate';
import { auditDeepReclaimSelection } from '../src/lib/deepReclaimSelectionAudit';

const protocol = {
  type: 'deep-reclaim',
  v: 1,
  rulesetId: DEEP_RECLAIM_RULESET_ID,
  gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
  selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
};
const candidate = (sym: string, operationalScore: number, eligible = true, reason: string | null = null) => ({
  watchId: `deep-reclaim-v0:${sym}:1000`, sym, setupTs: 1000, ddPct: 10,
  rankScore: sym === 'A' ? 70 : 71, operationalScore, buyShare4h: 0.65,
  qty1h: 1, qty4h: 4, eligible, reason,
});
const a = candidate('A', 80);
const b = candidate('B', 70);
const round = (overrides: Record<string, unknown> = {}) => ({
  ...protocol,
  id: 'deep-reclaim-selection-round:1:abcd',
  watchId: a.watchId,
  event: 'selection-round', status: 'selected', ts: 1100, setupTs: 1000,
  selectedWatchId: a.watchId, candidates: [a, b],
  ...overrides,
});
const lifecycle = (event: string, watchId: string) => ({ ...protocol, id: `${watchId}:${event}`, watchId, event });

{
  const result = auditDeepReclaimSelection([round(), lifecycle('armed', a.watchId), lifecycle('armed', b.watchId), lifecycle('early-delivered', a.watchId)]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.rounds, 1);
  assert.equal(result.deliveredSelections, 1);
}

{
  const duplicate = round();
  const result = auditDeepReclaimSelection([round(), duplicate]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.duplicateRows, 1);
}

{
  const result = auditDeepReclaimSelection([round({ candidates: [b, a] })]);
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'candidate-order-drift'));
}

{
  const result = auditDeepReclaimSelection([round({ selectedWatchId: b.watchId, watchId: b.watchId })]);
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'selected-watch-mismatch'));
}

{
  const conflict = round({ selectedWatchId: b.watchId, watchId: b.watchId });
  const result = auditDeepReclaimSelection([round(), conflict]);
  assert.equal(result.conflictingDuplicates, 1);
  assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'conflicting-duplicate-id'));
}

{
  const suppressed = candidate('A', 80, false, 'daily-cap');
  const result = auditDeepReclaimSelection([round({ status: 'suppressed', selectedWatchId: null, watchId: 'round', candidates: [suppressed] })]);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.suppressedRounds, 1);
  assert.equal(result.suppressionReasons['daily-cap'], 1);
}

{
  const orphan = lifecycle('early-delivered', 'deep-reclaim-v0:ORPHAN:1000');
  const result = auditDeepReclaimSelection([round(), orphan]);
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'delivery-without-selection-round'));
}

{
  const orphanArmed = lifecycle('armed', 'deep-reclaim-v0:ORPHAN-ARM:1000');
  const result = auditDeepReclaimSelection([orphanArmed]);
  assert.equal(result.verdict, 'FAIL', 'missing selection provenance cannot be reported as merely unavailable');
  assert.ok(result.anomalies.some((anomaly) => anomaly.code === 'armed-without-selection-round'));
  const recentWindow = auditDeepReclaimSelection([orphanArmed], { requireCompleteLinkage: false });
  assert.equal(recentWindow.verdict, 'UNAVAILABLE', 'bounded UI window does not invent cross-window orphan failures');
}

console.log('deep-reclaim selection fidelity audit tests PASS');
