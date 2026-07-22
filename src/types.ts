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
  // Binance kline field 10, quote-denominated taker BUY notional. Optional so
  // old caches/demo data keep their exact meaning. Never infer this from an up
  // candle: those are two different measurements.
  takerBuy?: number;
}

// ---- Ultimate Money Maker v1: common research / shadow interfaces ---------

export type StrategyId =
  | 'boarding-b2-v1'
  | 'boarding-b2-oi-v1'
  | 'ema20-reclaim-control-v1'
  | 'organic-spot-v0'
  | 'spot-led-v1'
  | 'virgin-v2'
  | 'rebuild-r1'
  | 'flush-breakout'
  | 'deep-reclaim-v0'
  | 'top-t1-reversal-v2'
  | 'wbottom-w2-uncrowded-v2';

export type StrategyCandidateStatus = 'shadow' | 'paper' | 'eligible' | 'rejected';
export type ExecutionPolicyId = 'time24-sl3-v1' | 'ladder-4-8-15-sl3-v1';

export interface DataCoverage {
  complete: boolean;
  barsExpected: number;
  barsObserved: number;
  contiguous: boolean;
  fundingComplete: boolean;
  reason?: string;
}

export interface StrategyCandidate {
  type: 'strategy-candidate';
  v: 1;
  id: string;
  strategyId: StrategyId;
  rulesetId: string;
  sym: string;
  decisionTs: number;
  signalPx: number;
  status: StrategyCandidateStatus;
  source: 'historical' | 'forward';
  side?: 'long' | 'short'; // absent on legacy rows means long
  regime?: 'up' | 'down' | 'chop';
  strength?: number;
  ema20?: number;
  ema50?: number;
  atr?: number;
  oiQty1h?: number | null;
  oiQty4h?: number | null;
  takerBuyShare4h?: number | null;
  spotVol24h?: number | null;
  perpVol24h?: number | null;
  basisPct?: number | null;
  reason?: string;
}

export interface ThresholdOrdering {
  plus4At?: number;
  plus8At?: number;
  plus15At?: number;
  minus3At?: number;
  plus4BeforeMinus3: boolean;
}

export interface StrategyOutcome {
  type: 'strategy-outcome';
  v: 1;
  id: string;
  candidateId: string;
  strategyId: StrategyId;
  executionPolicyId: ExecutionPolicyId;
  sym: string;
  side?: 'long' | 'short'; // absent on legacy rows means long
  decisionTs: number;
  entryTs: number;
  entryPx: number;
  exitTs: number;
  exitPx: number;
  grossReturn: number; // decimal return on notional
  costReturn: number; // positive decimal cost deducted from gross
  fundingReturn: number; // signed decimal cost; negative funding is a credit
  netReturn: number;
  mfe: number;
  mae: number;
  ordering: ThresholdOrdering;
  coverage: DataCoverage;
  terminal: 'time' | 'stop' | 'ladder-complete' | 'insufficient-data';
}

export interface ExecutionPolicy {
  id: ExecutionPolicyId;
  roundTripCostBps: 30 | 60;
  hardStopPct: 3;
  maxHoldH: 24 | 48;
}

export interface PortfolioPolicy {
  id: 'balanced-v1';
  leverage: 1;
  riskPerTradePct: 0.5;
  maxPositionNotionalPct: 20;
  maxOpenPositions: 4;
  maxOpenRiskPct: 2;
  dailyLossBlockPct: 1.5;
  drawdownLockPct: 10;
}

