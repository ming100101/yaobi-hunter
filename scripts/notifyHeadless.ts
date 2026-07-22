import { execFile } from 'node:child_process';
import { readKvFile, writeKvKey } from './kvFile';
import { appendRecordLine } from './recordFile';
import { renderCandlePng, type ChartOpts } from './chartPng';
import { fmtPct, fmtPrice } from '../src/lib/format';
import type {
  Candle,
  CoinLite,
  DeliveredSignal,
  DeliveredPush,
  ExitPlan,
  NotifyCfg,
  NotifyRunResult,
  NotifySignalClass,
} from '../src/types';
import type { Insight } from '../src/lib/interpret';
import { ENTRY_WATCH_PROMOTED, entryWatchId } from '../src/lib/entryWatch';
import { SIGNAL_EVIDENCE_COPY } from '../src/lib/evidenceCopy';
import { H1_EVIDENCE_DECISION } from '../src/lib/evidenceDecision';

// Notification I/O for the headless recorder AND the dev/exe server's setup
// endpoints. Everything runs in Node (Telegram fetch + Windows toast via
// PowerShell), so the browser never hits CORS and a test exercises the real
// path. Config lives in kv.json under 'notify' (edited in the 設定 tab).

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// R4: per-coin payload for the rich signal card, captured from the FULL Coin
// before toLite strips the series. insights = interpret(coin) output — the
// exact objects the detail page renders, so card facts cannot drift from the
// app. Historical lift figures are intentionally omitted from the live card.
export interface NotifyRich {
  candles: Candle[];
  plan: ExitPlan;
  insights: Insight[];
  entryWatch?: { support: number; atr: number };
}

export interface Channel {
  ok: boolean;
  error?: string;
  messageId?: number;
  deliveredAt?: number;
}

export interface TelegramSendOptions {
  replyToMessageId?: number;
  silent?: boolean;
}

function confirmedTelegramMessage(value: any): Channel {
  const messageId = Number(value?.result?.message_id);
  const sentAtSeconds = Number(value?.result?.date);
  if (!Number.isInteger(messageId) || messageId <= 0 || !Number.isInteger(sentAtSeconds) || sentAtSeconds <= 0) {
    return { ok: false, error: 'Telegram success response missing message proof' };
  }
  return { ok: true, messageId, deliveredAt: sentAtSeconds * 1000 };
}

export async function sendTelegram(
  token: string | undefined,
  chatId: string | undefined,
  text: string,
  options: TelegramSendOptions = {},
): Promise<Channel> {
  if (!token || !chatId) return { ok: false, error: 'missing token or chat id' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_notification: options.silent === true,
        ...(options.replyToMessageId
          ? { reply_parameters: { message_id: options.replyToMessageId, allow_sending_without_reply: true } }
          : {}),
      }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j.ok !== true) return { ok: false, error: j.description || `http ${res.status}` };
    return confirmedTelegramMessage(j);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// R4: photo card via multipart sendPhoto (photo ≤10MB, caption ≤1024 chars).
// Node ≥18 globals only (FormData/Blob ride the same undici as fetch above).
export async function sendTelegramPhoto(
  token: string | undefined,
  chatId: string | undefined,
  png: Buffer,
  caption: string,
  options: TelegramSendOptions = {},
): Promise<Channel> {
  if (!token || !chatId) return { ok: false, error: 'missing token or chat id' };
  try {
    const fd = new FormData();
    fd.append('chat_id', chatId);
    fd.append('caption', caption);
    fd.append('parse_mode', 'HTML');
    if (options.silent) fd.append('disable_notification', 'true');
    if (options.replyToMessageId) {
      fd.append(
        'reply_parameters',
        JSON.stringify({ message_id: options.replyToMessageId, allow_sending_without_reply: true }),
      );
    }
    fd.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'chart.png');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: fd,
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j.ok !== true) return { ok: false, error: j.description || `http ${res.status}` };
    return confirmedTelegramMessage(j);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const REGIME_LABEL: Record<CoinLite['regime'], string> = {
  accumulate: '蓄力',
  pump: '拉升',
  distribute: '出貨',
};

// The other SHIPPED reads eligible for the card's 同時亮 line. R4 upgrades card
// CONTENT only — the notify trigger stays ⚡-only; adding a read to the trigger
// set is an E2 promote/demote decision, never a card tweak.
const CARD_EXTRA_IDS = new Set(['squeeze-breakout', 'boarding-reclaim', 'spot-led-pump']);

