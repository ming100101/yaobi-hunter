import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoinLite, ScanSource } from '../types';
import { fmtAge, fmtClock, fmtPct, fmtPrice, strengthCls } from '../lib/format';
import { DEEP_RECLAIM_RULESET_ID, DEEP_RECLAIM_SELECTION_POLICY_ID } from '../lib/deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from '../lib/researchGate';
import { auditDeepReclaimSelection, type DeepSelectionAuditResult } from '../lib/deepReclaimSelectionAudit';
import { parseDeliveredSignalObject } from '../lib/signalEvents';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';
import Sparkline from './Sparkline';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  coins: CoinLite[];
  source: ScanSource;
  onSelect: (symbol: string) => void;
}

interface PushEvent {
  id?: string;
  ts: number;
  sym: string;
  cls: string;
  px: number;
  strength: number;
  via?: 'photo' | 'text';
  delivered?: boolean;
}

interface PushRow {
  sym: string;
  latest: PushEvent;
  count: number;
  classes: string[];
  coin?: CoinLite;
  ret: number | null;
  watch?: EntryWatchState;
}

type SignalFilter = 'all' | 'fb' | 'rb' | 'vg';
type WatchStatus = 'waiting' | 'ready' | 'invalid';
type StatusFilter = 'all' | WatchStatus;
type SortKey = 'latest' | 'distance' | 'ret' | 'strength' | 'change24h';

// Entry-watch records are deliberately parsed at this UI seam rather than by
// evalCore: they are an operational lifecycle attached to a delivered push,
// not a scan signal. Runtime v1 writes a full snapshot on every transition.
// The handful of aliases keep development-era JSONL readable while the stable
// fields remain watchId/pushTs/status/zoneLow/zoneHigh/expiresAt/confirmPx.
interface EntryWatchState {
  watchId: string;
  sourceId?: string;
  sym: string;
  cls?: string;
  pushTs?: number;
  status: WatchStatus;
  updatedAt: number;
  zoneLow?: number;
  zoneHigh?: number;
  expiresAt?: number;
  confirmPx?: number;
  confirmTs?: number;
  lastPx?: number;
  reason?: string;
  lastEvent?: string;
  followupEnabled?: boolean;
  logOrder: number;
}

interface ParsedRecordingEvents {
  pushes: PushEvent[];
  watches: EntryWatchState[];
}

type DeepReclaimStatus =
  | 'early'
  | 'watching'
  | 'confirmed'
  | 'invalid'
  | 'expired'
  | 'missed'
  | 'oi-rejected';
type DeepReclaimFilter = 'all' | DeepReclaimStatus;

interface DeepReclaimReference {
  sym: string;
  ts: number;
  px: number;
  refStrength?: number;
  kind?: string;
  provisional: boolean;
  notes?: string;
}

interface DeepReclaimRow {
  id: string;
  sym: string;
  status: DeepReclaimStatus;
  setupTs: number;
  updatedAt: number;
  expiresAt?: number;
  lastPx?: number;
  ema20?: number;
  ema50?: number;
  l0?: number;
  bandLow?: number;
  bandHigh?: number;
  lo24?: number;
  ddPct?: number;
  oi1h?: number;
  oi4h?: number;
  distancePct?: number;
  reason?: string;
  rulesetId?: string;
  gateProtocolId?: string;
  selectionPolicyId?: string;
  cohortMonth?: string;
  evidenceEligible?: boolean;
}

interface ParsedDeepReclaim {
  rows: DeepReclaimRow[];
  references: DeepReclaimReference[];
  selectionAudit: DeepSelectionAuditResult;
}

const DEEP_STATUS_META: Record<DeepReclaimStatus, { label: string; short: string }> = {
  early: { label: '早察', short: '早察' },
  watching: { label: '等確認', short: '等確認' },
  confirmed: { label: '已確認', short: '確認' },
  invalid: { label: '結構失效', short: '失效' },
  expired: { label: '監察到期', short: '到期' },
  missed: { label: '已走車', short: '走車' },
  'oi-rejected': { label: 'OI 未通過', short: 'OI未過' },
};

