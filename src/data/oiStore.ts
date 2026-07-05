import { kvGet, kvSet } from './cache';

// Warm-store for open interest. Each sweep appends one bulk snapshot (all
// instruments' current oiUsd in a single request); once ~48h of history has
// accumulated for a coin, the scan reads its OI trend straight from here — zero
// rubik requests, which is what collapses a warm sweep from ~4.5min to ~1min.
//
// Values are per-instId `oiUsd` (absolute USD), a self-consistent unit — NEVER
// spliced with rubik history (which uses a different, per-coin unit). Timestamps
// are raw epoch-seconds; the caller adds its tzShift at read time, so the store
// is timezone-agnostic and survives DST/timezone changes. Persisted to
// IndexedDB in the browser; in Node (headless recorder) cache.ts no-ops and the
// store is in-memory only (warms within the long-running process).

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
      store.set(
        inst,
        pts.map(([t, v]) => ({ t, v })),
      );
    }
  }
}

// Append one bulk snapshot taken at tsMs. Dedups same-timestamp writes and
// prunes points older than the retention window.
export function appendSnapshot(rows: Array<{ instId: string; oiUsd: number }>, tsMs: number): void {
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
  void persist();
}

async function persist(): Promise<void> {
  const obj: Record<string, [number, number][]> = {};
  for (const [inst, arr] of store) obj[inst] = arr.map((p) => [p.t, p.v]);
  await kvSet(KEY, obj);
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

// how many instruments have any stored history (for logging / diagnostics)
export function storeSize(): number {
  return store.size;
}
