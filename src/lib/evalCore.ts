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
