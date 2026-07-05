// M3 unit check (amended: 20x bracket exits + position discipline).
// Run: `npm run test-strategy`. All numbers are exact per the spec worked cases.
import { parseRecordings, SLOT_MS } from '../src/lib/evalCore';
import { buildDailyReport, sideStats, type StratDay } from '../src/lib/strategyReport';

let fail = 0;
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const ok = (name: string, cond: boolean, got?: unknown) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  (got ${JSON.stringify(got)})`}`);
};

// slots anchored a couple hours into a local day so a full fixture stays within
// one local day regardless of timezone (dayStartOf uses local midnight).
const SLOT0 = Math.floor(new Date(2026, 6, 1, 2, 0).getTime() / SLOT_MS);
const JULY1 = new Date(2026, 6, 1, 12, 0).getTime(); // "today" for open-position test
const JULY2 = new Date(2026, 6, 2, 12, 0).getTime(); // "final" (past) for the rest

type C = [string, number, number, number]; // [sym, price, str, fb]
const row = (c: C): (string | number)[] => {
  const r: (string | number)[] = new Array(21).fill(0);
  r[0] = c[0]; r[1] = c[1]; r[5] = c[2]; r[6] = 'P'; r[7] = c[3];
  return r;
};
// steps[k] = null (skipped slot → gap) or a list of coin tuples for slot SLOT0+k
function reportDay(steps: (C[] | null)[], nowMs: number): StratDay | null {
  const lines: string[] = [];
  steps.forEach((coins, k) => {
    if (!coins) return;
    const slot = SLOT0 + k;
    lines.push(JSON.stringify({ v: 2, ts: slot * SLOT_MS, slot, source: 'okx', coins: coins.map(row) }));
  });
  return buildDailyReport(parseRecordings(lines.join('\n')), 14, nowMs)[0] ?? null;
}
const find = (arr: { sym: string }[], sym: string) => arr.find((t) => t.sym === sym);

// ---- Fixture A: 20x bracket exits, long + short, non-mirror -----------------
{
  const A: C[][] = [
    [['WIN', 1.0, 50, 0], ['LOSS', 2.0, 50, 0], ['T1SL', 1.0, 50, 0], ['T2SL', 1.0, 50, 0], ['SHRT', 1.0, 50, 0]],
    [['WIN', 1.0, 50, 1], ['LOSS', 2.0, 50, 1], ['T1SL', 1.0, 50, 1], ['T2SL', 1.0, 50, 1], ['SHRT', 1.0, 50, 1]],
    [['WIN', 1.05, 50, 0], ['LOSS', 1.9, 50, 0], ['T1SL', 1.05, 50, 0], ['T2SL', 1.05, 50, 0], ['SHRT', 0.95, 50, 0]],
    [['WIN', 1.1, 50, 0], ['LOSS', 1.9, 50, 0], ['T1SL', 0.95, 50, 0], ['T2SL', 1.1, 50, 0], ['SHRT', 0.9, 50, 0]],
    [['WIN', 1.08, 50, 0], ['LOSS', 1.9, 50, 0], ['T1SL', 0.95, 50, 0], ['T2SL', 0.95, 50, 0], ['SHRT', 0.92, 50, 0]],
  ];
  const d = reportDay(A, JULY2)!;
  ok('A: 5 long + 5 short trades', d.fb.long.length === 5 && d.fb.short.length === 5, [d.fb.long.length, d.fb.short.length]);
  const L = (s: string) => find(d.fb.long, s)!.roi;
  const S = (s: string) => find(d.fb.short, s)!.roi;
  ok('A: WIN long = +1.40 (TP1+TP2+runner)', approx(L('WIN'), 1.4), L('WIN'));
  ok('A: LOSS long = -1.00 (direct SL)', approx(L('LOSS'), -1.0), L('LOSS'));
  ok('A: T1SL long = 0.00 exactly (TP1 then SL)', approx(L('T1SL'), 0), L('T1SL'));
  ok('A: T2SL long = +0.75 (TP1+TP2 then SL)', approx(L('T2SL'), 0.75), L('T2SL'));
  ok('A: SHRT short = +1.40 (mirror path)', approx(S('SHRT'), 1.4), S('SHRT'));
  ok('A: WIN short = -1.00 (long-winner stops the short)', approx(S('WIN'), -1.0), S('WIN'));
  ok('A: non-mirror — WIN long +1.40 ≠ −short', Math.abs(L('WIN') - -S('WIN')) > 0.01, [L('WIN'), S('WIN')]);
  ok('A: final day → runner fill is eod', find(d.fb.long, 'WIN')!.fills.at(-1)!.kind === 'eod');
}

