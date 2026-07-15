import { SLOT_MS, type RecIndex } from './evalCore';
import type { NotifyDeliveryVia, NotifySignalClass } from '../types';

const CLASSES = new Set<NotifySignalClass>(['fb', 'rb', 'vg']);
const CHANNELS = new Set<NotifyDeliveryVia>(['photo', 'text']);

export interface SignalNotifyEvent {
  type: 'notify';
  v: number;
  id: string;
  attemptedAt: number;
  ts: number; // confirmed Telegram delivery time (best available on legacy rows)
  deliveredAt: number;
  sym: string;
  cls: NotifySignalClass;
  px: number; // TG card price, not an execution fill
  strength: number;
  via: NotifyDeliveryVia;
  messageId?: number;
  legacy: boolean;
}

const finite = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;

export function parseDeliveredSignalObject(value: unknown): SignalNotifyEvent | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.type !== 'notify') return null;
  // v1 text fallback did not preserve Telegram success, while photo implied a
  // successful send. v2/v3 carry delivered:true explicitly.
  const confirmed = o.delivered === true || (o.delivered == null && o.via === 'photo');
  if (!confirmed || typeof o.sym !== 'string' || typeof o.cls !== 'string') return null;
  if (!CLASSES.has(o.cls as NotifySignalClass) || !CHANNELS.has(o.via as NotifyDeliveryVia)) return null;
  const ts = finite(o.deliveredAt) ?? finite(o.ts);
  const px = finite(o.px);
  const strength = finite(o.strength);
  if (ts == null || px == null || px <= 0 || strength == null) return null;
  const sym = o.sym.trim().toUpperCase();
  if (!sym) return null;
  const cls = o.cls as NotifySignalClass;
  const v = finite(o.v) ?? 1;
  const attemptedAt = finite(o.attemptedAt) ?? ts;
  const message = finite(o.messageId) ?? finite(o.telegramMessageId);
  return {
    type: 'notify',
    v,
    id: typeof o.id === 'string' && o.id ? o.id : `${cls}:${sym}:${ts}`,
    attemptedAt,
    ts,
    deliveredAt: ts,
    sym,
    cls,
    px,
    strength,
    via: o.via as NotifyDeliveryVia,
    messageId: message != null && Number.isInteger(message) && message > 0 ? message : undefined,
    legacy: v < 3,
  };
}

export function parseDeliveredSignals(text: string, symbol?: string): SignalNotifyEvent[] {
  const wanted = symbol?.trim().toUpperCase();
  const byId = new Map<string, SignalNotifyEvent>();
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"notify"')) continue;
    try {
      const event = parseDeliveredSignalObject(JSON.parse(line));
      if (!event || (wanted && event.sym !== wanted)) continue;
      byId.set(event.id, event);
    } catch {
      /* skip malformed line */
    }
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

export type SignalEntryMode = 'tg-card' | 'next-15m';
export type SignalOutcomeStatus = 'complete' | 'pending' | 'data-missing';

export interface SignalThresholdHits {
  up4?: number;
  up8?: number;
  up10?: number;
  down3?: number;
  down5?: number;
  plus4BeforeMinus3: boolean;
  plus10BeforeMinus5: boolean;
}

export interface SignalOutcome {
  event: SignalNotifyEvent;
  mode: SignalEntryMode;
  horizonSlots: number;
  status: SignalOutcomeStatus;
  entryTs?: number;
  entryPx?: number;
  entrySlippagePct?: number;
  coverage: number;
  mfe?: number; // fraction, may be partial while status=pending
  mae?: number;
  ret?: number;
  hits?: SignalThresholdHits;
}

const firstHit = (slot: number | undefined, fallback = Infinity) => slot ?? fallback;

export function evaluateSignalOutcome(
  idx: RecIndex,
  event: SignalNotifyEvent,
  horizonSlots: number,
  mode: SignalEntryMode,
): SignalOutcome {
  const signalSlot = Math.floor(event.ts / SLOT_MS);
  const fillSlot = mode === 'next-15m' ? signalSlot + 1 : signalSlot;
  const pm = idx.priceAt.get(event.sym);
  const lastGlobal = idx.slots[idx.slots.length - 1] ?? -1;
  const entryPx = mode === 'tg-card' ? event.px : pm?.get(fillSlot);
  const entryTs = mode === 'tg-card' ? event.ts : fillSlot * SLOT_MS;
  const base: SignalOutcome = {
    event,
    mode,
    horizonSlots,
    status: 'data-missing',
    entryTs,
    entryPx,
    entrySlippagePct:
      entryPx != null && entryPx > 0 ? (entryPx / event.px - 1) * 100 : undefined,
    coverage: 0,
  };
  if (!Number.isInteger(horizonSlots) || horizonSlots <= 0 || !pm) return base;
  if (mode === 'next-15m' && lastGlobal < fillSlot) return { ...base, status: 'pending' };
  if (entryPx == null || !Number.isFinite(entryPx) || entryPx <= 0) return base;

  const endSlot = fillSlot + horizonSlots;
  const availableEnd = Math.min(endSlot, lastGlobal);
  const path: Array<[number, number]> = [];
  let missing = false;
  for (let slot = fillSlot + 1; slot <= availableEnd; slot++) {
    // Both the global completed sweep and this symbol's price must exist. A gap
    // is never forward-filled or replaced by a later convenient observation.
    if (!idx.bySlot.has(slot)) {
      missing = true;
      break;
    }
    const px = pm.get(slot);
    if (px == null || !Number.isFinite(px) || px <= 0) {
      missing = true;
      break;
    }
    path.push([slot, px]);
  }
  const coverage = Math.min(1, path.length / horizonSlots);
  if (missing) return { ...base, status: 'data-missing', coverage };
  if (!path.length) {
    return { ...base, status: lastGlobal < endSlot ? 'pending' : 'data-missing', coverage };
  }

  let hi = entryPx;
  let lo = entryPx;
  const hits: SignalThresholdHits = {
    plus4BeforeMinus3: false,
    plus10BeforeMinus5: false,
  };
  for (const [slot, px] of path) {
    hi = Math.max(hi, px);
    lo = Math.min(lo, px);
    if (hits.up4 == null && px >= entryPx * 1.04) hits.up4 = slot;
    if (hits.up8 == null && px >= entryPx * 1.08) hits.up8 = slot;
    if (hits.up10 == null && px >= entryPx * 1.1) hits.up10 = slot;
    if (hits.down3 == null && px <= entryPx * 0.97) hits.down3 = slot;
    if (hits.down5 == null && px <= entryPx * 0.95) hits.down5 = slot;
  }
  hits.plus4BeforeMinus3 = firstHit(hits.up4) < firstHit(hits.down3);
  hits.plus10BeforeMinus5 = firstHit(hits.up10) < firstHit(hits.down5);
  return {
    ...base,
    status: lastGlobal < endSlot ? 'pending' : path.length === horizonSlots ? 'complete' : 'data-missing',
    coverage,
    mfe: hi / entryPx - 1,
    mae: lo / entryPx - 1,
    ret: path[path.length - 1][1] / entryPx - 1,
    hits,
  };
}
