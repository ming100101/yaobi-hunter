import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Candle, DeliveredPush, EntryWatchObservation, ExitPlan } from '../src/types';
import {
  ENTRY_WATCH_EXPIRY_MS,
  ENTRY_WATCH_MIN_DELAY_MS,
  activeEntryWatches,
  applyEntryWatchTransition,
  createEntryWatchCandidate,
  deliveredPushId,
  deriveEntryWatchAnchor,
  emptyEntryWatchState,
  markEntryWatchDelivered,
  markEntryWatchSendFailed,
  markEntryWatchSending,
  observeEntryWatch,
  sanitizeEntryWatchState,
  supersedeEntryWatch,
} from '../src/lib/entryWatch';
import { readEntryWatchState, updateEntryWatchState, writeEntryWatchState } from './entryWatchFile';

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
const MIN = 60_000;
const HOUR = 60 * MIN;
const plan: ExitPlan = {
  entry: 101,
  kind: 'pullback',
  tp1: 105,
  tp2: 109,
  tp3: 116,
  sl: 98,
  runnerPct: 5,
};

function push(overrides: Partial<DeliveredPush> = {}): DeliveredPush {
  const cls = overrides.cls ?? 'rb';
  const sym = overrides.sym ?? 'TEST';
  const ts = overrides.ts ?? T0;
  return {
    id: overrides.id ?? deliveredPushId(cls, sym, ts),
    sym,
    cls,
    attemptedAt: ts,
    ts,
    deliveredAt: ts,
    px: 110,
    strength: 82,
    via: 'photo',
    telegramMessageId: 4242,
    plan,
    support: 100,
    atr: 10,
    followupEnabled: true,
    ...overrides,
  };
}

function bar(minutes: number, overrides: Partial<EntryWatchObservation> = {}): EntryWatchObservation {
  return {
    ts: T0 + minutes * MIN,
    high: 104,
    low: 96,
    close: 101,
    ...overrides,
  };
}

function hourlyFixture(completeHours = 24, currentRows = 1): Candle[] {
  const start = Math.floor(1_700_000_000 / 3600) * 3600;
  const out: Candle[] = [];
  for (let h = 0; h < completeHours; h++) {
    for (let k = 0; k < 12; k++) {
      out.push({ time: start + h * 3600 + k * 300, open: 100, high: 102, low: 98, close: 100 });
    }
  }
  for (let k = 0; k < currentRows; k++) {
    // An extreme current-hour high must never leak into frozen prior-hour support.
    out.push({
      time: start + completeHours * 3600 + k * 300,
      open: 100,
      high: 999,
      low: 1,
      close: 500,
    });
  }
  return out;
}

test('clock-aligned anchor drops the current hour and derives prior-24h high + ATR14', () => {
  const got = deriveEntryWatchAnchor(hourlyFixture());
  assert.deepEqual(got, { support: 102, atr: 4 });
});

test('anchor remains clock-aligned for reversed input and drops a full newest group', () => {
  const got = deriveEntryWatchAnchor(hourlyFixture(25, 0).reverse());
  assert.deepEqual(got, { support: 102, atr: 4 });
});

test('anchor fails closed on an incomplete completed hour', () => {
  const xs = hourlyFixture();
  xs.splice(7, 1);
  assert.equal(deriveEntryWatchAnchor(xs), null);
});

test('anchor fails closed on an hour gap', () => {
  const xs = hourlyFixture().map((c) =>
    c.time >= hourlyFixture()[0].time + 12 * 3600 ? { ...c, time: c.time + 3600 } : c,
  );
  assert.equal(deriveEntryWatchAnchor(xs), null);
});

test('candidate freezes all thresholds and Telegram reply provenance', () => {
  const c = createEntryWatchCandidate(push());
  assert.equal(c.id, `entry:rb:TEST:${T0}`);
  assert.equal(c.sourceId, `rb:TEST:${T0}`);
  assert.equal(c.bandLow, 95);
  assert.equal(c.bandHigh, 105);
  assert.equal(c.invalidBelow, 90);
  assert.ok(Math.abs(c.missedAbove - 126.5) < 1e-10);
  assert.equal(c.minReadyAt, T0 + 30 * MIN);
  assert.equal(c.expiresAt, T0 + 24 * HOUR);
  assert.equal(c.telegramMessageId, 4242);
  assert.equal(c.followupEnabled, true);
  assert.notEqual(c.plan, plan, 'plan must be copied/frozen by value');
});

