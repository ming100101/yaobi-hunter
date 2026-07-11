import type { CoinLite } from '../types';

// Paper-trading engine (M1) — pure logic, NO I/O. Both the browser sweep
// callback and the headless recorder call drivePaper() once per completed sweep
// with the same kv-persisted state, so app-open and app-closed accrue into ONE
// virtual ledger. This is the T1 unlock gate: ≥1 month of positive paper P&L is
// required before any real-money mode is discussed.
//
// Marks are 15-min sweep closes — intra-slot touches of TP/SL are invisible, so
// results UNDERSTATE TP hits and MISS some SLs; the SL-first tie/gap rule keeps
// the bias conservative. Entry is mark-based (the coin's CURRENT lastPrice at
// signal time), NOT the structural plan entry, so the sim is honest about what a
// market order at ⚡ time would actually get.

// M4: exit-ladder arms over the SAME entry signals — the comparison is the
// exit philosophy, never the entries. A = the original shallow ladder (mirrors
// analyze()'s ExitPlan); B = the 老詹 ladder (+10/+25/+50, hard SL −15, scale
// out 30/30/35, 5% moonbag rides until SL/timeout, timeout ×2 for the wide
// targets); C = the 老詹試用群 2026-07-06 full-TP variant (「全部設定8-10%就全
// 止盈,吃第一段就跑」+「止損一定都很遠…逐倉五倍開,爆倉價就是止損價」):
// single all-out TP at +9% (mid of his 8-10%), far SL −20% ≈ 5x isolated-margin
// liquidation proxy, timeout ×2 because far stops need time. His win-rate claim
// gets measured here, not believed. T1's unlock clock stays on arm A until a
// ladder is promoted.
export type PaperArm = 'A' | 'B' | 'C';
interface Ladder {
  tp: [number, number, number]; // price multipliers
  sl: number;
  fracs: [number, number, number | null]; // tp3 null = close ALL at tp3 (no moonbag)
  timeoutMult: number;
  beAfterTp1?: boolean; // 老詹 2026-07-06 batch: 「TP1 後止損移至開倉價」— SL jumps to breakeven once TP1 fills
}
const LADDERS: Record<PaperArm, Ladder> = {
  A: { tp: [1.04, 1.08, 1.15], sl: 0.97, fracs: [0.5, 0.3, null], timeoutMult: 1 },
  B: { tp: [1.1, 1.25, 1.5], sl: 0.85, fracs: [0.3, 0.3, 0.35], timeoutMult: 2, beAfterTp1: true },
  // all three TPs collapse to the same price: price ≥ tp3 closes EVERYTHING in
  // the tp3 branch (fracs[2] = null), giving single-TP semantics without a new
  // code path. tp1/tp2 branches are unreachable (same price, tp3 checked first).
  C: { tp: [1.09, 1.09, 1.09], sl: 0.8, fracs: [0, 0, null], timeoutMult: 2 },
};

const MAX_OPEN = 5;
const LEDGER_CAP = 2000;
const CURVE_CAP = 5000;

export interface PaperCfg {
  startEquity: number;
  riskPct: number;
  feePct: number;
  timeoutH: number;
  enabled: boolean;
}

export interface PaperPosition {
  id: string; // `${sym}-${openedTs}`
  sym: string;
  openedTs: number;
  entry: number;
  size: number; // ORIGINAL size in coin units
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  remainingFrac: number; // fraction of the original size still open (1 → 0)
  tookTp1: boolean;
  tookTp2: boolean;
  tookTp3?: boolean; // M4: B-arm tp3 is a PARTIAL (moonbag stays); absent on legacy A rows
  arm?: PaperArm; // absent = legacy A position
}

export type PaperAction = 'open' | 'tp1' | 'tp2' | 'tp3' | 'sl' | 'timeout';

export interface PaperLedgerRow {
  ts: number;
  sym: string;
  action: PaperAction;
  px: number; // fill price
  frac: number; // fraction of ORIGINAL size this fill covers (open = 1)
  pnl: number; // realized P&L of this fill, already net of its fee
  equityAfter: number;
}

export interface PaperState {
  cfg: PaperCfg;
  equity: number;
  positions: PaperPosition[];
  ledger: PaperLedgerRow[];
  curve: [number, number][]; // [tsMs, equity], one point per driven sweep
  lastDriverTs: number;
  driver: 'app' | 'recorder' | '';
  // M4: the B-arm (老詹 ladder) sub-book — same entries, own equity/ledger/curve.
  // Absent on pre-M4 states; created fresh on the first driven sweep. Never nested.
  armB?: PaperState;
  // C-arm (老詹全止盈變體, clock start 2026-07-06) — same rules as armB.
  armC?: PaperState;
}

