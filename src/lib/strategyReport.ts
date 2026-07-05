import type { RecCoin } from './recording';
import { F, SLOT_MS, risingEdges, type EdgeEvent, type RecIndex } from './evalCore';

// Daily-strategy report over recorded sweeps (M3, amended 2026-07-04).
//
// Two strategies — ⚡ 縮倉突破 (row FB=1) and 強度≥70 crossing — each simulated
// LONG and SHORT INDEPENDENTLY as a 20x-leverage isolated-margin position:
//   TP1  幣價 ±5%  → ROI +100% on the half closed  (出本金:平一半倉)
//   TP2  幣價 ±10% → ROI +200% on the quarter closed(平餘下嘅一半)
//   SL   幣價 ∓5%  → ROI −100% on whatever remains  (爆倉式清零)
//   runner (last 25%) rides to the day's close (or is marked live for today).
// Long and short share TP/SL PARAMETERS but each walks the real 15-min price
// path, so their results are genuinely asymmetric (not a −1 mirror). Fills use
// the trigger LEVEL price; SL wins ties (conservative, we only see 15-min
// closes). Equal-weight: 1 margin unit per trade, ROI in margin units
// (+1.0 = +100% of the bet's margin).
//
// Entry uses M1's position discipline: one live position per (strategy, side,
// coin) — a new rising edge while a runner is still open is ignored; only after
// a full SL close can the same coin re-enter that day. Two guards on top:
//   • gap guard  — an edge counts only if the immediately-prior 15-min slot was
//                  recorded (after a recorder gap we can't trust the off→on).
//   • stablecoins are excluded (USDC etc. — flat, pure noise).
// No I/O, no React.

const LEV = 20;
const TP1 = 0.05; // +5% favorable price move → TP1 level
const TP2 = 0.1; // +10% → TP2 level
const SL = 0.05; // -5% favorable → stop (−100% on remaining at 20x)
const TP_CLOSE = 0.5; // close half the REMAINING position at each TP level
const EPS = 1e-9; // trigger tolerance so an exact ±5%/±10% touch isn't lost to float dust
const DAY_MS = 24 * 3600 * 1000;

// Perp bases that are stablecoins — never a strategy entry (flat price = noise).
export const STABLE_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDE', 'USDP', 'PYUSD', 'BUSD', 'USDD', 'GUSD', 'EURT',
]);

export type FillKind = 'tp1' | 'tp2' | 'sl' | 'eod' | 'mark';
export interface Fill {
  kind: FillKind;
  ts: number;
  px: number; // fill price (trigger level for tp/sl; close for eod/mark)
  roi: number; // ROI contribution in margin units
}
export interface StratTrade {
  sym: string;
  side: 'long' | 'short';
  entryTs: number;
  entry: number;
  fills: Fill[];
  roi: number; // realized + (for open) unrealized, margin units
  open: boolean; // still holding a runner at the latest slot (today only)
}
export interface StratSide {
  long: StratTrade[];
  short: StratTrade[];
  skippedLong: number;
  skippedShort: number;
}
export interface StratDay {
  dayStartMs: number;
  final: boolean; // false = today, still in progress
  fb: StratSide;
  s70: StratSide;
}
export interface SideStats {
  n: number;
  winRate: number; // 0..1, ROI > 0
  sum: number; // total ROI (margin units)
  mean: number;
}

function dayStartOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Walk one position from its entry slot to the day's end (or an SL). Returns null
// when the edge is the coin's last slot that day (no forward path → skipped).
function walkTrade(
  pm: Map<number, number> | undefined,
  entrySlot: number,
  entry: number,
  side: 'long' | 'short',
  dayEndSlot: number,
  final: boolean,
): StratTrade | null {
  if (!pm || !(entry > 0)) return null;
  const sign = side === 'long' ? 1 : -1;
  let rem = 1;
  let tp1 = false;
  let tp2 = false;
  const fills: Fill[] = [];
  let hadForward = false;
  let lastPx = entry;
  let lastSlot = entrySlot;

  for (const [slot, px] of pm) {
    if (slot <= entrySlot || slot >= dayEndSlot || !(px > 0)) continue;
    hadForward = true;
    lastPx = px;
    lastSlot = slot;
    const fav = sign * (px / entry - 1); // favorable move fraction
    const ts = slot * SLOT_MS;
    if (fav <= -SL + EPS) {
      fills.push({ kind: 'sl', ts, px: entry * (1 - sign * SL), roi: LEV * -SL * rem });
      rem = 0;
      break; // full stop, position flat
    }
    if (!tp1 && fav >= TP1 - EPS) {
      const cf = TP_CLOSE * rem;
      fills.push({ kind: 'tp1', ts, px: entry * (1 + sign * TP1), roi: LEV * TP1 * cf });
      rem -= cf;
      tp1 = true;
    }
    if (!tp2 && fav >= TP2 - EPS) {
      const cf = TP_CLOSE * rem;
      fills.push({ kind: 'tp2', ts, px: entry * (1 + sign * TP2), roi: LEV * TP2 * cf });
      rem -= cf;
      tp2 = true;
    }
  }

  if (!hadForward) return null; // no path this day → skipped
  if (rem > 1e-12) {
    const favEnd = sign * (lastPx / entry - 1);
    fills.push({ kind: final ? 'eod' : 'mark', ts: lastSlot * SLOT_MS, px: lastPx, roi: LEV * favEnd * rem });
  }
  return {
    sym: '',
    side,
    entryTs: entrySlot * SLOT_MS,
    entry,
    fills,
    roi: fills.reduce((s, f) => s + f.roi, 0),
    open: !final && rem > 1e-12,
  };
}

