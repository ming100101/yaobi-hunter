import { kvGet, kvSet } from './cache';

// Warm-store for open interest. Each sweep appends one snapshot (every coin's
// current oiUsd from the per-symbol openInterest fan-out); once ~48h of history
// has accumulated for a coin, the scan reads its OI trend straight from here —
// zero cold-history requests.
//
// Keys are BASE coins (e.g. "PEPE") since the 2026-07-07 Binance migration.
// Values are `oiUsd` (absolute USD, openInterest contracts × last price), a
// self-consistent unit — NEVER spliced with openInterestHist series (different
// derivation) and NEVER with OKX-era history (different exchange's OI; the old
// `X-USDT-SWAP`-keyed entries are purged on hydrate). Timestamps are raw
// epoch-seconds; the caller adds its tzShift at read time, so the store is
// timezone-agnostic and survives DST/timezone changes. Persisted to IndexedDB
// in the browser; in Node (headless recorder) cache.ts no-ops and the store is
// in-memory only (warms within the long-running process).

interface Pt {
  t: number; // epoch seconds (raw, no tzShift)
  v: number; // oiUsd
}

const KEY = 'oi-snapshots';
const RETAIN_S = 49 * 3600; // keep ~49h so the 48h window always has headroom
const WARM_S = 48 * 3600; // need >=48h span before trusting the store
const FRESH_S = 20 * 60; // last point must be this recent to count as "this sweep"

let store = new Map<string, Pt[]>();
let hydrated = false;

export async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const raw = await kvGet<Record<string, [number, number][]>>(KEY);
  if (raw) {
    store = new Map();
    for (const [inst, pts] of Object.entries(raw)) {
      // OKX-era keys ("X-USDT-SWAP") hold a different exchange's OI levels —
      // drop them rather than let them shadow or splice with Binance data.
      if (inst.includes('-USDT-SWAP')) continue;
      store.set(
        inst,
        pts.map(([t, v]) => ({ t, v })),
      );
    }
  }
}

// Core append (no persist) so a bulk backfill can write many snapshots then
// persist once, instead of serializing the whole store per snapshot.
function appendOne(rows: Array<{ instId: string; oiUsd: number }>, tsMs: number): void {
  const t = Math.floor(tsMs / 1000);
  const cutoff = t - RETAIN_S;
  for (const r of rows) {
    if (!Number.isFinite(r.oiUsd) || r.oiUsd <= 0) continue;
    let arr = store.get(r.instId);
    if (!arr) {
      arr = [];
      store.set(r.instId, arr);
    }
    if (arr.length && arr[arr.length - 1].t === t) arr[arr.length - 1].v = r.oiUsd;
    else arr.push({ t, v: r.oiUsd });
    if (arr.length && arr[0].t < cutoff) {
      const keep = arr.findIndex((p) => p.t >= cutoff);
      if (keep > 0) store.set(r.instId, arr.slice(keep));
    }
  }
}

// Append one bulk snapshot taken at tsMs. Dedups same-timestamp writes and
// prunes points older than the retention window.
export function appendSnapshot(rows: Array<{ instId: string; oiUsd: number }>, tsMs: number): void {
  appendOne(rows, tsMs);
  void persist();
}