test('candidate construction rejects unusable ATR and Telegram message ids', () => {
  assert.throws(() => createEntryWatchCandidate(push({ atr: 100 })), /smaller than support/);
  assert.throws(() => createEntryWatchCandidate(push({ telegramMessageId: 0 })), /positive integer/);
});

test('record-only shadow mode is frozen into the candidate and audit event', () => {
  const c = createEntryWatchCandidate(push({ followupEnabled: false }));
  assert.equal(c.followupEnabled, false);
  const armed = supersedeEntryWatch(emptyEntryWatchState(), c).events[0];
  assert.equal(armed.followupEnabled, false);
});

test('⚡ uses the same frozen reclaim state machine but remains App-only', () => {
  const c = createEntryWatchCandidate(push({ cls: 'fb', id: deliveredPushId('fb', 'TEST', T0), followupEnabled: false }));
  assert.equal(c.cls, 'fb');
  assert.equal(c.followupEnabled, false);
  const ready = observeEntryWatch(c, bar(30));
  assert.equal(ready.candidate.status, 'ready');
  assert.equal(ready.event?.event, 'ready');
  assert.equal(ready.event?.followupEnabled, false);
});

test('a valid reclaim before 30m does not become ready', () => {
  const c = createEntryWatchCandidate(push());
  const r = observeEntryWatch(c, bar(29));
  assert.equal(r.candidate.status, 'watching');
  assert.equal(r.event, undefined);
  assert.equal(r.candidate.lastBarTs, T0 + 29 * MIN);
});

test('at 30m, a band touch closing in [support, bandHigh] becomes ready', () => {
  const c = createEntryWatchCandidate(push());
  const r = observeEntryWatch(c, bar(30));
  assert.equal(r.candidate.status, 'ready');
  assert.equal(r.candidate.readyPx, 101);
  assert.equal(r.event?.event, 'ready');
  assert.equal(r.event?.sourceId, c.sourceId);
});

test('no-chase rule rejects a close above the upper band', () => {
  const r = observeEntryWatch(
    createEntryWatchCandidate(push()),
    bar(30, { high: 108, low: 100, close: 106 }),
  );
  assert.equal(r.candidate.status, 'watching');
  assert.equal(r.event, undefined);
});

test('a close below support is not a reclaim even when the band was touched', () => {
  const r = observeEntryWatch(
    createEntryWatchCandidate(push()),
    bar(30, { high: 103, low: 95, close: 99 }),
  );
  assert.equal(r.candidate.status, 'watching');
});

test('a bar that never overlaps the band cannot become ready', () => {
  const r = observeEntryWatch(
    createEntryWatchCandidate(push()),
    bar(30, { high: 110, low: 106, close: 108 }),
  );
  assert.equal(r.candidate.status, 'watching');
});

test('15m close strictly below support-ATR invalidates; equality does not', () => {
  const c = createEntryWatchCandidate(push());
  const equal = observeEntryWatch(c, bar(31, { high: 95, low: 90, close: 90 }));
  assert.equal(equal.candidate.status, 'watching');
  const broken = observeEntryWatch(c, bar(31, { high: 95, low: 89, close: 89 }));
  assert.equal(broken.candidate.status, 'invalidated');
  assert.equal(broken.event?.event, 'invalid');
});

test('+15% continuation marks the entry missed before a same-bar reclaim can fire', () => {
  const r = observeEntryWatch(
    createEntryWatchCandidate(push()),
    bar(30, { high: 126.5, low: 96, close: 101 }),
  );
  assert.equal(r.candidate.status, 'missed');
  assert.equal(r.event?.event, 'missed');
});

test('24h expiry wins over a same-bar reclaim', () => {
  const r = observeEntryWatch(
    createEntryWatchCandidate(push()),
    bar(24 * 60),
  );
  assert.equal(r.candidate.status, 'expired');
  assert.equal(r.event?.event, 'expired');
  assert.equal(r.candidate.terminalAt, T0 + ENTRY_WATCH_EXPIRY_MS);
});

test('source/pre-source bars and duplicate/older 15m closes are idempotent no-ops', () => {
  const c = createEntryWatchCandidate(push());
  const source = observeEntryWatch(c, bar(0));
  assert.equal(source.candidate, c);
  const first = observeEntryWatch(c, bar(31, { high: 108, low: 106, close: 107 }));
  const duplicate = observeEntryWatch(first.candidate, bar(31));
  assert.equal(duplicate.candidate, first.candidate);
  assert.equal(duplicate.event, undefined);
});

