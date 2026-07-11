import type { RefSignal } from '../types';
import { recCoinField, type RecCoin } from './recording';

// E4 — reference-signal logbook joins (老詹抓妖). PURE logic, no I/O: callers
// (scripts/ref-eval.ts today, a settings-tab form later) supply the recordings
// JSONL text and the signal list. Everything anchors to the recordings slot at
// the signal's MESSAGE ts — never a nearby favourable print (the ADA
// 0.1766-vs-0.1852 lesson, see docs/roadmap/E4-reference-logbook.md 陷阱).

export interface RecRow {
  ts: number;
  row: RecCoin;
}

// 老詹訊號名稱 → 佢體系嘅倉位分級(試用群使用說明 2026-07-06,E4 spec 有全表)。
// Reference metadata for logbook display ONLY — never drives sizing automation
// (our signal↔his-kind mapping is rough, and sizing automation is post-T1).
export const KIND_SIZING: Record<string, string> = {
  上車準備: '小倉',
  接人: '補倉 小倉',
  蓄力加倉: '加倉',
  跑車加倉: '正常倉',
  火箭加倉: '正常倉',
};

// Parse raw recordings JSONL into per-symbol ascending time series.
export function parseRecordings(jsonl: string): Map<string, RecRow[]> {
  const out = new Map<string, RecRow[]>();
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let o: { type?: string; ts?: number; coins?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || o.type === 'sweep-meta' || !Array.isArray(o.coins) || typeof o.ts !== 'number') continue;
    for (const c of o.coins as RecCoin[]) {
      const sym = c[0];
      if (typeof sym !== 'string') continue;
      let arr = out.get(sym);
      if (!arr) {
        arr = [];
        out.set(sym, arr);
      }
      arr.push({ ts: o.ts, row: c });
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a.ts - b.ts);
  return out;
}

// Nearest row at-or-before ts (fallback: nearest after, within tolerance).
function slotAt(series: RecRow[], ts: number, tolMs = 25 * 60 * 1000): RecRow | null {
  let best: RecRow | null = null;
  for (const r of series) {
    if (r.ts <= ts) best = r;
    else break;
  }
  if (best && ts - best.ts <= tolMs) return best;
  const after = series.find((r) => r.ts > ts);
  if (after && after.ts - ts <= tolMs) return after;
  return null;
}

// True 4h OI %change from raw oiUsd (idx2) — NEVER trusts idx21, which is
// laggy-series garbage in the pre-P1 provenance window (R3 spec note).
function oi4hFromRaw(series: RecRow[], ts: number): number | null {
  const now = slotAt(series, ts);
  const ref = slotAt(series, ts - 4 * 3600 * 1000);
  const a = now ? (now.row[2] as number | null) : null;
  const b = ref ? (ref.row[2] as number | null) : null;
  if (a == null || b == null || !(b > 0)) return null;
  return (a / b - 1) * 100;
}

export interface JoinedFeatures {
  slotTs: number;
  slotPx: number;
  anchorDivergencePct: number; // slot px vs the message's printed px
  strength: number;
  regime: string;
  volZ: number;
  funding: number;
  buyShare4h: number | null;
  ret4h: number | null;
  change24h: number | null;
  change1h: number | null; // v3 rows only
  pos: number | null;
  f8h: number | null;
  f24h: number | null; // v3 rows only
  bbPctile: number | null;
  oi4hTrue: number | null; // from raw oiUsd, not idx21
}

export function joinToRecordings(sig: RefSignal, series: RecRow[] | undefined): JoinedFeatures | null {
  if (!series?.length) return null;
  const hit = slotAt(series, sig.ts);
  if (!hit) return null;
  const r = hit.row;
  const px = r[1] as number;
  return {
    slotTs: hit.ts,
    slotPx: px,
    anchorDivergencePct: sig.px > 0 ? (px / sig.px - 1) * 100 : 0,
    strength: r[5] as number,
    regime: String(r[6]),
    volZ: r[4] as number,
    funding: r[3] as number,
    buyShare4h: recCoinField(r, 13),
    ret4h: recCoinField(r, 11),
    change24h: recCoinField(r, 10),
    change1h: recCoinField(r, 22),
    pos: recCoinField(r, 12),
    f8h: recCoinField(r, 14),
    f24h: recCoinField(r, 23),
    bbPctile: recCoinField(r, 15),
    oi4hTrue: oi4hFromRaw(series, sig.ts),
  };
}

