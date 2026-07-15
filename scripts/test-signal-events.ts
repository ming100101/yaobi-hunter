import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRecordings, SLOT_MS } from '../src/lib/evalCore';
import {
  evaluateSignalOutcome,
  parseDeliveredSignalObject,
  parseDeliveredSignals,
  type SignalNotifyEvent,
} from '../src/lib/signalEvents';
import { serveSignalEvents } from './signalEventsServe';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

const makeCoin = (sym: string, px: number) => {
  const row: unknown[] = Array(25).fill(0);
  row[0] = sym;
  row[1] = px;
  row[5] = 80;
  return row;
};
const scans = (rows: Array<{ slot: number; px?: number; include?: boolean }>) =>
  rows
    .map(({ slot, px = 100, include = true }) =>
      JSON.stringify({ v: 4, ts: slot * SLOT_MS, slot, source: 'binance', coins: include ? [makeCoin('THE', px)] : [makeCoin('OTHER', 1)] }),
    )
    .join('\n');
const event = (overrides: Partial<SignalNotifyEvent> = {}): SignalNotifyEvent => ({
  type: 'notify',
  v: 3,
  id: 'fb:THE:1',
  attemptedAt: 5 * SLOT_MS + 60_000,
  ts: 5 * SLOT_MS + 5 * 60_000,
  deliveredAt: 5 * SLOT_MS + 5 * 60_000,
  sym: 'THE',
  cls: 'fb',
  px: 100,
  strength: 81,
  via: 'photo',
  messageId: 691,
  legacy: false,
  ...overrides,
});

test('only rows with explicit delivery and Telegram message proof are readable', () => {
  const v1Photo = parseDeliveredSignalObject({ type: 'notify', ts: 1, sym: 'A', cls: 'fb', px: 1, strength: 1, via: 'photo' });
  const unproven = parseDeliveredSignalObject({ type: 'notify', delivered: true, ts: 2, sym: 'B', cls: 'fb', px: 1, strength: 1, via: 'text' });
  const v2 = parseDeliveredSignalObject({ type: 'notify', v: 2, delivered: true, ts: 3, sym: 'C', cls: 'rb', px: 2, strength: 2, via: 'text', messageId: 8 });
  const v3 = parseDeliveredSignalObject({ type: 'notify', v: 3, delivered: true, attemptedAt: 3, ts: 4, deliveredAt: 5, sym: 'D', cls: 'vg', px: 3, strength: 3, via: 'photo', messageId: 9 });
  assert.equal(v1Photo, null);
  assert.equal(unproven, null);
  assert.equal(v2?.ts, 3);
  assert.equal(v2?.messageId, 8);
  assert.equal(v3?.ts, 5, 'deliveredAt is the authoritative success timestamp');
  assert.equal(v3?.messageId, 9);
});

test('shared parser filters symbols, de-duplicates Telegram messages, and preserves delivery order', () => {
  const a = { type: 'notify', v: 3, delivered: true, attemptedAt: 1, ts: 2, deliveredAt: 2, id: 'x', sym: 'THE', cls: 'fb', px: 1, strength: 1, via: 'photo', messageId: 10 };
  const b = { ...a, id: 'y', sym: 'OTHER', deliveredAt: 1 };
  const duplicate = { ...a, id: 'duplicate-audit-row' };
  assert.deepEqual(parseDeliveredSignals([JSON.stringify(b), JSON.stringify(a), JSON.stringify(duplicate)].join('\n'), 'THE').map((x) => x.id), ['x']);
});

