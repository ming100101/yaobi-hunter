import { kvGet, kvSet } from './cache';

// Warm-store for open interest. Each sweep appends both raw contract quantity
// and USD notional from the per-symbol fan-out. USD remains the legacy display/
// analyze series; quantity is an independent fail-closed confirmation series.
//
// Keys are BASE coins (e.g. "PEPE") since the 2026-07-07 Binance migration.
// USD is absolute notional (openInterest contracts × last price) and is never
// spliced unscaled with openInterestHist values. Quantity is raw Binance
// contracts and is never synthesized from USD. Neither is mixed with OKX-era
// history (different exchange's OI; the old
// `X-USDT-SWAP`-keyed entries are purged on hydrate). Timestamps are raw
// epoch-seconds; the caller adds its tzShift at read time, so the store is
// timezone-agnostic and survives DST/timezone changes. Persisted to IndexedDB
// in the browser; in Node (headless recorder) cache.ts no-ops and the store is
// in-memory only (warms within the long-running process).

interface Pt {
  t: number; // epoch seconds (raw, no tzShift)
  usd?: number;
  qty?: number; // raw Binance openInterest contracts; never derived from USD
}

type PersistedPt = [number, number] | [number, number | null, number | null];

export interface OiSnapshotRow {
  instId: string;
  oiUsd?: number | null;
  oiQty?: number | null;
}

export interface OiQtyChange {
  observedAt: number; // epoch milliseconds of the quantity snapshot used
  current: number;
  change1h: number; // percent
  change4h: number; // percent
}

const KEY = 'oi-snapshots';
const RETAIN_S = 49 * 3600; // keep ~49h so the 48h window always has headroom
const WARM_S = 48 * 3600; // need >=48h span before trusting the store
const FRESH_S = 20 * 60; // last point must be this recent to count as "this sweep"
const QTY_FRESH_S = 10 * 60; // detector reads are stricter than the display store
const REF_MAX_LAG_S = 20 * 60; // normal cadence is 15m; fail closed across larger gaps

let store = new Map<string, Pt[]>();
let hydrated = false;

export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const raw = await kvGet<Record<string, PersistedPt[]>>(KEY);
  if (raw) {
    store = new Map();
    for (const [inst, pts] of Object.entries(raw)) {
      // OKX-era keys ("X-USDT-SWAP") hold a different exchange's OI levels —
      // drop them rather than let them shadow or splice with Binance data.
      if (inst.includes('-USDT-SWAP')) continue;
      const parsed: Pt[] = [];
      for (const tuple of pts) {
        if (!Array.isArray(tuple) || tuple.length < 2) continue;
        const t = Number(tuple[0]);
        const usd = Number(tuple[1]);
        const qty = tuple.length >= 3 ? Number(tuple[2]) : NaN;
        if (!Number.isFinite(t)) continue;
        const p: Pt = { t: Math.trunc(t) };
        if (Number.isFinite(usd) && usd > 0) p.usd = usd;
        if (Number.isFinite(qty) && qty > 0) p.qty = qty;
        if (p.usd != null || p.qty != null) parsed.push(p);
      }
      parsed.sort((a, b) => a.t - b.t);
      if (parsed.length) store.set(inst, parsed);
    }
  }
}

// Core append (no persist) so a bulk backfill can write many snapshots then
// persist once, instead of serializing the whole store per snapshot.
function appendOne(rows: OiSnapshotRow[], tsMs: number): void {
  const t = Math.floor(tsMs / 1000);
  const cutoff = t - RETAIN_S;
  for (const r of rows) {
    const usd = typeof r.oiUsd === 'number' && Number.isFinite(r.oiUsd) && r.oiUsd > 0 ? r.oiUsd : null;
    const qty = typeof r.oiQty === 'number' && Number.isFinite(r.oiQty) && r.oiQty > 0 ? r.oiQty : null;
    if (usd == null && qty == null) continue;
    let arr = store.get(r.instId);
    if (!arr) {
      arr = [];
      store.set(r.instId, arr);
    }
    if (arr.length && arr[arr.length - 1].t === t) {
      if (usd != null) arr[arr.length - 1].usd = usd;
      if (qty != null) arr[arr.length - 1].qty = qty;
    } else {
      arr.push({ t, ...(usd == null ? {} : { usd }), ...(qty == null ? {} : { qty }) });
    }
    if (arr.length && arr[0].t < cutoff) {
      const keep = arr.findIndex((p) => p.t >= cutoff);
      if (keep > 0) store.set(r.instId, arr.slice(keep));
    }
  }
}