const DAY_MS = 24 * 3600 * 1000;
const FETCH_DAYS = 7;
const POLL_MS = 30_000;
const SIGNAL_META: Record<string, { short: string; label: string }> = {
  fb: { short: '⚡ 縮', label: '縮倉突破' },
  rb: { short: '📈 增', label: '增倉突破' },
  vg: { short: '🚀 擴', label: '處女增倉' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtPushTime = (ms: number) => {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return `${sameDay ? '今日' : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`} ${fmtClock(ms)}`;
};

function finite(...values: unknown[]): number | undefined {
  for (const value of values) if (Number.isFinite(value)) return Number(value);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function normalizeDeepReclaimStatus(value: unknown): DeepReclaimStatus | null {
  const status = typeof value === 'string' ? value.toLowerCase().replace(/_/g, '-') : '';
  if (['early', 'armed', 'detected', 'setup', 'created', 'price-candidate', 'early-sending', 'early-retry'].includes(status)) return 'early';
  if (['watching', 'waiting', 'awaiting-confirmation', 'early-delivered', 'delivery-failed', 'delivery-uncertain', 'oi-wait', 'sent'].includes(status)) return 'watching';
  if (['confirmed', 'confirm-sending', 'confirm-delivered', 'confirmation-delivered', 'confirmation-delivery-failed', 'confirmation-delivery-uncertain', 'ready'].includes(status)) return 'confirmed';
  if (['invalid', 'invalidated', 'cancelled', 'superseded'].includes(status)) return 'invalid';
  if (['expired', 'timeout', 'timed-out'].includes(status)) return 'expired';
  if (['missed', 'escaped', 'ran-away'].includes(status)) return 'missed';
  if (['oi-rejected', 'oi-failed', 'oi-reject'].includes(status)) return 'oi-rejected';
  return null;
}

function deepIdentity(o: Record<string, unknown>, sym: string, setupTs: number): string {
  const explicit = textValue(o.watchId, o.candidateId, o.sourceId);
  if (explicit) return explicit;
  const id = textValue(o.id);
  const event = textValue(o.event);
  const ts = finite(o.ts);
  if (id && event && ts != null) {
    const suffix = `:${event}:${ts}`;
    if (id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id ?? `${sym}:${setupTs}`;
}

function readDeepReclaimRow(value: unknown, fallbackSym?: string): DeepReclaimRow | null {
  const o = asRecord(value);
  if (!o) return null;
  if (textValue(o.event) === 'selection-round') return null;
  const sym = textValue(o.sym, o.symbol, fallbackSym)?.toUpperCase();
  const setupTs = finite(o.setupTs, o.triggerTs, o.armedAt, o.pushTs, o.ts) ?? 0;
  const lastBarTs = finite(o.lastBarTs, o.observedAt);
  const event = textValue(o.event, o.eventKind);
  let status = normalizeDeepReclaimStatus(event ?? o.status ?? o.stage ?? o.state);
  // The state machine starts in `watching`; before it has observed a later
  // closed bar the UI calls it「早察」so the two requested stages stay visible.
  if (!event && status === 'watching' && (lastBarTs == null || lastBarTs <= setupTs)) {
    status = textValue(o.delivery) === 'delivered' ? 'watching' : 'early';
  }
  if (!sym || !status) return null;

  const setupOi = asRecord(o.setupOi) ?? asRecord(o.oi) ?? {};
  const lastPx = finite(o.lastPx, o.px, o.confirmedPx, o.setupClose, o.pushPx);
  const l0 = finite(o.l0, o.L0, o.confirmLine, o.referencePx);
  const directDistance = finite(o.distancePct, o.distanceToL0Pct, o.l0DistancePct);
  const distancePct = directDistance ?? (lastPx != null && l0 != null && l0 > 0 ? (lastPx / l0 - 1) * 100 : undefined);
  const updatedAt = finite(
    o.ts,
    o.updatedAt,
    o.terminalAt,
    o.confirmedAt,
    o.lastBarTs,
    o.setupTs,
    o.triggerTs,
  ) ?? setupTs;

  const rulesetId = textValue(o.rulesetId);
  const gateProtocolId = textValue(o.gateProtocolId);
  const selectionPolicyId = textValue(o.selectionPolicyId);
  const currentProtocolEvidence = o.evidenceEligible === true &&
    rulesetId === DEEP_RECLAIM_RULESET_ID &&
    gateProtocolId === DEEP_RECLAIM_GATE_PROTOCOL.id &&
    selectionPolicyId === DEEP_RECLAIM_SELECTION_POLICY_ID;

  return {
    id: deepIdentity(o, sym, setupTs),
    sym,
    status,
    setupTs,
    updatedAt,
    expiresAt: finite(o.expiresAt, o.expireTs, o.expiryTs),
    lastPx,
    ema20: finite(o.ema20, o.e20),
    ema50: finite(o.ema50, o.e50),
    l0,
    bandLow: finite(o.bandLow, o.confirmLow),
    bandHigh: finite(o.bandHigh, o.confirmHigh),
    lo24: finite(o.lo24, o.troughLow, o.invalidBelow),
    ddPct: finite(o.ddPct, o.drawdownPct, o.dd),
    oi1h: finite(setupOi.qty1h, setupOi.oiQty1hPct, o.qty1h, o.oiQty1hPct, o.oi1hPct),
    oi4h: finite(setupOi.qty4h, setupOi.oiQty4hPct, o.qty4h, o.oiQty4hPct, o.oi4hPct),
    distancePct,
    reason: textValue(o.reason, o.terminalReason, o.note),
    rulesetId,
    gateProtocolId,
    selectionPolicyId,
    cohortMonth: textValue(o.cohortMonth),
    evidenceEligible: currentProtocolEvidence ? true : o.evidenceEligible === false ? false : undefined,
  };
}

function readDeepReclaimReference(value: unknown): DeepReclaimReference | null {
  const o = asRecord(value);
  if (!o) return null;
  const sym = textValue(o.sym, o.symbol)?.toUpperCase();
  const ts = finite(o.ts, o.referenceTs, o.messageTs);
  const px = finite(o.px, o.referencePx, o.price);
  if (!sym || ts == null || px == null) return null;
  return {
    sym,
    ts,
    px,
    refStrength: finite(o.refStrength, o.strength),
    kind: textValue(o.kind, o.label),
    provisional: o.tsProvisional === true || o.provisional === true,
    notes: textValue(o.notes, o.note),
  };
}

function objectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const o = asRecord(value);
  return o ? Object.values(o) : [];
}

export function parseDeepReclaimPayload(payload: unknown): ParsedDeepReclaim {
  const root = asRecord(payload) ?? {};
  const state = asRecord(root.state) ?? root;
  const eventValues = objectValues(root.events);
  const rows = new Map<string, DeepReclaimRow>();

  const merge = (next: DeepReclaimRow, active = false) => {
    const prev = rows.get(next.id);
    if (!prev) {
      rows.set(next.id, next);
      return;
    }
    const newer = next.updatedAt >= prev.updatedAt;
    // Some early audit builds wrote transition deltas instead of full frozen
    // snapshots. Never let an omitted field erase the setup levels we already
    // saw on an earlier line.
    const defined = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined),
    ) as unknown as Partial<DeepReclaimRow>;
    rows.set(next.id, {
      ...prev,
      ...defined,
      id: next.id,
      sym: next.sym,
      setupTs: next.setupTs || prev.setupTs,
      updatedAt: Math.max(prev.updatedAt, next.updatedAt),
      status: active || newer ? next.status : prev.status,
      reason: next.reason ?? prev.reason,
      evidenceEligible: prev.evidenceEligible === true || next.evidenceEligible === true
        ? true
        : next.evidenceEligible ?? prev.evidenceEligible,
    });
  };

  eventValues
    .map((event) => readDeepReclaimRow(event))
    .filter((row): row is DeepReclaimRow => row != null)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .forEach((row) => merge(row));
  const active = asRecord(state.active);
  if (active) {
    for (const [sym, value] of Object.entries(active)) {
      const row = readDeepReclaimRow(value, sym);
      if (row) merge(row, true);
    }
  }

  const references = objectValues(root.references)
    .map(readDeepReclaimReference)
    .filter((ref): ref is DeepReclaimReference => ref != null)
    .sort((a, b) => b.ts - a.ts);

  return {
    rows: [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    references,
    selectionAudit: auditDeepReclaimSelection(eventValues, { requireCompleteLinkage: false }),
  };
}

function normalizeWatchStatus(value: unknown): WatchStatus | null {
  if (value === 'waiting' || value === 'armed' || value === 'watching') return 'waiting';
  if (
    value === 'ready' ||
    value === 'sending' ||
    value === 'delivered' ||
    value === 'send-failed' ||
    value === 'delivery-failed' ||
    value === 'confirmed' ||
    value === 'entry'
  ) return 'ready';
  if (
    value === 'invalid' ||
    value === 'invalidated' ||
    value === 'expired' ||
    value === 'missed' ||
    value === 'superseded' ||
    value === 'cancelled'
  ) return 'invalid';
  return null;
}

export function parseRecordingEvents(text: string): ParsedRecordingEvents {
  const pushes: PushEvent[] = [];
  // Merge transition deltas by watch id. This also makes restart/retry log
  // lines harmless: last write wins, while earlier frozen-zone fields survive.
  const watches = new Map<string, EntryWatchState>();
  let logOrder = 0;
  for (const line of text.split('\n')) {
    logOrder++;
    if (!line.includes('"type":"notify"') && !line.includes('entry-watch') && !line.includes('entry_watch')) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      const delivered = parseDeliveredSignalObject(o);
      if (delivered) {
        pushes.push(delivered);
        continue;
      }

      if (o.type !== 'entry-watch' && o.type !== 'entry_watch') continue;
      const status = normalizeWatchStatus(o.status ?? o.state ?? o.event);
      const ts = finite(o.ts, o.updatedAt, o.at);
      if (!status || !ts || typeof o.sym !== 'string') continue;
      const event = typeof o.event === 'string' ? o.event : undefined;
      const pushTs = finite(
        o.pushTs,
        o.notifyTs,
        o.parentTs,
        o.initialTs,
        event === 'armed' ? ts : undefined,
      );
      const cls = typeof o.cls === 'string' ? o.cls : typeof o.signalClass === 'string' ? o.signalClass : undefined;
      const watchId =
        typeof o.watchId === 'string' && o.watchId
          ? o.watchId
          : typeof o.id === 'string' && o.id
            ? o.id
          : `${o.sym}|${cls ?? ''}|${pushTs ?? Math.floor(ts / 900_000)}`;
      const prev = watches.get(watchId);
      const zone = Array.isArray(o.zone) ? o.zone : [];
      const next: EntryWatchState = {
        ...(prev ?? { watchId, sym: o.sym, status, updatedAt: ts, logOrder }),
        watchId,
        sym: o.sym,
        status,
        updatedAt: ts,
        logOrder,
      };
      if (cls != null) next.cls = cls;
      if (typeof o.sourceId === 'string') next.sourceId = o.sourceId;
      if (typeof o.followupEnabled === 'boolean') next.followupEnabled = o.followupEnabled;
      if (pushTs != null) next.pushTs = pushTs;
      const zoneLow = finite(o.bandLow, o.zoneLow, o.entryLow, o.entryMin, zone[0], o.entry);
      const zoneHigh = finite(o.bandHigh, o.zoneHigh, o.entryHigh, o.entryMax, zone[1], o.entry);
      const expiresAt = finite(
        o.expiresAt,
        o.expiryTs,
        o.expireTs,
        event === 'armed' ? ts + DAY_MS : undefined,
      );
      const confirmPx = finite(
        o.confirmPx,
        o.hitPx,
        event === 'ready' || event === 'confirmed' || event === 'entry' ? o.px : undefined,
      );
      const confirmTs = finite(
        o.confirmTs,
        o.hitTs,
        event === 'ready' || event === 'confirmed' || event === 'entry' ? ts : undefined,
      );
      const lastPx = finite(o.lastPx, o.currentPx, o.markPx, o.px);
      if (zoneLow != null) next.zoneLow = zoneLow;
      if (zoneHigh != null) next.zoneHigh = zoneHigh;
      if (expiresAt != null) next.expiresAt = expiresAt;
      if (confirmPx != null) next.confirmPx = confirmPx;
      if (confirmTs != null) next.confirmTs = confirmTs;
      if (lastPx != null) next.lastPx = lastPx;
      if (typeof o.reason === 'string') next.reason = o.reason;
      else if (typeof o.invalidReason === 'string') next.reason = o.invalidReason;
      else if (event === 'expired') next.reason = '監察到期';
      else if (event === 'missed') next.reason = '錯過入場區';
      else if (event === 'invalidated' || event === 'invalid') next.reason = '結構失效';
      else if (event === 'superseded') next.reason = '新推送取代';
      else if (event === 'send-failed' || event === 'delivery-failed') next.reason = 'TG 發送失敗';
      if (event) next.lastEvent = event;
      watches.set(watchId, next);
    } catch {
      /* one malformed JSONL line must not hide the rest of the watchlist */
    }
  }
  return {
    pushes: pushes.sort((a, b) => b.ts - a.ts),
    watches: [...watches.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.logOrder - a.logOrder),
  };
}

export function watchForPush(states: EntryWatchState[], push: PushEvent): EntryWatchState | undefined {
  return states.find((watch) => {
    if (watch.sym !== push.sym) return false;
    if (push.id && watch.sourceId) return push.id === watch.sourceId;
    if (watch.cls && watch.cls !== push.cls) return false;
    // Stable runtime records carry pushTs. Alias-era records without it are
    // accepted only when their lifecycle starts after this delivered push.
    return watch.pushTs != null ? Math.abs(watch.pushTs - push.ts) < 60_000 : watch.updatedAt >= push.ts - 60_000;
  });
}

export function zoneDistance(watch: EntryWatchState | undefined, px: number | undefined): number | null {
  if (!watch || !(px && px > 0)) return null;
  const lo = watch.zoneLow;
  const hi = watch.zoneHigh ?? lo;
  if (!(lo && lo > 0) || !(hi && hi > 0)) return null;
  if (px < lo) return (px / lo - 1) * 100;
  if (px > hi) return (px / hi - 1) * 100;
  return 0;
}

function fmtRemaining(expiresAt: number | undefined): string | null {
  if (!expiresAt) return null;
  const ms = expiresAt - Date.now();
  if (ms <= 0) return '到期待同步';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `餘 ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `餘 ${hours}h${mins % 60 ? `${mins % 60}m` : ''}`;
}

function watchReason(watch: EntryWatchState): string {
  if (watch.lastEvent === 'expired') return '監察 24 小時到期';
  if (watch.lastEvent === 'missed') return '未回踩前已再升 15%';
  if (watch.lastEvent === 'invalidated' || watch.lastEvent === 'invalid') return '15m 收市跌穿失效位';
  if (watch.lastEvent === 'superseded') return '被新推送取代';
  if (watch.lastEvent === 'send-failed' || watch.lastEvent === 'delivery-failed') return 'TG 發送失敗，稍後重試';
  return watch.reason || '監察已結束';
}

function WatchCell({ watch, coin }: { watch?: EntryWatchState; coin?: CoinLite }) {
  if (!watch) return <span className="push-watch none"><b>舊推送</b><small>無入場監察資料</small></span>;
  const lo = watch.zoneLow;
  const hi = watch.zoneHigh ?? lo;
  const zone = lo && hi ? (Math.abs(hi - lo) / lo < 1e-9 ? fmtPrice(lo) : `${fmtPrice(lo)}–${fmtPrice(hi)}`) : '未有區間';
  const px = coin?.lastPrice ?? watch.lastPx;
  const distance = zoneDistance(watch, px);
  const remaining = fmtRemaining(watch.expiresAt);
  if (watch.status === 'ready') {
    return (
      <span className="push-watch ready" title={watch.confirmTs ? new Date(watch.confirmTs).toLocaleString() : undefined}>
        <b>{watch.lastEvent === 'send-failed' || watch.lastEvent === 'delivery-failed' ? '✓ 到價 · TG失敗' : watch.followupEnabled === false ? '✓ 研究到價' : '✓ 已到入場區'}</b>
        <small>{watch.confirmPx ? `確認 ${fmtPrice(watch.confirmPx)}` : zone}{watch.confirmTs ? ` · ${fmtAge(watch.confirmTs)}` : ''}</small>
      </span>
    );
  }
  if (watch.status === 'invalid') {
    const reason = watchReason(watch);
    return (
      <span className="push-watch invalid" title={reason}>
        <b>已失效</b>
        <small>{reason} · {zone}</small>
      </span>
    );
  }
  const distanceText = distance == null
    ? '等候現價'
    : distance === 0
      ? '區內待確認'
      : `${distance > 0 ? '高於' : '低於'} ${Math.abs(distance).toFixed(2)}%`;
  return (
    <span className="push-watch waiting">
      <b>{watch.followupEnabled === false ? '⏳ 研究觀察中' : '⏳ 等待入場'}</b>
      <small>{zone} · {distanceText}{remaining ? ` · ${remaining}` : ''}</small>
    </span>
  );
}

function localDateTimeValue(ms: number): string {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fmtDeepTime(row: DeepReclaimRow): string {
  if (row.status === 'early' || row.status === 'watching') return fmtRemaining(row.expiresAt) ?? '24h 監察中';
  return row.updatedAt ? fmtAge(row.updatedAt) : '—';
}

function deepReason(status: DeepReclaimStatus): string {
  if (status === 'early') return 'EMA 已收復，準備等確認';
  if (status === 'watching') return '等 L0 價位及 OI 通過';
  if (status === 'confirmed') return '價位及 OI 已確認';
  if (status === 'invalid') return '已跌穿凍結低位';
  if (status === 'expired') return '24 小時監察完結';
  if (status === 'missed') return '未確認前已走車';
  return '價到確認區，但 OI 未通過';
}

function DeepReclaimPanel({ coins, onSelect }: Pick<Props, 'coins' | 'onSelect'>) {
  const [allRows, setAllRows] = useState<DeepReclaimRow[]>([]);
  const [references, setReferences] = useState<DeepReclaimReference[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [filter, setFilter] = useState<DeepReclaimFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [selectionAudit, setSelectionAudit] = useState<DeepSelectionAuditResult>(() =>
    auditDeepReclaimSelection([], { requireCompleteLinkage: false }));
  const loadedOnce = useRef(false);

  const [refSym, setRefSym] = useState('');
  const [refTs, setRefTs] = useState(() => localDateTimeValue(Date.now()));
  const [refPx, setRefPx] = useState('');
  const [refStrength, setRefStrength] = useState('70');
  const [refProvisional, setRefProvisional] = useState(true);
  const [refBusy, setRefBusy] = useState(false);
  const [refMsg, setRefMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const res = await fetch('/deep-reclaim', { signal });
      if (!res.ok) throw new Error(`deep reclaim http ${res.status}`);
      const parsed = parseDeepReclaimPayload(await res.json());
      setAllRows(parsed.rows);
      setReferences(parsed.references);
      setSelectionAudit(parsed.selectionAudit);
      setStatus(parsed.rows.length ? 'ready' : 'empty');
      setLoadedAt(Date.now());
      loadedOnce.current = true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && !loadedOnce.current) setStatus('error');
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = setInterval(() => void load(ctrl.signal), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  const coinMap = useMemo(() => new Map(coins.map((coin) => [coin.symbol, coin])), [coins]);
  const latestReference = useMemo(() => {
    const bySym = new Map<string, DeepReclaimReference>();
    for (const ref of references) if (!bySym.has(ref.sym)) bySym.set(ref.sym, ref);
    return bySym;
  }, [references]);
  const counts = useMemo(() => {
    const next = Object.fromEntries(
      Object.keys(DEEP_STATUS_META).map((key) => [key, 0]),
    ) as Record<DeepReclaimStatus, number>;
    for (const row of allRows) next[row.status]++;
    return next;
  }, [allRows]);
  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return allRows.filter((row) =>
      (!q || row.sym.includes(q)) && (filter === 'all' || row.status === filter),
    );
  }, [allRows, filter, query]);
  const endedCount = counts.invalid + counts.expired + counts.missed + counts['oi-rejected'];
  const eligibleEvidenceCount = allRows.filter((row) => row.evidenceEligible === true).length;
  const auditMeta = selectionAudit.verdict === 'PASS'
    ? { label: 'Top‑1 核對正常', cls: 'pass', title: `${selectionAudit.validRounds} 輪排序及選擇一致` }
    : selectionAudit.verdict === 'FAIL'
      ? { label: 'Top‑1 核對異常', cls: 'fail', title: `${selectionAudit.anomalies.length} 個異常；請暫停解讀新訊號` }
      : { label: 'Top‑1 等首輪', cls: 'wait', title: '未有 OI 合格 round；唔會將零資料當成通過' };

  const submitReference = async (event: React.FormEvent) => {
    event.preventDefault();
    setRefMsg(null);
    const sym = refSym.trim().toUpperCase().replace(/USDT$/, '');
    const ts = new Date(refTs).getTime();
    const px = Number(refPx);
    const strength = Number(refStrength);
    if (!sym || !Number.isFinite(ts) || !(px > 0) || !Number.isFinite(strength)) {
      setRefMsg({ ok: false, text: '請填齊幣種、時間、參考價同分數。' });
      return;
    }
    setRefBusy(true);
    try {
      const res = await fetch('/deep-reclaim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sym,
          ts,
          px,
          refStrength: strength,
          kind: 'deep-reclaim-manual',
          tsProvisional: refProvisional,
          notes: 'Push 頁人手補充',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      setRefMsg({ ok: true, text: `${sym} 參考已加入。` });
      setRefSym('');
      setRefPx('');
      setRefTs(localDateTimeValue(Date.now()));
      await load();
    } catch (e) {
      setRefMsg({ ok: false, text: `暫時加唔到：${(e as Error).message}` });
    } finally {
      setRefBusy(false);
    }
  };

  const filterOptions: DeepReclaimFilter[] = [
    'all',
    'early',
    'watching',
    'confirmed',
    'invalid',
    'expired',
    'missed',
    'oi-rejected',
  ];

  return (
    <section className="deep-reclaim-section" aria-labelledby="deep-reclaim-title">
      <div className="deep-reclaim-titlebar">
        <div>
          <div className="deep-reclaim-titleline">
            <h2 id="deep-reclaim-title">深跌收復 · 測試監察</h2>
            <span className="deep-research-tag">研究限定</span>
            <span className={`deep-audit-tag ${auditMeta.cls}`} title={auditMeta.title}>{auditMeta.label}</span>
          </div>
          <p>追蹤深跌後收復 EMA、再等 L0 確認嘅過程；未完成驗證，唔係買入提示。</p>
        </div>
        <div className="deep-reclaim-sync">
          <span>{loadedAt ? `更新 ${fmtClock(loadedAt)}` : '每 30 秒自動更新'}</span>
          <button type="button" className="btn ghost" disabled={refreshing} onClick={() => void load()}>
            {refreshing ? '更新中…' : '↻ 更新'}
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="card strat-msg"><div className="spinner" /> 載入深跌收復監察…</div>
      )}
      {status === 'error' && (
        <div className="card strat-msg">暫時未讀到深跌收復監察；上面嘅推送監察仍可正常使用。</div>
      )}
      {(status === 'ready' || status === 'empty') && (
        <>
          <div className="deep-summary-grid">
            <div className="card deep-summary"><span>全部記錄</span><strong>{allRows.length}</strong></div>
            <div className="card deep-summary early"><span>早察</span><strong>{counts.early}</strong></div>
            <div className="card deep-summary watching"><span>等確認</span><strong>{counts.watching}</strong></div>
            <div className="card deep-summary confirmed"><span>已確認</span><strong>{counts.confirmed}</strong></div>
            <div className="card deep-summary ended"><span>已結束</span><strong>{endedCount}</strong></div>
            <div className="card deep-summary evidence" title="只計同一 detector ruleset、gate protocol及Top-1選拔規則；傳送紀錄與舊版資料不入分母"><span>同規則樣本</span><strong>{eligibleEvidenceCount}</strong></div>
          </div>

          <div className="card deep-tools">
            <label className="push-search deep-search">
              <span className="sr-only">搜尋深跌收復幣種</span>
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                placeholder="搜尋幣種"
                spellCheck={false}
              />
              {query && <button type="button" aria-label="清除搜尋" onClick={() => setQuery('')}>×</button>}
            </label>
            <div className="deep-status-filters" role="group" aria-label="深跌收復狀態">
              {filterOptions.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value === 'all' ? `全部 ${allRows.length}` : `${DEEP_STATUS_META[value].short} ${counts[value]}`}
                </button>
              ))}
            </div>
          </div>

          <div className="card deep-table">
            <div className="deep-head">
              <span>幣</span>
              <span>狀態 / 參考</span>
              <span>24H</span>
              <span>EMA</span>
              <span className="ta-r">L0</span>
              <span className="ta-r">回撤</span>
              <span className="ta-r">OI 變化</span>
              <span className="ta-r">距 L0</span>
              <span>時間</span>
            </div>
            {rows.map((row) => {
              const coin = coinMap.get(row.sym);
              const reference = latestReference.get(row.sym);
              const meta = DEEP_STATUS_META[row.status];
              return (
                <div
                  key={row.id}
                  className="deep-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.sym)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(row.sym);
                    }
                  }}
                >
                  <span className="deep-symbol">
                    <span className="deep-symbol-line"><strong>{row.sym}</strong><small>/USDT</small></span>
                    <small>{coin ? fmtPrice(coin.lastPrice) : row.lastPx ? fmtPrice(row.lastPx) : '等現價'}</small>
                  </span>
                  <span className="deep-state-cell">
                    <b className={`deep-state ${row.status}`}>{meta.label}</b>
                    {reference
                      ? <small className={reference.provisional ? 'provisional' : 'manual'}>{reference.provisional ? '暫定參考' : '人手確認'} · {fmtPushTime(reference.ts)}</small>
                      : <small title={row.reason}>{deepReason(row.status)}</small>}
                  </span>
                  <span className="spark-cell deep-spark" title={coin ? `24h ${fmtPct(coin.change24h)}` : '等候掃描'}>
                    {coin ? <Sparkline pts={coin.spark} up={coin.change24h >= 0} /> : <span className="muted">—</span>}
                  </span>
                  <span className="deep-stacked num">
                    <small>20</small>{row.ema20 != null ? fmtPrice(row.ema20) : '—'}
                    <small>50</small>{row.ema50 != null ? fmtPrice(row.ema50) : '—'}
                  </span>
                  <span className="ta-r num" title={row.bandLow != null && row.bandHigh != null ? `確認區 ${fmtPrice(row.bandLow)}–${fmtPrice(row.bandHigh)}` : undefined}>
                    {row.l0 != null ? fmtPrice(row.l0) : '—'}
                  </span>
                  <span className={`ta-r num ${row.ddPct != null ? 'down' : 'muted'}`}>
                    {row.ddPct != null ? `−${Math.abs(row.ddPct).toFixed(1)}%` : '—'}
                  </span>
                  <span className="deep-oi num">
                    <small>1h <b className={row.oi1h != null && row.oi1h > 0 ? 'up' : ''}>{row.oi1h != null ? fmtPct(row.oi1h, 1) : '—'}</b></small>
                    <small>4h <b className={row.oi4h != null && row.oi4h >= 3 ? 'up' : ''}>{row.oi4h != null ? fmtPct(row.oi4h, 1) : '—'}</b></small>
                  </span>
                  <span className={`ta-r num ${row.distancePct == null ? 'muted' : row.distancePct >= 0 ? 'up' : 'down'}`}>
                    {row.distancePct != null ? fmtPct(row.distancePct, 2) : '—'}
                  </span>
                  <span className="deep-time" title={row.updatedAt ? new Date(row.updatedAt).toLocaleString() : undefined}>
                    {fmtDeepTime(row)}<small>{row.setupTs ? `早察 ${fmtAge(row.setupTs)}` : '—'}</small>
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="push-empty muted">
                {allRows.length ? '呢個狀態暫時未有記錄。' : '暫時未有深跌收復測試記錄。'}
              </div>
            )}
          </div>
        </>
      )}

      <div className="card deep-reference-panel">
        <div className="deep-reference-head">
          <div><strong>補充人手參考</strong><small>供日後核對；暫定時間會清楚標記，唔會當成正式驗證。</small></div>
          <span>{references.length} 筆參考</span>
        </div>
        <form className="deep-reference-form" onSubmit={submitReference}>
          <label><span>幣種</span><input type="text" value={refSym} onChange={(e) => setRefSym(e.target.value.toUpperCase())} placeholder="例如 GUA" spellCheck={false} /></label>
          <label><span>訊息時間</span><input type="datetime-local" value={refTs} onChange={(e) => setRefTs(e.target.value)} /></label>
          <label><span>參考價</span><input type="number" min="0" step="any" value={refPx} onChange={(e) => setRefPx(e.target.value)} placeholder="0.0000" /></label>
          <label><span>參考分數</span><input type="number" min="0" max="100" step="1" value={refStrength} onChange={(e) => setRefStrength(e.target.value)} /></label>
          <label className="deep-reference-check"><input type="checkbox" checked={refProvisional} onChange={(e) => setRefProvisional(e.target.checked)} />時間未確認</label>
          <button type="submit" className="btn" disabled={refBusy}>{refBusy ? '加入中…' : '加入記錄'}</button>
        </form>
        {refMsg && <div className={refMsg.ok ? 'set-ok deep-reference-msg' : 'set-err deep-reference-msg'}>{refMsg.text}</div>}
        {references.length > 0 && (
          <div className="deep-reference-list" aria-label="最近人手參考">
            {references.slice(0, 5).map((ref) => (
              <span key={`${ref.sym}:${ref.ts}:${ref.px}`}>
                <b>{ref.sym}</b> {fmtPrice(ref.px)} · {fmtPushTime(ref.ts)}
                <em className={ref.provisional ? 'provisional' : 'manual'}>{ref.provisional ? '暫定' : '已確認'}</em>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function PushWatchView({ tab, onTab, coins, source, onSelect }: Props) {
  const [events, setEvents] = useState<PushEvent[]>([]);
  const [watchStates, setWatchStates] = useState<EntryWatchState[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [rangeH, setRangeH] = useState<24 | 168>(24);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [query, setQuery] = useState('');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('latest');
  const loadedOnce = useRef(false);
  // A progressive full sweep temporarily contains only the batches scanned so
  // far. Preserve the last live row so pushed coins do not blink to "waiting".
  const currentCache = useRef(new Map<string, CoinLite>());
  for (const coin of coins) currentCache.current.set(coin.symbol, coin);

  const load = useCallback(async (signal: AbortSignal) => {
    setRefreshing(true);
    try {
      const now = Date.now();
      const res = await fetch(`/recordings?from=${ymd(now - FETCH_DAYS * DAY_MS)}&to=${ymd(now)}`, { signal });
      if (!res.ok) throw new Error(`recordings http ${res.status}`);
      const parsed = parseRecordingEvents(await res.text());
      setEvents(parsed.pushes);
      setWatchStates(parsed.watches);
      setStatus(parsed.pushes.length ? 'ready' : 'empty');
      setLoadedAt(Date.now());
      loadedOnce.current = true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && !loadedOnce.current) setStatus('error');
    } finally {
      if (!signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = setInterval(() => void load(ctrl.signal), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load, refreshSeq]);

  const windowEvents = useMemo(() => {
    const cutoff = Date.now() - rangeH * 3600_000;
    return events.filter((e) => e.ts >= cutoff);
  }, [events, rangeH]);

  const allRows = useMemo<PushRow[]>(() => {
    const grouped = new Map<string, { latest: PushEvent; count: number; classes: Set<string>; pushes: PushEvent[] }>();
    for (const event of windowEvents) {
      const hit = grouped.get(event.sym);
      if (hit) {
        hit.count++;
        hit.classes.add(event.cls);
        hit.pushes.push(event);
        if (event.ts > hit.latest.ts) hit.latest = event;
      } else {
        grouped.set(event.sym, { latest: event, count: 1, classes: new Set([event.cls]), pushes: [event] });
      }
    }
    return [...grouped.entries()].map(([sym, g]) => {
        // One symbol may receive several classes in the same sweep. If one of
        // those delivered pushes armed a watch, make that source card the row's
        // price/time context; otherwise an equal-ts ⚡ row could hide an active
        // 增/擴 watch merely because it was appended first.
        const watch = watchStates.find(
          (state) => state.sym === sym && g.pushes.some((push) => push.id && push.id === state.sourceId),
        ) ?? watchForPush(watchStates, g.latest);
        const watchedPush = watch?.sourceId
          ? g.pushes.find((push) => push.id === watch.sourceId)
          : undefined;
        const primary = watchedPush ?? g.latest;
        const coin = currentCache.current.get(sym);
        const ret = coin && primary.px > 0 ? (coin.lastPrice / primary.px - 1) * 100 : null;
        return {
          sym,
          latest: primary,
          count: g.count,
          classes: [...g.classes],
          coin,
          ret,
          watch,
        };
      });
  }, [windowEvents, watchStates, coins]);

  // Search + signal filters define the population used by the summary cards.
  // Status is layered afterwards so choosing「等待」doesn't make the ready /
  // invalid headline counts disappear.
  const filteredRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return allRows.filter(
      (row) => (!q || row.sym.toUpperCase().includes(q)) &&
        (signalFilter === 'all' || row.classes.includes(signalFilter)),
    );
  }, [allRows, query, signalFilter]);

  const rows = useMemo(() => {
    const filtered = filteredRows.filter(
      (row) => statusFilter === 'all' || row.watch?.status === statusFilter,
    );
    const value = (row: PushRow): number | null => {
      if (sortKey === 'distance') {
        const px = row.coin?.lastPrice ?? row.watch?.lastPx;
        const d = zoneDistance(row.watch, px);
        return d == null ? null : Math.abs(d);
      }
      if (sortKey === 'ret') return row.ret;
      if (sortKey === 'strength') return row.coin?.strength ?? row.latest.strength ?? null;
      if (sortKey === 'change24h') return row.coin?.change24h ?? null;
      return row.latest.ts;
    };
    return filtered.sort((a, b) => {
      // An entry-ready row is actionable now, then come active waits, then
      // terminal/legacy rows. The selected metric only orders within a state.
      const rank = (row: PushRow) => row.watch?.status === 'ready' ? 0 : row.watch?.status === 'waiting' ? 1 : row.watch?.status === 'invalid' ? 2 : 3;
      const stateDelta = rank(a) - rank(b);
      if (stateDelta) return stateDelta;
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return b.latest.ts - a.latest.ts;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === 'distance') return av - bv || b.latest.ts - a.latest.ts;
      return bv - av || b.latest.ts - a.latest.ts;
    });
  }, [filteredRows, statusFilter, sortKey]);

  const priced = filteredRows.filter((r) => r.ret != null);
  const winners = priced.filter((r) => (r.ret ?? 0) > 0).length;
  const best = priced.reduce<PushRow | null>((top, row) => (!top || (row.ret ?? -Infinity) > (top.ret ?? -Infinity) ? row : top), null);
  const worst = priced.reduce<PushRow | null>((low, row) => (!low || (row.ret ?? Infinity) < (low.ret ?? Infinity) ? row : low), null);
  const waitingCount = filteredRows.filter((row) => row.watch?.status === 'waiting').length;
  const readyCount = filteredRows.filter((row) => row.watch?.status === 'ready').length;
  const invalidCount = filteredRows.filter((row) => row.watch?.status === 'invalid').length;
  const hasFilters = query.trim() !== '' || signalFilter !== 'all' || statusFilter !== 'all';
  const resetFilters = () => {
    setQuery('');
    setSignalFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="page push-page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">Telegram 推送監察 · 推送價對而家價</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="push-controls">
        <div className="push-range" role="group" aria-label="推送時間範圍">
          <button type="button" aria-pressed={rangeH === 24} className={rangeH === 24 ? 'active' : ''} onClick={() => setRangeH(24)}>24小時</button>
          <button type="button" aria-pressed={rangeH === 168} className={rangeH === 168 ? 'active' : ''} onClick={() => setRangeH(168)}>7日</button>
        </div>
        <span className={`chip ${source === 'demo' ? 'demo' : 'live'}`}>
          <i className="live-dot" /> {source === 'demo' ? 'DEMO 現價' : 'LIVE 現價'}
        </span>
        <span className="muted push-sync">每30秒讀新推送及入場監察 · 現價跟掃描更新{loadedAt ? ` · ${fmtClock(loadedAt)}` : ''}</span>
        <button type="button" className="btn ghost" disabled={refreshing} onClick={() => setRefreshSeq((n) => n + 1)}>
          {refreshing ? '更新中…' : '↻ 更新'}
        </button>
      </div>

      {status === 'loading' && (
        <div className="card strat-msg"><div className="spinner" /> 載入 Telegram 推送記錄…</div>
      )}
      {status === 'error' && (
        <div className="card strat-msg">讀取推送記錄失敗 — 需在 dev server 或桌面版內執行。</div>
      )}
      {(status === 'ready' || status === 'empty') && (
        <>
          <div className="push-summary-grid">
            <div className="card push-summary"><span>活躍監察</span><strong className={waitingCount ? 'watch-waiting' : ''}>{waitingCount}</strong></div>
            <div className="card push-summary"><span>已到入場區</span><strong className={readyCount ? 'up' : ''}>{readyCount}</strong></div>
            <div className="card push-summary"><span>已失效</span><strong className={invalidCount ? 'muted' : ''}>{invalidCount}</strong></div>
            <div className="card push-summary"><span>TG 推送</span><strong>{windowEvents.length}</strong></div>
            <div className="card push-summary"><span>現價高過推送價</span><strong className={winners ? 'up' : ''}>{winners}/{priced.length}</strong></div>
            <div className="card push-summary push-extreme">
              <span>表現最好</span>
              <strong className={best ? ((best.ret ?? 0) >= 0 ? 'up' : 'down') : ''}>
                {best ? <><small>{best.sym}</small>{fmtPct(best.ret ?? 0, 2)}</> : '—'}
              </strong>
            </div>
            <div className="card push-summary push-extreme">
              <span>表現最弱</span>
              <strong className={worst ? ((worst.ret ?? 0) >= 0 ? 'up' : 'down') : ''}>
                {worst ? <><small>{worst.sym}</small>{fmtPct(worst.ret ?? 0, 2)}</> : '—'}
              </strong>
            </div>
          </div>

          <div className="card push-tools" aria-label="推送篩選及排序">
            <label className="push-search">
              <span className="sr-only">搜尋幣種</span>
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋幣種，例如 CLO"
                spellCheck={false}
              />
              {query && <button type="button" aria-label="清除搜尋" onClick={() => setQuery('')}>×</button>}
            </label>
            <div className="push-signal-filters" role="group" aria-label="訊號種類">
              {(['all', 'fb', 'rb', 'vg'] as const).map((cls) => (
                <button
                  type="button"
                  key={cls}
                  aria-pressed={signalFilter === cls}
                  className={signalFilter === cls ? 'active' : ''}
                  onClick={() => setSignalFilter(cls)}
                >
                  {cls === 'all' ? '全部' : SIGNAL_META[cls].short}
                </button>
              ))}
            </div>
            <div className="push-status-filters" role="group" aria-label="入場監察狀態">
              {(['all', 'waiting', 'ready', 'invalid'] as const).map((watchStatus) => (
                <button
                  type="button"
                  key={watchStatus}
                  aria-pressed={statusFilter === watchStatus}
                  className={statusFilter === watchStatus ? 'active' : ''}
                  onClick={() => setStatusFilter(watchStatus)}
                >
                  {watchStatus === 'all'
                    ? '全部狀態'
                    : watchStatus === 'waiting'
                      ? '⏳ 等待'
                      : watchStatus === 'ready'
                        ? '✓ 到價'
                        : '已失效'}
                </button>
              ))}
            </div>
            <label className="push-sort">
              <span>排序</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="latest">最新推送</option>
                <option value="distance">距入場區</option>
                <option value="ret">推送後表現</option>
                <option value="strength">強度</option>
                <option value="change24h">24H 升幅</option>
              </select>
            </label>
            {hasFilters && (
              <button type="button" className="push-reset" onClick={resetFilters}>
                清除篩選
              </button>
            )}
          </div>

          <div className="card push-table">
            <div className="push-head">
              <span>幣</span>
              <span>訊號</span>
              <span>入場監察</span>
              <span>推送時間</span>
              <span className="ta-r">推送價</span>
              <span className="ta-r">而家價</span>
              <span className="ta-r">推送後</span>
              <span className="ta-r">1h</span>
              <span>24H</span>
              <span className="ta-r">強度</span>
            </div>
            {rows.map((row) => {
              const meta = SIGNAL_META[row.latest.cls] ?? { short: row.latest.cls, label: row.latest.cls };
              return (
                <div
                  key={row.sym}
                  className="push-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.sym)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(row.sym);
                    }
                  }}
                >
                  <span className="push-symbol">
                    <strong>{row.sym}</strong><span className="quote">/USDT</span>
                    {row.count > 1 && <span className="chip mini">×{row.count}</span>}
                  </span>
                  <span>
                    <span className={`push-signal ${row.latest.cls}`} title={meta.label}>{meta.short}</span>
                    {row.classes.length > 1 && <span className="push-multi" title="曾觸發多種推送">+{row.classes.length - 1}</span>}
                  </span>
                  <WatchCell watch={row.watch} coin={row.coin} />
                  <span className="push-time" title={new Date(row.latest.ts).toLocaleString()}>
                    {fmtPushTime(row.latest.ts)} <small>{fmtAge(row.latest.ts)}</small>
                  </span>
                  <span className="ta-r num">{fmtPrice(row.latest.px)}</span>
                  <span className={`ta-r num ${row.coin ? '' : 'muted'}`}>{row.coin ? fmtPrice(row.coin.lastPrice) : '等掃描'}</span>
                  <span className={`ta-r num ${row.ret == null ? 'muted' : row.ret >= 0 ? 'up' : 'down'}`}>
                    {row.ret == null ? '—' : fmtPct(row.ret, 2)}
                  </span>
                  <span className={`ta-r num ${row.coin ? (row.coin.change1h >= 0 ? 'up' : 'down') : 'muted'}`}>
                    {row.coin ? fmtPct(row.coin.change1h, 2) : '—'}
                  </span>
                  <span className="spark-cell push-spark" title={row.coin ? `24h ${fmtPct(row.coin.change24h)}` : '等候掃描'}>
                    {row.coin ? <Sparkline pts={row.coin.spark} up={row.coin.change24h >= 0} /> : <span className="muted">—</span>}
                  </span>
                  <span className={`ta-r num ${row.coin ? strengthCls(row.coin.strength) : 'muted'}`}>
                    {row.coin?.strength ?? row.latest.strength ?? '—'}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="push-empty muted">
                {hasFilters
                  ? <>搵唔到符合條件嘅推送。<button type="button" onClick={resetFilters}>清除篩選</button></>
                  : <>近 {rangeH === 24 ? '24 小時' : '7 日'}未有成功 Telegram 推送。</>}
              </div>
            )}
          </div>
          <div className="push-note muted">
            到價只代表原先結構入場區已確認，並非買入指令。「研究觀察」只記錄結果，唔會發第二次 TG。有監察時推送價/時間以該次來源卡為準；舊 notify v1 會保留並標示「無入場監察資料」。×N 代表範圍內重複推送。
          </div>
        </>
      )}

      <DeepReclaimPanel coins={coins} onSelect={onSelect} />
    </div>
  );
}
