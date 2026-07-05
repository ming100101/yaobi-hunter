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

// TP/SL multipliers mirror analyze()'s ExitPlan (src/lib/analyze.ts) but are
// re-applied to the mark-based entry rather than the structural anchor.
const TP1_MULT = 1.04;
const TP2_MULT = 1.08;
const TP3_MULT = 1.15;
const SL_MULT = 0.97;
// scale-out sizing: TP1 sheds half the original size, TP2 sheds another 0.3;
// TP3 / SL / timeout close whatever remains.
const TP1_FRAC = 0.5;
const TP2_FRAC = 0.3;

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
  const cfg = state.cfg;
  let equity = state.equity;
  const ledger = state.ledger.slice();
  const feeOf = (notional: number) => Math.abs(notional) * (cfg.feePct / 100);

  // ---- 1. mark existing positions ----------------------------------------
  const kept: PaperPosition[] = [];
  for (const src of state.positions) {
    const pos = { ...src };
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
    } else if (P >= pos.tp3) {
      const size = pos.remainingFrac * pos.size;
      const pnl = size * (pos.tp3 - pos.entry) - feeOf(size * pos.tp3);
      equity += pnl;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp3', px: pos.tp3, frac: pos.remainingFrac, pnl, equityAfter: equity });
      pos.remainingFrac = 0;
      terminal = true;
    } else if (P >= pos.tp2 && !pos.tookTp2) {
      const size = TP2_FRAC * pos.size;
      const pnl = size * (pos.tp2 - pos.entry) - feeOf(size * pos.tp2);
      equity += pnl;
      pos.remainingFrac -= TP2_FRAC;
      pos.tookTp2 = true;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp2', px: pos.tp2, frac: TP2_FRAC, pnl, equityAfter: equity });
    } else if (P >= pos.tp1 && !pos.tookTp1) {
      const size = TP1_FRAC * pos.size;
      const pnl = size * (pos.tp1 - pos.entry) - feeOf(size * pos.tp1);
      equity += pnl;
      pos.remainingFrac -= TP1_FRAC;
      pos.tookTp1 = true;
      ledger.push({ ts: nowMs, sym: pos.sym, action: 'tp1', px: pos.tp1, frac: TP1_FRAC, pnl, equityAfter: equity });
    }
    // timeout closes whatever survived the price chain this sweep.
    if (!terminal && pos.remainingFrac > 1e-9 && nowMs - pos.openedTs > cfg.timeoutH * 3600e3) {
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

  // ---- 2. open on rising ⚡ edges -----------------------------------------
  if (cfg.enabled) {
    for (const sym of fbEdges) {
      if (positions.length >= MAX_OPEN) break;
      if (positions.some((p) => p.sym === sym)) continue; // one position per coin
      const entry = marks.get(sym);
      if (entry == null || !Number.isFinite(entry) || entry <= 0) continue;
      const sl = entry * SL_MULT;
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
        tp1: entry * TP1_MULT,
        tp2: entry * TP2_MULT,
        tp3: entry * TP3_MULT,
        sl,
        remainingFrac: 1,
        tookTp1: false,
        tookTp2: false,
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
  };
}

// Reconstruct closed positions by walking the ledger: an 'open' row starts a
// segment for its coin, and because there is at most one open position per coin
// at a time (rule 1 dedup), a 'sl'/'tp3'/'timeout' row terminates it. tp1/tp2 are
// partials that stay in the segment. Stats are recomputed, never stored, so
// stored aggregates can never drift.
export function paperStats(state: PaperState): PaperStats {
  const cfg = state.cfg;
  const open = new Map<string, { pnl: number; r: number }>();
  const closed: number[] = []; // R-multiple per closed position
  const closedPnl: number[] = [];

  for (const row of state.ledger) {
    if (row.action === 'open') {
      // (entry−sl)×size == equityAtOpen × riskPct/100 by construction; equityAtOpen
      // = equityAfter − pnl (pnl on an open row is just −fee).
      const equityAtOpen = row.equityAfter - row.pnl;
      const r = equityAtOpen * (cfg.riskPct / 100);
      open.set(row.sym, { pnl: row.pnl, r: r > 0 ? r : NaN });
      continue;
    }
    const seg = open.get(row.sym);
    if (!seg) continue; // orphan close (shouldn't happen); ignore
    seg.pnl += row.pnl;
    if (row.action === 'sl' || row.action === 'tp3' || row.action === 'timeout') {
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