// Simulate one side (long/short) over a pre-filtered, slot-ascending edge stream.
// M1 position rule: one live position per (day, coin); a runner blocks re-entry
// until a full SL close frees the coin (busyUntil = SL slot; a TP'd runner rides
// to EOD → busyUntil = Infinity, no same-day re-entry).
function simulateSide(
  edges: EdgeEvent[],
  side: 'long' | 'short',
  idx: RecIndex,
  todayStart: number,
): Map<number, { trades: StratTrade[]; skipped: number }> {
  const byDay = new Map<number, { trades: StratTrade[]; skipped: number }>();
  const busyUntil = new Map<string, number>(); // `${day}|${sym}` -> slot busy through
  for (const e of edges) {
    const day = dayStartOf(e.ts);
    const key = `${day}|${e.sym}`;
    if (e.slot <= (busyUntil.get(key) ?? -1)) continue; // still holding
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = { trades: [], skipped: 0 };
      byDay.set(day, bucket);
    }
    const dayEndSlot = (day + DAY_MS) / SLOT_MS;
    const t = walkTrade(idx.priceAt.get(e.sym), e.slot, e.price, side, dayEndSlot, day !== todayStart);
    if (!t) {
      bucket.skipped++;
      continue;
    }
    t.sym = e.sym;
    bucket.trades.push(t);
    const sl = t.fills.find((f) => f.kind === 'sl');
    busyUntil.set(key, sl ? sl.ts / SLOT_MS : Infinity);
  }
  return byDay;
}

// Newest → oldest, only days that actually have edges, capped at `days`. Today is
// marked `final: false`. Long and short are independent simulations.
export function buildDailyReport(idx: RecIndex, days: number, nowMs: number): StratDay[] {
  const todayStart = dayStartOf(nowMs);
  const slotSet = new Set(idx.slots);
  const prep = (edges: EdgeEvent[]) =>
    edges.filter((e) => !STABLE_BASES.has(e.sym) && slotSet.has(e.slot - 1)); // stablecoin + gap guard

  const fbEdges = prep(risingEdges(idx, (r: RecCoin) => r[F.FB] === 1));
  const s70Edges = prep(risingEdges(idx, (r: RecCoin) => (r[F.STR] as number) >= 70));
  const fbL = simulateSide(fbEdges, 'long', idx, todayStart);
  const fbS = simulateSide(fbEdges, 'short', idx, todayStart);
  const sL = simulateSide(s70Edges, 'long', idx, todayStart);
  const sS = simulateSide(s70Edges, 'short', idx, todayStart);

  const bucket = (m: Map<number, { trades: StratTrade[]; skipped: number }>, day: number) =>
    m.get(day) ?? { trades: [], skipped: 0 };
  const sideFor = (
    long: Map<number, { trades: StratTrade[]; skipped: number }>,
    short: Map<number, { trades: StratTrade[]; skipped: number }>,
    day: number,
  ): StratSide => {
    const l = bucket(long, day);
    const s = bucket(short, day);
    return { long: l.trades, short: s.trades, skippedLong: l.skipped, skippedShort: s.skipped };
  };

  return [...new Set([...fbL.keys(), ...fbS.keys(), ...sL.keys(), ...sS.keys()])]
    .sort((a, b) => b - a)
    .slice(0, days)
    .map((day) => ({
      dayStartMs: day,
      final: day !== todayStart,
      fb: sideFor(fbL, fbS, day),
      s70: sideFor(sL, sS, day),
    }));
}

export function sideStats(trades: StratTrade[]): SideStats {
  const n = trades.length;
  if (!n) return { n: 0, winRate: 0, sum: 0, mean: 0 };
  const rois = trades.map((t) => t.roi);
  const sum = rois.reduce((a, b) => a + b, 0);
  return { n, winRate: rois.filter((r) => r > 0).length / n, sum, mean: sum / n };
}
