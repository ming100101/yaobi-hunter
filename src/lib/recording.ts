import type { CoinLite, Regime, ScanSource } from '../types';

// Compact per-sweep snapshot format shared by the browser (POST /record) and
// the headless recorder, so both write identical JSONL. One line per completed
// sweep; a few months of these is the raw material for real event-library lift
// analysis (scripts/eval-recordings.ts) that isn't confined to one backtest
// window's market regime.

// Per-coin row. v1 rows are the first 10 elements; v2 appends the feature
// vector + EA/spot numbers (indexes 10-21); v3 (R3) appends 22-23; v4 (S14)
// appends 24; v5 appends quantity OI at 25-27. NEVER reorder or remove earlier positions — months of data are
// keyed by them. Read idx >= 10 ONLY via recCoinField (shorter rows read those
// positions as null).
// [0 sym, 1 price, 2 oiUsd, 3 funding%, 4 volZ, 5 strength, 6 regimeCode,
//  7 fb, 8 ea, 9 vol24hUsd,
//  10 change24h%, 11 ret4h%, 12 pos, 13 buyShare4h, 14 f8h%, 15 bbPctile,
//  16 lsDropPct, 17 rsPct, 18 oiDropPct, 19 spotVol24hUsd, 20 basisPct%,
//  21 oi4hPct (P1: null when OI untrusted — eval must skip, not treat as 0),
//  22 change1h%, 23 f24h%,
//  24 earlyPump (S14: 0|1 — pre-breakout markup fired live this sweep),
//  25 oiQty, 26 oiQty1hPct, 27 oiQty4hPct (null unless available/trusted)]
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
  number | null,
  // ---- v3 (R3) appends ----
  number,
  number | null,
  // ---- v4 (S14) appends ----
  0 | 1,
  // ---- v5 quantity OI appends ----
  number | null,
  number | null,
  number | null,
  // ---- v6 true taker-buy quote share ----
  number | null,
  // ---- v7 true spot taker-buy quote share ----
  number | null,
];

export interface ScanRecord {
  v?: number; // absent/1=legacy; ... 6=perp taker buy; 7=spot taker buy
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
  // S6: squeeze reads [setup01, breakout01] per coin, SPARSE — only coins where
  // at least one flag is 1 (353 all-zero entries per sweep would bloat the file).
  // Absent key ⇒ [0,0]. Recorder-only, same reason as spotSignals.
  squeezeSignals?: Record<string, [0 | 1, 0 | 1]>;
  // S9/S10/S11 (2026-07-06): per-def evidence streams for E1 revalidation, same
  // sparse convention. rebuild [R1,R2,R3] (R1 shipped ×2.60); top [T1..T4]
  // (SHORT, all n<20 → recording-only); wbottom [W1,W2,W3] (W2 died on the
  // t10/h48 cross-target cell → recording-only).
  rebuildSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
  topSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1, 0 | 1]>;
  wbottomSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
  // S13 (2026-07-07): virgin [V1,V2,V3] — V2 shipped ×2.76, V1/V3 recording-only
  virginSignals?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
  // E3 (2026-07-08): BTC regime at sweep time for per-regime lift stratification.
  // Absent on pre-E3 recordings → those slots are excluded from regime-filtered eval.
  btcRegime?: 'up' | 'down' | 'chop';
  btcRet7d?: number;
}

export const REC_SLOT_MS = 15 * 60 * 1000;

// S4e phase 1: per-sweep liquidation-event capture for candidate coins
// (collection only — the estimated-liq-level heat model and anything signal-
// shaped are locked behind the validation gates in docs/roadmap/S4e-liquidations.md).
// Own JSONL line; every reader skips it via `type` exactly like sweep-meta.
// `cands` records coverage so "no events" is distinguishable from "not polled".
// Event tuple: [tsMs, bkPx, usd, dir01] — dir 0 = long liquidated (forced
// sell), 1 = short liquidated (forced buy). Recorder-only, like spotSignals.
export interface LiqRecord {
  type: 'liq';
  v: number;
  slot: number;
  ts: number;
  cands: string[];
  ev: Record<string, Array<[number, number, number, 0 | 1]>>;
}