// Append one bulk snapshot taken at tsMs. Dedups same-timestamp writes and
// prunes points older than the retention window.
export function appendSnapshot(rows: OiSnapshotRow[], tsMs: number): void {
  appendOne(rows, tsMs);
  void persist();
}

// P1: warm the store from persisted recordings on startup, so coins are
// trustworthy right after app open instead of waiting ~48h of live sweeps.
// Parses JSONL (skips sweep-meta lines), appends each ScanRecord's per-coin
// oiUsd (recording idx2) and, on v5 rows, oiQty (idx25) at the record's ts.
// ONLY source==='binance' records
// are applied — OKX-era lines carry a different exchange's OI levels, and one
// spliced series would corrupt every %-trend read across the seam (same
// honest-stats rule as the rubik ban in the file header). Returns the number
// of snapshots applied. Persists once.
export function backfillFromRecords(jsonl: string): number {
  // Collect per-coin time->oiUsd points from all records first. A proper merge
  // (not append-only) is required: recording points are OLDER than any live
  // points already hydrated into the store, so they must be inserted before the
  // tail — appendSnapshot can't do that.
  const collected = new Map<string, Map<number, { usd?: number; qty?: number }>>();
  let records = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let o: { type?: string; ts?: number; source?: string; coins?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || o.type === 'sweep-meta' || !Array.isArray(o.coins) || typeof o.ts !== 'number') continue;
    if (o.source !== 'binance') continue; // OKX-era or demo lines — never splice
    const t = Math.floor(o.ts / 1000);
    for (const c of o.coins as unknown[][]) {
      const sym = c[0];
      const oiUsd = c.length > 2 ? c[2] : null;
      const oiQty = c.length > 25 ? c[25] : null;
      if (typeof sym !== 'string') continue;
      const usd = typeof oiUsd === 'number' && Number.isFinite(oiUsd) && oiUsd > 0 ? oiUsd : null;
      const qty = typeof oiQty === 'number' && Number.isFinite(oiQty) && oiQty > 0 ? oiQty : null;
      if (usd == null && qty == null) continue;
      const inst = sym; // store key = base coin (recordings key coins by base)
      let m = collected.get(inst);
      if (!m) {
        m = new Map();
        collected.set(inst, m);
      }
      const p = m.get(t) ?? {};
      if (usd != null) p.usd = usd;
      if (qty != null) p.qty = qty;
      m.set(t, p); // later record for the same slot wins per available unit
    }
    records++;
  }
  // Merge each instrument's points into the store: union by timestamp (existing
  // live points win over recordings for the same t), re-sort, prune to retention.
  for (const [inst, pts] of collected) {
    const merged = new Map<number, Pt>();
    for (const [t, v] of pts) merged.set(t, { t, ...v });
    for (const p of store.get(inst) ?? []) {
      const prev = merged.get(p.t) ?? { t: p.t };
      // Existing live/hydrated values win independently at the same timestamp.
      if (p.usd != null) prev.usd = p.usd;
      if (p.qty != null) prev.qty = p.qty;
      merged.set(p.t, prev);
    }
    const arr = [...merged.values()].sort((a, b) => a.t - b.t);
    const newest = arr.length ? arr[arr.length - 1].t : 0;
    const cutoff = newest - RETAIN_S;
    store.set(
      inst,
      arr.filter((p) => p.t >= cutoff),
    );
  }
  void persist();
  return records;
}

