import type { Candle, Coin, CoinLite, NotifyCfg } from '../src/types';
import {
  BN_LIVE,
  fetchClosedPerpCandles,
  fetchOiQtyChange,
  mapPool,
} from '../src/data/binance';
import {
  DEEP_RECLAIM_LEGACY_RULESET_ID,
  DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID,
  DEEP_RECLAIM_RULESET_ID,
  DEEP_RECLAIM_SELECTION_POLICY_ID,
  activeDeepReclaims,
  applyDeepReclaimArm,
  applyDeepReclaimTransition,
  armDeepReclaim,
  attachDeepReclaimOiEligibility,
  closed15mBars,
  deepReclaimWatchId,
  deepReclaimOperationalScore,
  detectDeepReclaimPriceCandidate,
  observeDeepReclaim,
  rankDeepReclaimOperationalCandidates,
  type DeepReclaimDetection,
  type DeepReclaimEvent,
  type DeepReclaimOiObservation,
  type DeepReclaimPriceCandidate,
  type DeepReclaimWatch,
} from '../src/lib/deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from '../src/lib/researchGate';
import { fmtPrice } from '../src/lib/format';
import { renderCandlePng } from './chartPng';
import {
  readDeepReclaimState,
  writeDeepReclaimState,
  type DeepReclaimDeliveryState,
  type DeepReclaimRuntimeState,
} from './deepReclaimFile';
import { readKvFile, writeKvKey } from './kvFile';
import { appendRecordLine } from './recordFile';
import { sendTelegram, sendTelegramPhoto, sendToast } from './notifyHeadless';

const SLOT_MS = 15 * 60_000;
const MAX_EARLY_PER_DAY = 10;
const EARLY_COOLDOWN_MS = 24 * 3600_000;
const MAX_SIGNAL_AGE_MS = 20 * 60_000;
const QUOTA_KEY = 'deep-reclaim-notify-quota-v1';
const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface DeepReclaimSweepCandidate {
  price: DeepReclaimPriceCandidate;
  buyShare4h: number;
  candles: Candle[];
}

interface DeepReclaimQualifiedCandidate extends DeepReclaimSweepCandidate {
  detection: DeepReclaimDetection;
  observation: DeepReclaimOiObservation | null;
  watch: DeepReclaimWatch;
}

interface DeepQuota {
  v: 1;
  day: string;
  sent: number;
  cooldowns: Record<string, number>;
}

let state: DeepReclaimRuntimeState = readDeepReclaimState();
let lastEarlyAttemptSlot = -1;

function hktDay(ts: number): string {
  return new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
}

function readQuota(now = Date.now()): DeepQuota {
  const raw = readKvFile()[QUOTA_KEY] as Partial<DeepQuota> | undefined;
  const day = hktDay(now);
  const cooldowns: Record<string, number> = {};
  if (raw?.cooldowns && typeof raw.cooldowns === 'object') {
    for (const [sym, ts] of Object.entries(raw.cooldowns)) {
      if (typeof ts === 'number' && Number.isFinite(ts) && now - ts < EARLY_COOLDOWN_MS) cooldowns[sym] = ts;
    }
  }
  return {
    v: 1,
    day,
    sent: raw?.day === day && Number.isFinite(raw.sent) ? Math.max(0, Math.trunc(raw.sent as number)) : 0,
    cooldowns,
  };
}

function canDeliverEarly(sym: string, now = Date.now()): boolean {
  const quota = readQuota(now);
  return quota.sent < MAX_EARLY_PER_DAY && now - (quota.cooldowns[sym] ?? 0) >= EARLY_COOLDOWN_MS;
}

function consumeEarlyQuota(sym: string, now = Date.now()): void {
  const quota = readQuota(now);
  quota.sent += 1;
  quota.cooldowns[sym] = now;
  writeKvKey(QUOTA_KEY, quota);
}

function persist(): void {
  writeDeepReclaimState(state);
}

