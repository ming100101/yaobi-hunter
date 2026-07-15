/**
 * deep-reclaim-v0
 *
 * Pure, evidence-gated geometry + quantity-OI state machine.  This module has
 * deliberately no dependency on the scanner, persistence, notifications, or
 * shared application types.  Callers are expected to persist events/state and
 * decide whether an evidence gate permits any external notification.
 */

export const DEEP_RECLAIM_STRATEGY = 'deep-reclaim-v0' as const;
export const DEEP_RECLAIM_STATE_VERSION = 1 as const;
export const DEEP_RECLAIM_EVENT_VERSION = 1 as const;
export const DEEP_RECLAIM_RANK_VERSION = 1 as const;
export const DEEP_RECLAIM_RULESET_ID = 'deep-reclaim-v0-rules@2026-07-13' as const;
export const DEEP_RECLAIM_LEGACY_RULESET_ID = 'deep-reclaim-legacy-unversioned' as const;
export const DEEP_RECLAIM_SELECTION_POLICY_ID = 'deep-reclaim-top1-v2@2026-07-14' as const;
export const DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID = 'deep-reclaim-selection-legacy-unversioned' as const;

export const DEEP_RECLAIM_SLOT_MS = 15 * 60 * 1000;
export const DEEP_RECLAIM_MIN_BARS = 100;
export const DEEP_RECLAIM_DD_WINDOW_BARS = 96;
export const DEEP_RECLAIM_DD_MIN_PCT = 6;
export const DEEP_RECLAIM_DD_MAX_PCT = 20;
export const DEEP_RECLAIM_TROUGH_MIN_AGE_BARS = 4;
export const DEEP_RECLAIM_TROUGH_MAX_AGE_BARS = 80;
export const DEEP_RECLAIM_POS_MAX = 0.7;
export const DEEP_RECLAIM_RET4H_MAX_PCT = 6;
export const DEEP_RECLAIM_CONFIRM_ATR = 0.5;
export const DEEP_RECLAIM_MISSED_ATR = 2;
export const DEEP_RECLAIM_OI_MAX_AGE_MS = 10 * 60 * 1000;
export const DEEP_RECLAIM_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Frozen production geometry. Research sensitivity cells must pass an explicit copy. */
export interface DeepReclaimGeometryRules {
  ddMinPct: number;
  ddMaxPct: number;
  troughMinAgeBars: number;
  troughMaxAgeBars: number;
  posMax: number;
  ret4hMaxPct: number;
}

export const DEEP_RECLAIM_GEOMETRY_V0: Readonly<DeepReclaimGeometryRules> = Object.freeze({
  ddMinPct: DEEP_RECLAIM_DD_MIN_PCT,
  ddMaxPct: DEEP_RECLAIM_DD_MAX_PCT,
  troughMinAgeBars: DEEP_RECLAIM_TROUGH_MIN_AGE_BARS,
  troughMaxAgeBars: DEEP_RECLAIM_TROUGH_MAX_AGE_BARS,
  posMax: DEEP_RECLAIM_POS_MAX,
  ret4hMaxPct: DEEP_RECLAIM_RET4H_MAX_PCT,
});

