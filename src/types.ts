export type Regime = 'accumulate' | 'pump' | 'distribute';

export interface Candle {
  time: number; // unix seconds; stored at the 5m base resolution
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SeriesPoint {
  time: number;
  value: number;
}

export interface VolumeBar {
  time: number;
  value: number; // USD notional
  up: boolean;
}

// what the entry level MEANS — anchored to structure, not to fetch time
export type EntryKind = 'breakout' | 'pullback' | 'reclaim';

export interface ExitPlan {
  entry: number;
  kind: EntryKind;
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  runnerPct: number;
}

export interface Signals {
  fundsFirst: boolean; // 低位資金先動
  mildRise: boolean; // 1h 溫和抬升
  oiHealthy: boolean; // OI 健康增加
  buyHealthy: boolean; // 主動買盤健康
}

export interface Coin {
  symbol: string;
  regime: Regime;
  strength: number; // 0-100 composite
  change1h: number; // pct
  oi4h: number; // pct change over 4h
  funding: number; // current rate in %
  volZ: number; // volume z-score
  vol24h: number; // USD
  oiUsd?: number | null; // absolute open interest in USD (bulk snapshot, live scan only)
  spotVol24h?: number | null; // S1: 24h spot USD volume (bulk spot ticker); null if no spot pair
  basisPct?: number | null; // S1: perp/spot basis % = (perpLast/spotLast − 1)×100; null if no spot pair
  // S2 candidate-tier spot series for the cross-source detectors; present only
  // when a spot pair exists AND the coin was a spot-fetch candidate this sweep
  // (or on any coin opened in the detail view). All absent on demo/older coins.
  spotCandles?: Candle[]; // spot 5m klines (~48h), same shape as perp candles
  spotVolume?: VolumeBar[]; // spot 5m volume bars aligned to spotCandles (Candle carries no volume; spot-volume-z needs it)
  spotTakerBuyShare24h?: number | null; // spot taker BUY share over 24h (rubik SPOT taker-volume, ratio-only); null if no spot pair or fetch failed
  flushBreakout: boolean; // backtested 縮倉突破 trigger (analyze.detectFlushBreakout)
  earlyAccum: EarlyAccum | null; // watchlist-tier 早期蓄力 (set by the data layer)
  riskFlags: string[];
  signals: Signals;
  plan: ExitPlan;
  candles: Candle[];
  volume: VolumeBar[];
  oi: SeriesPoint[];
  fundingHist: SeriesPoint[];
  strengthHist: SeriesPoint[];
  // optional 1H-resolution long-history series (~25-30 days) for the detail
  // chart's higher timeframes; absent in demo/older-cache coins (1h/4h then
  // gracefully fall back to aggregating the 48h 5m base)
  long?: LongSeries;
}

// A second, coarser+longer series attached to a detail Coin. Same shape as the
// 5m base but sampled at 1H, so 1h/4h timeframes show weeks instead of 12 bars.
export interface LongSeries {
  candles: Candle[];
  volume: VolumeBar[];
  oi: SeriesPoint[];
  fundingHist: SeriesPoint[];
  strengthHist: SeriesPoint[];
}

export type ScanSource = 'okx' | 'demo';

// Notification config (persisted under kv key 'notify'; edited in the 設定 tab,
// read by the headless recorder). Telegram + Windows toast on rising-edge ⚡.
export interface NotifyCfg {
  telegramToken: string;
  telegramChatId: string;
  toast: boolean; // fire a Windows toast too
  cooldownH: number; // per-coin cooldown, hours
}

// per-symbol timestamps of when each signal state was first entered
// (continuous-presence semantics: cleared when the state turns off)
export interface SignalTimesEntry {
  top10?: number; // first entered the strength top-10
  fb?: number; // ⚡ 縮倉突破 first fired
  ea?: number; // 蓄 早期蓄力 first fired
}
export type SignalTimes = Record<string, SignalTimesEntry>;

// 早期蓄力 watchlist confirmation numbers (see lib/analyze.ts for thresholds
// and the backtest evidence behind them)
export interface EarlyAccum {
  oiDropPct: number;
  lsDropPct: number;
  rsPct: number;
}

// Recording v2 feature vector — the detector inputs a replay/backtest needs but
// the v1 row (derived metrics only) couldn't reconstruct. Computed by
// lib/analyze.featureVector on the 15m aggregation, so it matches what live
// detectors see. Recorded per coin per sweep (src/lib/recording.ts).
export interface RecFeatures {
  ret4h: number; // % over 4h
  pos: number; // 0..1 range position over 24h
  buyShare4h: number; // 0..1 taker-buy share over 4h
  f8h: number; // funding rate 8h ago, %
  bbPctile: number; // 0..1 Bollinger-bandwidth percentile in the window
}

// Lightweight screener row — the rolling full-market scan keeps only derived
// metrics per coin (full series for ~250 coins would cost hundreds of MB);
// detail views fetch the full series on demand.
export interface CoinLite {
  symbol: string;
  regime: Regime;
  strength: number;
  change1h: number;
  change24h: number;
  oi4h: number;
  funding: number;
  volZ: number;
  vol24h: number;
  lastPrice: number;
  spark?: number[]; // 24h closes @ 30-min resolution (~48 pts, 5 sig figs) from toLite; optional so old cache/demo/recorded coins typecheck
  oiUsd: number | null; // absolute open interest (USD) from the bulk snapshot; recorder logs this
  flushBreakout: boolean; // backtested 縮倉突破 trigger is live on this coin
  earlyAccum: boolean; // 早期蓄力 watchlist flag
  spotPump?: boolean; // S2 現貨帶動 (spot-led-pump, backtest lift ×1.79); only on candidate coins with spot data
  riskFlags: string[];
  signals: Signals;
  // recording-v2 feature vector + EA confirmation numbers; optional so demo
  // coins and older cached scans still typecheck. Set by okx.toLite on live
  // scans; consumed by lib/recording.buildScanRecord. Spot fields (S1) land later.
  feat?: RecFeatures & {
    lsDropPct?: number | null;
    rsPct?: number | null;
    oiDropPct?: number | null;
    spotVol24h?: number | null;
    basisPct?: number | null;
  };
}

export interface ScanProgress {
  done: number;
  total: number;
}

// U2 screener sort/filter — state lives in App (survives tab switches), applied
// in ScreenerList. Sortable columns are the numeric CoinLite fields.
export type ScreenerSortKey = 'strength' | 'change1h' | 'oi4h' | 'funding' | 'vol24h';
export type ScreenerSortDir = 'asc' | 'desc';

// a row in the search tab — any listed USDT perp, not just scanned coins
export interface SearchHit {
  instId: string;
  base: string;
  last: number;
  change24h: number; // pct
  vol24hUsd: number;
}

export interface ScanResult {
  coins: CoinLite[];
  scannedAt: number; // ms epoch
  source: ScanSource;
}

export const STRENGTH_THRESHOLD = 70;

// K-line timeframe. Series are stored at the 5m base resolution and aggregated
// up by `mult` base bars for display; the detail view stays in sync because
// every panel uses the same multiplier.
export type Timeframe = '5m' | '15m' | '1h' | '4h';
export type TfBase = '5m' | '1h';

// `base` = which stored series a timeframe aggregates from; `mult` = buckets of
// that base per display bar. 5m/15m ride the 5m base (48h); 1h/4h ride the 1H
// long series (~25d) when present. `mult5` is the equivalent 5m-base bucket
// size used as a fallback when a coin has no long series.
export const TIMEFRAMES: ReadonlyArray<{
  key: Timeframe;
  label: string;
  base: TfBase;
  mult: number;
  mult5: number;
}> = [
  { key: '5m', label: '5m', base: '5m', mult: 1, mult5: 1 },
  { key: '15m', label: '15m', base: '5m', mult: 3, mult5: 3 },
  { key: '1h', label: '1H', base: '1h', mult: 1, mult5: 12 },
  { key: '4h', label: '4H', base: '1h', mult: 4, mult5: 48 },
];