export interface PaperStats {
  equity: number;
  retPct: number; // equity vs startEquity, %
  openCount: number;
  closedCount: number;
  winRate: number; // 0..1 over closed positions
  profitFactor: number; // grossWins / |grossLosses|; Infinity if no losses
  maxDrawdown: number; // 0..1 fraction, peak-to-trough on the equity curve
  avgR: number; // mean R-multiple over closed positions
}

export const DEFAULT_PAPER_CFG: PaperCfg = {
  startEquity: 10000,
  riskPct: 1,
  feePct: 0.05,
  timeoutH: 48,
  enabled: true,
};

// Fresh state from a config (first run, before any sweep has driven).
export function createPaperState(cfg: PaperCfg = DEFAULT_PAPER_CFG): PaperState {
  return {
    cfg,
    equity: cfg.startEquity,
    positions: [],
    ledger: [],
    curve: [],
    lastDriverTs: 0,
    driver: '',
  };
}

// The set of coins whose ⚡ 縮倉突破 fired on a RISING edge this sweep (off last
// sweep → on now). Callers own edge detection because each context already
// tracks previous-sweep ⚡ state differently (recorder: prevFb set; browser:
// signal-times .fb). Kept here so both compute the same definition.
export function risingFbEdges(coins: CoinLite[], prevFb: Set<string>): Set<string> {
  const edges = new Set<string>();
  for (const c of coins) if (c.flushBreakout && !prevFb.has(c.symbol)) edges.add(c.symbol);
  return edges;
}

// The full set of ⚡ symbols this sweep — recorder/browser thread this back in as
// next sweep's prevFb.
export function currentFbSet(coins: CoinLite[]): Set<string> {
  const s = new Set<string>();
  for (const c of coins) if (c.flushBreakout) s.add(c.symbol);
  return s;
}

// Advance the paper book by ONE sweep. Pure: returns a new state, never mutates
// the input. `marks` = sym → current lastPrice for this sweep; `fbEdges` = coins
// to open on (rising ⚡ edge, deduped by the caller); `nowMs` = sweep timestamp.
// Order: mark/close existing positions FIRST, then open new ones, so a coin that
// exits this sweep can only re-open next sweep. Appends exactly one equity-curve
// point per call.
export function drivePaper(
  state: PaperState,
  marks: Map<string, number>,
  fbEdges: Set<string>,
  nowMs: number,
): PaperState {
  const next = driveBook(state, marks, fbEdges, nowMs, 'A');
  // M4: drive the B/C-arm sub-books on the SAME marks/edges. Pre-existing
  // states without an arm start it fresh here (A history untouched, that arm's
  // clock starts on its first driven sweep).
  const prevB = state.armB ?? createPaperState(state.cfg);
  next.armB = driveBook(prevB, marks, fbEdges, nowMs, 'B');
  const prevC = state.armC ?? createPaperState(state.cfg);
  next.armC = driveBook(prevC, marks, fbEdges, nowMs, 'C');
  return next;
}

