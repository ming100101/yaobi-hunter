import type { Insight } from './interpret';
import { kvGet, kvSet } from '../data/cache';

// Per-coin 24h Signal Read log. interpret() is a live snapshot — a read vanishes
// the moment its condition stops holding (e.g. strength drops). This layer keeps
// every read that fired for 24h from its FIRST detection, regardless of whether
// it's still active, so the list + K-line marks accumulate the day's history.
//
// Backed by kv.json (key 'signal-log', server-backed → survives reload, app
// restart and exe port drift). Kept in an in-memory mirror so mergeSignals stays
// synchronous for the render path; each change is persisted fire-and-forget.
// Each read is deduped by id and frozen at first detection (its detected time /
// anchor candle stay put); a re-fire after expiry starts a fresh 24h entry.

const DAY_MS = 24 * 3600 * 1000;
const KV_KEY = 'signal-log';

interface Entry {
  insight: Insight;
  firstTs: number; // wall-clock ms of first detection
}
type Serialized = Record<string, Record<string, Entry>>;

const store = new Map<string, Map<string, Entry>>();
let hydrated = false;
let hydrating: Promise<void> | null = null;

function prune(m: Map<string, Entry>, nowMs: number): void {
  for (const [id, e] of m) if (nowMs - e.firstTs > DAY_MS) m.delete(id);
}

function persist(): void {
  const out: Serialized = {};
  for (const [sym, m] of store) {
    if (m.size === 0) continue;
    const rec: Record<string, Entry> = {};
    for (const [id, e] of m) rec[id] = e;
    out[sym] = rec;
  }
  void kvSet(KV_KEY, out);
}

// Load the persisted log once (call at app startup). Merges kv into the in-memory
// store — so reads recorded this session before hydrate finishes aren't lost, and
// the earlier first-detection time wins — then prunes anything past 24h.
export function hydrateSignalLog(nowMs = Date.now()): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      const saved = await kvGet<Serialized>(KV_KEY);
      if (saved) {
        for (const [sym, rec] of Object.entries(saved)) {
          let m = store.get(sym);
          if (!m) {
            m = new Map();
            store.set(sym, m);
          }
          for (const [id, e] of Object.entries(rec)) {
            const cur = m.get(id);
            if (!cur || e.firstTs < cur.firstTs) m.set(id, e); // keep earliest detection
          }
          prune(m, nowMs);
          if (m.size === 0) store.delete(sym);
        }
      }
      hydrated = true;
    })();
  }
  return hydrating;
}

// Merge this snapshot's live reads into the symbol's log and return the full kept
// set (still-live + fired-within-24h), newest anchor candle first. Reads are
// NEVER dropped for going inactive — only after 24h.
export function mergeSignals(symbol: string, live: Insight[], nowMs: number): Insight[] {
  let m = store.get(symbol);
  if (!m) {
    m = new Map();
    store.set(symbol, m);
  }
  let changed = false;
  for (const ins of live) {
    const cur = m.get(ins.id);
    if (!cur || nowMs - cur.firstTs > DAY_MS) {
      m.set(ins.id, { insight: ins, firstTs: nowMs }); // new, or re-fired after expiry
      changed = true;
    } else if (ins.next && !cur.insight.next) {
      // backfill static fields added after the entry froze (e.g. the 之後睇 hint)
      // without touching firstTs or the anchor candle
      cur.insight.next = ins.next;
      changed = true;
    }
    // else keep the original entry frozen (first detected time + anchor candle)
  }
  const before = m.size;
  prune(m, nowMs);
  if (m.size !== before) changed = true;
  if (m.size === 0) store.delete(symbol);
  // persist only after hydrate so an early write can't clobber the saved log
  if (changed && hydrated) persist();
  return [...(store.get(symbol)?.values() ?? [])]
    .sort((a, b) => (b.insight.atTime ?? 0) - (a.insight.atTime ?? 0) || b.firstTs - a.firstTs)
    .map((e) => e.insight);
}
