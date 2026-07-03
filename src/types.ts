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
}

export type ScanSource = 'okx' | 'demo';

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
  flushBreakout: boolean; // backtested 縮倉突破 trigger is live on this coin
  earlyAccum: boolean; // 早期蓄力 watchlist flag
  riskFlags: string[];
  signals: Signals;
}

export interface ScanProgress {
  done: number;
  total: number;
}

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

export const TIMEFRAMES: ReadonlyArray<{ key: Timeframe; label: string; mult: number }> = [
  { key: '5m', label: '5m', mult: 1 },
  { key: '15m', label: '15m', mult: 3 },
  { key: '1h', label: '1H', mult: 12 },
  { key: '4h', label: '4H', mult: 48 },
];