async function persist(): Promise<void> {
  const obj: Record<string, PersistedPt[]> = {};
  for (const [inst, arr] of store) obj[inst] = arr.map((p) => [p.t, p.usd ?? null, p.qty ?? null]);
  await kvSet(KEY, obj);
}

// Cold-start seed (2026-07-07, EPIC seam-miss fix): when a coin's store can't
// serve the recent-OI trend yet (new listing to us / fresh install / the
// migration seam), graft the openInterestHist history the cold path already
// fetched BELOW the live snapshot points — SCALED so hist's last pre-snapshot
// value equals the snapshot's level. Ratios are scale-invariant, so the series
// stays one self-consistent unit (no derivation splicing: probed 2026-07-07,
// snapshot vs hist gap median 0.32% / max 2.08%, hist tail lag ≤6.7min) and
// oi4h becomes trustworthy on the coin's FIRST sweep instead of after 4.5h.
// P1's fail-closed policy is untouched — the store is still the only source
// the gates read; it just becomes servable earlier. Returns true when seeded.
const SEED_ANCHOR_MAX_GAP_S = 45 * 60; // hist anchor must sit close to the snapshot
const SEED_SCALE_MIN = 0.8; // outside this band something is wrong with the
const SEED_SCALE_MAX = 1.25; // units — skip rather than plant a bad series
const RECENT_MIN_S = 4.5 * 3600;

export function seedFromHist(
  inst: string,
  src: Array<{ t: number; v: number; q?: number }>,
  nowMs: number,
): boolean {
  const arr = store.get(inst) ?? [];
  const now = Math.floor(nowMs / 1000);
  const ordered = [...src].sort((a, b) => a.t - b.t);
  const merged = new Map<number, Pt>(arr.map((p) => [p.t, { ...p }]));
  let seeded = false;

  // Seed USD and quantity independently. A legacy store may already be warm
  // in USD while having only one new quantity snapshot after an upgrade.
  const seedUnit = (unit: 'usd' | 'qty'): void => {
    const live = arr.filter((p) => (unit === 'usd' ? p.usd : p.qty) != null);
    if (!live.length) {
      // sumOpenInterest is already the exact raw quantity unit returned by the
      // live endpoint, so unlike USD it needs no snapshot scaling anchor.
      if (unit === 'usd') return;
      const direct = ordered.filter((p) => p.t <= now && p.q != null && p.q > 0);
      if (
        !direct.length ||
        now - direct[direct.length - 1].t > QTY_FRESH_S ||
        direct[direct.length - 1].t - direct[0].t < RECENT_MIN_S
      ) return;
      for (const p of direct) {
        const dst = merged.get(p.t) ?? { t: p.t };
        if (dst.qty == null) dst.qty = p.q;
        merged.set(p.t, dst);
      }
      seeded = true;
      return;
    }
    if (live[0].t <= now - RECENT_MIN_S) return;
    if (live[live.length - 1].t < now - FRESH_S) return;
    const anchor = live[0];
    const anchorValue = unit === 'usd' ? anchor.usd : anchor.qty;
    if (!(anchorValue != null && anchorValue > 0)) return;

    let hi = -1;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const value = unit === 'usd' ? ordered[i].v : ordered[i].q;
      if (ordered[i].t <= anchor.t && value != null && value > 0) {
        hi = i;
        break;
      }
    }
    if (hi < 0 || anchor.t - ordered[hi].t > SEED_ANCHOR_MAX_GAP_S) return;
    const histAnchor = unit === 'usd' ? ordered[hi].v : ordered[hi].q;
    if (!(histAnchor != null && histAnchor > 0)) return;
    const scale = anchorValue / histAnchor;
    if (!(scale >= SEED_SCALE_MIN && scale <= SEED_SCALE_MAX)) return;

    const candidates = ordered.slice(0, hi + 1).filter((p) => {
      const value = unit === 'usd' ? p.v : p.q;
      return p.t < anchor.t && value != null && value > 0;
    });
    if (!candidates.length || anchor.t - candidates[0].t < RECENT_MIN_S) return;
    for (const p of candidates) {
      const value = unit === 'usd' ? p.v : (p.q as number);
      const dst = merged.get(p.t) ?? { t: p.t };
      if (unit === 'usd') {
        if (dst.usd == null) dst.usd = value * scale;
      } else if (dst.qty == null) {
        dst.qty = value * scale;
      }
      merged.set(p.t, dst);
    }
    seeded = true;
  };

  seedUnit('usd');
  seedUnit('qty');
  if (!seeded) return false;
  const newest = Math.max(...merged.keys());
  const cutoff = newest - RETAIN_S;
  store.set(inst, [...merged.values()].filter((p) => p.t >= cutoff).sort((a, b) => a.t - b.t));
  void persist();
  return true;
}