test('symbol endpoint returns only notify/watch rows for the requested symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaobi-signal-events-'));
  const prior = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = dir;
  try {
    const recDir = path.join(dir, 'YaobiHunter', 'recordings');
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(
      path.join(recDir, '2026-07-14.jsonl'),
      [
        JSON.stringify({ type: 'notify', delivered: true, ts: 1, sym: 'THE', cls: 'fb', px: 1, strength: 1, via: 'photo' }),
        JSON.stringify({ type: 'notify', delivered: true, ts: 2, sym: 'OTHER', cls: 'fb', px: 1, strength: 1, via: 'photo' }),
        JSON.stringify({ type: 'entry-watch', ts: 3, sym: 'THE', status: 'watching' }),
        JSON.stringify({ v: 4, slot: 1, source: 'binance', coins: [] }),
      ].join('\n'),
    );
    const served = serveSignalEvents('the', '2026-07-14', '2026-07-14');
    assert.equal(served.code, 200);
    assert.equal(served.body.split('\n').filter(Boolean).length, 2);
    assert.doesNotMatch(served.body, /OTHER|"coins"/);
    assert.equal(serveSignalEvents('THE', '2026-01-01', '2026-07-14').code, 413);
  } finally {
    if (prior == null) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mid-slot TG card starts its strict path at the next complete slot', () => {
  const idx = parseRecordings(scans([
    { slot: 5, px: 99 },
    { slot: 6, px: 101 },
    { slot: 7, px: 104 },
    { slot: 8, px: 95 },
  ]));
  const tg = evaluateSignalOutcome(idx, event(), 3, 'tg-card');
  assert.equal(tg.status, 'complete');
  assert.equal(tg.entryPx, 100);
  assert.equal(tg.coverage, 1);
  assert.ok(Math.abs((tg.mfe ?? 0) - 0.04) < 1e-12);
  assert.ok(Math.abs((tg.mae ?? 0) + 0.05) < 1e-12);
  assert.equal(tg.hits?.plus4BeforeMinus3, true);

  const confirmed = evaluateSignalOutcome(idx, event(), 2, 'next-15m');
  assert.equal(confirmed.entryTs, 6 * SLOT_MS);
  assert.equal(confirmed.entryPx, 101);
  assert.ok(Math.abs((confirmed.entrySlippagePct ?? 0) - 1) < 1e-12);
});

test('missing next slot/gap is data-missing, while an unfinished contiguous horizon is pending', () => {
  const missingEntry = parseRecordings(scans([{ slot: 5 }, { slot: 6, include: false }, { slot: 7 }]));
  assert.equal(evaluateSignalOutcome(missingEntry, event(), 1, 'next-15m').status, 'data-missing');

  const gap = parseRecordings(scans([{ slot: 5 }, { slot: 6 }, { slot: 7, include: false }, { slot: 8 }]));
  assert.equal(evaluateSignalOutcome(gap, event(), 3, 'tg-card').status, 'data-missing');

  const pending = parseRecordings(scans([{ slot: 5 }, { slot: 6 }, { slot: 7 }]));
  const outcome = evaluateSignalOutcome(pending, event(), 3, 'tg-card');
  assert.equal(outcome.status, 'pending');
  assert.ok(outcome.coverage > 0 && outcome.coverage < 1);
});

test('exact-slot matching survives a UTC day boundary and multiplier symbols', () => {
  const daySlots = 24 * 4;
  const base = daySlots - 1;
  const lines = [base, base + 1, base + 2]
    .map((slot, index) => JSON.stringify({
      v: 4,
      ts: slot * SLOT_MS,
      slot,
      source: 'binance',
      coins: [makeCoin('1000PEPE', 10 + index)],
    }))
    .join('\n');
  const idx = parseRecordings(lines);
  const multiplier = event({
    id: 'fb:1000PEPE:day-edge',
    sym: '1000PEPE',
    attemptedAt: base * SLOT_MS + 60_000,
    ts: base * SLOT_MS + 2 * 60_000,
    deliveredAt: base * SLOT_MS + 2 * 60_000,
    px: 10,
  });
  const outcome = evaluateSignalOutcome(idx, multiplier, 1, 'next-15m');
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.entryTs, (base + 1) * SLOT_MS);
  assert.equal(outcome.entryPx, 11);
  assert.ok(Math.abs((outcome.ret ?? 0) - (12 / 11 - 1)) < 1e-12);
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SIGNAL EVENT TESTS PASS');
process.exit(failures ? 1 : 0);
