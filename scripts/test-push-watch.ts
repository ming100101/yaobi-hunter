import assert from 'node:assert/strict';
import { parseDeepReclaimPayload, parseRecordingEvents, watchForPush, zoneDistance } from '../src/components/PushWatchView';
import { DEEP_RECLAIM_RULESET_ID, DEEP_RECLAIM_SELECTION_POLICY_ID } from '../src/lib/deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from '../src/lib/researchGate';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(e);
  }
}

const T0 = 1_783_125_000_000;
const notify = {
  type: 'notify',
  v: 2,
  id: 'rb:CLO:1',
  ts: T0,
  sym: 'CLO',
  cls: 'rb',
  px: 110,
  strength: 82,
  via: 'photo',
  delivered: true,
  messageId: 500,
};
const armed = {
  type: 'entry-watch',
  v: 1,
  id: 'entry:rb:CLO:1:armed',
  watchId: 'entry:rb:CLO:1',
  sourceId: notify.id,
  event: 'armed',
  status: 'watching',
  ts: T0,
  sym: 'CLO',
  cls: 'rb',
  px: 110,
  support: 100,
  atr: 10,
  bandLow: 95,
  bandHigh: 105,
  followupEnabled: false,
};
const ready = {
  ...armed,
  id: 'entry:rb:CLO:1:ready',
  event: 'ready',
  status: 'ready',
  ts: T0 + 45 * 60_000,
  px: 101,
};

test('v2 push and lifecycle deltas merge by watchId/sourceId', () => {
  const parsed = parseRecordingEvents([notify, armed, ready].map(JSON.stringify).join('\n'));
  assert.equal(parsed.pushes.length, 1);
  assert.equal(parsed.watches.length, 1);
  const watch = parsed.watches[0];
  assert.equal(watch.status, 'ready');
  assert.equal(watch.zoneLow, 95);
  assert.equal(watch.zoneHigh, 105);
  assert.equal(watch.confirmPx, 101);
  assert.equal(watch.confirmTs, ready.ts);
  assert.equal(watch.expiresAt, T0 + 24 * 3600_000);
  assert.equal(watch.followupEnabled, false);
  assert.equal(watchForPush(parsed.watches, parsed.pushes[0])?.watchId, watch.watchId);
});

test('terminal records normalize into the invalid UI bucket with their reason', () => {
  const invalid = {
    ...armed,
    id: 'entry:rb:CLO:1:invalid',
    event: 'invalid',
    status: 'invalidated',
    ts: T0 + 60 * 60_000,
    px: 89,
    reason: '15m close below support - 1 ATR',
  };
  const parsed = parseRecordingEvents([notify, armed, invalid].map(JSON.stringify).join('\n'));
  assert.equal(parsed.watches[0].status, 'invalid');
  assert.equal(parsed.watches[0].lastEvent, 'invalid');
  assert.match(parsed.watches[0].reason ?? '', /15m close/);
});

test('legacy rows without Telegram message proof are rejected for both photo and text', () => {
  const oldPhoto = { type: 'notify', v: 1, ts: T0 - 2, sym: 'SAFE', cls: 'vg', px: 1, strength: 70, via: 'photo' };
  const oldText = { type: 'notify', v: 1, ts: T0 - 1, sym: 'NOPE', cls: 'vg', px: 1, strength: 70, via: 'text' };
  const parsed = parseRecordingEvents([oldPhoto, oldText].map(JSON.stringify).join('\n'));
  assert.deepEqual(parsed.pushes, []);
  assert.deepEqual(parsed.watches, []);
});

test('zone distance is signed, zero in-band, and null without a usable zone', () => {
  const watch = parseRecordingEvents([notify, armed].map(JSON.stringify).join('\n')).watches[0];
  assert.ok(Math.abs((zoneDistance(watch, 110) ?? 0) - 4.7619047619) < 1e-9);
  assert.equal(zoneDistance(watch, 100), 0);
  assert.ok(Math.abs((zoneDistance(watch, 90) ?? 0) + 5.2631578947) < 1e-9);
  assert.equal(zoneDistance(undefined, 100), null);
});

test('deep-reclaim delivery telemetry cannot erase eligible source provenance', () => {
  const source = {
    type: 'deep-reclaim', id: 'deep-reclaim-v0:TEST:1:price-candidate:1', watchId: 'deep-reclaim-v0:TEST:1',
    event: 'price-candidate', status: 'early', ts: T0, setupTs: T0, sym: 'TEST', px: 1,
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    cohortMonth: '2026-07', evidenceEligible: true,
  };
  const delivery = {
    ...source, id: 'deep-reclaim-v0:TEST:1:early-delivered:2', event: 'early-delivered', status: 'watching',
    ts: T0 + 1, evidenceEligible: false,
  };
  const legacy = {
    type: 'deep-reclaim', id: 'deep-reclaim-v0:OLD:1:price-candidate:1', watchId: 'deep-reclaim-v0:OLD:1',
    event: 'price-candidate', status: 'early', ts: T0, setupTs: T0, sym: 'OLD', px: 1,
  };
  const selectionRound = {
    type: 'deep-reclaim', id: 'deep-reclaim-selection-round:1', watchId: source.watchId,
    event: 'selection-round', status: 'selected', ts: T0, setupTs: T0, sym: 'TEST', px: 1,
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    selectedWatchId: source.watchId,
    candidates: [{
      watchId: source.watchId, sym: 'TEST', setupTs: T0, ddPct: 10, rankScore: 70,
      operationalScore: 80, buyShare4h: 0.65, qty1h: 1, qty4h: 4, eligible: true, reason: null,
    }],
  };
  const oldSelection = {
    ...source,
    id: 'deep-reclaim-v0:OLDSELECT:1:price-candidate:1',
    watchId: 'deep-reclaim-v0:OLDSELECT:1',
    sym: 'OLDSELECT',
    selectionPolicyId: 'deep-reclaim-top1-v1',
  };
  const parsed = parseDeepReclaimPayload({ events: [source, delivery, legacy, oldSelection, selectionRound] });
  const current = parsed.rows.find((row) => row.sym === 'TEST');
  const old = parsed.rows.find((row) => row.sym === 'OLD');
  assert.equal(current?.evidenceEligible, true);
  const drifted = parsed.rows.find((row) => row.sym === 'OLDSELECT');
  assert.equal(current?.rulesetId, DEEP_RECLAIM_RULESET_ID);
  assert.equal(old?.evidenceEligible, undefined);
  assert.equal(drifted?.evidenceEligible, undefined, 'old Top-1 selection policy cannot enter the current denominator');
  assert.equal(parsed.rows.some((row) => row.sym === '*'), false, 'operational selection rounds never appear as coin rows');
  assert.equal(parsed.selectionAudit.verdict, 'PASS', 'Push payload exposes recent Top-1 fidelity');
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PUSH WATCH TESTS PASS');
process.exitCode = failures ? 1 : 0;
