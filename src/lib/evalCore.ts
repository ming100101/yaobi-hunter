import type { RecCoin, ScanRecord } from './recording';

// Browser-safe core of the recorded-signal analysis: parse concatenated JSONL
// into a per-symbol index, and sample state rising-edges over it. Shared by the
// CLI (scripts/eval-recordings.ts, which adds fs I/O) and the in-app 策略/記錄
// tabs (which fetch text from /recordings) — ONE implementation so the two never
// drift into two truths. (M2 later moves forward/summarize/STATES here too.)

export const SLOT_MS = 15 * 60 * 1000;

// Column indexes into a v2+ recording row (see recording.ts RecCoin).
export const F = {
  SYM: 0, PRICE: 1, FUND: 3, STR: 5, FB: 7, EA: 8,
  VOL24H: 9, RET4H: 11, BUYSHARE: 13, SPOTVOL: 19, BASIS: 20,
  TAKERBUY: 28,
  SPOT_TAKERBUY: 29,
  EARLY: 24, // S14 早期拉盤 fired (v4; v3-and-earlier rows read undefined → state off)
} as const;

export interface RecIndex {
  slots: number[]; // ascending unique 15-min slot indexes
  bySlot: Map<number, ScanRecord>;
  priceAt: Map<string, Map<number, number>>; // sym -> slot -> recorded price
  rowAt: Map<string, Map<number, RecCoin>>; // sym -> slot -> full row
  top10At: Map<number, Set<string>>; // slot -> top-10 symbols by strength
  sourcesPresent: Array<'okx' | 'binance'>; // which live eras appear (for the seam filter / UI selector)
  regimeAt: Map<number, 'up' | 'down' | 'chop'>; // E3: slot -> BTC regime (from sweep-meta btcRegime); untagged slots absent
}

export type Regime3 = 'up' | 'down' | 'chop'; // E3 BTC regime filter

// Which live era a lift analysis runs over. The OKX→Binance migration (2026-07-07)
// is a venue seam: forward returns and baselines must NOT aggregate across it (the
// ROADMAP 統計 seam rule). 'auto' = the newest era present, so a lift view never
// straddles the seam by default; 'all' is the deliberate blended view.
export type EvalSource = 'auto' | 'all' | 'okx' | 'binance';

// Parse concatenated JSONL text (as /recordings serves, or files concatenated by
// the CLI) into the index. Defensive: malformed lines skipped, sweep-meta lines
// ignored (they carry no coin rows), only live sources kept ('okx' = pre-
// 2026-07-07 era, 'binance' = current; lift analyses can split on rec.source at
// the migration seam), last-write-wins per slot.
export function parseRecordings(text: string): RecIndex {
  const bySlot = new Map<number, ScanRecord>();
  const regimeAt = new Map<number, 'up' | 'down' | 'chop'>(); // E3
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as ScanRecord & { type?: string; btcRegime?: 'up' | 'down' | 'chop' };
      if (rec.type) {
        // E3: capture the BTC regime tag off the sweep-meta line before skipping it
        if (rec.type === 'sweep-meta' && rec.btcRegime) regimeAt.set(rec.slot, rec.btcRegime);
        continue; // sweep-meta completeness line, not coin data
      }
      if ((rec.source === 'okx' || rec.source === 'binance') && Array.isArray(rec.coins)) bySlot.set(rec.slot, rec); // last write wins
    } catch {
      /* skip malformed */
    }
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const seenSrc = new Set<'okx' | 'binance'>();
  for (const rec of bySlot.values()) if (rec.source === 'okx' || rec.source === 'binance') seenSrc.add(rec.source);
  const sourcesPresent = (['okx', 'binance'] as const).filter((s) => seenSrc.has(s));
  const priceAt = new Map<string, Map<number, number>>();
  const rowAt = new Map<string, Map<number, RecCoin>>();
  const top10At = new Map<number, Set<string>>();
  for (const slot of slots) {
    const coins = bySlot.get(slot)!.coins as RecCoin[];
    const ranked = [...coins].sort((a, b) => (b[F.STR] as number) - (a[F.STR] as number));
    top10At.set(slot, new Set(ranked.slice(0, 10).map((c) => c[F.SYM] as string)));
    for (const c of coins) {
      const sym = c[F.SYM] as string;
      if (!priceAt.has(sym)) {
        priceAt.set(sym, new Map());
        rowAt.set(sym, new Map());
      }
      priceAt.get(sym)!.set(slot, c[F.PRICE] as number);
      rowAt.get(sym)!.set(slot, c);
    }
  }
  return { slots, bySlot, priceAt, rowAt, top10At, sourcesPresent, regimeAt };
}

