import type { RecCoin, ScanRecord } from './recording';

// Browser-safe core of the recorded-signal analysis: parse concatenated JSONL
// into a per-symbol index, and sample state rising-edges over it. Shared by the
// CLI (scripts/eval-recordings.ts, which adds fs I/O) and the in-app 策略/記錄
// tabs (which fetch text from /recordings) — ONE implementation so the two never
// drift into two truths. (M2 later moves forward/summarize/STATES here too.)

export const SLOT_MS = 15 * 60 * 1000;

// Column indexes into a v2 recording row (see recording.ts RecCoin).
export const F = {
  SYM: 0, PRICE: 1, FUND: 3, STR: 5, FB: 7, EA: 8,
  VOL24H: 9, RET4H: 11, BUYSHARE: 13, SPOTVOL: 19, BASIS: 20,
} as const;

export interface RecIndex {
  slots: number[]; // ascending unique 15-min slot indexes
  bySlot: Map<number, ScanRecord>;
  priceAt: Map<string, Map<number, number>>; // sym -> slot -> recorded price
  rowAt: Map<string, Map<number, RecCoin>>; // sym -> slot -> full row
  top10At: Map<number, Set<string>>; // slot -> top-10 symbols by strength
}

// Parse concatenated JSONL text (as /recordings serves, or files concatenated by
// the CLI) into the index. Defensive: malformed lines skipped, sweep-meta lines
// ignored (they carry no coin rows), only source==='okx' kept, last-write-wins
// per slot.
export function parseRecordings(text: string): RecIndex {
  const bySlot = new Map<number, ScanRecord>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as ScanRecord & { type?: string };
      if (rec.type) continue; // sweep-meta completeness line, not coin data
      if (rec.source === 'okx' && Array.isArray(rec.coins)) bySlot.set(rec.slot, rec); // last write wins
    } catch {
      /* skip malformed */
    }
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
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
  return { slots, bySlot, priceAt, rowAt, top10At };
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
  ret: number; // close-to-close return at the horizon, fraction
}

export interface StateSummary {
  n: number;
  hit: number; // fraction of samples whose MFE reached the target
  meanMfe: number;
  medMfe: number;
  meanRet: number;
}

export interface StateResult {
  events: number; // rising-edge count
  h4: StateSummary;
  h24: StateSummary;
}

export interface EvalResults {
  uniqueSlots: number;
  spanHours: number;
  target: number;
  states: Record<string, StateResult>;
  baseline: { h4: StateSummary; h24: StateSummary };
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
  let lastP = NaN;
  let lastSlot = -1;
  for (const s of idx.slots) {
    if (s <= slot) continue;
    if (s > slot + hSlots) break;
    const p = pm.get(s);
    if (p == null || p <= 0) continue;
    hi = Math.max(hi, p);
    if (s > lastSlot) {
      lastSlot = s;
      lastP = p;
    }
  }
  if (lastSlot < 0) return null; // no forward data
  return { mfe: hi / entry - 1, ret: lastP / entry - 1 };
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
    medMfe: mfes[Math.floor(n / 2)],
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
  ];
}

// Full lift analysis over a parsed index: baseline (every obs) + each state's
// rising-edge samples, summarised at 4h and 24h. The single source of truth for
// both `npm run eval-rec` and the 記錄 tab's lift table.
export function runEval(idx: RecIndex, target: number): EvalResults {
  const { slots, bySlot } = idx;
  const baseline: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
  for (const slot of slots) {
    for (const c of bySlot.get(slot)!.coins as RecCoin[]) {
      const sym = c[F.SYM] as string;
      for (const h of [H4, H24]) {
        const f = forward(idx, sym, slot, h);
        if (f) baseline[h].push(f);
      }
    }
  }
  const states: Record<string, StateResult> = {};
  for (const st of evalStates(idx)) {
    const edges = risingEdges(idx, st.on);
    const samples: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
    for (const e of edges) {
      for (const h of [H4, H24]) {
        const f = forward(idx, e.sym, e.slot, h);
        if (f) samples[h].push(f);
      }
    }
    states[st.key] = {
      events: edges.length,
      h4: summarize(samples[H4], target),
      h24: summarize(samples[H24], target),
    };
  }
  return {
    uniqueSlots: slots.length,
    spanHours: ((slots[slots.length - 1] - slots[0]) * SLOT_MS) / 3600000,
    target,
    states,
    baseline: { h4: summarize(baseline[H4], target), h24: summarize(baseline[H24], target) },
  };
}
