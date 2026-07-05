// Unit check for the 24h Signal Read log (src/lib/signalLog.ts): a read must
// persist for 24h from first detection even after it goes inactive, dedupe by
// id, freeze its detected time, expire at 24h, and re-fire fresh afterwards.
// Run: `npm run test-signal-log`.
import { mergeSignals } from '../src/lib/signalLog';
import type { InsightTone } from '../src/lib/interpret';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  (got ${JSON.stringify(got)})`}`);
};
const ins = (id: string, atTime = 1_000_000) => ({ id, title: id, detail: '', tone: 'info' as InsightTone, priority: 5, atTime });
const ids = (arr: { id: string }[]) => arr.map((i) => i.id).sort().join(',');

const HR = 3600_000;
const T0 = 1_700_000_000_000;

// 1. first detection of A + B
let r = mergeSignals('X', [ins('A'), ins('B')], T0);
ok('detects A + B', ids(r) === 'A,B', ids(r));

// 2. B drops out of the live set (e.g. strength fell) — it must stay
r = mergeSignals('X', [ins('A')], T0 + 60_000);
ok('B kept after going inactive', ids(r) === 'A,B', ids(r));

// 3. detected time is frozen at first detection (B keeps its original atTime)
r = mergeSignals('X', [ins('A')], T0 + 2 * HR);
const b = r.find((i) => i.id === 'B');
ok('B detected time frozen', b?.atTime === 1_000_000, b?.atTime);

// 4. dedup — re-firing A within the window does not duplicate it
r = mergeSignals('X', [ins('A'), ins('A')], T0 + 3 * HR);
ok('no dupes, still A + B', ids(r) === 'A,B' && r.length === 2, r.length);

// 5. at 23h nothing live — both still kept
r = mergeSignals('X', [], T0 + 23 * HR);
ok('both kept at 23h', ids(r) === 'A,B', ids(r));

// 6. at 25h — both expired
r = mergeSignals('X', [], T0 + 25 * HR);
ok('both expired at 25h', r.length === 0, r.length);

// 7. A re-fires after expiry → fresh entry
r = mergeSignals('X', [ins('A')], T0 + 26 * HR);
ok('A re-fires fresh after expiry', ids(r) === 'A', ids(r));

// 8. per-symbol isolation
mergeSignals('Y', [ins('Z')], T0 + 26 * HR);
r = mergeSignals('X', [ins('A')], T0 + 26 * HR + 1000);
ok('symbols isolated (X has no Z)', ids(r) === 'A', ids(r));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