// Resolve an EvalSource to a concrete era. 'auto' = the newest era present (the
// source of the most-recent recorded slot), so lift analyses default to the
// current venue and never blend the migration seam.
export function resolveEvalSource(idx: RecIndex, source: EvalSource): 'all' | 'okx' | 'binance' {
  if (source === 'all' || source === 'okx' || source === 'binance') return source;
  const last = idx.slots.length ? idx.slots[idx.slots.length - 1] : -1;
  return (idx.bySlot.get(last)?.source as 'okx' | 'binance') ?? 'binance';
}

export interface EdgeEvent {
  sym: string;
  slot: number;
  ts: number; // slot * SLOT_MS
  price: number; // recorded price at the edge slot
  row: RecCoin;
}

// Rising-edge sampling: a state counts as one event when it is ON in a slot but
// was OFF (or the symbol unseen) in the PREVIOUS recorded slot — so a state that
// persists for many slots is one event, not N correlated samples.
export function risingEdges(
  idx: RecIndex,
  on: (row: RecCoin, slot: number, sym: string) => boolean,
): EdgeEvent[] {
  const { slots, bySlot, rowAt } = idx;
  const out: EdgeEvent[] = [];
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    const coins = bySlot.get(slot)!.coins as RecCoin[];
    for (const c of coins) {
      const sym = c[F.SYM] as string;
      if (!on(c, slot, sym)) continue;
      const prevSlot = si > 0 ? slots[si - 1] : -1;
      const prevRow = prevSlot >= 0 ? rowAt.get(sym)?.get(prevSlot) : undefined;
      const prevOn = prevRow ? on(prevRow, prevSlot, sym) : false;
      if (prevOn) continue;
      out.push({ sym, slot, ts: slot * SLOT_MS, price: c[F.PRICE] as number, row: c });
    }
  }
  return out;
}

// ---- forward returns + lift summary (M2: moved from eval-recordings.ts so the
// CLI and the in-app 記錄 tab share ONE eval implementation and can't drift) ----

export const H4 = 16; // 4h in 15-min slots
export const H24 = 96; // 24h in slots

export interface Sample {
  mfe: number; // max favourable excursion (high-based), fraction
  mae: number; // max adverse excursion, fraction
  ret: number; // close-to-close return at the horizon, fraction
  coverage: number; // observed symbol slots / requested horizon slots
}

export interface StateSummary {
  n: number;
  hit: number; // fraction of samples whose MFE reached the target
  meanMfe: number;
  medMfe: number;
  meanRet: number;
}

// S4d lead-time: for events that reach the target, how many 15-min slots before
// the move actually started did the signal fire. Big = early (good), small = late.
export interface LeadStats {
  n: number; // events that hit target within 24h (a move exists → lead defined)
  p25: number;
  med: number;
  p75: number;
  late2: number; // fraction that fired ≤2 slots (≤30min) before the move — "almost too late"
}

export interface StateResult {
  events: number; // rising-edge count
  h4: StateSummary;
  h24: StateSummary;
  lead: LeadStats; // S4d structural earliness vs the move (not delivery latency)
}

export interface EvalResults {
  uniqueSlots: number;
  spanHours: number;
  target: number;
  states: Record<string, StateResult>;
  baseline: { h4: StateSummary; h24: StateSummary };
  source: 'all' | 'okx' | 'binance'; // era this lift ran over (seam filter)
  regime: 'up' | 'down' | 'chop' | null; // E3: BTC regime filter applied (null = all regimes)
}

