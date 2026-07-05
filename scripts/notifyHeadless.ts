import { execFile } from 'node:child_process';
import { readKvFile, writeKvKey } from './kvFile';
import type { CoinLite, NotifyCfg } from '../src/types';

// Notification I/O for the headless recorder AND the dev/exe server's setup
// endpoints. Everything runs in Node (Telegram fetch + Windows toast via
// PowerShell), so the browser never hits CORS and a test exercises the real
// path. Config lives in kv.json under 'notify' (edited in the 設定 tab).

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Channel {
  ok: boolean;
  error?: string;
}

export async function sendTelegram(
  token: string | undefined,
  chatId: string | undefined,
  text: string,
): Promise<Channel> {
  if (!token || !chatId) return { ok: false, error: 'missing token or chat id' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) return { ok: false, error: j.description || `http ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

const CD_KEY = 'fb-notified-headless';

// Rising-edge ⚡ notifier for the recorder loop. prevFb = last sweep's ⚡ set;
// returns the current one to thread through. Per-coin cooldown persisted in
// kv.json (separate key from the browser's, so both can run without racing).
export async function notifyFlushBreakouts(
  coins: CoinLite[],
  prevFb: Set<string>,
): Promise<Set<string>> {
  const kv = readKvFile();
  const cfg = (kv['notify'] ?? {}) as Partial<NotifyCfg>;
  const cooldownMs = (cfg.cooldownH ?? 6) * 3600_000;
  const notified = (kv[CD_KEY] ?? {}) as Record<string, number>;
  const now = Date.now();
  const curFb = new Set<string>();
  let changed = false;
  for (const c of coins) {
    if (!c.flushBreakout) continue;
    curFb.add(c.symbol);
    if (prevFb.has(c.symbol)) continue; // not a rising edge
    if (now - (notified[c.symbol] ?? 0) < cooldownMs) continue;
    notified[c.symbol] = now;
    changed = true;
    const text =
      `⚡ 縮倉突破 — <b>${esc(c.symbol)}</b>/USDT\n` +
      `強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}% · 價 ${c.lastPrice}\n` +
      `回測 lift ×2 訊號,僅供參考`;
    await sendTelegram(cfg.telegramToken, cfg.telegramChatId, text);
    if (cfg.toast !== false) {
      await sendToast(`⚡ 縮倉突破 — ${c.symbol}/USDT`, `強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}%`);
    }
  }
  if (changed) writeKvKey(CD_KEY, notified);
  return curFb;
}