// Raw {t (epoch sec), v} series for a coin, or null when not warm enough:
// requires >=48h of span AND a point fresh from this sweep (so a missed bulk
// fetch falls back to rubik rather than serving a stale, gappy trend).
export function getSeries(instId: string, nowMs: number): Array<{ t: number; v: number }> | null {
  const arr = (store.get(instId) ?? [])
    .filter((p): p is Pt & { usd: number } => p.usd != null && p.usd > 0)
    .map((p) => ({ t: p.t, v: p.usd }));
  if (arr.length < 2) return null;
  const now = Math.floor(nowMs / 1000);
  if (arr[0].t > now - WARM_S) return null;
  if (arr[arr.length - 1].t < now - FRESH_S) return null;
  return arr;
}

// P1: partial-warm read for the recent-OI trend (the 4h gate), needing only a
// short span rather than the full 48h. A coin with >=4.5h of fresh snapshots can
// serve a trustworthy oi4h even before it qualifies as fully warm — this is what
// unfreezes OI-gated reads for backfilled / recently-seen coins. Returns null
// (→ caller fail-closes) when span is too short or the last point is stale.
export function getRecentSeries(
  instId: string,
  nowMs: number,
  minSpanS = RECENT_MIN_S,
): Array<{ t: number; v: number }> | null {
  const arr = (store.get(instId) ?? [])
    .filter((p): p is Pt & { usd: number } => p.usd != null && p.usd > 0)
    .map((p) => ({ t: p.t, v: p.usd }));
  if (arr.length < 2) return null;
  const now = Math.floor(nowMs / 1000);
  if (arr[0].t > now - minSpanS) return null; // not enough span yet
  if (arr[arr.length - 1].t < now - FRESH_S) return null; // last point stale
  return arr;
}

// Quantity-only as-of read for completed-bar decisions. The current point and
// both references are selected strictly from snapshots at/before asOfMs. USD
// is never consulted, so a legacy USD-only store fails closed until quantity
// has been backfilled or warmed live.
export function oiQtyChangeFromStore(instId: string, asOfMs: number): OiQtyChange | null {
  if (!Number.isFinite(asOfMs)) return null;
  const asOf = Math.floor(asOfMs / 1000);
  const points = (store.get(instId) ?? []).filter(
    (p): p is Pt & { qty: number } => p.t <= asOf && p.qty != null && Number.isFinite(p.qty) && p.qty > 0,
  );
  if (points.length < 3) return null;
  const current = points[points.length - 1];
  if (asOf - current.t > QTY_FRESH_S) return null;

  const refAt = (seconds: number): number | null => {
    const target = current.t - seconds;
    for (let i = points.length - 2; i >= 0; i--) {
      if (points[i].t <= target) {
        if (target - points[i].t > REF_MAX_LAG_S) return null;
        return points[i].qty;
      }
    }
    return null;
  };
  const q1 = refAt(3600);
  const q4 = refAt(4 * 3600);
  if (!(q1 != null && q1 > 0 && q4 != null && q4 > 0)) return null;
  return {
    observedAt: current.t * 1000,
    current: current.qty,
    change1h: (current.qty / q1 - 1) * 100,
    change4h: (current.qty / q4 - 1) * 100,
  };
}

// how many instruments have any stored history (for logging / diagnostics)
export function storeSize(): number {
  return store.size;
}