// Forward MFE / fixed-horizon return from the recorded 15-min price path of one
// symbol. null when the entry price is missing/non-positive or there is no
// forward data within the horizon.
export function forward(idx: RecIndex, sym: string, slot: number, hSlots: number): Sample | null {
  const pm = idx.priceAt.get(sym);
  if (!pm) return null;
  const entry = pm.get(slot);
  if (!entry || entry <= 0) return null;
  let hi = -Infinity;
  let lo = Infinity;
  let lastP = NaN;
  let lastSlot = -1;
  let observed = 0;
  for (const s of idx.slots) {
    if (s <= slot) continue;
    if (s > slot + hSlots) break;
    const p = pm.get(s);
    if (p == null || p <= 0) continue;
    hi = Math.max(hi, p);
    lo = Math.min(lo, p);
    observed++;
    if (s > lastSlot) {
      lastSlot = s;
      lastP = p;
    }
  }
  if (lastSlot < 0) return null; // no forward data
  return { mfe: hi / entry - 1, mae: lo / entry - 1, ret: lastP / entry - 1, coverage: observed / hSlots };
}

// S4d — structural earliness of one event. Walk the recorded price path S..S+24h;
// if it reaches the full target (a move exists), return how many 15-min slots
// before the move-START (first close ≥ entry × (1 + 0.25·target), i.e. 25% of the
// way there) the signal fired. null when no move materialises. Same priceAt path
// as forward(), so it inherits the era filter when called with a filtered index.
// This measures the SIGNAL'S earliness, not delivery latency (that's SignalTimes).
export function leadTime(idx: RecIndex, sym: string, slot: number, targetPct: number): number | null {
  const pm = idx.priceAt.get(sym);
  if (!pm) return null;
  const entry = pm.get(slot);
  if (!entry || entry <= 0) return null;
  const moveLvl = entry * (1 + (0.25 * targetPct) / 100);
  const tgtLvl = entry * (1 + targetPct / 100);
  let moveStart: number | null = null;
  let hit = false;
  for (const s of idx.slots) {
    if (s <= slot) continue;
    if (s > slot + H24) break;
    const p = pm.get(s);
    if (p == null || p <= 0) continue;
    if (moveStart == null && p >= moveLvl) moveStart = s;
    if (p >= tgtLvl) {
      hit = true;
      break;
    }
  }
  return hit && moveStart != null ? moveStart - slot : null;
}

function quantile(sorted: number[], f: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))));
  return sorted[i];
}

function leadStatsOf(leads: number[]): LeadStats {
  const s = [...leads].sort((a, b) => a - b);
  const n = s.length;
  return {
    n,
    p25: quantile(s, 0.25),
    med: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    late2: n ? s.filter((x) => x <= 2).length / n : 0,
  };
}

export function summarize(xs: Sample[], target: number): StateSummary {
  const n = xs.length;
  if (!n) return { n: 0, hit: 0, meanMfe: 0, medMfe: 0, meanRet: 0 };
  const mfes = xs.map((x) => x.mfe).sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    n,
    hit: xs.filter((x) => x.mfe >= target / 100).length / n,
    meanMfe: mean(xs.map((x) => x.mfe)),
    medMfe: n % 2 ? mfes[(n - 1) / 2] : (mfes[n / 2 - 1] + mfes[n / 2]) / 2, // avg two middle for even n
    meanRet: mean(xs.map((x) => x.ret)),
  };
}

