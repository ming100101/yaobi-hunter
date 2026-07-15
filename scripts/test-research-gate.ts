import {
  DEEP_RECLAIM_GATE_PROTOCOL,
  blockBootstrapLowerBounds,
  isolateProtocolCohort,
  matchedPrecisionLift,
  purgedWalkForward,
  type ResearchGateRow,
} from '../src/lib/researchGate';
import { DEEP_RECLAIM_SELECTION_POLICY_ID } from '../src/lib/deepReclaim';

let failures = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
  }
}
function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function eq<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${message}: got ${actual}, expected ${expected}`);
}

function row(
  id: string,
  sym: string,
  ts: number,
  value: number,
  success: boolean,
  confirmed = true,
): ResearchGateRow {
  return { id, sym, ts, value, success, confirmed };
}

test('gate protocol is pinned to the deployed Top-1 selection policy', () => {
  eq(DEEP_RECLAIM_GATE_PROTOCOL.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID, 'selection protocol id');
  eq(DEEP_RECLAIM_GATE_PROTOCOL.requireExactSelectionReplay, true, 'promotion fails closed without exact replay');
});

test('matched lift uses exact ids and cannot borrow unmatched easy controls', () => {
  const ts = Date.UTC(2026, 0, 10);
  const primary = [row('a', 'A', ts, 0.1, true), row('b', 'B', ts, 0, true), row('c', 'C', ts, 0, false, false)];
  const control = [row('a', 'A', ts, 0, false), row('b', 'B', ts, 0, false), row('x', 'X', ts, 1, true)];
  const all = matchedPrecisionLift(primary, control, false);
  eq(all.eligible, 2, 'only exact ids are eligible');
  eq(all.primaryHits, 2, 'primary hits');
  eq(all.controlHits, 0, 'unmatched control hit excluded');
  eq(all.lift, Infinity, 'zero-hit matched control gives infinite lift only with primary hits');
  const confirmed = matchedPrecisionLift(primary, control, true);
  eq(confirmed.eligible, 2, 'primary confirmation filter is applied before matching');
});

test('bootstrap is deterministic and preserves zero-return source events', () => {
  const rows: ResearchGateRow[] = [];
  for (let sym = 0; sym < 25; sym++) {
    for (let day = 0; day < 3; day++) {
      rows.push(row(`${sym}-${day}`, `S${sym}`, Date.UTC(2026, 0, 3 + day), sym < 20 ? 0.02 : 0, sym < 20, sym < 20));
    }
  }
  const a = blockBootstrapLowerBounds(rows, { iterations: 500, seed: 'locked' });
  const b = blockBootstrapLowerBounds(rows, { iterations: 500, seed: 'locked' });
  ok(a.available, 'bootstrap should be available');
  eq(a.eventLower, b.eventLower, 'event lower bound deterministic');
  eq(a.coinLower, b.coinLower, 'coin lower bound deterministic');
  ok((a.eventLower ?? 0) > 0, 'positive population lower bound');
  ok((a.coinLower ?? 0) > 0, 'positive coin lower bound');
});

test('bootstrap fails closed when independent blocks are too few', () => {
  const rows = [row('a', 'A', Date.UTC(2026, 0, 3), 1, true)];
  const result = blockBootstrapLowerBounds(rows);
  eq(result.available, false, 'small sample unavailable');
  eq(result.eventLower, null, 'no fabricated lower bound');
});

test('purged walk-forward requires three calendar months', () => {
  const rows = [row('a', 'A', Date.UTC(2026, 0, 10), 1, true), row('b', 'B', Date.UTC(2026, 1, 10), 1, true)];
  const result = purgedWalkForward(rows);
  eq(result.available, false, 'two months unavailable');
  eq(result.pass, false, 'unavailable cannot pass');
});

test('purged walk-forward rejects one losing out-of-time fold', () => {
  const rows: ResearchGateRow[] = [];
  for (let month = 0; month < 3; month++) {
    for (let i = 0; i < 5; i++) rows.push(row(`${month}-${i}`, `S${i}`, Date.UTC(2026, month, 10 + i), month === 1 ? -0.01 : 0.01, true));
  }
  const result = purgedWalkForward(rows);
  ok(result.available, 'three months available');
  eq(result.folds.length, 3, 'three folds');
  eq(result.pass, false, 'losing fold blocks promotion');
  eq(result.folds[1].pass, false, 'middle fold is the failure');
});

test('purged walk-forward passes only when every fold is event and coin positive', () => {
  const rows: ResearchGateRow[] = [];
  for (let month = 0; month < 3; month++) {
    for (let i = 0; i < 5; i++) rows.push(row(`${month}-${i}`, `S${i}`, Date.UTC(2026, month, 10 + i), 0.01, true));
  }
  const result = purgedWalkForward(rows);
  ok(result.available && result.pass, 'all frozen out-of-time folds pass');
});

test('protocol cohort isolation excludes legacy, drifted selection and misdated evidence', () => {
  const ts = Date.UTC(2026, 0, 10);
  const current = { rulesetId: 'rules-v1', gateProtocolId: 'gate-v1', selectionPolicyId: 'select-v2', cohortMonth: '2026-01' };
  const rows: ResearchGateRow[] = [
    { ...row('ok', 'A', ts, 0.01, true), ...current },
    { ...row('ok', 'A', ts, 0.01, true), ...current },
    row('legacy', 'B', ts, 0.01, true),
    { ...row('rules', 'C', ts, 0.01, true), ...current, rulesetId: 'rules-v2' },
    { ...row('gate', 'D', ts, 0.01, true), ...current, gateProtocolId: 'gate-v2' },
    { ...row('selection', 'F', ts, 0.01, true), ...current, selectionPolicyId: 'select-v1' },
    { ...row('month', 'E', ts, 0.01, true), ...current, cohortMonth: '2026-02' },
  ];
  const audit = isolateProtocolCohort(rows, { rulesetId: 'rules-v1', gateProtocolId: 'gate-v1', selectionPolicyId: 'select-v2' });
  eq(audit.included.length, 1, 'only exact protocol cohort remains');
  eq(audit.excluded, 6, 'mixed and duplicated evidence excluded');
  eq(audit.excludedByReason['missing-provenance'], 1, 'legacy reason');
  eq(audit.excludedByReason['ruleset-mismatch'], 1, 'rules drift reason');
  eq(audit.excludedByReason['gate-protocol-mismatch'], 1, 'gate drift reason');
  eq(audit.excludedByReason['selection-policy-mismatch'], 1, 'selection drift reason');
  eq(audit.excludedByReason['cohort-mismatch'], 1, 'bad month reason');
  eq(audit.excludedByReason['duplicate-id'], 1, 'restart/replay duplicate reason');
});

if (failures) process.exit(1);
console.log('\n8 research-gate tests passed');