test('ready -> sending -> failed/backoff -> retry -> delivered is deterministic', () => {
  const ready = observeEntryWatch(createEntryWatchCandidate(push()), bar(30)).candidate;
  const sending1 = markEntryWatchSending(ready, T0 + 31 * MIN);
  assert.equal(sending1.status, 'sending');
  assert.equal(sending1.attemptCount, 1);
  const failed = markEntryWatchSendFailed(sending1, T0 + 31 * MIN, T0 + 36 * MIN, 'offline');
  assert.equal(failed.candidate.status, 'ready');
  assert.equal(failed.event?.event, 'delivery-failed');
  assert.equal(markEntryWatchSending(failed.candidate, T0 + 35 * MIN), failed.candidate);
  const sending2 = markEntryWatchSending(failed.candidate, T0 + 36 * MIN);
  assert.equal(sending2.attemptCount, 2);
  const delivered = markEntryWatchDelivered(sending2, T0 + 37 * MIN, 102);
  assert.equal(delivered.candidate.status, 'delivered');
  assert.equal(delivered.event?.event, 'delivered');
});

test('one-active-per-symbol insert is idempotent and newer source supersedes', () => {
  const a = createEntryWatchCandidate(push());
  const first = supersedeEntryWatch(emptyEntryWatchState(), a);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].event, 'armed');
  const replay = supersedeEntryWatch(first.state, a);
  assert.equal(replay.state, first.state);
  assert.deepEqual(replay.events, []);

  const b = createEntryWatchCandidate(
    push({ id: deliveredPushId('vg', 'TEST', T0 + MIN), cls: 'vg', ts: T0 + MIN }),
  );
  const replaced = supersedeEntryWatch(first.state, b);
  assert.deepEqual(replaced.events.map((e) => e.event), ['superseded', 'armed']);
  assert.equal(replaced.events[0].replacedBy, b.id);
  assert.equal(replaced.state.active.TEST.sourceId, b.sourceId);
  assert.equal(activeEntryWatches(replaced.state).length, 1);
});

test('a stale transition cannot overwrite a superseding candidate', () => {
  const a = createEntryWatchCandidate(push());
  const stateA = supersedeEntryWatch(emptyEntryWatchState(), a).state;
  const b = createEntryWatchCandidate(
    push({ id: deliveredPushId('vg', 'TEST', T0 + MIN), cls: 'vg', ts: T0 + MIN }),
  );
  const stateB = supersedeEntryWatch(stateA, b).state;
  const stale = observeEntryWatch(a, bar(30));
  assert.equal(applyEntryWatchTransition(stateB, stale), stateB);
});

test('terminal transition removes only the matching active candidate', () => {
  const c = createEntryWatchCandidate(push());
  const state = supersedeEntryWatch(emptyEntryWatchState(), c).state;
  const terminal = observeEntryWatch(c, bar(31, { high: 95, low: 89, close: 89 }));
  const next = applyEntryWatchTransition(state, terminal);
  assert.equal(next.active.TEST, undefined);
});

test('disk sanitizer retains active rows, drops terminal/corrupt rows and normalizes symbols', () => {
  const active = createEntryWatchCandidate(push({ sym: 'test' }));
  const terminal = { ...createEntryWatchCandidate(push({ sym: 'DONE', id: 'rb:DONE:1' })), status: 'expired' as const };
  const clean = sanitizeEntryWatchState({
    v: 1,
    updatedAt: T0,
    active: { lower: active, terminal, broken: { nope: true } },
  });
  assert.deepEqual(Object.keys(clean.active), ['TEST']);
  assert.equal(clean.active.TEST.sym, 'TEST');
});

test('atomic state file round-trips, replaces, updates, and leaves no temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaobi-entry-watch-'));
  const file = path.join(dir, 'entry-watch.json');
  try {
    const c = createEntryWatchCandidate(push());
    const state = supersedeEntryWatch(emptyEntryWatchState(), c).state;
    writeEntryWatchState(state, file);
    assert.deepEqual(readEntryWatchState(file), state);

    const updated = updateEntryWatchState((s) => ({ ...s, updatedAt: T0 + MIN }), file);
    assert.equal(updated.updatedAt, T0 + MIN);
    assert.equal(readEntryWatchState(file).updatedAt, T0 + MIN);
    assert.deepEqual(fs.readdirSync(dir), ['entry-watch.json']);

    fs.writeFileSync(file, '{bad json');
    assert.deepEqual(readEntryWatchState(file), emptyEntryWatchState());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canonical timing constants stay frozen', () => {
  assert.equal(ENTRY_WATCH_MIN_DELAY_MS, 30 * MIN);
  assert.equal(ENTRY_WATCH_EXPIRY_MS, 24 * HOUR);
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ENTRY-WATCH TESTS PASS');
process.exit(failures ? 1 : 0);
