# R2 — 閂 app 都收到通知:headless recorder → Telegram + Windows toast

**層級**: 第1層 數據護城河 · **工作量**: S/M · **依賴**: P0 (kv.json), R1 (recorder loop 已在跑)

## zh-HK TL;DR
而家 ⚡ 通知只喺 app 開住先有(browser Notification,`src/lib/notify.ts`)。呢個 spec 令 headless recorder 每次 sweep 檢查有冇新 fire 嘅 ⚡,有就雙軌通知:Telegram bot(手機 push,免費)+ Windows toast。用戶決定咗兩樣都要。**設定改由 app 內嘅「設定」tab 做(唔使手改 kv.json):填 token、撳「偵測」自動攞 chat ID、撳「測試」即刻試兩條 channel。** 見下面 Results block 嘅實際實作。

## Context (verified facts)
- Browser-side notify already exists: `src/lib/notify.ts` — 6h per-coin cooldown (`COOLDOWN_MS`, line 11), cooldown map persisted under key `fb-notified` (line 12), fires only on `c.flushBreakout` (line 37). Keep it; this spec adds the HEADLESS path.
- Recorder loop: `scripts/recorder.ts` — `sweepAndRecord()` (25-37) assembles `CoinLite[]` per sweep; `main()` loops per 15-min slot (39-57).
- `CoinLite.flushBreakout` is the ⚡ flag (`src/types.ts:112`).
- kv.json helpers from P0: `scripts/kvFile.ts` (`readKvFile`, `writeKvKey`) — recorder is Node, use them directly (no HTTP).
- Telegram Bot API is free: `https://api.telegram.org/bot<TOKEN>/sendMessage`.

## Design (decided)
- Config lives in kv.json under key `notify`:
```json
{ "notify": { "telegramToken": "123456:ABC-...", "telegramChatId": "123456789", "toast": true, "cooldownH": 6 } }
```
- Headless cooldown map: kv.json key `fb-notified-headless` = `{ [symbol]: lastNotifiedMs }` (separate from the browser's `fb-notified` so exe + recorder running simultaneously don't race the same key).
- Rising edge in the recorder: keep the previous sweep's `Set<string>` of ⚡ symbols in memory; notify only for symbols in current-but-not-previous AND past cooldown. First sweep after startup: treat all current ⚡ as edges (cooldown map suppresses repeats across restarts).
- Message template (Telegram, HTML parse mode; numbers from the CoinLite):
```
⚡ 縮倉突破 — <b>{SYM}</b>/USDT
強度 {strength} · 1h {change1h}% · 24h量 ${vol24h 簡寫}
價 {lastPrice} · 回測 lift ×2 訊號,僅供參考
```

## Steps

### 1. New module `scripts/notifyHeadless.ts`
```ts
import { execFile } from 'node:child_process';
import { readKvFile, writeKvKey } from './kvFile';
import type { CoinLite } from '../src/types';

interface NotifyCfg { telegramToken?: string; telegramChatId?: string; toast?: boolean; cooldownH?: number }

export async function sendTelegram(cfg: NotifyCfg, text: string): Promise<void> {
  if (!cfg.telegramToken || !cfg.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegramChatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* best-effort */ }
}

export function sendToast(title: string, body: string): void {
  // WinRT toast via PowerShell — no module install needed. AppId piggybacks on PowerShell's.
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @"
<toast><visual><binding template='ToastGeneric'><text>${title}</text><text>${body}</text></binding></visual></toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('YaobiHunter').Show([Windows.UI.Notifications.ToastNotification]::new($doc))`;
  execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => {});
}