function appendAudit(event: unknown): void {
  try {
    let value = event;
    if (event && typeof event === 'object' && (event as Record<string, unknown>).type === 'deep-reclaim') {
      const row = event as Record<string, unknown>;
      const setupTs = typeof row.setupTs === 'number' && Number.isFinite(row.setupTs) ? row.setupTs : 0;
      const eventName = typeof row.event === 'string' ? row.event : '';
      const id = typeof row.id === 'string' ? row.id : '';
      const rulesetId = typeof row.rulesetId === 'string' && row.rulesetId
        ? row.rulesetId
        : DEEP_RECLAIM_LEGACY_RULESET_ID;
      const selectionPolicyId = typeof row.selectionPolicyId === 'string' && row.selectionPolicyId
        ? row.selectionPolicyId
        : DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID;
      const delivery = eventName.includes('deliver') || eventName.includes('uncertain');
      const source = id.includes(':price-candidate:');
      const lifecycle = ['armed', 'confirmed', 'invalid', 'missed', 'oi-rejected', 'oi-wait', 'expired'].includes(eventName);
      const evidenceRole = delivery ? 'delivery' : source ? 'source' : lifecycle ? 'lifecycle' : 'operational';
      const evidenceEligible =
        (evidenceRole === 'source' || evidenceRole === 'lifecycle') &&
        rulesetId === DEEP_RECLAIM_RULESET_ID &&
        selectionPolicyId === DEEP_RECLAIM_SELECTION_POLICY_ID;
      const evidenceExclusionReason = evidenceRole === 'delivery' || evidenceRole === 'operational'
        ? evidenceRole
        : rulesetId !== DEEP_RECLAIM_RULESET_ID
          ? 'ruleset-mismatch'
          : 'selection-policy-mismatch';
      value = {
        ...row,
        rulesetId,
        selectionPolicyId,
        gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
        cohortMonth: setupTs > 0 ? new Date(setupTs).toISOString().slice(0, 7) : null,
        evidenceRole,
        evidenceEligible,
        ...(!evidenceEligible
          ? { evidenceExclusionReason }
          : {}),
      };
    }
    appendRecordLine(JSON.stringify(value));
  } catch (e) {
    console.error(`  [deep-reclaim] audit failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function deliveryEvent(
  watch: DeepReclaimWatch,
  event: string,
  status: string,
  ts: number,
  reason?: string,
): Record<string, unknown> {
  const px = watch.confirmedPx ?? watch.lastPx ?? watch.setupClose;
  return {
    type: 'deep-reclaim',
    v: 1,
    strategy: watch.strategy,
    rulesetId: watch.rulesetId,
    selectionPolicyId: watch.selectionPolicyId ?? DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID,
    cohortMonth: new Date(watch.setupTs).toISOString().slice(0, 7),
    id: `${watch.id}:${event}:${ts}`,
    watchId: watch.id,
    event,
    status,
    ts,
    sym: watch.sym,
    px,
    setupTs: watch.setupTs,
    waitedMinutes: Math.max(0, (ts - watch.setupTs) / 60_000),
    distanceToL0Pct: (px / watch.l0 - 1) * 100,
    peakHigh: watch.peakHigh,
    troughLow: watch.troughLow,
    troughAgeBars: watch.troughAgeBars,
    ddPct: watch.ddPct,
    pos24: watch.pos24,
    ret4hPct: watch.ret4hPct,
    ema20: watch.ema20,
    ema50: watch.ema50,
    atr14: watch.atr14,
    l0: watch.l0,
    bandLow: watch.bandLow,
    bandHigh: watch.bandHigh,
    invalidBelow: watch.invalidBelow,
    missedAbove: watch.missedAbove,
    expiresAt: watch.expiresAt,
    rankVersion: watch.rankVersion,
    rankScore: watch.rankScore,
    operationalScore: watch.operationalScore ?? watch.rankScore,
    buyShare4h: watch.buyShare4h,
    oiDecision: watch.lastOiDecision,
    oiObservedAt: watch.setupOi.observedAt,
    qty1h: watch.setupOi.qty1h,
    qty4h: watch.setupOi.qty4h,
    telegramMessageId: watch.telegramMessageId,
    reason,
  };
}

function priceCandidateEvent(
  item: DeepReclaimSweepCandidate,
  detection: DeepReclaimDetection,
  operationalScore: number,
): Record<string, unknown> {
  const p = detection.price;
  const watchId = deepReclaimWatchId(p.sym, p.setupTs);
  return {
    type: 'deep-reclaim',
    v: 1,
    strategy: p.strategy,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    id: `${watchId}:price-candidate:${p.setupTs}`,
    watchId,
    event: detection.oiQualified ? 'price-candidate' : 'oi-rejected',
    status: detection.oiQualified ? 'early' : 'oi-rejected',
    ts: p.setupTs,
    sym: p.sym,
    px: p.setupClose,
    setupTs: p.setupTs,
    ...p,
    priceQualified: true,
    oiQualified: detection.oiQualified,
    oiDecision: detection.oiDecision.code,
    oiReason: detection.oiDecision.reason,
    oiObservedAt: detection.oi?.observedAt,
    qty1h: detection.oi?.qty1h,
    qty4h: detection.oi?.qty4h,
    buyShare4h: item.buyShare4h,
    operationalScore,
    testOnly: true,
  };
}

type EarlySelectionReason =
  | 'notifications-disabled'
  | 'telegram-unconfigured'
  | 'slot-already-used'
  | 'signal-too-old'
  | 'daily-cap'
  | 'symbol-cooldown';

function stableSelectionFingerprint(ids: string[]): string {
  let hash = 2166136261 >>> 0;
  for (const ch of [...ids].sort().join('|')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function earlySelectionReason(
  watch: DeepReclaimWatch,
  cfg: Partial<NotifyCfg>,
  quota: DeepQuota,
  now: number,
  slotAlreadyUsed: boolean,
): EarlySelectionReason | null {
  if (cfg.deepReclaimTestEnabled === false) return 'notifications-disabled';
  if (!cfg.telegramToken || !cfg.telegramChatId) return 'telegram-unconfigured';
  if (slotAlreadyUsed) return 'slot-already-used';
  if (now >= watch.expiresAt || now - watch.setupTs > MAX_SIGNAL_AGE_MS) return 'signal-too-old';
  if (quota.sent >= MAX_EARLY_PER_DAY) return 'daily-cap';
  if (now - (quota.cooldowns[watch.sym] ?? 0) < EARLY_COOLDOWN_MS) return 'symbol-cooldown';
  return null;
}

function selectionRoundEvent(
  candidates: DeepReclaimQualifiedCandidate[],
  selected: DeepReclaimWatch | undefined,
  cfg: Partial<NotifyCfg>,
  now: number,
): Record<string, unknown> {
  const slot = Math.floor(now / SLOT_MS);
  const quota = readQuota(now);
  const slotAlreadyUsed = lastEarlyAttemptSlot === slot;
  const ranked = rankDeepReclaimOperationalCandidates(candidates.map((row) => row.watch));
  const fingerprint = stableSelectionFingerprint(candidates.map((row) => row.watch.id));
  const byId = new Map(candidates.map((row) => [row.watch.id, row]));
  const setupTs = Math.max(...candidates.map((row) => row.watch.setupTs));
  return {
    type: 'deep-reclaim',
    v: 1,
    strategy: 'deep-reclaim-v0',
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    id: `deep-reclaim-selection-round:${slot}:${fingerprint}`,
    watchId: selected?.id ?? `deep-reclaim-selection-round:${slot}:${fingerprint}`,
    event: 'selection-round',
    status: selected ? 'selected' : 'suppressed',
    ts: now,
    setupTs,
    sym: selected?.sym ?? '*',
    px: selected?.setupClose ?? 0,
    selectedWatchId: selected?.id ?? null,
    selectedSym: selected?.sym ?? null,
    dailyQuotaDay: quota.day,
    dailySentBefore: quota.sent,
    dailyCap: MAX_EARLY_PER_DAY,
    slot,
    candidates: ranked.map((watch) => {
      const row = byId.get(watch.id)!;
      const reason = earlySelectionReason(watch, cfg, quota, now, slotAlreadyUsed);
      return {
        watchId: watch.id,
        sym: watch.sym,
        setupTs: watch.setupTs,
        ddPct: watch.ddPct,
        rankScore: watch.rankScore,
        operationalScore: watch.operationalScore ?? watch.rankScore,
        buyShare4h: watch.buyShare4h,
        qty1h: row.observation?.qty1h,
        qty4h: row.observation?.qty4h,
        eligible: reason == null,
        reason,
      };
    }),
  };
}

function toOiObservation(value: Awaited<ReturnType<typeof fetchOiQtyChange>>): DeepReclaimOiObservation | null {
  return value
    ? { observedAt: value.observedAt, qty1h: value.change1h, qty4h: value.change4h }
    : null;
}

// Scanner candles carry a local-time display shift. The pure detector's time
// contract is raw UTC epoch seconds, so remove that shift before aggregation.
export function collectDeepReclaimPriceCandidate(
  coin: Coin,
  lite: CoinLite,
  nowMs: number,
): DeepReclaimSweepCandidate | null {
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  const raw = coin.candles.map((c) => ({ ...c, time: c.time - tzShift }));
  const bars = closed15mBars(raw, nowMs);
  const price = detectDeepReclaimPriceCandidate(coin.symbol, bars);
  if (!price) return null;
  return {
    price,
    buyShare4h: lite.feat?.buyShare4h ?? 0.5,
    candles: coin.candles.map((c) => ({ ...c })),
  };
}

function earlyCard(c: DeepReclaimWatch): string {
  return (
    `🟡 <b>深跌收復早察（測試）</b> — <b>${esc(c.sym)}</b>/USDT\n` +
    `測試排序分 ${(c.operationalScore ?? c.rankScore).toFixed(1)} · 回撤 -${c.ddPct.toFixed(1)}% · 24H位置 ${(c.pos24 * 100).toFixed(0)}%\n` +
    `現價 ${fmtPrice(c.setupClose)} · EMA20 ${fmtPrice(c.ema20)} · EMA50 ${fmtPrice(c.ema50)}\n` +
    `quantity OI：1h ${c.setupOi.qty1h >= 0 ? '+' : ''}${c.setupOi.qty1h.toFixed(2)}% · 4h +${c.setupOi.qty4h.toFixed(2)}%\n` +
    `確認線 ${fmtPrice(c.l0)} · 確認帶 ${fmtPrice(c.bandLow)}–${fmtPrice(c.bandHigh)}\n` +
    `失效參考 ${fmtPrice(c.troughLow)} · 24小時內等完成15m確認\n` +
    `測試市場提醒，並非買入指令。`
  );
}

function confirmCard(c: DeepReclaimWatch): string {
  const waited = Math.max(0, (c.confirmedAt ?? Date.now()) - c.setupTs);
  const mins = Math.round(waited / 60_000);
  const text = mins >= 60 ? `${Math.floor(mins / 60)}小時${mins % 60 ? `${mins % 60}分` : ''}` : `${mins}分`;
  return (
    `🟢 <b>阻力收復確認（測試）</b> — <b>${esc(c.sym)}</b>/USDT\n` +
    `確認價 ${fmtPrice(c.confirmedPx ?? c.lastPx ?? c.setupClose)} · 確認線 ${fmtPrice(c.l0)}\n` +
    `等待 ${text} · quantity OI：1h ${c.lastOiDecision === 'pass' ? '已確認' : c.lastOiDecision ?? '未知'}\n` +
    `原早察 ${fmtPrice(c.setupClose)} · 失效參考 ${fmtPrice(c.troughLow)}\n` +
    `請重新評估風險，並非買入指令。`
  );
}

function updateActiveDelivery(watchId: string, patch: Partial<DeepReclaimWatch>): DeepReclaimWatch | null {
  for (const [sym, watch] of Object.entries(state.active)) {
    if (watch.id !== watchId) continue;
    const next = { ...watch, ...patch };
    state = { ...state, updatedAt: Date.now(), active: { ...state.active, [sym]: next } };
    return next;
  }
  return null;
}

async function performEarlyDelivery(
  watchId: string,
  cfg: Partial<NotifyCfg>,
  candles?: Candle[],
): Promise<boolean> {
  const delivery = state.deliveries[watchId];
  const watch = Object.values(state.active).find((c) => c.id === watchId);
  if (!delivery || !watch || !['shadow', 'retry'].includes(delivery.earlyStatus)) return false;
  if (!cfg.telegramToken || !cfg.telegramChatId || cfg.deepReclaimTestEnabled === false) return false;
  if (!canDeliverEarly(watch.sym)) return false;
  const now = Date.now();
  if (now >= watch.expiresAt || now - watch.setupTs > MAX_SIGNAL_AGE_MS) return false;

  lastEarlyAttemptSlot = Math.floor(now / SLOT_MS);
  delivery.earlyStatus = 'sending';
  delivery.earlyAttempts += 1;
  delete delivery.earlyNextAttemptAt;
  updateActiveDelivery(watchId, { delivery: 'sending', attemptCount: delivery.earlyAttempts, nextAttemptAt: undefined });
  persist(); // durable sending before Telegram side effect

  const text = earlyCard(watch);
  let out = { ok: false, error: 'photo not attempted', messageId: undefined as number | undefined };
  if (candles?.length) {
    try {
      const png = renderCandlePng(candles, {
        symbol: watch.sym,
        signal: 'DEEP RECLAIM',
        entry: watch.l0,
        stop: watch.invalidBelow,
        lastPrice: watch.lastPx ?? watch.setupClose,
        change1hPct: watch.ret4hPct,
        strength: watch.operationalScore ?? watch.rankScore,
        oi4hPct: watch.setupOi.qty4h,
      });
      out = await sendTelegramPhoto(cfg.telegramToken, cfg.telegramChatId, png, text);
    } catch {
      /* text fallback below */
    }
  }
  if (!out.ok) out = await sendTelegram(cfg.telegramToken, cfg.telegramChatId, text);

  const at = Date.now();
  if (out.ok) {
    delivery.earlyStatus = 'delivered';
    delivery.earlyDeliveredAt = at;
    delivery.telegramMessageId = out.messageId;
    const delivered = updateActiveDelivery(watchId, {
      delivery: 'delivered',
      telegramMessageId: out.messageId,
      earlyDeliveredAt: at,
      nextAttemptAt: undefined,
    }) ?? watch;
    consumeEarlyQuota(watch.sym, at); // success only
    appendAudit(deliveryEvent(delivered, 'early-delivered', 'watching', at, 'test early Telegram delivered'));
    if (cfg.toast !== false) await sendToast(`🟡 深跌收復早察 — ${watch.sym}/USDT`, '測試訊號 · 等15m阻力確認');
    persist();
    return true;
  }

  if (delivery.earlyAttempts >= RETRY_MS.length) {
    delivery.earlyStatus = 'failed';
    updateActiveDelivery(watchId, { delivery: 'failed', nextAttemptAt: undefined });
  } else {
    delivery.earlyStatus = 'retry';
    delivery.earlyNextAttemptAt = at + RETRY_MS[delivery.earlyAttempts - 1];
    updateActiveDelivery(watchId, { delivery: 'selected', nextAttemptAt: delivery.earlyNextAttemptAt });
  }
  appendAudit(deliveryEvent(watch, 'delivery-failed', 'watching', at, out.error || 'early Telegram failed'));
  persist();
  return true;
}

async function performConfirmDelivery(watchId: string, cfg: Partial<NotifyCfg>): Promise<void> {
  const delivery = state.deliveries[watchId];
  const c = delivery?.confirmCandidate;
  if (!delivery || !c || !['sending', 'retry'].includes(delivery.confirmStatus)) return;
  if (!cfg.telegramToken || !cfg.telegramChatId || !delivery.telegramMessageId) {
    delivery.confirmStatus = 'failed';
    appendAudit(deliveryEvent(c, 'confirmation-delivery-failed', 'confirmed', Date.now(), 'missing Telegram reply target'));
    delete state.deliveries[watchId];
    persist();
    return;
  }
  delivery.confirmStatus = 'sending';
  delivery.confirmAttempts += 1;
  delete delivery.confirmNextAttemptAt;
  persist();

  const out = await sendTelegram(
    cfg.telegramToken,
    cfg.telegramChatId,
    confirmCard(c),
    { replyToMessageId: delivery.telegramMessageId },
  );
  const at = Date.now();
  if (out.ok) {
    delivery.confirmStatus = 'delivered';
    delivery.confirmDeliveredAt = at;
    appendAudit(deliveryEvent(c, 'confirmation-delivered', 'confirmed', at, 'confirmation Telegram replied to early message'));
    if (cfg.toast !== false) await sendToast(`🟢 阻力收復確認 — ${c.sym}/USDT`, '測試訊號 · 請重新評估風險');
    delete state.deliveries[watchId];
    persist();
    return;
  }
  if (delivery.confirmAttempts >= RETRY_MS.length) {
    delivery.confirmStatus = 'failed';
    appendAudit(deliveryEvent(c, 'confirmation-delivery-failed', 'confirmed', at, out.error || 'confirmation Telegram failed'));
    delete state.deliveries[watchId];
  } else {
    delivery.confirmStatus = 'retry';
    delivery.confirmNextAttemptAt = at + RETRY_MS[delivery.confirmAttempts - 1];
    appendAudit(deliveryEvent(c, 'confirmation-delivery-failed', 'confirmed', at, out.error || 'confirmation retry scheduled'));
  }
  persist();
}

async function deliverDueRetries(cfg: Partial<NotifyCfg>): Promise<void> {
  const now = Date.now();
  for (const d of Object.values(state.deliveries)) {
    if (d.confirmStatus === 'retry' && (d.confirmNextAttemptAt ?? Infinity) <= now) {
      await performConfirmDelivery(d.watchId, cfg);
    }
  }
  if (lastEarlyAttemptSlot === Math.floor(now / SLOT_MS)) return;
  const due = Object.values(state.deliveries)
    .filter((d) => d.earlyStatus === 'retry' && (d.earlyNextAttemptAt ?? Infinity) <= now)
    .sort((a, b) => (a.earlyNextAttemptAt ?? 0) - (b.earlyNextAttemptAt ?? 0));
  if (due[0]) await performEarlyDelivery(due[0].watchId, cfg);
}

export function reconcileAmbiguousDeepReclaimSends(): void {
  const now = Date.now();
  for (const d of Object.values(state.deliveries)) {
    if (d.earlyStatus === 'sending') {
      d.earlyStatus = 'uncertain';
      const watch = updateActiveDelivery(d.watchId, { delivery: 'uncertain', nextAttemptAt: undefined });
      if (watch) appendAudit(deliveryEvent(watch, 'delivery-uncertain', 'watching', now, 'restart during early Telegram send; not resent'));
    }
    if (d.confirmStatus === 'sending' && d.confirmCandidate) {
      d.confirmStatus = 'uncertain';
      appendAudit(deliveryEvent(d.confirmCandidate, 'confirmation-delivery-uncertain', 'confirmed', now, 'restart during confirmation send; not resent'));
      delete state.deliveries[d.watchId];
    }
  }
  persist();
}

export async function processDeepReclaimSweep(items: DeepReclaimSweepCandidate[]): Promise<void> {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  await deliverDueRetries(cfg);
  if (!items.length) return;

  const assessed: Array<{
    item: DeepReclaimSweepCandidate;
    detection: DeepReclaimDetection;
    observation: DeepReclaimOiObservation | null;
    operationalScore: number;
  }> = [];
  await mapPool(
    items,
    4,
    async (item) => {
      let observation: DeepReclaimOiObservation | null = null;
      try { observation = toOiObservation(await fetchOiQtyChange(BN_LIVE, item.price.sym, item.price.setupTs)); } catch { /* audit missing */ }
      const detection = attachDeepReclaimOiEligibility(item.price, observation);
      const operationalScore = deepReclaimOperationalScore(item.price, observation, item.buyShare4h);
      assessed.push({ item, detection, observation, operationalScore });
    },
    100,
  );

  const newlyArmed: DeepReclaimQualifiedCandidate[] = [];
  for (const row of assessed.sort((a, b) => a.item.price.sym.localeCompare(b.item.price.sym))) {
    appendAudit(priceCandidateEvent(row.item, row.detection, row.operationalScore));
    if (!row.detection.oiQualified || !row.observation) continue;
    if (state.active[row.item.price.sym]) {
      appendAudit({
        ...priceCandidateEvent(row.item, row.detection, row.operationalScore),
        id: `${deepReclaimWatchId(row.item.price.sym, row.item.price.setupTs)}:duplicate-active:${Date.now()}`,
        event: 'duplicate-active',
        status: 'waiting',
        reason: 'one active deep-reclaim watch per symbol',
      });
      continue;
    }
    const arm = armDeepReclaim(row.detection.price, row.observation);
    if (!arm.candidate) continue;
    const watch: DeepReclaimWatch = {
      ...arm.candidate,
      delivery: 'shadow',
      attemptCount: 0,
      buyShare4h: row.item.buyShare4h,
      operationalScore: row.operationalScore,
      selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    };
    const armed = { ...arm, candidate: watch };
    const core = applyDeepReclaimArm(state, armed);
    state = { ...core, deliveries: state.deliveries };
    state.deliveries[watch.id] = {
      watchId: watch.id,
      sym: watch.sym,
      earlyStatus: 'shadow',
      earlyAttempts: 0,
      confirmStatus: 'none',
      confirmAttempts: 0,
    };
    if (arm.event) appendAudit({
      ...arm.event,
      selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
      operationalScore: row.operationalScore,
      buyShare4h: row.item.buyShare4h,
    });
    newlyArmed.push({ item: row.item, detection: row.detection, observation: row.observation, watch });
  }
  persist();

  if (!newlyArmed.length) return;
  const now = Date.now();
  const quota = readQuota(now);
  const slotAlreadyUsed = lastEarlyAttemptSlot === Math.floor(now / SLOT_MS);
  const eligible = newlyArmed.filter(
    (x) => earlySelectionReason(x.watch, cfg, quota, now, slotAlreadyUsed) == null,
  );
  const ranked = rankDeepReclaimOperationalCandidates(eligible.map((x) => x.watch));
  const top = ranked[0];
  appendAudit(selectionRoundEvent(newlyArmed, top, cfg, now));
  if (!top) return;
  const source = eligible.find((x) => x.watch.id === top.id);
  if (source) await performEarlyDelivery(top.id, cfg, source.item.candles);
}

export async function monitorDeepReclaims(): Promise<void> {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  await deliverDueRetries(cfg);
  for (const snapshot of activeDeepReclaims(state)) {
    try {
      const bars = await fetchClosedPerpCandles(BN_LIVE, snapshot.sym, '15m', 128);
      let current = state.active[snapshot.sym];
      if (!current || current.id !== snapshot.id) continue;
      for (const c of bars) {
        const bar = { closeTs: c.time * 1000 + SLOT_MS, open: c.open, high: c.high, low: c.low, close: c.close };
        if (bar.closeTs <= current.lastBarTs) continue;
        let observation: DeepReclaimOiObservation | null = null;
        if (bar.close >= current.bandLow && bar.close <= current.bandHigh) {
          try { observation = toOiObservation(await fetchOiQtyChange(BN_LIVE, current.sym, bar.closeTs)); } catch { /* missing keeps waiting */ }
        }
        const transition = observeDeepReclaim(current, bar, observation);
        current = transition.candidate;
        if (transition.event) appendAudit(transition.event);
        const core = applyDeepReclaimTransition(state, transition);
        state = { ...core, deliveries: state.deliveries };

        if (current.status !== 'watching') {
          const delivery = state.deliveries[current.id];
          if (current.status === 'confirmed' && delivery?.earlyStatus === 'delivered' && delivery.telegramMessageId) {
            delivery.confirmStatus = 'sending';
            delivery.confirmCandidate = current;
            persist(); // durable confirmation queue before send
            await performConfirmDelivery(current.id, cfg);
          } else {
            delete state.deliveries[current.id];
            persist();
          }
          break;
        }
        persist();
      }
    } catch (e) {
      console.error(`  [deep-reclaim] ${snapshot.sym} monitor skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export function getDeepReclaimRuntimeState(): DeepReclaimRuntimeState {
  return state;
}