// R4/S9: notification class descriptor — which flag triggers, what the card
// header says, which cooldown key isolates it. ⚡ stays the hardcoded default
// everywhere so R2/R4 behaviour is untouched; S9 增倉突破 is the second class
// (gate-passed 2026-07-06, user decision: gate-passers notify).
export interface NotifyClass {
  id: NotifySignalClass;
  enabled: boolean; // H1 evidence decision; raw detector still records when false
  cdKey: string; // kv cooldown map key
  title: string; // card/toast header, e.g. '⚡ 縮倉突破'
  tail: string; // the closing lift/caveat line
  fires: (c: CoinLite) => boolean;
}
export const CLASS_FB: NotifyClass = {
  id: 'fb',
  enabled: H1_EVIDENCE_DECISION.telegram.fb,
  cdKey: 'fb-notified-headless',
  title: '⚡ 縮倉突破',
  tail: SIGNAL_EVIDENCE_COPY.flushBreakout.notify,
  fires: (c) => c.flushBreakout,
};
export const CLASS_REBUILD: NotifyClass = {
  id: 'rb',
  enabled: H1_EVIDENCE_DECISION.telegram.rb,
  cdKey: 'rb-notified-headless',
  title: '📈 增倉突破',
  tail: SIGNAL_EVIDENCE_COPY.rebuildBreakout.notify,
  fires: (c) => c.rebuildBreakout === true,
};
export const CLASS_VIRGIN: NotifyClass = {
  id: 'vg',
  enabled: H1_EVIDENCE_DECISION.telegram.vg,
  cdKey: 'vg-notified-headless',
  title: '🚀 處女增倉',
  tail: SIGNAL_EVIDENCE_COPY.virginBreakout.notify,
  fires: (c) => c.virginBreakout === true,
};

const CHART_SIGNAL_LABEL: Record<NotifySignalClass, string> = {
  fb: 'FLUSH BREAKOUT',
  rb: 'REBUILD BREAKOUT',
  vg: 'VIRGIN BREAKOUT',
};

/**
 * Causal first-stage chart contract.
 *
 * The Telegram card is a detection alert, not an execution fill. The old path
 * passed `rich.plan.entry`, which can be an EMA pullback or prior structure
 * level that price visited before the alert. Labelling that historical level
 * ENTRY implied an impossible time-travel fill. Only the scan price is marked
 * at the newest candle; any structure band is explicitly a future watch zone.
 */
export function buildSignalChartOptions(c: CoinLite, rich: NotifyRich, klass: NotifyClass): ChartOpts {
  const ew = rich.entryWatch;
  return {
    symbol: c.symbol,
    signal: CHART_SIGNAL_LABEL[klass.id],
    alertPrice: c.lastPrice,
    watchLow: ew ? ew.support - 0.5 * ew.atr : undefined,
    watchHigh: ew ? ew.support + 0.5 * ew.atr : undefined,
    lastPrice: c.lastPrice,
    change1hPct: c.change1h,
    strength: c.strength,
    volZ: c.volZ,
    oi4hPct: c.oi4h,
  };
}

// 老詹-style card caption. All live numbers come from the same CoinLite /
// Insight objects the app renders — nothing is recomputed here. `plan` remains
// frozen in NotifyRich for the research/watch audit, but is deliberately not
// presented as an executable fill in this first-stage signal card.
// Caption cap is 1024: optional lines are dropped lowest-priority-first until
// it fits; the title and causal alert/watch-state lines always survive.
export function buildSignalCard(
  c: CoinLite,
  rich: NotifyRich,
  klass: NotifyClass = CLASS_FB,
  entryWatchActive = false,
): string {
  const extras = rich.insights
    .filter((i) => CARD_EXTRA_IDS.has(i.id))
    .map((i) => i.title);
  const oiTag = c.oiTrusted === false ? '(滯後)' : '';
  const ew = rich.entryWatch;
  const bandLow = ew ? ew.support - 0.5 * ew.atr : 0;
  const bandHigh = ew ? ew.support + 0.5 * ew.atr : 0;
  const invalidBelow = ew ? ew.support - ew.atr : 0;

  // [dropRank, line] in display order; rank 0 = never dropped, higher = cut first
  const lines: Array<[number, string]> = [
    [0, `${klass.title} — <b>${esc(c.symbol)}</b>/USDT · 強度 ${c.strength} · ${REGIME_LABEL[c.regime]}`],
    [0, `通知價 ${fmtPrice(c.lastPrice)} · 尚未入場／未成交，勿當成可回溯成交價`],
    [
      0,
      ew
        ? `候選回踩觀察區 ${fmtPrice(bandLow)}–${fmtPrice(bandHigh)} · 只計TG通知後，最早30分鐘再等15m收線確認`
        : `未建立可執行入場條件 · 勿追價`,
    ],
    [0, ew ? `失效參考 ${fmtPrice(invalidBelow)} · ${entryWatchActive ? '24h TG監察已開啟' : 'App只作影子觀察；未確認前不是入場'}` : ''],
    [3, extras.length ? `同時亮:${extras.map(esc).join(' · ')}` : ''],
    [2, `OI4h ${fmtPct(c.oi4h, 1)}${oiTag} · 費率 ${fmtPct(c.funding, 3)} · 量Z ${c.volZ.toFixed(1)} · 1h ${fmtPct(c.change1h, 2)}`],
    [1, c.riskFlags.length ? `⚠ 風險:${c.riskFlags.map(esc).join(' · ')}` : ''],
    [0, klass.tail],
  ];
  let kept = lines.filter(([, s]) => s);
  for (let rank = 3; rank >= 1 && kept.map(([, s]) => s).join('\n').length > 1024; rank--) {
    kept = kept.filter(([r]) => r !== rank);
  }
  return kept.map(([, s]) => s).join('\n');
}