export async function notifyFlushBreakouts(coins: CoinLite[], prevFb: Set<string>): Promise<Set<string>> {
  const kv = readKvFile();
  const cfg = (kv['notify'] ?? {}) as NotifyCfg;
  const cooldownMs = (cfg.cooldownH ?? 6) * 3600_000;
  const notified = (kv['fb-notified-headless'] ?? {}) as Record<string, number>;
  const now = Date.now();
  const curFb = new Set<string>();
  let changed = false;
  for (const c of coins) {
    if (!c.flushBreakout) continue;
    curFb.add(c.symbol);
    if (prevFb.has(c.symbol)) continue;                    // not a rising edge
    if (now - (notified[c.symbol] ?? 0) < cooldownMs) continue;
    notified[c.symbol] = now; changed = true;
    const text = `⚡ 縮倉突破 — <b>${c.symbol}</b>/USDT\n強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}% · 價 ${c.lastPrice}\n回測 lift ×2 訊號,僅供參考`;
    await sendTelegram(cfg, text);
    if (cfg.toast !== false) sendToast(`⚡ 縮倉突破 — ${c.symbol}/USDT`, `強度 ${c.strength} · 1h ${c.change1h.toFixed(2)}%`);
  }
  if (changed) writeKvKey('fb-notified-headless', notified);
  return curFb;
}
```
Escape rule: symbol/body strings are alphanumeric from OKX instIds — still, replace `<`, `>`, `&` in interpolated values before embedding into the toast XML and Telegram HTML.

### 2. Wire into `scripts/recorder.ts`
- Module-level `let prevFb = new Set<string>();`
- In `sweepAndRecord()` after the record append (line 34): `prevFb = await notifyFlushBreakouts(coins, prevFb);`

### 3. `--test-notify` flag in recorder.ts
Before the main loop: if `process.argv.includes('--test-notify')` → send one fake notification (`TEST` symbol, current time) via both channels and exit. Lets the user verify config without waiting for a real ⚡ (~1-2/day universe-wide).

### 4. User setup walkthrough (add short section to README)
1. Telegram → search `@BotFather` → `/newbot` → copy the token.
2. Message your new bot once (any text).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser → find `"chat":{"id":123456789}` → that's the chat id.
4. Edit `%LOCALAPPDATA%\YaobiHunter\kv.json` → add the `notify` object (exact shape above).
5. `npm run recorder -- --test-notify` → expect a Telegram message + a Windows toast.

## Verification
1. `npm run typecheck` clean.
2. `npm run recorder -- --test-notify` with a real token/chat id → both channels fire.
3. Cooldown: run `--test-notify` twice within a minute → second run for the same symbol is suppressed (add the cooldown check to the test path too) OR verify via `fb-notified-headless` timestamp in kv.json.
4. Leave recorder running; simulate an edge by temporarily lowering `FB_VOLZ` in a scratch build if needed — otherwise accept a live ⚡ within a day or two as the real test.

## Acceptance checklist
- [ ] Telegram + toast both fire on a rising-edge ⚡ from the headless recorder.
- [ ] Per-coin cooldown persisted across recorder restarts.
- [ ] Missing/invalid config → recorder keeps sweeping silently (notifications are best-effort, never crash the loop).
- [ ] Token never printed to console or committed (kv.json is outside the repo — keep it that way).

## 陷阱 / Do-NOT
- Do NOT put the bot token anywhere inside the repo (no defaults in code, no .env committed). kv.json lives under LOCALAPPDATA.
- Do NOT block the sweep on notification I/O failures — wrap everything, the recorder's job is data first.
- Do NOT reuse the browser's `fb-notified` key (races with the app when both run).
- PowerShell toast: keep `windowsHide: true` and `-NoProfile` (user profile scripts must not run).
- Do NOT notify 蓄 (earlyAccum) — it is watchlist-tier by design, 非進場訊號 (README:57). Only ⚡.

## ✅ Results (2026-07-04, implemented — with in-app setup UI)
Built the notify engine AND a **設定 tab** so the user never hand-edits kv.json (user request).
- **Engine** `scripts/notifyHeadless.ts` (new): `sendTelegram(token,chatId,text)`, `sendToast(title,body)` (PowerShell WinRT), `detectChatId(token)` (getUpdates → latest chat id), `notifyFlushBreakouts(coins,prevFb)` (rising-edge ⚡, per-coin cooldown in kv `fb-notified-headless`). Wired into `scripts/recorder.ts` (module `prevFb`, called each sweep) + `--test-notify` flag.
- **Setup UI** `src/components/SettingsView.tsx` (new) as a 3rd nav tab (`NavTabs.tsx` gained `'settings'`; `App.tsx` renders it): Telegram token (show/hide), Chat ID + **偵測** button, toast toggle, cooldown hours, **測試通知** button, collapsible BotFather walkthrough, live per-channel result. Persists to kv `notify` (added to `SERVER_KEYS` in `cache.ts`) so the recorder reads it from kv.json. Styling `theme.css` `.set-*`.
- **Endpoints** (all Telegram/toast I/O server-side → no browser CORS, and the test hits the real send path): `POST /notify-detect-chat {token}` and `POST /notify-test {token,chatId,toast}` in BOTH `vite.config.ts` (`notifyEndpoints()`, imports notifyHeadless) and `scripts/server.cjs` (inline CJS mirror).
- **Verified:** `npm run typecheck` clean; `node --check server.cjs` OK. `npm run recorder -- --test-notify` → `telegram {ok:false,'missing token or chat id'}` + a **real Windows toast fired** (`toast {ok:true}`). curl on a dedicated dev server: `/notify-detect-chat` bad token → `{"error":"Unauthorized"}`; `/notify-test` → `{telegram:{ok:false,"Unauthorized"},toast:{ok:true,"skipped"}}`; GET→405. **Real browser (preview):** 設定 tab renders fully; typed a token → buttons enable → clicked 測試通知 → result region showed `Telegram: 失敗 — missing token or chat id` + `桌面通知: 已彈出 ✓` (real toast popped). Zero console errors.
- **Left for the user:** enter a real BotFather token in the 設定 tab, click 偵測 then 測試. The engine only fires while the recorder (or app/exe) runs — set up auto-start (`scripts/yaobi-ctl.ps1 install`, see README) for 閂-app coverage.
- **Post-review fixes (2026-07-04):** an adversarial review flagged 3 real issues, all fixed: (1+2, low) `server.cjs` `tgSend`/`tgDetectChat` returned `'bad response'` on a non-JSON error body while the vite path returned `http {status}` — now both return `http {status}`; (3, medium) `SettingsView` `detect()` merged the chat id into a stale `cfg` closure, so a token edited during the in-flight getUpdates could be reverted in state + kv.json — handlers now use functional state updaters (`patch`/`edit`/`persist`).
