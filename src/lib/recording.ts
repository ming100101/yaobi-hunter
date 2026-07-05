import type { CoinLite, Regime, ScanSource } from '../types';

// Compact per-sweep snapshot format shared by the browser (POST /record) and
// the headless recorder, so both write identical JSONL. One line per completed
// sweep; a few months of these is the raw material for real event-library lift
// analysis (scripts/eval-recordings.ts) that isn't confined to one backtest
// window's market regime.

// Per-coin row. v1 rows are the first 10 elements; v2 appends the feature
// vector + EA/spot numbers (indexes 10-21). NEVER reorder or remove the first
// 10 — months of v1 data are keyed by these positions. Read idx >= 10 ONLY via
// recCoinField (a v1 row has length 10, so those positions read back as null).
// [0 sym, 1 price, 2 oiUsd, 3 funding%, 4 volZ, 5 strength, 6 regimeCode,
//  7 fb, 8 ea, 9 vol24hUsd,
//  10 change24h%, 11 ret4h%, 12 pos, 13 buyShare4h, 14 f8h%, 15 bbPctile,
//  16 lsDropPct, 17 rsPct, 18 oiDropPct, 19 spotVol24hUsd, 20 basisPct%,
//  21 oi4hPct]
export type RecCoin = [
  string,
  number,
  number | null,
  number,
  number,
  number,
  string,
  0 | 1,
  0 | 1,
  number,
  // ---- v2 appends ----
  number,
  number,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number,
];

export interface ScanRecord {
  v?: number; // schema version; absent/1 = legacy 10-field rows, 2 = feature vector
  ts: number; // ms epoch of the sweep
  slot: number; // 15-min slot index (dedup key across writers)
  source: ScanSource;
  coins: RecCoin[];
}

// One-per-sweep completeness marker, written as its own JSONL line alongside the
// ScanRecord. Readers key off `type` to skip it (it carries no coin rows).
export interface SweepMeta {
  type: 'sweep-meta';
  v: number;
  slot: number;
  ts: number;
  coins: number; // coin count in the sweep
  durationMs: number; // wall time of the sweep
  // S2: per-candidate spot cross-source reads [pump, accum, basis01] (0/1).
  // basis01 stays 0 until the recording-eval work. Present only on sweeps the
  // headless recorder writes — the browser writer has only CoinLite, no spot series.
  spotSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
}

export const REC_SLOT_MS = 15 * 60 * 1000;

const REGIME_CODE: Record<Regime, string> = { accumulate: 'A', pump: 'P', distribute: 'D' };

const sig = (x: number, p = 6) => Number(x.toPrecision(p));
const fix = (x: number, d: number) => Number(x.toFixed(d));
const fixN = (x: number | null | undefined, d: number): number | null =>
  x == null ? null : Number(x.toFixed(d));

export function buildScanRecord(coins: CoinLite[], tsMs: number, source: ScanSource): ScanRecord {
  return {
    v: 2,
    ts: tsMs,
    slot: Math.floor(tsMs / REC_SLOT_MS),
    source,
    coins: coins.map((c): RecCoin => {
      const f = c.feat;
      return [
        c.symbol,
        sig(c.lastPrice),
        c.oiUsd == null ? null : Math.round(c.oiUsd),
        fix(c.funding, 4),
        fix(c.volZ, 2),
        c.strength,
        REGIME_CODE[c.regime] ?? c.regime,
        c.flushBreakout ? 1 : 0,
        c.earlyAccum ? 1 : 0,
        Math.round(c.vol24h),
        // ---- v2 feature vector; f is present on every live-scanned coin ----
        fix(c.change24h, 2),
        f ? fix(f.ret4h, 2) : 0,
        f ? fix(f.pos, 3) : 0,
        f ? fix(f.buyShare4h, 3) : 0,
        f ? fix(f.f8h, 4) : 0,
        f ? fix(f.bbPctile, 3) : 0,
        fixN(f?.lsDropPct, 2),
        fixN(f?.rsPct, 2),
        fixN(f?.oiDropPct, 2),
        f?.spotVol24h == null ? null : Math.round(f.spotVol24h), // S1 fills this
        fixN(f?.basisPct, 3), // S1 fills this
        fix(c.oi4h, 2), // idx21 — 令未來 eval 可加返 OI-flat gate 對齊 live detector
      ];
    }),
  };
}

// The only sanctioned way to read a v2 field (idx >= 10): a v1 row is length 10,
// so anything past it reads back as null instead of throwing/undefined.
export function recCoinField(row: RecCoin, idx: number): number | null {
  return row.length > idx ? (row[idx] as number | null) : null;
}

export function buildSweepMeta(
  coinCount: number,
  tsMs: number,
  durationMs: number,
  spotSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1]>,
): SweepMeta {
  const meta: SweepMeta = {
    type: 'sweep-meta',
    v: 2,
    slot: Math.floor(tsMs / REC_SLOT_MS),
    ts: tsMs,
    coins: coinCount,
    durationMs,
  };
  if (spotSignals && Object.keys(spotSignals).length) meta.spotSignals = spotSignals;
  return meta;
}