/** Repo-compatible 5m input. `time` is a UTC bucket-open epoch in seconds. */
export interface DeepReclaim5mCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A completed, canonical UTC 15m OHLC bar. `closeTs` is epoch milliseconds. */
export interface DeepReclaimBar {
  closeTs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Quantity OI percentage changes observed no later than the associated bar. */
export interface DeepReclaimOiObservation {
  observedAt: number;
  qty1h: number;
  qty4h: number;
}

export type DeepReclaimOiDecisionCode = 'pass' | 'missing' | 'stale' | 'future' | 'rejected';

export interface DeepReclaimOiDecision {
  code: DeepReclaimOiDecisionCode;
  qualified: boolean;
  fresh: boolean;
  reason: string;
}

export interface DeepReclaimPriceCandidate {
  strategy: typeof DEEP_RECLAIM_STRATEGY;
  rulesetId: string;
  sym: string;
  setupTs: number;
  setupClose: number;
  barCount: number;
  peakTs: number;
  peakHigh: number;
  troughTs: number;
  troughLow: number;
  troughAgeBars: number;
  ddPct: number;
  high24: number;
  low24: number;
  pos24: number;
  ret4hPct: number;
  ema20: number;
  ema20Prev: number;
  ema50: number;
  emaSlopePct: number;
  atr14: number;
  l0: number;
  bandLow: number;
  bandHigh: number;
  invalidBelow: number;
  missedAbove: number;
  setupDistanceToL0Pct: number;
  setupDistanceToL0Atr: number;
  expiresAt: number;
  rankVersion: typeof DEEP_RECLAIM_RANK_VERSION;
  rankScore: number;
}

export type DeepReclaimPriceRejectReason =
  | 'insufficient-bars'
  | 'invalid-bars'
  | 'bar-gap'
  | 'drawdown-unavailable'
  | 'drawdown-out-of-range'
  | 'trough-age-out-of-range'
  | 'flat-range'
  | 'position-too-high'
  | 'momentum-out-of-range'
  | 'ema-not-ready'
  | 'ema-not-fresh-reclaim'
  | 'ema-not-rising'
  | 'atr-not-ready'
  | 'invalid-level'
  | 'already-extended';

export type DeepReclaimPriceEvaluation =
  | { qualified: true; candidate: DeepReclaimPriceCandidate }
  | { qualified: false; reason: DeepReclaimPriceRejectReason };

/**
 * Audit record returned once price geometry qualifies, even when OI does not.
 * This keeps "price setup, OI failed/missing" distinct from "no price setup".
 */
export interface DeepReclaimDetection {
  price: DeepReclaimPriceCandidate;
  oiQualified: boolean;
  oiDecision: DeepReclaimOiDecision;
  oi: DeepReclaimOiObservation | null;
}

export type DeepReclaimStatus =
  | 'watching'
  | 'confirmed'
  | 'invalidated'
  | 'missed'
  | 'oi-rejected'
  | 'expired';

/** Optional operational delivery state; independent of the market lifecycle. */
export type DeepReclaimDeliveryStatus =
  | 'shadow'
  | 'selected'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'uncertain';

export type DeepReclaimEventKind =
  | 'armed'
  | 'confirmed'
  | 'invalid'
  | 'missed'
  | 'oi-rejected'
  | 'oi-wait'
  | 'expired';

export interface DeepReclaimWatch extends DeepReclaimPriceCandidate {
  v: typeof DEEP_RECLAIM_STATE_VERSION;
  id: string;
  status: DeepReclaimStatus;
  setupOi: DeepReclaimOiObservation;
  lastBarTs: number;
  lastPx?: number;
  lastOiDecision?: DeepReclaimOiDecisionCode;
  lastOiWaitAt?: number;
  confirmedAt?: number;
  confirmedPx?: number;
  terminalAt?: number;
  delivery?: DeepReclaimDeliveryStatus;
  telegramMessageId?: number;
  earlyDeliveredAt?: number;
  attemptCount?: number;
  nextAttemptAt?: number;
  buyShare4h?: number;
  operationalScore?: number;
  selectionPolicyId?: string;
}

export interface DeepReclaimEvent {
  type: 'deep-reclaim';
  v: typeof DEEP_RECLAIM_EVENT_VERSION;
  strategy: typeof DEEP_RECLAIM_STRATEGY;
  rulesetId: string;
  selectionPolicyId?: string;
  cohortMonth: string;
  id: string;
  watchId: string;
  event: DeepReclaimEventKind;
  status: DeepReclaimStatus;
  ts: number;
  sym: string;
  px: number;
  setupTs: number;
  waitedMinutes: number;
  distanceToL0Pct: number;
  peakHigh: number;
  troughLow: number;
  troughAgeBars: number;
  ddPct: number;
  pos24: number;
  ret4hPct: number;
  ema20: number;
  ema50: number;
  atr14: number;
  l0: number;
  bandLow: number;
  bandHigh: number;
  invalidBelow: number;
  missedAbove: number;
  expiresAt: number;
  rankVersion: typeof DEEP_RECLAIM_RANK_VERSION;
  rankScore: number;
  oiDecision?: DeepReclaimOiDecisionCode;
  oiObservedAt?: number;
  qty1h?: number;
  qty4h?: number;
  reason?: string;
}

export interface DeepReclaimTransition {
  candidate: DeepReclaimWatch;
  event?: DeepReclaimEvent;
}

export interface DeepReclaimArmResult {
  candidate: DeepReclaimWatch | null;
  event?: DeepReclaimEvent;
  oiDecision: DeepReclaimOiDecision;
}

export interface DeepReclaimState {
  v: typeof DEEP_RECLAIM_STATE_VERSION;
  updatedAt: number;
  active: Record<string, DeepReclaimWatch>;
}

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function positive(x: unknown): x is number {
  return finite(x) && x > 0;
}

function cleanTimestamp(name: string, x: number): number {
  if (!finite(x) || x < 0) throw new RangeError(`${name} must be a non-negative finite timestamp`);
  return Math.trunc(x);
}

function symbolOf(sym: string): string {
  const out = String(sym).trim().toUpperCase();
  if (!out) throw new TypeError('symbol must not be empty');
  return out;
}

function validOhlc(x: Pick<DeepReclaimBar, 'open' | 'high' | 'low' | 'close'>): boolean {
  return (
    positive(x.open) &&
    positive(x.high) &&
    positive(x.low) &&
    positive(x.close) &&
    x.low <= x.open &&
    x.low <= x.close &&
    x.high >= x.open &&
    x.high >= x.close
  );
}

function sameOhlc(a: DeepReclaim5mCandle, b: DeepReclaim5mCandle): boolean {
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
}

/**
 * Canonical completed-15m builder.
 *
 * A UTC 15m bucket is emitted only when it has the exact three unique 5m opens
 * at +0/+300/+600 seconds and its bucket close is no later than `nowMs`.
 * Identical duplicate rows are harmless; conflicting duplicates reject the
 * whole bucket.  Input order is irrelevant and the input is never mutated.
 */
export function closed15mBars(candles5m: DeepReclaim5mCandle[], nowMs: number): DeepReclaimBar[] {
  const now = cleanTimestamp('nowMs', nowMs);
  interface Bucket {
    rows: Map<number, DeepReclaim5mCandle>;
    conflict: boolean;
  }
  const buckets = new Map<number, Bucket>();
  for (const raw of candles5m) {
    if (!finite(raw.time) || Math.trunc(raw.time) !== raw.time || raw.time < 0 || raw.time % 300 !== 0) continue;
    if (!validOhlc(raw)) continue;
    const bucket = Math.floor(raw.time / 900) * 900;
    let group = buckets.get(bucket);
    if (!group) {
      group = { rows: new Map(), conflict: false };
      buckets.set(bucket, group);
    }
    const old = group.rows.get(raw.time);
    if (old) {
      if (!sameOhlc(old, raw)) group.conflict = true;
      continue;
    }
    group.rows.set(raw.time, { ...raw });
  }

  const out: DeepReclaimBar[] = [];
  for (const bucket of [...buckets.keys()].sort((a, b) => a - b)) {
    const closeTs = (bucket + 900) * 1000;
    if (closeTs > now) continue;
    const group = buckets.get(bucket)!;
    const expected = [bucket, bucket + 300, bucket + 600];
    if (group.conflict || group.rows.size !== 3 || expected.some((t) => !group.rows.has(t))) continue;
    const rows = expected.map((t) => group.rows.get(t)!);
    out.push({
      closeTs,
      open: rows[0].open,
      high: Math.max(...rows.map((r) => r.high)),
      low: Math.min(...rows.map((r) => r.low)),
      close: rows[2].close,
    });
  }
  return out;
}

function normalizeBars(input: DeepReclaimBar[]):
  | { ok: true; bars: DeepReclaimBar[] }
  | { ok: false; reason: Extract<DeepReclaimPriceRejectReason, 'invalid-bars' | 'bar-gap'> } {
  const bars = input.map((b) => ({ ...b })).sort((a, b) => a.closeTs - b.closeTs);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (
      !finite(b.closeTs) ||
      Math.trunc(b.closeTs) !== b.closeTs ||
      b.closeTs <= 0 ||
      b.closeTs % DEEP_RECLAIM_SLOT_MS !== 0 ||
      !validOhlc(b)
    ) return { ok: false, reason: 'invalid-bars' };
    if (i > 0) {
      const gap = b.closeTs - bars[i - 1].closeTs;
      if (gap === 0) return { ok: false, reason: 'invalid-bars' };
      if (gap !== DEEP_RECLAIM_SLOT_MS) return { ok: false, reason: 'bar-gap' };
    }
  }
  return { ok: true, bars };
}