function driveBook(
  state: PaperState,
  marks: Map<string, number>,
  fbEdges: Set<string>,
  nowMs: number,
  arm: PaperArm,
): PaperState {
  const cfg = state.cfg;
  const lad = LADDERS[arm];
  let equity = state.equity;
  const ledger = state.ledger.slice();
  const feeOf = (notional: number) => Math.abs(notional) * (cfg.feePct / 100);

  // ---- 1. mark existing positions ----------------------------------------
  const kept: PaperPosition[] = [];
  for (const src of state.positions) {
    const pos = { ...src };
    const posLad = LADDERS[pos.arm ?? 'A']; // fracs by the position's own arm (legacy = A)
    const P = marks.get(pos.sym);
    if (P == null || !Number.isFinite(P) || P <= 0) {
      kept.push(pos); // no price this sweep — leave it open, unmarked
      continue;
    }
    let terminal = false;
    // price-based exits: at most one branch fires (SL wins ties/gaps).
    if (P <= pos.sl) {
      const size = pos.remainingFrac * pos.size;
      const pnl = size * (pos.sl - pos.entry) - feeOf(size * pos.sl);
      equity += pnl;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'sl', px: pos.sl, frac: pos.remainingFrac, pnl, equityAfter: equity });
      pos.remainingFrac = 0;
      terminal = true;
    } else if (P >= pos.tp3 && !pos.tookTp3) {
      // A (fracs[2]=null): close everything. B: shed 0.35, the 5% moonbag rides
      // until SL/timeout — 老詹's 夢想倉.
      const frac = posLad.fracs[2] == null ? pos.remainingFrac : Math.min(posLad.fracs[2], pos.remainingFrac);
      const size = frac * pos.size;
      const pnl = size * (pos.tp3 - pos.entry) - feeOf(size * pos.tp3);
      equity += pnl;
      pos.remainingFrac -= frac;
      pos.tookTp3 = true;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp3', px: pos.tp3, frac, pnl, equityAfter: equity });
      terminal = pos.remainingFrac <= 1e-9;
    } else if (P >= pos.tp2 && !pos.tookTp2) {
      const frac = Math.min(posLad.fracs[1], pos.remainingFrac);
      const size = frac * pos.size;
      const pnl = size * (pos.tp2 - pos.entry) - feeOf(size * pos.tp2);
      equity += pnl;
      pos.remainingFrac -= frac;
      pos.tookTp2 = true;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp2', px: pos.tp2, frac, pnl, equityAfter: equity });
    } else if (P >= pos.tp1 && !pos.tookTp1) {
      const frac = Math.min(posLad.fracs[0], pos.remainingFrac);
      const size = frac * pos.size;
      const pnl = size * (pos.tp1 - pos.entry) - feeOf(size * pos.tp1);
      equity += pnl;
      pos.remainingFrac -= frac;
      pos.tookTp1 = true;
      // 老詹 rule (B arm): once TP1 fills, the stop jumps to breakeven — the
      // remaining 70% can no longer turn the trade into a −15% loser.
      if (posLad.beAfterTp1) pos.sl = Math.max(pos.sl, pos.entry);
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp1', px: pos.tp1, frac, pnl, equityAfter: equity });
    }
    // timeout closes whatever survived the price chain this sweep.
    if (!terminal && pos.remainingFrac > 1e-9 && nowMs - pos.openedTs > cfg.timeoutH * posLad.timeoutMult * 3600e3) {
      const size = pos.remainingFrac * pos.size;
      const pnl = size * (P - pos.entry) - feeOf(size * P);
      equity += pnl;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'timeout', px: P, frac: pos.remainingFrac, pnl, equityAfter: equity });
      pos.remainingFrac = 0;
      terminal = true;
    }
    if (pos.remainingFrac > 1e-9) kept.push(pos);
  }
  const positions = kept;

  // ---- 2. open on rising ⚡ edges (identical entries in both arms) ---------
  if (cfg.enabled) {
    for (const sym of fbEdges) {
      if (positions.length >= MAX_OPEN) break; // per-book cap — arms never steal slots
      if (positions.some((p) => p.sym === sym)) continue; // one position per coin
      const entry = marks.get(sym);
      if (entry == null || !Number.isFinite(entry) || entry <= 0) continue;
      const sl = entry * lad.sl;
      const size = (equity * (cfg.riskPct / 100)) / (entry - sl);
      if (!Number.isFinite(size) || size <= 0) continue;
      const openFee = feeOf(entry * size);
      equity -= openFee;
      positions.push({
        id: `${sym}-${nowMs}`,
        sym,
        openedTs: nowMs,
        entry,
        size,
        tp1: entry * lad.tp[0],
        tp2: entry * lad.tp[1],
        tp3: entry * lad.tp[2],
        sl,
        remainingFrac: 1,
        tookTp1: false,
        tookTp2: false,
        tookTp3: false,
        arm,
      });
      ledger.push({ ts: nowMs, sym, action: 'open', px: entry, frac: 1, pnl: -openFee, equityAfter: equity });
    }
  }

  // ---- 3. equity curve: one point per driven sweep -----------------------
  const curve = state.curve.slice();
  curve.push([nowMs, equity]);

  return {
    ...state,
    equity,
    positions,
    ledger: ledger.length > LEDGER_CAP ? ledger.slice(ledger.length - LEDGER_CAP) : ledger,
    curve: curve.length > CURVE_CAP ? curve.slice(curve.length - CURVE_CAP) : curve,
    armB: undefined, // set only by drivePaper on the top-level book; never nested
    armC: undefined,
  };
}