export function buildLiqRecord(
  tsMs: number,
  cands: string[],
  ev: Record<string, Array<[number, number, number, 0 | 1]>>,
): LiqRecord {
  return { type: 'liq', v: 1, slot: Math.floor(tsMs / REC_SLOT_MS), ts: tsMs, cands, ev };
}

const REGIME_CODE: Record<Regime, string> = { accumulate: 'A', pump: 'P', distribute: 'D' };

const sig = (x: number, p = 6) => Number(x.toPrecision(p));
const fix = (x: number, d: number) => Number(x.toFixed(d));
const fixN = (x: number | null | undefined, d: number): number | null =>
  x == null ? null : Number(x.toFixed(d));

export function buildScanRecord(coins: CoinLite[], tsMs: number, source: ScanSource): ScanRecord {
  return {
    v: 7,
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
        // idx21 — 令未來 eval 可加返 OI-flat gate 對齊 live detector。P1: null when
        // untrusted (laggy series) so eval fail-closes exactly like the live gates.
        c.oiTrusted === false ? null : fix(c.oi4h, 2),
        // ---- v3 (R3) appends ----
        fix(c.change1h, 2), // idx22 — mildRise 精確 replay 用
        fixN(c.f24h, 4), // idx23 — funding-overheat / extreme-negative replay 用
        // ---- v4 (S14) appends ----
        c.earlyPump ? 1 : 0, // idx24 — 早期拉盤 live fire (E1 evidence for notify promotion)
        // ---- v5 raw-contract OI appends; never derived from oiUsd ----
        c.oiQty == null ? null : sig(c.oiQty, 10), // idx25 current quantity
        fixN(c.oiQty1h, 4), // idx26 trusted 1h % change
        fixN(c.oiQty4h, 4), // idx27 trusted 4h % change
        fixN(f?.takerBuyShare4h, 4), // idx28 true taker BUY quote share
        fixN(f?.spotTakerBuyShare4h, 4), // idx29 true SPOT taker BUY quote share
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
  squeezeSignals?: Record<string, [0 | 1, 0 | 1]>,
  // S9/S10/S11 evidence streams — one optional trailing bag so existing callers
  // (the browser writer passes neither) stay source-compatible
  extra?: {
    rebuild?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
    top?: Record<string, [0 | 1, 0 | 1, 0 | 1, 0 | 1]>;
    wbottom?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
    virgin?: Record<string, [0 | 1, 0 | 1, 0 | 1]>;
    regime?: { regime: 'up' | 'down' | 'chop'; ret7d: number } | null, // E3
  },
): SweepMeta {
  const meta: SweepMeta = {
    type: 'sweep-meta',
    v: 3,
    slot: Math.floor(tsMs / REC_SLOT_MS),
    ts: tsMs,
    coins: coinCount,
    durationMs,
  };
  if (spotSignals && Object.keys(spotSignals).length) meta.spotSignals = spotSignals;
  if (squeezeSignals && Object.keys(squeezeSignals).length) meta.squeezeSignals = squeezeSignals;
  if (extra?.rebuild && Object.keys(extra.rebuild).length) meta.rebuildSignals = extra.rebuild;
  if (extra?.top && Object.keys(extra.top).length) meta.topSignals = extra.top;
  if (extra?.wbottom && Object.keys(extra.wbottom).length) meta.wbottomSignals = extra.wbottom;
  if (extra?.virgin && Object.keys(extra.virgin).length) meta.virginSignals = extra.virgin;
  if (extra?.regime) {
    meta.btcRegime = extra.regime.regime;
    meta.btcRet7d = extra.regime.ret7d;
  }
  return meta;
}