// WinRT toast via PowerShell — no module install. AppId piggybacks on
// PowerShell's, so it shows even though YaobiHunter isn't a registered app.
export function sendToast(title: string, body: string): Promise<Channel> {
  // SINGLE-quoted here-string (@'...'@): PowerShell does NO $-/backtick expansion
  // inside it, so a coin symbol containing $() or ` can't inject commands. esc()
  // still XML-escapes for LoadXml. Do NOT switch this back to @"...\"@.
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @'
<toast><visual><binding template='ToastGeneric'><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('YaobiHunter').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`;
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) =>
      resolve(err ? { ok: false, error: String(err.message || err) } : { ok: true }),
    );
  });
}

// Read the most recent chat id from getUpdates — the one manual step (finding
// your chat id) done for the user. They message the bot once, we pick it up.
export async function detectChatId(
  token: string | undefined,
): Promise<{ chatId?: string; name?: string; error?: string }> {
  if (!token) return { error: 'missing token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) return { error: j.description || `http ${res.status}` };
    const updates: any[] = j.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const msg = updates[i].message || updates[i].edited_message || updates[i].channel_post;
      const chat = msg?.chat;
      if (chat?.id != null) {
        const name =
          [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
          chat.title ||
          chat.username ||
          '';
        return { chatId: String(chat.id), name };
      }
    }
    return { error: '未搵到訊息 — 請先喺 Telegram 傳一句俾你個 bot,再試' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Rising-edge notifier for one signal class. prev = last sweep's fired set for
// THIS class; returns the current one to thread through. Per-coin cooldown
// persisted in kv.json under the class's own key (⚡ keeps its original key, so
// R2-era state carries over; classes never suppress each other).
// R4: when the caller supplies a rich payload for a coin, Telegram gets the
// photo card (chart PNG + caption); ANY failure in that chain falls back to a
// plain sendMessage — the notification never dies because of the picture.
export async function notifyClassEdges(
  coins: CoinLite[],
  prev: Set<string>,
  rich: Map<string, NotifyRich> | undefined,
  klass: NotifyClass,
): Promise<NotifyRunResult> {
  const current = new Set(coins.filter((c) => klass.fires(c)).map((c) => c.symbol));
  if (!klass.enabled) return { current, delivered: [], watchable: [] };
  const kv = readKvFile();
  const cfg = (kv['notify'] ?? {}) as Partial<NotifyCfg>;
  const cooldownMs = (cfg.cooldownH ?? 6) * 3600_000;
  const notified = (kv[klass.cdKey] ?? {}) as Record<string, number>;
  const now = Date.now();
  const curFb = new Set<string>();
  const delivered: DeliveredSignal[] = [];
  const watchable: DeliveredPush[] = [];
  let changed = false;
  for (const c of coins) {
    if (!klass.fires(c)) continue;
    curFb.add(c.symbol);
    const lastSentAt = notified[c.symbol] ?? 0;
    // A successful persistent signal is not a rising edge. A FAILED send has
    // no cooldown timestamp and is allowed to retry on the next sweep even
    // though the detector stayed on.
    if (prev.has(c.symbol) && lastSentAt > 0) continue;
    if (now - lastSentAt < cooldownMs) continue;
    const attemptedAt = Date.now();
    let sent = false;
    let deliveredAt = 0;
    let via: 'photo' | 'text' = 'text';
    let messageId: number | undefined;
    const r = rich?.get(c.symbol);
    const classPromoted = ENTRY_WATCH_PROMOTED[klass.id];
    const hasWatchAnchor =
      r?.entryWatch != null &&
      r.entryWatch.support > 0 &&
      r.entryWatch.atr > 0;
    const followupEnabled =
      classPromoted &&
      cfg.entryWatchEnabled !== false &&
      hasWatchAnchor;
    if (r) {
      try {
        const caption = buildSignalCard(c, r, klass, followupEnabled);
        try {
          const png = renderCandlePng(r.candles, buildSignalChartOptions(c, r, klass));
          const out = await sendTelegramPhoto(cfg.telegramToken, cfg.telegramChatId, png, caption);
          sent = out.ok;
          messageId = out.messageId;
          if (sent) {
            via = 'photo';
            deliveredAt = out.deliveredAt ?? 0;
          }
        } catch {
          // render threw — caption still carries the full card as text
        }
        if (!sent) {
          const out = await sendTelegram(cfg.telegramToken, cfg.telegramChatId, caption);
          sent = out.ok;
          messageId = out.messageId;
          if (sent) {
            via = 'text';
            deliveredAt = out.deliveredAt ?? 0;
          }
        }
      } catch {
        // card build threw — legacy short text below
      }
    }
    if (!sent) {
      const text =
        `${klass.title} — <b>${esc(c.symbol)}</b>/USDT\n` +
        `強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}% · 價 ${c.lastPrice}\n` +
        klass.tail;
      const out = await sendTelegram(cfg.telegramToken, cfg.telegramChatId, text);
      sent = out.ok;
      messageId = out.messageId;
      if (sent) {
        via = 'text';
        deliveredAt = out.deliveredAt ?? 0;
      }
    }
    if (sent) {
      // Commit the first-stage cooldown immediately after Telegram accepts the
      // message. A toast/render/log failure must never cause a duplicate card.
      notified[c.symbol] = deliveredAt;
      changed = true;
      writeKvKey(klass.cdKey, notified);
    }
    if (cfg.toast !== false) {
      await sendToast(`${klass.title} — ${c.symbol}/USDT`, `強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}%`);
    }
    if (!sent) continue;

    // This is the first timestamp at which the first-stage card is known to
    // exist in Telegram. The card price stays the scan reference by explicit
    // product choice; it is never renamed to an execution fill.
    const sourceId = `${klass.id}:${c.symbol}:${deliveredAt}`;
    const base: DeliveredSignal = {
      id: sourceId,
      sym: c.symbol,
      cls: klass.id,
      attemptedAt,
      ts: deliveredAt,
      deliveredAt,
      px: c.lastPrice,
      strength: c.strength,
      via,
      telegramMessageId: messageId,
    };
    delivered.push(base);

    // Arming is driven directly by the confirmed Telegram result, never by
    // whether the best-effort audit file happened to be writable.
    if (hasWatchAnchor && r?.entryWatch) {
      watchable.push({
        ...base,
        plan: r.plan,
        support: r.entryWatch.support,
        atr: r.entryWatch.atr,
        followupEnabled,
        telegramMessageId: messageId,
      });
    }
    // notify log: only successful Telegram delivery belongs in the push monitor.
    // 訊號日誌 can show every card 1:1 (recordings-derived edges miss micro-scan
    // fires and non-RecCoin classes like 增倉突破). Own JSONL line type; every
    // reader skips it via `type`. Best-effort — logging must never kill notify.
    try {
      appendRecordLine(
        JSON.stringify({
          type: 'notify',
          v: 3,
          id: sourceId,
          attemptedAt,
          ts: deliveredAt,
          deliveredAt,
          sym: c.symbol,
          cls: klass.id,
          px: c.lastPrice,
          strength: c.strength,
          via,
          delivered: true,
          messageId,
          ...(hasWatchAnchor && r?.entryWatch
            ? {
                watchId: entryWatchId(sourceId),
                watch: {
                  support: r.entryWatch.support,
                  atr: r.entryWatch.atr,
                  bandLow: r.entryWatch.support - 0.5 * r.entryWatch.atr,
                  bandHigh: r.entryWatch.support + 0.5 * r.entryWatch.atr,
                  invalidBelow: r.entryWatch.support - r.entryWatch.atr,
                  expiresAt: deliveredAt + 24 * 3600_000,
                  mode: followupEnabled ? 'active' : 'shadow',
                },
              }
            : {}),
        }),
      );
    } catch {
      /* recordings dir unavailable (browser-side import path) — skip */
    }
  }
  if (changed) {
    // prune coins past their cooldown — they no longer suppress a re-notify, so
    // dropping them keeps this map bounded instead of growing once per coin forever.
    for (const s in notified) if (now - notified[s] >= cooldownMs) delete notified[s];
    writeKvKey(klass.cdKey, notified);
  }
  return { current: curFb, delivered, watchable };
}

// Back-compat ⚡ wrapper — same key, same copy, same behaviour as pre-S9.
export function notifyFlushBreakouts(
  coins: CoinLite[],
  prevFb: Set<string>,
  rich?: Map<string, NotifyRich>,
): Promise<NotifyRunResult> {
  return notifyClassEdges(coins, prevFb, rich, CLASS_FB);
}