export interface FwdReturn {
  h: number;
  lastPct: number;
  peakPct: number;
  covered: boolean; // data actually reaches the horizon
}

// Forward returns anchored at the message-ts slot px (15-min marks).
export function forwardReturns(sig: RefSignal, series: RecRow[] | undefined, horizons = [1, 4, 12, 24, 48]): FwdReturn[] {
  if (!series?.length) return [];
  const anchor = slotAt(series, sig.ts);
  if (!anchor) return [];
  const base = anchor.row[1] as number;
  if (!(base > 0)) return [];
  const out: FwdReturn[] = [];
  for (const h of horizons) {
    const until = sig.ts + h * 3600 * 1000;
    let last: number | null = null;
    let peak = -Infinity;
    let lastTs = 0;
    for (const r of series) {
      if (r.ts <= anchor.ts || r.ts > until) continue;
      const px = r.row[1] as number;
      last = px;
      lastTs = r.ts;
      peak = Math.max(peak, px);
    }
    if (last == null) continue;
    out.push({
      h,
      lastPct: (last / base - 1) * 100,
      peakPct: (peak / base - 1) * 100,
      covered: until - lastTs <= 40 * 60 * 1000,
    });
  }
  return out;
}

export interface LadderSim {
  entry: number;
  hits: string[]; // e.g. ['TP1@+11.2h']
  slHit: string | null; // 'SL@+3.5h' — SL-first on the same mark (conservative, paper.ts:9-13)
  endPct: number; // last-mark return vs entry
  coveredH: number; // hours of data actually walked
}

// Walk the 15-min marks after the message ts applying 老詹's ladder. Marks are
// closes — intra-slot touches invisible; SL-first tie rule keeps bias
// conservative, same convention as paper.ts.
export function simLadder(sig: RefSignal, series: RecRow[] | undefined, maxH = 48): LadderSim | null {
  if (!series?.length || !sig.tpPcts?.length || sig.slPct == null) return null;
  const anchor = slotAt(series, sig.ts);
  if (!anchor) return null;
  const entry = anchor.row[1] as number;
  if (!(entry > 0)) return null;
  const tps = sig.tpPcts.map((p) => entry * (1 + p / 100));
  const sl = entry * (1 + sig.slPct / 100);
  const hits: string[] = [];
  let slHit: string | null = null;
  let tpIdx = 0;
  let endPx = entry;
  let endTs = anchor.ts;
  for (const r of series) {
    if (r.ts <= anchor.ts || r.ts > sig.ts + maxH * 3600 * 1000) continue;
    const px = r.row[1] as number;
    const hAt = ((r.ts - sig.ts) / 3600 / 1000).toFixed(1);
    endPx = px;
    endTs = r.ts;
    if (px <= sl && !slHit) {
      slHit = `SL@+${hAt}h`;
      break; // hard stop closes everything
    }
    while (tpIdx < tps.length && px >= tps[tpIdx]) {
      hits.push(`TP${tpIdx + 1}@+${hAt}h`);
      tpIdx++;
    }
  }
  return {
    entry,
    hits,
    slHit,
    endPct: (endPx / entry - 1) * 100,
    coveredH: (endTs - anchor.ts) / 3600 / 1000,
  };
}

// Lead-time vs our own live proxy (str≥60 ∧ regime ≠ D): hours from 老詹's
// message to OUR first proxy fire within ±24h. Negative ⇒ we were earlier.
export function leadTimeVsProxy(sig: RefSignal, series: RecRow[] | undefined): number | null {
  if (!series?.length) return null;
  const from = sig.ts - 24 * 3600 * 1000;
  const to = sig.ts + 24 * 3600 * 1000;
  for (const r of series) {
    if (r.ts < from || r.ts > to) continue;
    if ((r.row[5] as number) >= 60 && String(r.row[6]) !== 'D') {
      return (r.ts - sig.ts) / 3600 / 1000;
    }
  }
  return null;
}