// The event-library states, in display order. A factory because the top10 state
// reads idx.top10At. Feature-based predicates over the recorded v2 row — the same
// definitions the ⚡/蓄 badges + spot detectors use, so the tab matches the CLI.
export function evalStates(
  idx: RecIndex,
): Array<{ key: string; on: (row: RecCoin, slot: number, sym: string) => boolean }> {
  return [
    { key: '⚡ flushBreakout', on: (r) => r[F.FB] === 1 },
    { key: '蓄 earlyAccum', on: (r) => r[F.EA] === 1 },
    { key: '早 earlyPump', on: (r) => r[F.EARLY] === 1 }, // S14 — pre-breakout markup (v4 rows only)
    { key: 'strength≥70', on: (r) => (r[F.STR] as number) >= 70 },
    { key: 'top10', on: (_r, slot, sym) => idx.top10At.get(slot)!.has(sym) },
    {
      key: 'organic-spot-lift',
      on: (r) => {
        const basis = r[F.BASIS] as number | null;
        const spotVol = r[F.SPOTVOL] as number | null;
        if (basis == null || spotVol == null) return false;
        return (
          (r[F.RET4H] as number) >= 2 &&
          basis <= 0 &&
          spotVol >= (r[F.VOL24H] as number) &&
          (r[F.BUYSHARE] as number) > 0.55
        );
      },
    },
    {
      key: 'leverage-only-froth',
      on: (r) => {
        const basis = r[F.BASIS] as number | null;
        const spotVol = r[F.SPOTVOL] as number | null;
        if (basis == null || spotVol == null) return false;
        return (r[F.FUND] as number) >= 0.01 && basis >= 0.1 && spotVol < 0.5 * (r[F.VOL24H] as number);
      },
    },
    {
      key: 'spot-led-v1',
      on: (r) => {
        const basis = r[F.BASIS] as number | null;
        const spotVol = r[F.SPOTVOL] as number | null;
        const takerBuy = r.length > F.SPOT_TAKERBUY ? (r[F.SPOT_TAKERBUY] as number | null) : null;
        if (basis == null || spotVol == null || takerBuy == null) return false;
        return (
          (r[F.RET4H] as number) >= 2 &&
          basis <= 0 &&
          spotVol >= (r[F.VOL24H] as number) &&
          takerBuy > 0.55
        );
      },
    },
  ];
}

// Full lift analysis over a parsed index: baseline (every obs) + each state's
// rising-edge samples, summarised at 4h and 24h. The single source of truth for
// both `npm run eval-rec` and the 記錄 tab's lift table.
//
// `source` restricts the analysis to one live era (default 'auto' = newest era
// present). This is a CORRECTNESS gate, not a convenience: forward returns and
// baselines walk cross-slot price paths, and blending the OKX→Binance venue seam
// (2026-07-07) mixes two regimes into one lift number — the ROADMAP 統計 seam
// rule forbids it. Every driving loop iterates the era-filtered `slots`, and the
// index maps are only queried at those slots, so restricting `slots` is a
// complete seam cut (no path can reach across it). 'all' is the deliberate blend.
// `regime` (E3) further restricts to slots tagged with that BTC regime — applied
// to BOTH baseline and events (untagged/pre-E3 slots are dropped), so per-regime
// lift is never fabricated by a mismatched baseline (E3 spec 陷阱).
export function runEval(idx: RecIndex, target: number, source: EvalSource = 'auto', regime?: Regime3): EvalResults {
  const resolved = resolveEvalSource(idx, source);
  let slots =
    resolved === 'all' ? idx.slots : idx.slots.filter((s) => idx.bySlot.get(s)?.source === resolved);
  if (regime) slots = slots.filter((s) => idx.regimeAt.get(s) === regime);
  const eidx: RecIndex = { ...idx, slots };
  const { bySlot } = eidx;
  const baseline: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
  for (const slot of slots) {
    for (const c of bySlot.get(slot)!.coins as RecCoin[]) {
      const sym = c[F.SYM] as string;
      for (const h of [H4, H24]) {
        const f = forward(eidx, sym, slot, h);
        if (f) baseline[h].push(f);
      }
    }
  }
  const states: Record<string, StateResult> = {};
  for (const st of evalStates(eidx)) {
    const edges = risingEdges(eidx, st.on);
    const samples: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
    const leads: number[] = [];
    for (const e of edges) {
      for (const h of [H4, H24]) {
        const f = forward(eidx, e.sym, e.slot, h);
        if (f) samples[h].push(f);
      }
      const lt = leadTime(eidx, e.sym, e.slot, target); // S4d
      if (lt != null) leads.push(lt);
    }
    states[st.key] = {
      events: edges.length,
      h4: summarize(samples[H4], target),
      h24: summarize(samples[H24], target),
      lead: leadStatsOf(leads),
    };
  }
  return {
    uniqueSlots: slots.length,
    spanHours: slots.length ? ((slots[slots.length - 1] - slots[0]) * SLOT_MS) / 3600000 : 0,
    target,
    states,
    baseline: { h4: summarize(baseline[H4], target), h24: summarize(baseline[H24], target) },
    source: resolved,
    regime: regime ?? null,
  };
}
