// M1 unit check: drive the paper engine through the spec's worked example and
// assert the equity to the cent. Run: `npm run test-paper`.
//
// cfg: equity 10000, riskPct 1, fee 0. Entry 1.000 → sl 0.97, size 100/0.03 =
// 3333.33 units.
//   TP1 @1.04 close 50% → +66.67  (equity 10066.67)
//   TP2 @1.08 close 30% → +80.00  (equity 10146.67)
//   TP3 @1.15 close 20% → +100.00 (equity 10246.67, full winner = +2.47R)
//   straight SL @0.97   → −100.00 (equity 9900.00, −1R exactly)
import { PAPER_ENTRY_POLICY_ID, createPaperState, drivePaper, paperStats } from '../src/lib/paper';
import type { PaperState } from '../src/lib/paper';

let failures = 0;
const approx = (got: number, want: number, eps = 0.005) => Math.abs(got - want) < eps;
function check(name: string, got: number, want: number, eps = 0.005) {
  const ok = approx(got, want, eps);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} got ${got.toFixed(4)}  want ${want.toFixed(4)}`);
}
function checkStr(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} got ${got.padEnd(8)} want ${want}`);
}

const cfg = { startEquity: 10000, riskPct: 1, feePct: 0, timeoutH: 48, enabled: true };
const T0 = 1_783_125_000_000; // fixed base ts (Date.now() is unavailable/irrelevant here)
const SLOT = 15 * 60 * 1000;
const mk = (sym: string, px: number) => new Map([[sym, px]]);
const edge = (sym: string) => new Set([sym]);

// ---- winner path: open → TP1 → TP2 → TP3 --------------------------------
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('DOGE', 1.0), edge('DOGE'), T0); // open @1.00
  check('winner open equity', s.equity, 10000);
  const pos = s.positions[0];
  check('winner size', pos.size, 3333.3333, 0.01);
  check('winner sl', pos.sl, 0.97, 1e-9);
  check('winner tp1', pos.tp1, 1.04, 1e-9);

  s = drivePaper(s, mk('DOGE', 1.04), new Set(), T0 + SLOT); // TP1
  check('after TP1 equity', s.equity, 10066.67);
  s = drivePaper(s, mk('DOGE', 1.08), new Set(), T0 + 2 * SLOT); // TP2
  check('after TP2 equity', s.equity, 10146.67);
  s = drivePaper(s, mk('DOGE', 1.15), new Set(), T0 + 3 * SLOT); // TP3
  check('after TP3 equity', s.equity, 10246.67);
  check('winner positions closed', s.positions.length, 0, 1e-9);

  const st = paperStats(s);
  check('winner winRate', st.winRate, 1, 1e-9);
  check('winner avgR', st.avgR, 2.4667, 0.001);
  check('winner closedCount', st.closedCount, 1, 1e-9);
}

// ---- straight SL --------------------------------------------------------
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('PEPE', 1.0), edge('PEPE'), T0); // open @1.00
  s = drivePaper(s, mk('PEPE', 0.97), new Set(), T0 + SLOT); // SL (tie → SL wins)
  check('after SL equity', s.equity, 9900.0);
  check('SL positions closed', s.positions.length, 0, 1e-9);
  const st = paperStats(s);
  check('SL winRate', st.winRate, 0, 1e-9);
  check('SL avgR', st.avgR, -1, 0.001);
}

// ---- timeout: no price exit, aged past timeoutH → close remaining at P ---
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('WIF', 1.0), edge('WIF'), T0); // open @1.00
  // 49h later, price 1.02 sits between entry and TP1 (no price branch fires)
  s = drivePaper(s, mk('WIF', 1.02), new Set(), T0 + 49 * 3600 * 1000);
  check('after timeout equity', s.equity, 10066.67); // 3333.33 × 0.02
  check('timeout positions closed', s.positions.length, 0, 1e-9);
  checkStr('timeout ledger action', s.ledger[s.ledger.length - 1].action, 'timeout');
}

// ---- mixed win + loss: profit factor, max drawdown, avgR ----------------
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('WIN', 1.0), edge('WIN'), T0); // open @1.00, R=100
  s = drivePaper(s, mk('WIN', 1.15), new Set(), T0 + SLOT); // straight TP3 → +500 (5R)
  check('mixed after win equity', s.equity, 10500.0);
  s = drivePaper(s, mk('LOSS', 1.0), edge('LOSS'), T0 + 2 * SLOT); // open @1.00, R=105
  s = drivePaper(s, mk('LOSS', 0.97), new Set(), T0 + 3 * SLOT); // SL → −105 (−1R)
  check('mixed after loss equity', s.equity, 10395.0);
  const st = paperStats(s);
  check('mixed winRate', st.winRate, 0.5, 1e-9);
  check('mixed profitFactor', st.profitFactor, 500 / 105, 0.001); // grossWins/|grossLosses|
  check('mixed maxDrawdown', st.maxDrawdown, 105 / 10500, 1e-6); // 10500 peak → 10395
  check('mixed avgR', st.avgR, (5 + -1) / 2, 0.001);
}

