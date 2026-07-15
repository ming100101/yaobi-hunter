import type {
  Candle,
  DeliveredPush,
  EntryWatchCandidate,
  EntryWatchEvent,
  EntryWatchEventKind,
  EntryWatchObservation,
  EntryWatchState,
  EntryWatchStatus,
  EntryWatchTransition,
  ExitPlan,
  NotifySignalClass,
} from '../types';

// Frozen production contract. Keep these values in one shared module so the
// recorder, replay harness and UI cannot silently implement different watches.
export const ENTRY_WATCH_STATE_VERSION = 1 as const;
export const ENTRY_WATCH_EVENT_VERSION = 1 as const;
export const ENTRY_WATCH_BAND_ATR = 0.5;
export const ENTRY_WATCH_INVALID_ATR = 1;
export const ENTRY_WATCH_MIN_DELAY_MS = 30 * 60 * 1000;
export const ENTRY_WATCH_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const ENTRY_WATCH_MISSED_PCT = 15;

// Promotion is deliberately separate per source class.  The June 2026
// pre-registered study did not clear the full sample/robustness/evidence gate
// for either class (docs/roadmap/reports/ENTRY-WATCH-2026-06.md), so production
// must remain fail-closed even though the complete watcher plumbing is shipped.
// Flip a class only after a later report passes every frozen gate.
export const ENTRY_WATCH_PROMOTED = { fb: false, rb: false, vg: false } as const;
// The App-only shadow monitor is available even when no class has passed the
// much stricter gate required for a second Telegram notification.
export const ENTRY_WATCH_AVAILABLE = true;