export interface PromotionDecision {
  strategyId: StrategyId;
  stage: 'shadow' | 'paper';
  pass: boolean;
  reasons: string[];
  counts: { trades: number; coins: number; utcDays: number; months: number };
  netMean: number;
  maxDrawdown: number;
  matchedLift?: number;
  stressNetMean?: number;
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
  oi4h: number; // pct change over 4h (store-corrected when oiTrusted; else laggy series value)
  // P1: false ⇒ oi4h came from the laggy cold-path series (no warm/partial-warm
  // store data) — OI-gated signals fail closed and the UI tags the value 滯後.
  // Absent (demo/old cache) ⇒ treated as trusted, pre-P1 behaviour.
  oiTrusted?: boolean;
  // Raw-contract OI trends from the quantity-only warm store. Null/absent means
  // the as-of store lacked a fresh 1h/4h reference; never substitute USD OI.
  oiQty1h?: number | null;
  oiQty4h?: number | null;
  f24h?: number; // R3: funding rate 24h ago (%), same window as interpret buildCtx; recorded idx23
  funding: number; // current rate in %
  volZ: number; // volume z-score
  vol24h: number; // USD
  oiUsd?: number | null; // absolute open interest in USD (bulk snapshot, live scan only)
  oiQty?: number | null; // current raw Binance openInterest contract quantity
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
  // ~14d of 5m bars for the 5m/15m CHART tabs only (detail fetch, best-effort).
  // Display depth, NOT detector input: analyze/interpret/recording always read
  // the 48h base above, so signal reads stay identical to the sweep's.
  deep?: LongSeries;
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

// 'binance' = live data (since 2026-07-07); 'okx' = legacy live recordings from
// the OKX era — still readable everywhere, never written anymore. UI/eval code
// should test `!== 'demo'` for "is live", not a specific exchange literal.
export type ScanSource = 'binance' | 'okx' | 'demo';

// F1: visual theme. 'y2k' is the 🎀 pastel pixel skin — pure token overrides in
// theme.css, persisted under kv 'theme'; charts re-read colors via a
// theme-keyed remount.
export type ThemeName = 'dark' | 'y2k';

// Notification config (persisted under kv key 'notify'; edited in the 設定 tab,
// read by the headless recorder). Telegram + Windows toast on rising-edge ⚡.
export interface NotifyCfg {
  telegramToken: string;
  telegramChatId: string;
  toast: boolean; // fire a Windows toast too
  cooldownH: number; // per-coin cooldown, hours
  // Second-stage Telegram watch: after an eligible confirmed push, wait for a
  // frozen-support pullback/reclaim before sending an entry-ready follow-up.
  // Optional for backwards compatibility. Runtime treats absence as enabled
  // for App-only shadow collection; class promotion separately gates TG.
  entryWatchEnabled?: boolean;
  // Independent deep-reclaim v0 test feed. Optional/absent is ON for this
  // user-approved experimental deployment; false is the explicit opt-out.
  deepReclaimTestEnabled?: boolean;
}

// Headless Telegram notification classes. Keep this explicit rather than
// deriving an id from a persistence-key string (e.g. `fb-notified-headless`).
export type NotifySignalClass = 'fb' | 'rb' | 'vg';
export type NotifyDeliveryVia = 'photo' | 'text';

// Every first-stage card that Telegram confirmed as delivered. `px` is the
// price printed on that card: it is a signal reference, never represented as
// an executable fill. v3 records `attemptedAt` separately because a photo send
// can complete seconds after the attempt began.
export interface DeliveredSignal {
  id: string;
  sym: string;
  cls: NotifySignalClass;
  attemptedAt: number;
  ts: number; // Telegram success time, ms epoch
  deliveredAt: number; // explicit v3 provenance; equal to ts
  px: number; // TG card price / scan reference price
  strength: number;
  via: NotifyDeliveryVia;
  telegramMessageId?: number;
}

// One Telegram push that the Telegram API confirmed as delivered. `support`
// and `atr` are frozen at that moment and are intentionally distinct from
// `plan.entry`: fb/rb/vg are prior-high breakouts, while plan.entry can be an
// EMA pullback or another regime-dependent display level.
export interface DeliveredPush extends DeliveredSignal {
  plan: ExitPlan;
  support: number; // frozen breakout support, price units
  atr: number; // frozen clock-aligned 1H ATR14, price units
  // Frozen at first-stage delivery. False candidates still run as record-only
  // shadow watches, but can never emit the second Telegram notification.
  followupEnabled: boolean;
}

// notifyClassEdges' structured result: the current on-state remains available
// for rising-edge threading, while only confirmed Telegram sends appear in
// `delivered`; only `watchable` carries a complete frozen watch anchor.
export interface NotifyRunResult {
  current: Set<string>;
  delivered: DeliveredSignal[]; // every Telegram-confirmed first-stage card
  watchable: DeliveredPush[]; // delivered cards with complete frozen support/ATR/plan
}

export type EntryWatchStatus =
  | 'watching'
  | 'ready'
  | 'sending'
  | 'delivered'
  | 'expired'
  | 'missed'
  | 'invalidated'
  | 'superseded';

export type EntryWatchEventKind =
  | 'armed'
  | 'ready'
  | 'delivery-failed'
  | 'delivered'
  | 'expired'
  | 'missed'
  | 'invalid'
  | 'superseded';

// Durable second-stage candidate. There is at most one active candidate per
// symbol; a newer confirmed first push supersedes the older one. All thresholds
// are materialized here so a restart cannot move the entry band.
export interface EntryWatchCandidate {
  id: string;
  sourceId: string;
  sym: string;
  cls: NotifySignalClass;
  sourceTs: number;
  sourcePx: number;
  strength: number;
  via: NotifyDeliveryVia;
  telegramMessageId?: number;
  plan: ExitPlan;
  support: number;
  atr: number;
  followupEnabled: boolean;
  bandLow: number; // support - 0.5 ATR
  bandHigh: number; // support + 0.5 ATR
  invalidBelow: number; // support - 1 ATR; a 15m close below invalidates
  missedAbove: number; // source price +15%; continuation escaped without a pullback
  minReadyAt: number; // sourceTs +30m
  expiresAt: number; // sourceTs +24h
  status: EntryWatchStatus;
  lastBarTs: number; // last processed 15m close timestamp; 0 before the first
  lastPx?: number;
  readyAt?: number;
  readyPx?: number;
  terminalAt?: number;
  attemptCount: number;
  nextAttemptAt?: number;
}

// Append-only audit record for UI/history/restart reconciliation. `id` is the
// event id; `watchId` identifies the candidate across all of its transitions.
export interface EntryWatchEvent {
  type: 'entry-watch';
  v: 1;
  id: string;
  watchId: string;
  sourceId: string;
  event: EntryWatchEventKind;
  status: EntryWatchStatus;
  ts: number;
  sym: string;
  cls: NotifySignalClass;
  px: number;
  support: number;
  atr: number;
  bandLow: number;
  bandHigh: number;
  followupEnabled: boolean;
  replacedBy?: string;
  reason?: string;
}

export interface EntryWatchObservation {
  ts: number; // 15m bar CLOSE time, ms epoch
  high: number;
  low: number;
  close: number;
}

export interface EntryWatchTransition {
  candidate: EntryWatchCandidate;
  event?: EntryWatchEvent;
}

export interface EntryWatchState {
  v: 1;
  updatedAt: number;
  active: Record<string, EntryWatchCandidate>; // uppercase symbol -> candidate
}

// per-symbol timestamps of when each signal state was first entered
// (continuous-presence semantics: cleared when the state turns off)
export interface SignalTimesEntry {
  top10?: number; // first entered the strength top-10
  fb?: number; // ⚡ 縮倉突破 first fired
  ea?: number; // 蓄 早期蓄力 first fired
}
export type SignalTimes = Record<string, SignalTimesEntry>;

// E4: one logged reference signal from the 老詹抓妖 channel (manual entry —
// Telegram is protected, no API under the free constraint). The logbook is
// hypothesis fuel for E5/S7 and an audit trail of 老詹's own hit rate; it is
// NEVER a tuning/validation set (anti-overfit protocol, S7 spec).
export interface RefSignal {
  ts: number; // ms epoch of the source MESSAGE (anchor-provenance rule: forward
  // returns anchor to the recordings slot at this ts, never a nearby print)
  tsProvisional?: boolean; // true until the user confirms the real publish time
  src: string; // 'laozhan' (老詹抓妖)
  sym: string;
  side: 'LONG' | 'SHORT';
  kind: string; // 上車準備 | 蓄力加倉 | ...
  refStrength: number; // 老詹's 強度 score
  px: number; // price printed in the message
  tpPcts?: number[]; // TP ladder in % (e.g. [10, 25, 50])
  slPct?: number; // hard SL in % (e.g. -15)
  exits?: number[]; // scale-out fractions (e.g. [0.3, 0.3, 0.35], remainder = moonbag)
  refHitRate?: { alerts: number; wins: number; bestPct: number; windowDays: number }; // his self-reported 歷史 footer
  notes?: string;
  // v2 provenance: provisional chart-cross estimates must never enter a
  // promotion gate as though they were real Telegram publication timestamps.
  anchorMethod?: 'actual-message' | 'chart-entry-cross-estimate';
  uncertaintyMs?: number;
  gateEligible?: boolean;
}

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
  buyShare4h: number; // legacy 0..1 up-candle quote-volume share over 4h
  takerBuyShare4h?: number | null; // true Binance taker-buy quote share; absent on old/cache data
  spotTakerBuyShare4h?: number | null; // true SPOT taker-buy quote share over completed 5m bars
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
  oiTrusted?: boolean; // P1: see Coin.oiTrusted — false ⇒ laggy value, gates fail closed
  oiQty1h?: number | null; // trusted raw-contract OI change; unavailable => null
  oiQty4h?: number | null; // trusted raw-contract OI change; unavailable => null
  f24h?: number | null; // R3: funding 24h ago (%) for recording idx23; null/absent on demo/old cache
  funding: number;
  volZ: number;
  vol24h: number;
  lastPrice: number;
  spark?: number[]; // 24h closes @ 30-min resolution (~48 pts, 5 sig figs) from toLite; optional so old cache/demo/recorded coins typecheck
  oiUsd: number | null; // absolute open interest (USD) from the bulk snapshot; recorder logs this
  oiQty?: number | null; // raw Binance openInterest contracts; recorder v5 idx25
  flushBreakout: boolean; // backtested 縮倉突破 trigger is live on this coin
  earlyAccum: boolean; // 早期蓄力 watchlist flag
  spotPump?: boolean; // S2 現貨帶動 (spot-led-pump, backtest lift ×1.79); only on candidate coins with spot data
  rebuildBreakout?: boolean; // S9 增倉突破 (rebuild-R1, backtest lift ×2.60); absent on demo/old cache
  virginBreakout?: boolean; // S13 處女增倉 (virgin-V2, backtest lift ×2.76); absent on demo/old cache
  earlyPump?: boolean; // S14 早期拉盤 (pre-breakout markup, backtest lift ×1.73, ~6.5h earlier than ⚡); badge only, NOT notify (E1/E2 gate that); absent on demo/old cache
  igniting?: boolean; // 5m 點火 (2026-07-09) — real-time ignition ramp on the 5m clock; catches pumps 15-55 min earlier than 1H detectors; badge on, notify gated pending FP; absent on demo/old cache
  riskFlags: string[];
  signals: Signals;
  // recording-v2 feature vector + EA confirmation numbers; optional so demo
  // coins and older cached scans still typecheck. Set by binance.toLite on live
  // scans; consumed by lib/recording.buildScanRecord. Spot fields (S1) land later.
  feat?: RecFeatures & {
    lsDropPct?: number | null;
    rsPct?: number | null;
    oiDropPct?: number | null;
    spotVol24h?: number | null;
    basisPct?: number | null;
    spotTakerBuyShare4h?: number | null;
  };
}

export interface ScanProgress {
  done: number;
  total: number;
  btcRet24h?: number | null;
}

// U2 screener sort/filter — state lives in App (survives tab switches), applied
// in ScreenerList. Sortable columns are the numeric CoinLite fields.
export type ScreenerSortKey = 'strength' | 'change1h' | 'oi4h' | 'funding' | 'vol24h';
export type ScreenerSortDir = 'asc' | 'desc';

// a row in the search tab — any listed USDT perp, not just scanned coins
export interface SearchHit {
  instId: string; // raw Binance symbol (may carry a 1000×/1M× prefix); base is the app-wide identity
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