function emaSeries(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  if (closes.length < period) return out;
  let ema = closes.slice(0, period).reduce((sum, x) => sum + x, 0) / period;
  out[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function atr14At(bars: DeepReclaimBar[], i: number): number | null {
  if (i < 14) return null;
  let sum = 0;
  for (let j = i - 13; j <= i; j++) {
    const b = bars[j];
    const prevClose = bars[j - 1].close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  }
  const atr = sum / 14;
  return positive(atr) ? atr : null;
}

interface DrawdownPoint {
  peakIndex: number;
  peakHigh: number;
  troughIndex: number;
  troughLow: number;
  ddPct: number;
}

// Running-high is evaluated before the later bar's low, then updated after the
// bar.  A same-bar high/low can therefore never manufacture an earlier peak.
function causalMaxDrawdown(bars: DeepReclaimBar[], start: number, end: number): DrawdownPoint | null {
  if (end <= start) return null;
  let runningHigh = bars[start].high;
  let runningHighIndex = start;
  let best: DrawdownPoint | null = null;
  for (let j = start + 1; j <= end; j++) {
    const troughLow = bars[j].low;
    const ddPct = ((runningHigh - troughLow) / runningHigh) * 100;
    // On an exact repeated low, the most recent trough wins.  That makes the
    // age rule reflect the latest test of the low without changing drawdown.
    if (ddPct >= 0 && (!best || ddPct > best.ddPct || (ddPct === best.ddPct && j > best.troughIndex))) {
      best = { peakIndex: runningHighIndex, peakHigh: runningHigh, troughIndex: j, troughLow, ddPct };
    }
    if (bars[j].high > runningHigh) {
      runningHigh = bars[j].high;
      runningHighIndex = j;
    }
  }
  return best;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Versioned operational ranking only; it is not an eligibility or alpha gate.
 * Proximity to L0 dominates, followed by drawdown depth, anti-chase position,
 * trough recency and bounded positive momentum.
 */
export function deepReclaimRankScore(c: Omit<DeepReclaimPriceCandidate, 'rankVersion' | 'rankScore'>): number {
  const proximity = clamp01(1 - Math.max(0, c.l0 - c.setupClose) / (2 * c.atr14));
  const depth = clamp01((c.ddPct - DEEP_RECLAIM_DD_MIN_PCT) / (DEEP_RECLAIM_DD_MAX_PCT - DEEP_RECLAIM_DD_MIN_PCT));
  const position = clamp01(1 - c.pos24 / DEEP_RECLAIM_POS_MAX);
  const recency = clamp01(
    (DEEP_RECLAIM_TROUGH_MAX_AGE_BARS - c.troughAgeBars) /
      (DEEP_RECLAIM_TROUGH_MAX_AGE_BARS - DEEP_RECLAIM_TROUGH_MIN_AGE_BARS),
  );
  const momentum = clamp01(c.ret4hPct / DEEP_RECLAIM_RET4H_MAX_PCT);
  return Number((40 * proximity + 20 * depth + 15 * position + 15 * recency + 10 * momentum).toFixed(3));
}

export function rankDeepReclaimCandidates(
  candidates: DeepReclaimPriceCandidate[],
): DeepReclaimPriceCandidate[] {
  return candidates
    .map((c) => ({ ...c }))
    .sort(
      (a, b) =>
        b.rankScore - a.rankScore ||
        b.ddPct - a.ddPct ||
        b.setupTs - a.setupTs ||
        a.sym.localeCompare(b.sym),
    );
}

/**
 * Frozen live Top-1 score. It is ranking-only and must never replace the
 * detector's price-only `rankScore` in research records.
 */
export function deepReclaimOperationalScore(
  price: DeepReclaimPriceCandidate,
  oi: DeepReclaimOiObservation | null,
  buyShare4h: number,
): number {
  const oi4 = oi ? 25 * clamp01((oi.qty4h - 3) / 7) : 0;
  const oi1 = oi ? 10 * clamp01(oi.qty1h / 3) : 0;
  const buy = 15 * clamp01((buyShare4h - 0.55) / 0.2);
  return Number((0.5 * price.rankScore + oi4 + oi1 + buy).toFixed(3));
}

export interface DeepReclaimOperationalRankInput {
  sym: string;
  setupTs: number;
  ddPct: number;
  rankScore: number;
  operationalScore?: number;
}

export function compareDeepReclaimOperationalCandidates(
  a: DeepReclaimOperationalRankInput,
  b: DeepReclaimOperationalRankInput,
): number {
  return (b.operationalScore ?? b.rankScore) - (a.operationalScore ?? a.rankScore) ||
    b.rankScore - a.rankScore ||
    b.ddPct - a.ddPct ||
    b.setupTs - a.setupTs ||
    a.sym.localeCompare(b.sym);
}

/** Exact total order used by the live per-sweep Top-1 selector. */
export function rankDeepReclaimOperationalCandidates<
  T extends DeepReclaimOperationalRankInput,
>(candidates: T[]): T[] {
  return candidates
    .map((candidate) => ({ ...candidate }))
    .sort(compareDeepReclaimOperationalCandidates);
}

function assertGeometryRules(rules: DeepReclaimGeometryRules): void {
  if (
    !finite(rules.ddMinPct) || !finite(rules.ddMaxPct) || rules.ddMinPct <= 0 || rules.ddMinPct >= rules.ddMaxPct ||
    !Number.isInteger(rules.troughMinAgeBars) || !Number.isInteger(rules.troughMaxAgeBars) ||
    rules.troughMinAgeBars < 1 || rules.troughMinAgeBars >= rules.troughMaxAgeBars ||
    rules.troughMaxAgeBars >= DEEP_RECLAIM_DD_WINDOW_BARS ||
    !finite(rules.posMax) || rules.posMax <= 0 || rules.posMax > 1 ||
    !finite(rules.ret4hMaxPct) || rules.ret4hMaxPct <= 0
  ) throw new RangeError('invalid deep-reclaim research geometry rules');
}

/**
 * Research-only sensitivity seam. Runtime callers must use evaluateDeepReclaimPrice,
 * which always supplies the frozen v0 rules below.
 */
export function evaluateDeepReclaimPriceWithRules(
  sym: string,
  input: DeepReclaimBar[],
  rules: DeepReclaimGeometryRules,
): DeepReclaimPriceEvaluation {
  assertGeometryRules(rules);
  const cleanSym = symbolOf(sym);
  if (input.length < DEEP_RECLAIM_MIN_BARS) return { qualified: false, reason: 'insufficient-bars' };
  const normalized = normalizeBars(input);
  if (!normalized.ok) return { qualified: false, reason: normalized.reason };
  const bars = normalized.bars;
  const i = bars.length - 1;
  const start = i - (DEEP_RECLAIM_DD_WINDOW_BARS - 1);
  const dd = causalMaxDrawdown(bars, start, i);
  if (!dd) return { qualified: false, reason: 'drawdown-unavailable' };
  if (dd.ddPct < rules.ddMinPct || dd.ddPct > rules.ddMaxPct) {
    return { qualified: false, reason: 'drawdown-out-of-range' };
  }
  const troughAgeBars = i - dd.troughIndex;
  if (troughAgeBars < rules.troughMinAgeBars || troughAgeBars > rules.troughMaxAgeBars) {
    return { qualified: false, reason: 'trough-age-out-of-range' };
  }

  let high24 = -Infinity;
  let low24 = Infinity;
  for (let j = start; j <= i; j++) {
    high24 = Math.max(high24, bars[j].high);
    low24 = Math.min(low24, bars[j].low);
  }
  if (!(high24 > low24)) return { qualified: false, reason: 'flat-range' };
  const setupClose = bars[i].close;
  const pos24 = (setupClose - low24) / (high24 - low24);
  if (pos24 > rules.posMax) return { qualified: false, reason: 'position-too-high' };

  const ret4hPct = (setupClose / bars[i - 16].close - 1) * 100;
  if (!(ret4hPct > 0) || ret4hPct > rules.ret4hMaxPct) {
    return { qualified: false, reason: 'momentum-out-of-range' };
  }

  const closes = bars.map((b) => b.close);
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const ema20 = e20[i];
  const ema20Prev = e20[i - 1];
  const ema50 = e50[i];
  if (![ema20, ema20Prev, ema50].every(finite)) return { qualified: false, reason: 'ema-not-ready' };
  if (!(setupClose > ema20) || !(bars[i - 1].close <= ema20Prev)) {
    return { qualified: false, reason: 'ema-not-fresh-reclaim' };
  }
  if (!(ema20 > ema20Prev)) return { qualified: false, reason: 'ema-not-rising' };

  const atr14 = atr14At(bars, i);
  if (atr14 == null) return { qualified: false, reason: 'atr-not-ready' };
  let postTroughHigh = -Infinity;
  for (let j = dd.troughIndex + 1; j < i; j++) postTroughHigh = Math.max(postTroughHigh, bars[j].high);
  const l0 = Math.max(ema50, postTroughHigh);
  if (!positive(l0) || !(l0 > dd.troughLow)) return { qualified: false, reason: 'invalid-level' };
  const bandHigh = l0 + DEEP_RECLAIM_CONFIRM_ATR * atr14;
  if (setupClose > bandHigh) return { qualified: false, reason: 'already-extended' };

  const setupTs = bars[i].closeTs;
  const base = {
    strategy: DEEP_RECLAIM_STRATEGY,
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    sym: cleanSym,
    setupTs,
    setupClose,
    barCount: bars.length,
    peakTs: bars[dd.peakIndex].closeTs,
    peakHigh: dd.peakHigh,
    troughTs: bars[dd.troughIndex].closeTs,
    troughLow: dd.troughLow,
    troughAgeBars,
    ddPct: dd.ddPct,
    high24,
    low24,
    pos24,
    ret4hPct,
    ema20,
    ema20Prev,
    ema50,
    emaSlopePct: (ema20 / ema20Prev - 1) * 100,
    atr14,
    l0,
    bandLow: l0,
    bandHigh,
    invalidBelow: dd.troughLow,
    missedAbove: l0 + DEEP_RECLAIM_MISSED_ATR * atr14,
    setupDistanceToL0Pct: (setupClose / l0 - 1) * 100,
    setupDistanceToL0Atr: (setupClose - l0) / atr14,
    expiresAt: setupTs + DEEP_RECLAIM_EXPIRY_MS,
  } satisfies Omit<DeepReclaimPriceCandidate, 'rankVersion' | 'rankScore'>;
  const candidate: DeepReclaimPriceCandidate = {
    ...base,
    rankVersion: DEEP_RECLAIM_RANK_VERSION,
    rankScore: deepReclaimRankScore(base),
  };
  return { qualified: true, candidate };
}

/** Price-only production setup evaluation. OI never changes whether this geometry exists. */
export function evaluateDeepReclaimPrice(sym: string, input: DeepReclaimBar[]): DeepReclaimPriceEvaluation {
  return evaluateDeepReclaimPriceWithRules(sym, input, DEEP_RECLAIM_GEOMETRY_V0);
}

export function detectDeepReclaimPriceCandidate(
  sym: string,
  bars: DeepReclaimBar[],
): DeepReclaimPriceCandidate | null {
  const result = evaluateDeepReclaimPrice(sym, bars);
  return result.qualified ? result.candidate : null;
}

export function deepReclaimOiDecision(
  observation: DeepReclaimOiObservation | null | undefined,
  barCloseTs: number,
): DeepReclaimOiDecision {
  const closeTs = cleanTimestamp('barCloseTs', barCloseTs);
  if (
    !observation ||
    !finite(observation.observedAt) ||
    !finite(observation.qty1h) ||
    !finite(observation.qty4h)
  ) {
    return { code: 'missing', qualified: false, fresh: false, reason: 'quantity OI observation is missing or incomplete' };
  }
  if (observation.observedAt > closeTs) {
    return { code: 'future', qualified: false, fresh: false, reason: 'quantity OI observation is newer than the completed bar' };
  }
  if (closeTs - observation.observedAt > DEEP_RECLAIM_OI_MAX_AGE_MS) {
    return { code: 'stale', qualified: false, fresh: false, reason: 'quantity OI observation is older than 10 minutes' };
  }
  if (!(observation.qty1h > 0) || !(observation.qty4h >= 3)) {
    return { code: 'rejected', qualified: false, fresh: true, reason: 'fresh quantity OI failed qty1h > 0 or qty4h >= 3' };
  }
  return { code: 'pass', qualified: true, fresh: true, reason: 'fresh quantity OI passed' };
}

export function attachDeepReclaimOiEligibility(
  price: DeepReclaimPriceCandidate,
  observation: DeepReclaimOiObservation | null | undefined,
): DeepReclaimDetection {
  const oiDecision = deepReclaimOiDecision(observation, price.setupTs);
  return {
    price: { ...price },
    oiQualified: oiDecision.qualified,
    oiDecision,
    oi: observation && [observation.observedAt, observation.qty1h, observation.qty4h].every(finite)
      ? { ...observation }
      : null,
  };
}

/** Null means no price geometry. A non-null result is always audit-worthy. */
export function detectDeepReclaim(
  sym: string,
  bars: DeepReclaimBar[],
  observation?: DeepReclaimOiObservation | null,
): DeepReclaimDetection | null {
  const price = detectDeepReclaimPriceCandidate(sym, bars);
  return price ? attachDeepReclaimOiEligibility(price, observation) : null;
}

export function deepReclaimWatchId(sym: string, setupTs: number): string {
  return `${DEEP_RECLAIM_STRATEGY}:${symbolOf(sym)}:${cleanTimestamp('setupTs', setupTs)}`;
}

function makeEvent(
  candidate: DeepReclaimWatch,
  event: DeepReclaimEventKind,
  ts: number,
  px: number,
  extra: Pick<DeepReclaimEvent, 'oiDecision' | 'oiObservedAt' | 'qty1h' | 'qty4h' | 'reason'> = {},
): DeepReclaimEvent {
  const at = cleanTimestamp('event.ts', ts);
  return {
    type: 'deep-reclaim',
    v: DEEP_RECLAIM_EVENT_VERSION,
    strategy: DEEP_RECLAIM_STRATEGY,
    rulesetId: candidate.rulesetId,
    ...(candidate.selectionPolicyId ? { selectionPolicyId: candidate.selectionPolicyId } : {}),
    cohortMonth: new Date(candidate.setupTs).toISOString().slice(0, 7),
    id: `${candidate.id}:${event}:${at}`,
    watchId: candidate.id,
    event,
    status: candidate.status,
    ts: at,
    sym: candidate.sym,
    px,
    setupTs: candidate.setupTs,
    waitedMinutes: Math.max(0, (at - candidate.setupTs) / 60_000),
    distanceToL0Pct: (px / candidate.l0 - 1) * 100,
    peakHigh: candidate.peakHigh,
    troughLow: candidate.troughLow,
    troughAgeBars: candidate.troughAgeBars,
    ddPct: candidate.ddPct,
    pos24: candidate.pos24,
    ret4hPct: candidate.ret4hPct,
    ema20: candidate.ema20,
    ema50: candidate.ema50,
    atr14: candidate.atr14,
    l0: candidate.l0,
    bandLow: candidate.bandLow,
    bandHigh: candidate.bandHigh,
    invalidBelow: candidate.invalidBelow,
    missedAbove: candidate.missedAbove,
    expiresAt: candidate.expiresAt,
    rankVersion: candidate.rankVersion,
    rankScore: candidate.rankScore,
    ...extra,
  };
}

/** Arms only an OI-qualified price candidate. Non-qualified setups remain auditable via the returned decision. */
export function armDeepReclaim(
  price: DeepReclaimPriceCandidate,
  observation: DeepReclaimOiObservation | null | undefined,
): DeepReclaimArmResult {
  const oiDecision = deepReclaimOiDecision(observation, price.setupTs);
  if (!oiDecision.qualified || !observation) return { candidate: null, oiDecision };
  const candidate: DeepReclaimWatch = {
    ...price,
    v: DEEP_RECLAIM_STATE_VERSION,
    id: deepReclaimWatchId(price.sym, price.setupTs),
    status: 'watching',
    setupOi: { ...observation },
    lastBarTs: price.setupTs,
    lastPx: price.setupClose,
    lastOiDecision: 'pass',
  };
  return {
    candidate,
    event: makeEvent(candidate, 'armed', candidate.setupTs, candidate.setupClose, {
      oiDecision: 'pass',
      oiObservedAt: observation.observedAt,
      qty1h: observation.qty1h,
      qty4h: observation.qty4h,
      reason: 'price geometry and fresh quantity OI qualified; later 15m confirmation required',
    }),
    oiDecision,
  };
}

function validateObservationBar(raw: DeepReclaimBar): DeepReclaimBar {
  if (
    !finite(raw.closeTs) ||
    Math.trunc(raw.closeTs) !== raw.closeTs ||
    raw.closeTs <= 0 ||
    raw.closeTs % DEEP_RECLAIM_SLOT_MS !== 0 ||
    !validOhlc(raw)
  ) throw new RangeError('observation must be one valid completed, UTC-aligned 15m OHLC bar');
  return { ...raw };
}

function terminalTransition(
  candidate: DeepReclaimWatch,
  status: Extract<DeepReclaimStatus, 'invalidated' | 'missed' | 'oi-rejected' | 'expired'>,
  event: Extract<DeepReclaimEventKind, 'invalid' | 'missed' | 'oi-rejected' | 'expired'>,
  bar: DeepReclaimBar,
  reason: string,
  oi?: { decision: DeepReclaimOiDecision; observation: DeepReclaimOiObservation },
): DeepReclaimTransition {
  const next: DeepReclaimWatch = {
    ...candidate,
    status,
    lastBarTs: bar.closeTs,
    lastPx: bar.close,
    terminalAt: bar.closeTs,
    ...(oi ? { lastOiDecision: oi.decision.code } : {}),
  };
  return {
    candidate: next,
    event: makeEvent(next, event, bar.closeTs, bar.close, {
      ...(oi
        ? {
            oiDecision: oi.decision.code,
            oiObservedAt: oi.observation.observedAt,
            qty1h: oi.observation.qty1h,
            qty4h: oi.observation.qty4h,
          }
        : {}),
      reason,
    }),
  };
}

/**
 * Evaluates one later completed 15m bar. Terminal precedence is conservative:
 * expiry -> trough invalidation -> +2 ATR miss -> price/OI confirmation.
 */
export function observeDeepReclaim(
  candidate: DeepReclaimWatch,
  rawBar: DeepReclaimBar,
  observation?: DeepReclaimOiObservation | null,
): DeepReclaimTransition {
  if (candidate.status !== 'watching') return { candidate };
  const bar = validateObservationBar(rawBar);
  if (bar.closeTs <= candidate.setupTs || bar.closeTs <= candidate.lastBarTs) return { candidate };

  if (bar.closeTs >= candidate.expiresAt) {
    return terminalTransition(candidate, 'expired', 'expired', bar, '24h confirmation window elapsed');
  }
  if (bar.close < candidate.troughLow) {
    return terminalTransition(candidate, 'invalidated', 'invalid', bar, '15m close fell strictly below the frozen trough');
  }
  if (bar.high >= candidate.missedAbove) {
    return terminalTransition(candidate, 'missed', 'missed', bar, 'price reached L0 + 2 ATR before confirmation');
  }

  const next: DeepReclaimWatch = {
    ...candidate,
    lastBarTs: bar.closeTs,
    lastPx: bar.close,
  };
  const priceConfirmed = bar.close >= candidate.bandLow && bar.close <= candidate.bandHigh;
  if (!priceConfirmed) return { candidate: next };

  const oiDecision = deepReclaimOiDecision(observation, bar.closeTs);
  if (!oiDecision.fresh) {
    const waiting: DeepReclaimWatch = {
      ...next,
      lastOiDecision: oiDecision.code,
      lastOiWaitAt: bar.closeTs,
    };
    return {
      candidate: waiting,
      event: makeEvent(waiting, 'oi-wait', bar.closeTs, bar.close, {
        oiDecision: oiDecision.code,
        ...(observation && finite(observation.observedAt) ? { oiObservedAt: observation.observedAt } : {}),
        ...(observation && finite(observation.qty1h) ? { qty1h: observation.qty1h } : {}),
        ...(observation && finite(observation.qty4h) ? { qty4h: observation.qty4h } : {}),
        reason: `${oiDecision.reason}; watch remains active`,
      }),
    };
  }
  if (!oiDecision.qualified && observation) {
    return terminalTransition(
      next,
      'oi-rejected',
      'oi-rejected',
      bar,
      'price confirmed but fresh quantity OI failed qty1h > 0 or qty4h >= 3',
      { decision: oiDecision, observation },
    );
  }

  // A fresh decision can only be pass or rejected. The rejected branch above
  // is exhaustive, but keep this fail-closed guard for malformed future edits.
  if (!oiDecision.qualified || !observation) {
    const waiting: DeepReclaimWatch = { ...next, lastOiDecision: oiDecision.code, lastOiWaitAt: bar.closeTs };
    return { candidate: waiting };
  }
  const confirmed: DeepReclaimWatch = {
    ...next,
    status: 'confirmed',
    lastOiDecision: 'pass',
    confirmedAt: bar.closeTs,
    confirmedPx: bar.close,
    terminalAt: bar.closeTs,
  };
  return {
    candidate: confirmed,
    event: makeEvent(confirmed, 'confirmed', bar.closeTs, bar.close, {
      oiDecision: 'pass',
      oiObservedAt: observation.observedAt,
      qty1h: observation.qty1h,
      qty4h: observation.qty4h,
      reason: 'later 15m close entered the frozen L0 confirmation band and fresh quantity OI passed',
    }),
  };
}

export function isActiveDeepReclaim(candidate: DeepReclaimWatch): boolean {
  return candidate.status === 'watching';
}

export function emptyDeepReclaimState(updatedAt = 0): DeepReclaimState {
  return { v: DEEP_RECLAIM_STATE_VERSION, updatedAt: cleanTimestamp('updatedAt', updatedAt), active: {} };
}

export function applyDeepReclaimArm(state: DeepReclaimState, result: DeepReclaimArmResult): DeepReclaimState {
  if (!result.candidate) return state;
  return {
    v: DEEP_RECLAIM_STATE_VERSION,
    updatedAt: result.candidate.setupTs,
    active: { ...state.active, [result.candidate.sym]: result.candidate },
  };
}

export function applyDeepReclaimTransition(
  state: DeepReclaimState,
  transition: DeepReclaimTransition,
): DeepReclaimState {
  const candidate = transition.candidate;
  const active = { ...state.active };
  if (candidate.status === 'watching') active[candidate.sym] = candidate;
  else if (active[candidate.sym]?.id === candidate.id) delete active[candidate.sym];
  return { v: DEEP_RECLAIM_STATE_VERSION, updatedAt: candidate.lastBarTs, active };
}

export function activeDeepReclaims(state: DeepReclaimState): DeepReclaimWatch[] {
  return Object.values(state.active)
    .filter(isActiveDeepReclaim)
    .sort((a, b) => a.setupTs - b.setupTs || a.sym.localeCompare(b.sym));
}

const DELIVERY_STATUSES = new Set<DeepReclaimDeliveryStatus>([
  'shadow',
  'selected',
  'sending',
  'delivered',
  'failed',
  'uncertain',
]);

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);
}

function optionalTimestamp(x: unknown): x is number {
  return finite(x) && x >= 0;
}

function sanitizeWatch(raw: unknown, key: string): DeepReclaimWatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Record<string, unknown>;
  if (x.v !== DEEP_RECLAIM_STATE_VERSION || x.strategy !== DEEP_RECLAIM_STRATEGY || x.status !== 'watching') return null;
  if (typeof x.sym !== 'string' || symbolOf(x.sym) !== key || typeof x.id !== 'string') return null;
  const rulesetId = typeof x.rulesetId === 'string' && x.rulesetId.trim()
    ? x.rulesetId.trim()
    : DEEP_RECLAIM_LEGACY_RULESET_ID;
  const selectionPolicyId = typeof x.selectionPolicyId === 'string' && x.selectionPolicyId.trim()
    ? x.selectionPolicyId.trim()
    : DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID;
  const numeric = [
    'setupTs', 'setupClose', 'barCount', 'peakTs', 'peakHigh', 'troughTs', 'troughLow', 'troughAgeBars',
    'ddPct', 'high24', 'low24', 'pos24', 'ret4hPct', 'ema20', 'ema20Prev', 'ema50', 'emaSlopePct',
    'atr14', 'l0', 'bandLow', 'bandHigh', 'invalidBelow', 'missedAbove', 'setupDistanceToL0Pct',
    'setupDistanceToL0Atr', 'expiresAt', 'rankScore', 'lastBarTs',
  ] as const;
  if (numeric.some((k) => !finite(x[k]))) return null;

  const setupTs = x.setupTs as number;
  const setupClose = x.setupClose as number;
  const peakTs = x.peakTs as number;
  const peakHigh = x.peakHigh as number;
  const troughTs = x.troughTs as number;
  const troughLow = x.troughLow as number;
  const troughAgeBars = x.troughAgeBars as number;
  const ddPct = x.ddPct as number;
  const pos24 = x.pos24 as number;
  const ret4hPct = x.ret4hPct as number;
  const ema20 = x.ema20 as number;
  const ema20Prev = x.ema20Prev as number;
  const emaSlopePct = x.emaSlopePct as number;
  const atr14 = x.atr14 as number;
  const l0 = x.l0 as number;
  const lastBarTs = x.lastBarTs as number;
  const high24 = x.high24 as number;
  const low24 = x.low24 as number;
  if (
    !Number.isInteger(x.barCount) || (x.barCount as number) < DEEP_RECLAIM_MIN_BARS ||
    !Number.isInteger(troughAgeBars) || troughAgeBars < DEEP_RECLAIM_TROUGH_MIN_AGE_BARS ||
    troughAgeBars > DEEP_RECLAIM_TROUGH_MAX_AGE_BARS ||
    setupTs <= 0 || setupTs % DEEP_RECLAIM_SLOT_MS !== 0 || lastBarTs < setupTs ||
    lastBarTs >= setupTs + DEEP_RECLAIM_EXPIRY_MS || lastBarTs % DEEP_RECLAIM_SLOT_MS !== 0 ||
    peakTs % DEEP_RECLAIM_SLOT_MS !== 0 || troughTs % DEEP_RECLAIM_SLOT_MS !== 0 ||
    peakTs >= troughTs || troughTs > setupTs || (setupTs - troughTs) / DEEP_RECLAIM_SLOT_MS !== troughAgeBars ||
    !positive(setupClose) || !positive(peakHigh) || !positive(troughLow) || !(peakHigh > troughLow) ||
    ddPct < DEEP_RECLAIM_DD_MIN_PCT || ddPct > DEEP_RECLAIM_DD_MAX_PCT ||
    !near(ddPct, ((peakHigh - troughLow) / peakHigh) * 100) ||
    !positive(high24) || !positive(low24) || !(high24 > low24) || setupClose < low24 || setupClose > high24 ||
    !(pos24 >= 0 && pos24 <= DEEP_RECLAIM_POS_MAX) || !near(pos24, (setupClose - low24) / (high24 - low24)) ||
    !(ret4hPct > 0 && ret4hPct <= DEEP_RECLAIM_RET4H_MAX_PCT) ||
    !positive(ema20) || !positive(ema20Prev) || !(ema20 > ema20Prev) || !(setupClose > ema20) ||
    !near(emaSlopePct, (ema20 / ema20Prev - 1) * 100) ||
    !positive(x.ema50) || !positive(atr14) || !positive(l0) || !(l0 > troughLow) ||
    !near(x.bandLow as number, l0) || !near(x.bandHigh as number, l0 + DEEP_RECLAIM_CONFIRM_ATR * atr14) ||
    !near(x.invalidBelow as number, troughLow) || !near(x.missedAbove as number, l0 + DEEP_RECLAIM_MISSED_ATR * atr14) ||
    setupClose > (x.bandHigh as number) ||
    !near(x.setupDistanceToL0Pct as number, (setupClose / l0 - 1) * 100) ||
    !near(x.setupDistanceToL0Atr as number, (setupClose - l0) / atr14) ||
    x.expiresAt !== setupTs + DEEP_RECLAIM_EXPIRY_MS || x.rankVersion !== DEEP_RECLAIM_RANK_VERSION ||
    (x.rankScore as number) < 0 || (x.rankScore as number) > 100 ||
    x.id !== deepReclaimWatchId(key, setupTs)
  ) return null;

  if (!x.setupOi || typeof x.setupOi !== 'object') return null;
  const setupOiRaw = x.setupOi as Record<string, unknown>;
  if (![setupOiRaw.observedAt, setupOiRaw.qty1h, setupOiRaw.qty4h].every(finite)) return null;
  const setupOi: DeepReclaimOiObservation = {
    observedAt: setupOiRaw.observedAt as number,
    qty1h: setupOiRaw.qty1h as number,
    qty4h: setupOiRaw.qty4h as number,
  };
  if (!deepReclaimOiDecision(setupOi, setupTs).qualified) return null;

  if (x.delivery != null && (typeof x.delivery !== 'string' || !DELIVERY_STATUSES.has(x.delivery as DeepReclaimDeliveryStatus))) return null;
  if (x.telegramMessageId != null && (!Number.isInteger(x.telegramMessageId) || (x.telegramMessageId as number) <= 0)) return null;
  if (x.attemptCount != null && (!Number.isInteger(x.attemptCount) || (x.attemptCount as number) < 0)) return null;
  if (x.earlyDeliveredAt != null && !optionalTimestamp(x.earlyDeliveredAt)) return null;
  if (x.nextAttemptAt != null && !optionalTimestamp(x.nextAttemptAt)) return null;
  if (x.buyShare4h != null && (!finite(x.buyShare4h) || (x.buyShare4h as number) < 0 || (x.buyShare4h as number) > 1)) return null;
  if (x.operationalScore != null && (!finite(x.operationalScore) || (x.operationalScore as number) < 0 || (x.operationalScore as number) > 100)) return null;
  if (x.lastPx != null && !positive(x.lastPx)) return null;
  if (x.lastOiWaitAt != null && (!optionalTimestamp(x.lastOiWaitAt) || (x.lastOiWaitAt as number) > lastBarTs)) return null;
  if (x.confirmedAt != null || x.confirmedPx != null || x.terminalAt != null) return null;
  const oiCodes = new Set<DeepReclaimOiDecisionCode>(['pass', 'missing', 'stale', 'future', 'rejected']);
  if (x.lastOiDecision != null && (typeof x.lastOiDecision !== 'string' || !oiCodes.has(x.lastOiDecision as DeepReclaimOiDecisionCode))) return null;

  const clean = { ...x, sym: key, rulesetId, selectionPolicyId, setupOi } as unknown as DeepReclaimWatch;
  return clean;
}

/**
 * Restart-safe state boundary. Invalid/terminal rows are dropped independently
 * so one corrupt symbol cannot discard every active watch.
 */
export function sanitizeDeepReclaimState(raw: unknown): DeepReclaimState {
  if (!raw || typeof raw !== 'object') return emptyDeepReclaimState();
  const x = raw as Record<string, unknown>;
  if (x.v !== DEEP_RECLAIM_STATE_VERSION || !x.active || typeof x.active !== 'object') return emptyDeepReclaimState();
  const active: Record<string, DeepReclaimWatch> = {};
  for (const [rawKey, value] of Object.entries(x.active as Record<string, unknown>)) {
    const key = rawKey.trim().toUpperCase();
    if (!key || active[key]) continue;
    try {
      const watch = sanitizeWatch(value, key);
      if (watch) active[key] = watch;
    } catch {
      // Bad symbol/timestamp data is local to this row; fail closed per symbol.
    }
  }
  const updatedAt = optionalTimestamp(x.updatedAt)
    ? Math.trunc(x.updatedAt)
    : Object.values(active).reduce((m, c) => Math.max(m, c.lastBarTs), 0);
  return { v: DEEP_RECLAIM_STATE_VERSION, updatedAt, active };
}