const ACTIVE_STATUSES = new Set<EntryWatchStatus>(['watching', 'ready', 'sending']);
const ALL_STATUSES = new Set<EntryWatchStatus>([
  'watching',
  'ready',
  'sending',
  'delivered',
  'expired',
  'missed',
  'invalidated',
  'superseded',
]);
const SIGNAL_CLASSES = new Set<NotifySignalClass>(['fb', 'rb', 'vg']);
const DELIVERY_VIA = new Set(['photo', 'text']);

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function positive(name: string, x: number): number {
  if (!Number.isFinite(x) || x <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return x;
}

function timestamp(name: string, x: number): number {
  if (!Number.isFinite(x) || x < 0) throw new RangeError(`${name} must be a non-negative finite timestamp`);
  return Math.trunc(x);
}

function symbolOf(sym: string): string {
  const out = sym.trim().toUpperCase();
  if (!out) throw new TypeError('symbol must not be empty');
  return out;
}

function clonePlan(plan: ExitPlan): ExitPlan {
  const nums: Array<[string, number]> = [
    ['plan.entry', plan.entry],
    ['plan.tp1', plan.tp1],
    ['plan.tp2', plan.tp2],
    ['plan.tp3', plan.tp3],
    ['plan.sl', plan.sl],
    ['plan.runnerPct', plan.runnerPct],
  ];
  for (const [name, value] of nums) {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  }
  if (!['breakout', 'pullback', 'reclaim'].includes(plan.kind)) throw new TypeError('invalid plan.kind');
  return { ...plan };
}

export function deliveredPushId(cls: NotifySignalClass, sym: string, ts: number): string {
  return `${cls}:${symbolOf(sym)}:${timestamp('ts', ts)}`;
}

export function entryWatchId(sourceId: string): string {
  const id = sourceId.trim();
  if (!id) throw new TypeError('sourceId must not be empty');
  return `entry:${id}`;
}

/**
 * Derive the immutable support/ATR anchor used by a delivered breakout card.
 *
 * Input candles are the app's ascending 5m series. Unlike aggregateCandles(),
 * this groups by the candle timestamp's actual hour bucket. The last hour is
 * always dropped because Binance includes its currently-forming 5m bar. The
 * final 24 completed, contiguous hours define prior-high support; ATR is the
 * simple mean of the final 14 true ranges over those same completed bars.
 */
export function deriveEntryWatchAnchor(candles: Candle[]): { support: number; atr: number } | null {
  // 24 complete hours plus at least one row from the current hour.
  if (!Array.isArray(candles) || candles.length < 24 * 12 + 1) return null;

  interface Hour {
    bucket: number;
    open: number;
    high: number;
    low: number;
    close: number;
    times: Set<number>;
  }

  const sorted = [...candles]
    .filter(
      (c) =>
        finite(c.time) &&
        finite(c.open) &&
        finite(c.high) &&
        finite(c.low) &&
        finite(c.close) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0 &&
        c.low <= c.high,
    )
    .sort((a, b) => a.time - b.time);
  if (!sorted.length) return null;

  const hours: Hour[] = [];
  for (const c of sorted) {
    const t = Math.trunc(c.time);
    const bucket = Math.floor(t / 3600);
    let h = hours[hours.length - 1];
    if (!h || h.bucket !== bucket) {
      h = { bucket, open: c.open, high: c.high, low: c.low, close: c.close, times: new Set() };
      hours.push(h);
    }
    // A duplicate kline must not make an incomplete hour appear complete.
    if (h.times.has(t)) continue;
    h.times.add(t);
    if (c.high > h.high) h.high = c.high;
    if (c.low < h.low) h.low = c.low;
    h.close = c.close;
  }

  // The newest group contains Binance's in-progress bar even when it happens
  // to have accumulated 12 rows in a synthetic/offline fixture: drop it by
  // contract, rather than trying to infer wall time inside this pure function.
  const completed = hours.slice(0, -1);
  if (completed.length < 24) return null;
  const win = completed.slice(-24);

  for (let i = 0; i < win.length; i++) {
    const h = win[i];
    if (h.times.size !== 12) return null;
    if (i > 0 && h.bucket !== win[i - 1].bucket + 1) return null;
    const expectedOpen = h.bucket * 3600;
    for (let k = 0; k < 12; k++) if (!h.times.has(expectedOpen + k * 300)) return null;
  }

  let support = 0;
  for (const h of win) support = Math.max(support, h.high);

  let tr = 0;
  for (let i = win.length - 14; i < win.length; i++) {
    const h = win[i];
    const prev = win[i - 1];
    if (!prev) return null;
    tr += Math.max(h.high - h.low, Math.abs(h.high - prev.close), Math.abs(h.low - prev.close));
  }
  const atr = tr / 14;
  return support > 0 && atr > 0 && Number.isFinite(atr) ? { support, atr } : null;
}

export function createEntryWatchCandidate(push: DeliveredPush): EntryWatchCandidate {
  const sym = symbolOf(push.sym);
  if (!SIGNAL_CLASSES.has(push.cls)) throw new TypeError(`unsupported signal class: ${String(push.cls)}`);
  if (!DELIVERY_VIA.has(push.via)) throw new TypeError(`unsupported delivery channel: ${String(push.via)}`);
  const sourceTs = timestamp('push.ts', push.ts);
  const sourcePx = positive('push.px', push.px);
  const support = positive('push.support', push.support);
  const atr = positive('push.atr', push.atr);
  // An ATR wider than support makes the invalidation non-positive and is not a
  // meaningful long-entry setup. Fail closed rather than arm a watch that can
  // never invalidate.
  if (atr >= support) throw new RangeError('push.atr must be smaller than support');
  if (!Number.isFinite(push.strength)) throw new RangeError('push.strength must be finite');
  if (typeof push.followupEnabled !== 'boolean') throw new TypeError('push.followupEnabled must be boolean');
  if (!push.id.trim()) throw new TypeError('push.id must not be empty');
  if (push.telegramMessageId != null && (!Number.isInteger(push.telegramMessageId) || push.telegramMessageId <= 0)) {
    throw new RangeError('telegramMessageId must be a positive integer when present');
  }

  return {
    id: entryWatchId(push.id),
    sourceId: push.id,
    sym,
    cls: push.cls,
    sourceTs,
    sourcePx,
    strength: push.strength,
    via: push.via,
    telegramMessageId: push.telegramMessageId,
    plan: clonePlan(push.plan),
    support,
    atr,
    followupEnabled: push.followupEnabled,
    bandLow: support - ENTRY_WATCH_BAND_ATR * atr,
    bandHigh: support + ENTRY_WATCH_BAND_ATR * atr,
    invalidBelow: support - ENTRY_WATCH_INVALID_ATR * atr,
    missedAbove: sourcePx * (1 + ENTRY_WATCH_MISSED_PCT / 100),
    minReadyAt: sourceTs + ENTRY_WATCH_MIN_DELAY_MS,
    expiresAt: sourceTs + ENTRY_WATCH_EXPIRY_MS,
    status: 'watching',
    lastBarTs: 0,
    attemptCount: 0,
  };
}

function makeEvent(
  candidate: EntryWatchCandidate,
  event: EntryWatchEventKind,
  ts: number,
  px: number,
  extra: Pick<EntryWatchEvent, 'replacedBy' | 'reason'> = {},
): EntryWatchEvent {
  const cleanTs = timestamp('event.ts', ts);
  return {
    type: 'entry-watch',
    v: ENTRY_WATCH_EVENT_VERSION,
    id: `${candidate.id}:${event}:${cleanTs}`,
    watchId: candidate.id,
    sourceId: candidate.sourceId,
    event,
    status: candidate.status,
    ts: cleanTs,
    sym: candidate.sym,
    cls: candidate.cls,
    px,
    support: candidate.support,
    atr: candidate.atr,
    bandLow: candidate.bandLow,
    bandHigh: candidate.bandHigh,
    followupEnabled: candidate.followupEnabled,
    ...extra,
  };
}

export function entryWatchArmedEvent(candidate: EntryWatchCandidate): EntryWatchEvent {
  return makeEvent(candidate, 'armed', candidate.sourceTs, candidate.sourcePx);
}

function validateObservation(o: EntryWatchObservation): EntryWatchObservation {
  const ts = timestamp('observation.ts', o.ts);
  const high = positive('observation.high', o.high);
  const low = positive('observation.low', o.low);
  const close = positive('observation.close', o.close);
  if (low > high || close < low || close > high) throw new RangeError('observation must satisfy low <= close <= high');
  return { ts, high, low, close };
}

function terminalTransition(
  candidate: EntryWatchCandidate,
  status: Extract<EntryWatchStatus, 'expired' | 'missed' | 'invalidated'>,
  event: Extract<EntryWatchEventKind, 'expired' | 'missed' | 'invalid'>,
  o: EntryWatchObservation,
  reason: string,
): EntryWatchTransition {
  const next: EntryWatchCandidate = {
    ...candidate,
    status,
    lastBarTs: o.ts,
    lastPx: o.close,
    terminalAt: o.ts,
  };
  return { candidate: next, event: makeEvent(next, event, o.ts, o.close, { reason }) };
}

// Evaluate one COMPLETED 15m bar. Re-processing the same/older close timestamp
// is a no-op, which makes recorder restart/replay idempotent.
export function observeEntryWatch(
  candidate: EntryWatchCandidate,
  observation: EntryWatchObservation,
): EntryWatchTransition {
  if (candidate.status !== 'watching') return { candidate };
  const o = validateObservation(observation);
  if (o.ts <= candidate.sourceTs || o.ts <= candidate.lastBarTs) return { candidate };

  // Deterministic conservative ordering for ambiguous OHLC bars: an expired or
  // broken/escaped setup never becomes entry-ready merely because the same bar
  // also visited the pullback band.
  if (o.ts >= candidate.expiresAt) {
    return terminalTransition(candidate, 'expired', 'expired', o, '24h watch window elapsed');
  }
  if (o.close < candidate.invalidBelow) {
    return terminalTransition(candidate, 'invalidated', 'invalid', o, '15m close below support - 1 ATR');
  }
  if (o.high >= candidate.missedAbove) {
    return terminalTransition(candidate, 'missed', 'missed', o, 'price continued +15% from the first push without an entry');
  }

  const next: EntryWatchCandidate = { ...candidate, lastBarTs: o.ts, lastPx: o.close };
  const touchedBand = o.low <= candidate.bandHigh && o.high >= candidate.bandLow;
  const reclaimedWithoutChasing = o.close >= candidate.support && o.close <= candidate.bandHigh;
  if (o.ts >= candidate.minReadyAt && touchedBand && reclaimedWithoutChasing) {
    const ready: EntryWatchCandidate = {
      ...next,
      status: 'ready',
      readyAt: o.ts,
      readyPx: o.close,
    };
    return {
      candidate: ready,
      event: makeEvent(ready, 'ready', o.ts, o.close, { reason: '15m touched the frozen band and closed back above support' }),
    };
  }
  return { candidate: next };
}

export function markEntryWatchSending(candidate: EntryWatchCandidate, ts: number): EntryWatchCandidate {
  if (candidate.status !== 'ready') return candidate;
  const at = timestamp('sending.ts', ts);
  if (candidate.nextAttemptAt != null && at < candidate.nextAttemptAt) return candidate;
  return {
    ...candidate,
    status: 'sending',
    attemptCount: candidate.attemptCount + 1,
    nextAttemptAt: undefined,
  };
}

export function markEntryWatchSendFailed(
  candidate: EntryWatchCandidate,
  ts: number,
  retryAt: number,
  reason?: string,
): EntryWatchTransition {
  if (candidate.status !== 'sending') return { candidate };
  const at = timestamp('failure.ts', ts);
  const retry = timestamp('retryAt', retryAt);
  if (retry <= at) throw new RangeError('retryAt must be after failure.ts');
  const next: EntryWatchCandidate = { ...candidate, status: 'ready', nextAttemptAt: retry };
  return {
    candidate: next,
    event: makeEvent(next, 'delivery-failed', at, candidate.readyPx ?? candidate.lastPx ?? candidate.support, {
      reason: reason || 'Telegram delivery failed; retry scheduled',
    }),
  };
}

export function markEntryWatchDelivered(
  candidate: EntryWatchCandidate,
  ts: number,
  px = candidate.readyPx ?? candidate.lastPx ?? candidate.support,
): EntryWatchTransition {
  if (candidate.status !== 'sending' && candidate.status !== 'ready') return { candidate };
  const at = timestamp('delivery.ts', ts);
  positive('delivery.px', px);
  const next: EntryWatchCandidate = { ...candidate, status: 'delivered', terminalAt: at, lastPx: px };
  return {
    candidate: next,
    event: makeEvent(next, 'delivered', at, px, { reason: 'entry-ready Telegram follow-up delivered' }),
  };
}

export function isActiveEntryWatch(candidate: EntryWatchCandidate): boolean {
  return ACTIVE_STATUSES.has(candidate.status);
}

export function emptyEntryWatchState(updatedAt = 0): EntryWatchState {
  return { v: ENTRY_WATCH_STATE_VERSION, updatedAt: timestamp('updatedAt', updatedAt), active: {} };
}

export interface EntryWatchStateChange {
  state: EntryWatchState;
  events: EntryWatchEvent[];
}

// Insert one candidate while enforcing the one-active-per-symbol rule. Replaying
// the same source delivery is idempotent; a genuinely newer source supersedes
// the old candidate and emits an audit event before the new armed event.
export function supersedeEntryWatch(
  state: EntryWatchState,
  next: EntryWatchCandidate,
  ts = next.sourceTs,
): EntryWatchStateChange {
  const at = timestamp('supersede.ts', ts);
  const sym = symbolOf(next.sym);
  const prior = state.active[sym];
  if (prior?.sourceId === next.sourceId) return { state, events: [] };

  const events: EntryWatchEvent[] = [];
  if (prior && isActiveEntryWatch(prior)) {
    const replaced: EntryWatchCandidate = { ...prior, status: 'superseded', terminalAt: at };
    events.push(
      makeEvent(replaced, 'superseded', at, prior.lastPx ?? prior.sourcePx, {
        replacedBy: next.id,
        reason: `newer confirmed ${next.cls} push superseded the active watch`,
      }),
    );
  }
  events.push(entryWatchArmedEvent(next));
  return {
    state: {
      v: ENTRY_WATCH_STATE_VERSION,
      updatedAt: at,
      active: { ...state.active, [sym]: { ...next, sym } },
    },
    events,
  };
}

// Apply an observation/send transition only if it still belongs to the active
// source. Terminal candidates are removed; stale transitions from a superseded
// source cannot delete or overwrite the replacement.
export function applyEntryWatchTransition(
  state: EntryWatchState,
  transition: EntryWatchTransition,
  updatedAt = transition.event?.ts ?? transition.candidate.lastBarTs,
): EntryWatchState {
  const c = transition.candidate;
  const sym = symbolOf(c.sym);
  const current = state.active[sym];
  if (!current || current.sourceId !== c.sourceId) return state;
  const active = { ...state.active };
  if (isActiveEntryWatch(c)) active[sym] = c;
  else delete active[sym];
  return { v: ENTRY_WATCH_STATE_VERSION, updatedAt: timestamp('updatedAt', updatedAt), active };
}

export function activeEntryWatches(state: EntryWatchState): EntryWatchCandidate[] {
  return Object.values(state.active).filter(isActiveEntryWatch);
}

function validPlan(x: unknown): x is ExitPlan {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<ExitPlan>;
  return (
    (p.kind === 'breakout' || p.kind === 'pullback' || p.kind === 'reclaim') &&
    finite(p.entry) &&
    finite(p.tp1) &&
    finite(p.tp2) &&
    finite(p.tp3) &&
    finite(p.sl) &&
    finite(p.runnerPct)
  );
}

function validCandidate(x: unknown): x is EntryWatchCandidate {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<EntryWatchCandidate>;
  if (
    typeof c.id !== 'string' ||
    typeof c.sourceId !== 'string' ||
    typeof c.sym !== 'string' ||
    !SIGNAL_CLASSES.has(c.cls as NotifySignalClass) ||
    !DELIVERY_VIA.has(c.via as string) ||
    !ALL_STATUSES.has(c.status as EntryWatchStatus) ||
    typeof c.followupEnabled !== 'boolean' ||
    !validPlan(c.plan)
  )
    return false;
  const required = [
    c.sourceTs,
    c.sourcePx,
    c.strength,
    c.support,
    c.atr,
    c.bandLow,
    c.bandHigh,
    c.invalidBelow,
    c.missedAbove,
    c.minReadyAt,
    c.expiresAt,
    c.lastBarTs,
    c.attemptCount,
  ];
  if (!required.every(finite)) return false;
  if (c.telegramMessageId != null && (!Number.isInteger(c.telegramMessageId) || c.telegramMessageId <= 0)) return false;
  if (![c.lastPx, c.readyAt, c.readyPx, c.terminalAt, c.nextAttemptAt].every((n) => n == null || finite(n))) return false;
  if (!(c.sourcePx! > 0 && c.support! > 0 && c.atr! > 0 && c.atr! < c.support!)) return false;
  if (!Number.isInteger(c.attemptCount) || c.attemptCount! < 0) return false;
  const eps = Math.max(1, c.support!) * 1e-10;
  if (Math.abs(c.bandLow! - (c.support! - ENTRY_WATCH_BAND_ATR * c.atr!)) > eps) return false;
  if (Math.abs(c.bandHigh! - (c.support! + ENTRY_WATCH_BAND_ATR * c.atr!)) > eps) return false;
  if (Math.abs(c.invalidBelow! - (c.support! - ENTRY_WATCH_INVALID_ATR * c.atr!)) > eps) return false;
  if (Math.abs(c.missedAbove! - c.sourcePx! * (1 + ENTRY_WATCH_MISSED_PCT / 100)) > eps) return false;
  if (c.minReadyAt !== c.sourceTs! + ENTRY_WATCH_MIN_DELAY_MS) return false;
  if (c.expiresAt !== c.sourceTs! + ENTRY_WATCH_EXPIRY_MS) return false;
  return true;
}

// Runtime guard for data read back from disk. Invalid/terminal rows are dropped
// individually rather than poisoning every other candidate in a recoverable
// state file.
export function sanitizeEntryWatchState(raw: unknown): EntryWatchState {
  if (!raw || typeof raw !== 'object') return emptyEntryWatchState();
  const obj = raw as Partial<EntryWatchState>;
  if (obj.v !== ENTRY_WATCH_STATE_VERSION || !obj.active || typeof obj.active !== 'object') {
    return emptyEntryWatchState();
  }
  const active: Record<string, EntryWatchCandidate> = {};
  for (const value of Object.values(obj.active)) {
    if (!validCandidate(value) || !isActiveEntryWatch(value)) continue;
    const sym = value.sym.trim().toUpperCase();
    if (!sym) continue;
    active[sym] = { ...value, sym, plan: { ...value.plan } };
  }
  return {
    v: ENTRY_WATCH_STATE_VERSION,
    updatedAt: finite(obj.updatedAt) && obj.updatedAt >= 0 ? Math.trunc(obj.updatedAt) : 0,
    active,
  };
}