// ---- invariants: per-coin dedup, max-5 concurrent, curve cadence --------
{
  let s: PaperState = createPaperState(cfg);
  // same coin fires two sweeps running while a position is open → one position.
  s = drivePaper(s, mk('AAA', 2.0), edge('AAA'), T0);
  s = drivePaper(s, new Map([['AAA', 2.01]]), edge('AAA'), T0 + SLOT);
  check('dedup: still one AAA', s.positions.filter((p) => p.sym === 'AAA').length, 1, 1e-9);

  // six distinct rising edges in one sweep → capped at 5 open.
  let c: PaperState = createPaperState(cfg);
  const six = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
  const marks = new Map(six.map((x) => [x, 1] as [string, number]));
  c = drivePaper(c, marks, new Set(six), T0);
  check('max-5 concurrent cap', c.positions.length, 5, 1e-9);
  check('curve: one point per drive', c.curve.length, 1, 1e-9);
}

// ---- C arm (老詹全止盈變體): single all-out TP +9%, far SL −20% ----------
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('MOON', 1.0), edge('MOON'), T0); // opens in A, B and C books
  const c0 = s.armC!;
  check('C open equity', c0.equity, 10000);
  check('C sl', c0.positions[0].sl, 0.8, 1e-9);
  check('C tp3', c0.positions[0].tp3, 1.09, 1e-9);
  check('C size', c0.positions[0].size, 500, 0.001); // 100 risk / 0.20 stop

  // +9% mark → the whole position closes in ONE tp3-branch fill
  s = drivePaper(s, mk('MOON', 1.09), new Set(), T0 + SLOT);
  check('C all-out equity', s.armC!.equity, 10045.0); // 500 × 0.09
  check('C positions closed', s.armC!.positions.length, 0, 1e-9);
  checkStr('C single-fill action', s.armC!.ledger[s.armC!.ledger.length - 1].action, 'tp3');

  // far SL: straight to 0.80 = exactly −1R
  let s2: PaperState = createPaperState(cfg);
  s2 = drivePaper(s2, mk('RUG', 1.0), edge('RUG'), T0);
  s2 = drivePaper(s2, mk('RUG', 0.8), new Set(), T0 + SLOT);
  check('C far-SL equity', s2.armC!.equity, 9900.0);
  check('C SL avgR', paperStats(s2.armC!).avgR, -1, 0.001);
}

// ---- confirmed entry book: queue now, fill next observed 15m sweep ---------
{
  let s: PaperState = createPaperState(cfg);
  s = drivePaper(s, mk('WAIT', 1.0), edge('WAIT'), T0);
  check('confirmed no same-bar fill', s.confirmed!.positions.length, 0, 1e-9);
  check('confirmed queues signal', s.confirmed!.pending!.length, 1, 1e-9);
  s = drivePaper(s, mk('WAIT', 1.02), new Set(), T0 + SLOT);
  check('confirmed next-bar fill', s.confirmed!.positions[0].entry, 1.02, 1e-9);
  check('confirmed queue consumed', s.confirmed!.pending!.length, 0, 1e-9);
  check('confirmed signal price frozen', s.confirmed!.positions[0].signalPx!, 1.0, 1e-9);
  checkStr('confirmed policy frozen', s.confirmed!.positions[0].entryPolicyId!, PAPER_ENTRY_POLICY_ID);
  const fillAudit = s.confirmed!.entryAudit!.find((r) => r.action === 'filled')!;
  check('confirmed fill delay', fillAudit.delayMin!, 15, 1e-9);
  check('confirmed fill slippage', fillAudit.slippagePct!, 2, 1e-9);

  let expired: PaperState = createPaperState(cfg);
  expired = drivePaper(expired, mk('LATE', 1.0), edge('LATE'), T0);
  expired = drivePaper(expired, mk('LATE', 0.99), new Set(), T0 + 60 * 60 * 1000);
  check('confirmed gap expires', expired.confirmed!.positions.length, 0, 1e-9);
  check('confirmed expired queue empty', expired.confirmed!.pending!.length, 0, 1e-9);
  check(
    'confirmed expiry audited',
    expired.confirmed!.entryAudit!.filter((r) => r.action === 'expired').length,
    1,
    1e-9,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