// P1: warm the store from persisted recordings on startup, so coins are
// trustworthy right after app open instead of waiting ~48h of live sweeps.
// Parses JSONL (skips sweep-meta lines), appends each ScanRecord's per-coin
// oiUsd (recording idx2) at the record's ts. ONLY source==='binance' records
// are applied — OKX-era lines carry a different exchange's OI levels, and one
// spliced series would corrupt every %-trend read across the seam (same
// honest-stats rule as the rubik ban in the file header). Returns the number
// of snapshots applied. Persists once.
export function backfillFromRecords(jsonl: string): number {
  // Collect per-coin time->oiUsd points from all records first. A proper merge
  // (not append-only) is required: recording points are OLDER than any live
  // points already hydrated into the store, so they must be inserted before the
  // tail — appendSnapshot can't do that.
  const collected = new Map<string, Map<number, number>>();
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
      if (typeof sym !== 'string' || typeof oiUsd !== 'number' || !(oiUsd > 0)) continue;
      const inst = sym; // store key = base coin (recordings key coins by base)
      let m = collected.get(inst);
      if (!m) {
        m = new Map();
        collected.set(inst, m);
      }
      m.set(t, oiUsd); // later record for the same slot wins
    }
    records++;
  }
  // Merge each instrument's points into the store: union by timestamp (existing
  // live points win over recordings for the same t), re-sort, prune to retention.
  for (const [inst, pts] of collected) {
    const merged = new Map<number, number>();
    for (const [t, v] of pts) merged.set(t, v);
    for (const p of store.get(inst) ?? []) merged.set(p.t, p.v); // live overrides recording at same t
    const arr = [...merged.entries()]
      .map(([t, v]) => ({ t, v }))
      .sort((a, b) => a.t - b.t);
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
  const obj: Record<string, [number, number][]> = {};
  for (const [inst, arr] of store) obj[inst] = arr.map((p) => [p.t, p.v]);
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
export function seedFromHist(inst: string, src: Array<{ t: number; v: number }>, nowMs: number): boolean {
  const arr = store.get(inst);
  if (!arr || !arr.length) return false; // no live snapshot to anchor on yet — next sweep
  const now = Math.floor(nowMs / 1000);
  if (arr[0].t <= now - RECENT_MIN_S) return false; // already partial-warm — nothing to fix
  if (arr[arr.length - 1].t < now - FRESH_S) return false; // stale snapshots — don't extend a dead series
  const anchor = arr[0]; // oldest live snapshot: everything seeded goes strictly below it
  let hi = -1;
  for (let i = src.length - 1; i >= 0; i--) {
    if (src[i].t <= anchor.t) {
      hi = i;
      break;
    }
  }
  if (hi < 0 || !(src[hi].v > 0)) return false;
  if (anchor.t - src[hi].t > SEED_ANCHOR_MAX_GAP_S) return false; // hist tail too far from the anchor
  const scale = anchor.v / src[hi].v;
  if (!(scale >= SEED_SCALE_MIN && scale <= SEED_SCALE_MAX)) return false;
  const seed = src
    .slice(0, hi + 1)
    .filter((p) => p.t < anchor.t)
    .map((p) => ({ t: p.t, v: p.v * scale }));
  if (!seed.length || anchor.t - seed[0].t < RECENT_MIN_S) return false; // too little history to unlock anything
  const cutoff = arr[arr.length - 1].t - RETAIN_S;
  store.set(
    inst,
    seed.concat(arr).filter((p) => p.t >= cutoff),
  );
  void persist();
  return true;
}

// Raw {t (epoch sec), v} series for a coin, or null when not warm enough:
// requires >=48h of span AND a point fresh from this sweep (so a missed bulk
// fetch falls back to rubik rather than serving a stale, gappy trend).
export function getSeries(instId: string, nowMs: number): Array<{ t: number; v: number }> | null {
  const arr = store.get(instId);
  if (!arr || arr.length < 2) return null;
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
const RECENT_MIN_S = 4.5 * 3600;
export function getRecentSeries(
  instId: string,
  nowMs: number,
  minSpanS = RECENT_MIN_S,
): Array<{ t: number; v: number }> | null {
  const arr = store.get(instId);
  if (!arr || arr.length < 2) return null;
  const now = Math.floor(nowMs / 1000);
  if (arr[0].t > now - minSpanS) return null; // not enough span yet
  if (arr[arr.length - 1].t < now - FRESH_S) return null; // last point stale
  return arr;
}

// how many instruments have any stored history (for logging / diagnostics)
export function storeSize(): number {
  return store.size;
}