// ---- Fixture D: position discipline (hold blocks re-entry; SL frees it) ------
{
  const D: C[][] = [
    [['HOLD', 1.0, 50, 0], ['FREE', 1.0, 50, 0]],
    [['HOLD', 1.0, 50, 1], ['FREE', 1.0, 50, 1]], // both edge
    [['HOLD', 1.02, 50, 0], ['FREE', 0.95, 50, 0]], // HOLD drifts; FREE stops out
    [['HOLD', 1.0, 50, 0], ['FREE', 1.0, 50, 0]],
    [['HOLD', 1.0, 50, 1], ['FREE', 1.0, 50, 1]], // second edge for both
    [['HOLD', 1.03, 50, 0], ['FREE', 1.05, 50, 0]],
  ];
  const d = reportDay(D, JULY2)!;
  ok('D: HOLD long = 1 trade (runner blocks re-entry)', find(d.fb.long, 'HOLD') ? d.fb.long.filter((t) => t.sym === 'HOLD').length === 1 : false, d.fb.long.filter((t) => t.sym === 'HOLD').length);
  ok('D: FREE long = 2 trades (SL frees re-entry)', d.fb.long.filter((t) => t.sym === 'FREE').length === 2, d.fb.long.filter((t) => t.sym === 'FREE').length);
}

// ---- Fixture C: stablecoins excluded ----------------------------------------
{
  const Cx: C[][] = [
    [['USDC', 1.0, 50, 0]],
    [['USDC', 1.0, 50, 1]],
    [['USDC', 1.05, 50, 0]],
  ];
  ok('C: USDC edge produces no trades', reportDay(Cx, JULY2) === null, 'expected null day');
}

// ---- Fixture B: gap guard (edge after a missing slot is rejected) -----------
{
  const B: (C[] | null)[] = [
    [['CTRL', 1.0, 50, 0], ['GAPPY', 1.0, 50, 0]],
    [['CTRL', 1.0, 50, 1], ['GAPPY', 1.0, 50, 0]], // CTRL edge (prev slot present)
    null, // GAP: slot SLOT0+2 not recorded
    [['CTRL', 1.05, 50, 0], ['GAPPY', 1.0, 50, 1]], // GAPPY edge but slot-1 (the gap) missing
    [['CTRL', 1.05, 50, 0], ['GAPPY', 1.05, 50, 0]],
  ];
  const d = reportDay(B, JULY2)!;
  ok('B: only CTRL trades (GAPPY edge gap-guarded)', d.fb.long.length === 1 && d.fb.long[0].sym === 'CTRL', d.fb.long.map((t) => t.sym));
}

// ---- Fixture E: open position today (unrealized mark) -----------------------
{
  const E: C[][] = [
    [['OPEN', 1.0, 50, 0]],
    [['OPEN', 1.0, 50, 1]],
    [['OPEN', 1.05, 50, 0]], // TP1
    [['OPEN', 1.03, 50, 0]], // runner still open
  ];
  const d = reportDay(E, JULY1)!; // nowMs same local day → in progress
  const t = d.fb.long[0];
  ok('E: today trade is open', t.open === true, t.open);
  ok('E: runner fill is a live mark', t.fills.at(-1)!.kind === 'mark', t.fills.at(-1)!.kind);
  ok('E: open roi = TP1 +0.5 + mark +0.3 = 0.8', approx(t.roi, 0.8), t.roi);
  ok('E: day not final', d.final === false, d.final);
}

// ---- Fixture F: skipped (edge is the coin's last slot that day) -------------
{
  const Fx: C[][] = [
    [['LAST', 1.0, 50, 0], ['FILL', 1.0, 50, 0]],
    [['LAST', 1.0, 50, 1], ['FILL', 1.0, 50, 0]], // LAST edge, but LAST has no later slot
    [['FILL', 1.0, 50, 0]],
  ];
  const d = reportDay(Fx, JULY2)!;
  ok('F: LAST edge counted as skipped', d.fb.skippedLong === 1 && d.fb.long.length === 0, [d.fb.skippedLong, d.fb.long.length]);
}

// ---- sideStats ---------------------------------------------------------------
{
  const A: C[][] = [
    [['WIN', 1.0, 50, 0], ['LOSS', 1.0, 50, 0]],
    [['WIN', 1.0, 50, 1], ['LOSS', 1.0, 50, 1]],
    [['WIN', 1.05, 50, 0], ['LOSS', 0.95, 50, 0]], // WIN→TP1(runner), LOSS→SL
    [['WIN', 1.04, 50, 0], ['LOSS', 0.95, 50, 0]],
  ];
  const d = reportDay(A, JULY2)!;
  const st = sideStats(d.fb.long);
  ok('sideStats n = 2', st.n === 2, st.n);
  ok('sideStats winRate = 0.5', approx(st.winRate, 0.5), st.winRate);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