// ---- 交易簿 (blotter) — position-grouped fill history -----------------------
// Same ledger walk as paperStats below (one open position per coin at a time),
// but returning the per-position rows the 記錄 tab renders and exports. Pure
// reconstruction from the ledger — never stored, so it can't drift from stats.
export interface BlotterFill {
  action: PaperAction;
  ts: number;
  px: number;
  frac: number; // fraction of the ORIGINAL size this fill covers
  pnl: number; // realized P&L of the fill, net of its fee
}
export interface BlotterPos {
  sym: string;
  openTs: number;
  entry: number;
  riskUsd: number; // equityAtOpen × riskPct — the objective bet size (1R)
  fills: BlotterFill[]; // exits only, in fill order
  pnl: number; // realized so far (includes the open fee)
  r: number | null; // pnl / riskUsd; null while risk can't be derived
  closed: boolean;
  remainingFrac: number; // > 0 ⇒ still holding
}

export function paperBlotter(state: PaperState): BlotterPos[] {
  const riskPct = state.cfg.riskPct;
  const open = new Map<string, BlotterPos>();
  const out: BlotterPos[] = [];
  for (const row of state.ledger) {
    if (row.action === 'open') {
      const equityAtOpen = row.equityAfter - row.pnl; // pnl on an open row = −fee
      const risk = equityAtOpen * (riskPct / 100);
      open.set(row.sym, {
        sym: row.sym,
        openTs: row.ts,
        entry: row.px,
        riskUsd: risk > 0 ? risk : 0,
        fills: [],
        pnl: row.pnl,
        r: null,
        closed: false,
        remainingFrac: 1,
      });
      continue;
    }
    const pos = open.get(row.sym);
    if (!pos) continue; // orphan close (pre-cap ledger truncation); skip
    pos.fills.push({ action: row.action, ts: row.ts, px: row.px, frac: row.frac, pnl: row.pnl });
    pos.pnl += row.pnl;
    pos.remainingFrac = Math.max(0, pos.remainingFrac - row.frac);
    if (pos.remainingFrac <= 1e-3) {
      pos.closed = true;
      pos.remainingFrac = 0;
      pos.r = pos.riskUsd > 0 ? pos.pnl / pos.riskUsd : null;
      out.push(pos);
      open.delete(row.sym);
    }
  }
  for (const pos of open.values()) {
    pos.r = pos.riskUsd > 0 ? pos.pnl / pos.riskUsd : null; // realized-so-far R
    out.push(pos);
  }
  return out.sort((a, b) => b.openTs - a.openTs); // newest first
}

// Reconstruct closed positions by walking the ledger: an 'open' row starts a
// segment for its coin, and because there is at most one open position per coin
// at a time (rule 1 dedup), a 'sl'/'tp3'/'timeout' row terminates it. tp1/tp2 are
// partials that stay in the segment. Stats are recomputed, never stored, so
// stored aggregates can never drift.
export function paperStats(state: PaperState): PaperStats {
  const cfg = state.cfg;
  const open = new Map<string, { pnl: number; r: number; frac: number }>();
  const closed: number[] = []; // R-multiple per closed position
  const closedPnl: number[] = [];

  for (const row of state.ledger) {
    if (row.action === 'open') {
      // (entry−sl)×size == equityAtOpen × riskPct/100 by construction; equityAtOpen
      // = equityAfter − pnl (pnl on an open row is just −fee).
      const equityAtOpen = row.equityAfter - row.pnl;
      const r = equityAtOpen * (cfg.riskPct / 100);
      open.set(row.sym, { pnl: row.pnl, r: r > 0 ? r : NaN, frac: 0 });
      continue;
    }
    const seg = open.get(row.sym);
    if (!seg) continue; // orphan close (shouldn't happen); ignore
    seg.pnl += row.pnl;
    seg.frac += row.frac;
    // a position is closed when its cumulative closed fraction reaches 1 — NOT
    // on the action name: the B arm's tp3 is a PARTIAL (moonbag rides on until
    // sl/timeout), so 'tp3' alone no longer implies terminal.
    if (seg.frac >= 0.999) {
      closedPnl.push(seg.pnl);
      closed.push(Number.isFinite(seg.r) ? seg.pnl / seg.r : 0);
      open.delete(row.sym);
    }
  }

  const wins = closedPnl.filter((p) => p > 0);
  const losses = closedPnl.filter((p) => p < 0);
  const grossWins = wins.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(losses.reduce((a, b) => a + b, 0));

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const [, eq] of state.curve) {
    if (eq > peak) peak = eq;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - eq) / peak);
  }

  return {
    equity: state.equity,
    retPct: cfg.startEquity > 0 ? (state.equity / cfg.startEquity - 1) * 100 : 0,
    openCount: state.positions.length,
    closedCount: closedPnl.length,
    winRate: closedPnl.length ? wins.length / closedPnl.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    maxDrawdown,
    avgR: closed.length ? closed.reduce((a, b) => a + b, 0) / closed.length : 0,
  };
}
