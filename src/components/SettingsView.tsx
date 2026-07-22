import { useEffect, useState } from 'react';
import type { NotifyCfg } from '../types';
import { kvGet, kvSet } from '../data/cache';
import { ENTRY_WATCH_AVAILABLE } from '../lib/entryWatch';
import { H1_EVIDENCE_DECISION } from '../lib/evidenceDecision';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
}

type SettingsNotifyCfg = NotifyCfg & { deepReclaimTestEnabled?: boolean };

const DEFAULT: SettingsNotifyCfg = {
  telegramToken: '',
  telegramChatId: '',
  toast: true,
  cooldownH: 6,
  // Shadow collection defaults on. The separate per-class promotion map still
  // prevents every current watch from emitting a second Telegram.
  entryWatchEnabled: ENTRY_WATCH_AVAILABLE,
  // Test monitoring is opt-out: older saved configs without this field are on.
  deepReclaimTestEnabled: H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed,
};

interface Channel {
  ok: boolean;
  error?: string;
}

export default function SettingsView({ tab, onTab }: Props) {
  const [cfg, setCfg] = useState<SettingsNotifyCfg>(DEFAULT);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<null | 'detect' | 'test' | 'test-entry' | 'test-deep'>(null);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ telegram: Channel; toast: Channel } | null>(null);
  const [entryTestResult, setEntryTestResult] = useState<{ initial: Channel; followup: Channel } | null>(null);
  const [deepTestResult, setDeepTestResult] = useState<{ early: Channel; confirm: Channel } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void kvGet<SettingsNotifyCfg>('notify').then((v) => {
      if (v) setCfg({ ...DEFAULT, ...v });
    });
  }, []);

  // Merge a patch into the LATEST config via the functional updater (never a
  // stale closure — matters because `detect` awaits a network round-trip during
  // which the user may edit a field) and persist to kv, which the recorder
  // reads. `edit` = local-only (text fields, each keystroke); `persist` = write
  // current state (on blur / explicit actions).
  const patch = (p: Partial<SettingsNotifyCfg>) => {
    setCfg((prev) => {
      const next = { ...prev, ...p };
      void kvSet('notify', next);
      return next;
    });
  };
  const edit = (p: Partial<SettingsNotifyCfg>) => setCfg((prev) => ({ ...prev, ...p }));
  const persist = () =>
    setCfg((prev) => {
      void kvSet('notify', prev);
      return prev;
    });

  const detect = async () => {
    setBusy('detect');
    setDetectMsg(null);
    try {
      const r = await fetch('/notify-detect-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: cfg.telegramToken }),
      });
      const j = await r.json();
      if (j.chatId) {
        patch({ telegramChatId: j.chatId });
        setDetectMsg(`已偵測:${j.name ? `${j.name} (${j.chatId})` : j.chatId}`);
      } else {
        setDetectMsg(j.error || '偵測失敗');
      }
    } catch {
      setDetectMsg('伺服器連線失敗(需喺 exe 或 dev 伺服器內執行)');
    }
    setBusy(null);
  };

  const test = async () => {
    setBusy('test');
    setTestResult(null);
    persist(); // make sure the recorder sees the latest too
    try {
      const r = await fetch('/notify-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: cfg.telegramToken,
          chatId: cfg.telegramChatId,
          toast: cfg.toast,
        }),
      });
      setTestResult(await r.json());
    } catch {
      setTestResult({
        telegram: { ok: false, error: '伺服器連線失敗' },
        toast: { ok: false, error: '伺服器連線失敗' },
      });
    }
    setBusy(null);
  };

  const testEntryFollowup = async () => {
    setBusy('test-entry');
    setEntryTestResult(null);
    persist();
    try {
      const r = await fetch('/notify-test-entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: cfg.telegramToken,
          chatId: cfg.telegramChatId,
          toast: cfg.toast,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const fallback: Channel = r.ok
        ? { ok: true }
        : { ok: false, error: j.error || `HTTP ${r.status}` };
      setEntryTestResult({
        initial: j.initial ?? j.telegram ?? fallback,
        followup: j.followup ?? j.follow ?? j.entry ?? j.telegram ?? fallback,
      });
    } catch {
      const failed = { ok: false, error: '伺服器連線失敗' };
      setEntryTestResult({ initial: failed, followup: failed });
    }
    setBusy(null);
  };

  const testDeepReclaim = async () => {
    setBusy('test-deep');
    setDeepTestResult(null);
    persist();
    try {
      const r = await fetch('/notify-test-deep-reclaim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: cfg.telegramToken,
          chatId: cfg.telegramChatId,
          toast: cfg.toast,
        }),
      });
      const j = await r.json().catch(() => ({}));
      const fallback: Channel = r.ok
        ? { ok: true }
        : { ok: false, error: j.error || `HTTP ${r.status}` };
      setDeepTestResult({
        early: j.early ?? j.initial ?? j.telegram ?? fallback,
        confirm: j.confirm ?? j.confirmed ?? j.followup ?? j.telegram ?? fallback,
      });
    } catch {
      const failed = { ok: false, error: '連唔到測試服務' };
      setDeepTestResult({ early: failed, confirm: failed });
    }
    setBusy(null);
  };

  // U1: export/import backup of the config-like kv keys (the port-bug data-loss
  // insurance). Telegram token/chatId are NEVER written to the file, and on import
  // the existing token/chatId are preserved (a backup can't leak or wipe secrets).
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const exportBackup = async () => {
    const [pinned, notify, settings, paper] = await Promise.all([
      kvGet<string[]>('pinned'),
      kvGet<SettingsNotifyCfg>('notify'),
      kvGet<unknown>('settings'),
      kvGet<{ cfg?: unknown }>('paper-state'),
    ]);
    const backup = {
      _app: 'yaobi-hunter',
      _v: 1,
      _ts: Date.now(),
      pinned: pinned ?? [],
      // token + chatId stripped — shareable file must never carry secrets
      notify: notify
        ? {
            toast: notify.toast,
            cooldownH: notify.cooldownH,
            entryWatchEnabled: notify.entryWatchEnabled === true,
            deepReclaimTestEnabled:
              H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed && notify.deepReclaimTestEnabled === true,
          }
        : undefined,
      settings: settings ?? undefined,
      paperCfg: paper?.cfg ?? undefined,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yaobi-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    setImportMsg(null);
    try {
      const b = JSON.parse(await file.text());
      if (b?._app !== 'yaobi-hunter' || !Array.isArray(b.pinned)) {
        setImportMsg('唔係有效嘅 yaobi 備份檔');
        return;
      }
      await kvSet('pinned', b.pinned.filter((x: unknown) => typeof x === 'string'));
      if (b.settings && typeof b.settings === 'object') await kvSet('settings', b.settings);
      if (b.notify && typeof b.notify === 'object') {
        const existing = (await kvGet<SettingsNotifyCfg>('notify')) ?? DEFAULT;
        // preserve the live token/chatId; only merge the non-secret fields
        await kvSet('notify', {
          ...existing,
          toast: b.notify.toast !== false,
          cooldownH: Number.isFinite(Number(b.notify.cooldownH)) ? Number(b.notify.cooldownH) : existing.cooldownH,
          entryWatchEnabled:
            ENTRY_WATCH_AVAILABLE &&
            (typeof b.notify.entryWatchEnabled === 'boolean'
              ? b.notify.entryWatchEnabled
              : existing.entryWatchEnabled === true),
          deepReclaimTestEnabled:
            H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed &&
            (typeof b.notify.deepReclaimTestEnabled === 'boolean'
              ? b.notify.deepReclaimTestEnabled
              : existing.deepReclaimTestEnabled === true),
        });
      }
      if (b.paperCfg && typeof b.paperCfg === 'object') {
        const ps = (await kvGet<Record<string, unknown>>('paper-state')) ?? {};
        await kvSet('paper-state', { ...ps, cfg: b.paperCfg });
      }
      setImportMsg('已匯入 ✓ 重新載入中…');
      setTimeout(() => location.reload(), 700);
    } catch {
      setImportMsg('匯入失敗:檔案格式錯誤');
    }
  };

  const tokenSet = cfg.telegramToken.trim().length > 0;
  const chatSet = cfg.telegramChatId.trim().length > 0;

  return (
    <div className="page settings-page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">設定 · 通知 · 備份</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="card set-section">
        <div className="set-head">
          <span className="set-title">⚡ 訊號通知</span>
          <span className="set-sub">
            閂咗 app 都收到 ⚡ 縮倉、📈 增倉、🚀 處女增倉 —— 由 headless recorder 發 Telegram + Windows 通知
          </span>
        </div>

        <div className="set-field">
          <label className="set-label" htmlFor="tg-token">
            Telegram Bot Token
            <span className={`set-tag ${tokenSet ? 'on' : 'off'}`}>{tokenSet ? '已設定' : '未設定'}</span>
          </label>
          <div className="set-row">
            <input
              id="tg-token"
              className="search-input set-input"
              type={showToken ? 'text' : 'password'}
              value={cfg.telegramToken}
              onChange={(e) => edit({ telegramToken: e.target.value })}
              onBlur={persist}
              placeholder="123456789:ABCdef..."
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="btn ghost" onClick={() => setShowToken((v) => !v)}>
              {showToken ? '隱藏' : '顯示'}
            </button>
          </div>
        </div>

        <div className="set-field">
          <label className="set-label" htmlFor="tg-chat">
            Chat ID
            <span className={`set-tag ${chatSet ? 'on' : 'off'}`}>{chatSet ? '已設定' : '未設定'}</span>
          </label>
          <div className="set-row">
            <input
              id="tg-chat"
              className="search-input set-input"
              value={cfg.telegramChatId}
              onChange={(e) => edit({ telegramChatId: e.target.value })}
              onBlur={persist}
              placeholder="例如 123456789"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn ghost"
              onClick={detect}
              disabled={!tokenSet || busy !== null}
              title="先喺 Telegram 傳一句俾你個 bot,再撳呢度自動填 Chat ID"
            >
              {busy === 'detect' ? '偵測中…' : '偵測'}
            </button>
          </div>
          {detectMsg && <div className="set-hint">{detectMsg}</div>}
        </div>

        <div className="set-field">
          <label className="set-check">
            <input
              type="checkbox"
              checked={cfg.toast}
              onChange={(e) => patch({ toast: e.target.checked })}
            />
            同時彈 Windows 桌面通知
          </label>
        </div>

        <div className="set-field">
          <label className="set-label" htmlFor="tg-cd">
            每幣冷卻時間(小時)
          </label>
          <input
            id="tg-cd"
            className="search-input set-input set-num"
            type="number"
            min={0}
            step={1}
            value={cfg.cooldownH}
            onChange={(e) => edit({ cooldownH: Number(e.target.value) })}
            onBlur={() =>
              setCfg((prev) => {
                const next = { ...prev, cooldownH: Number.isFinite(prev.cooldownH) ? prev.cooldownH : 6 };
                void kvSet('notify', next);
                return next;
              })
            }
          />
        </div>

        <div className="set-field set-entry-watch">
          <label className="set-check">
            <input
              type="checkbox"
              checked={ENTRY_WATCH_AVAILABLE && cfg.entryWatchEnabled === true}
              onChange={(e) => patch({ entryWatchEnabled: e.target.checked })}
              disabled={!ENTRY_WATCH_AVAILABLE}
            />
            推送後入場監察
          </label>
          <div className="set-hint">
            {ENTRY_WATCH_AVAILABLE
              ? '成功 ⚡ / 📈 增 / 🚀 擴 TG 推送後監察凍結結構位 24 小時；至少等 30 分鐘先確認。目前全部只做 App／記錄 shadow，不會發第二次 TG，亦不接駁交易。'
              : '研究鎖定：現有歷史樣本／穩健性未通過 gate，所以只會在 App 記錄觀察結果，不會發第二次 TG。你仍可用下面按鈕測試成對訊息。'}
          </div>
        </div>

        <div className="set-field set-entry-watch set-deep-reclaim">
          <label className="set-check">
            <input
              type="checkbox"
              checked={H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed && cfg.deepReclaimTestEnabled === true}
              onChange={(e) => patch({ deepReclaimTestEnabled: e.target.checked })}
              disabled={!H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed}
            />
            深跌收復測試監察
            <span className="set-tag on">研究限定</span>
          </label>
          <div className="set-hint">
            H1 歷史 gate 已失敗，自動測試 TG 已關閉。Detector、早察 → 確認 lifecycle 同 shadow evidence 繼續記錄；下面嘅合成測試按鈕只供人手驗證通道。
          </div>
        </div>

        <div className="set-actions">
          <button type="button" className="btn" onClick={test} disabled={!tokenSet || busy !== null}>
            {busy === 'test' ? '傳送中…' : '測試通知'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={testEntryFollowup}
            disabled={!tokenSet || !chatSet || busy !== null}
            title="傳一對標明為測試嘅初始卡 + 到價跟進；唔會建立真實監察"
          >
            {busy === 'test-entry' ? '傳送中…' : '測試入場跟進'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={testDeepReclaim}
            disabled={!tokenSet || !chatSet || busy !== null}
            title="發一組早察及確認測試訊息，唔會建立監察記錄"
          >
            {busy === 'test-deep' ? '傳送中…' : '測試深跌收復'}
          </button>
        </div>

        {testResult && (
          <div className="set-result">
            <div className={testResult.telegram.ok ? 'set-ok' : 'set-err'}>
              Telegram:{' '}
              {testResult.telegram.ok ? '已傳送 ✓' : `失敗 — ${testResult.telegram.error || '未知'}`}
            </div>
            <div className={testResult.toast.ok ? 'set-ok' : 'set-err'}>
              桌面通知:{' '}
              {testResult.toast.ok
                ? testResult.toast.error === 'skipped'
                  ? '已關閉'
                  : '已彈出 ✓'
                : `失敗 — ${testResult.toast.error || '未知'}`}
            </div>
          </div>
        )}

        {entryTestResult && (
          <div className="set-result">
            <div className={entryTestResult.initial.ok ? 'set-ok' : 'set-err'}>
              初始測試卡:{' '}
              {entryTestResult.initial.ok ? '已傳送 ✓' : `失敗 — ${entryTestResult.initial.error || '未知'}`}
            </div>
            <div className={entryTestResult.followup.ok ? 'set-ok' : 'set-err'}>
              到價跟進:{' '}
              {entryTestResult.followup.ok ? '已傳送 ✓' : `失敗 — ${entryTestResult.followup.error || '未知'}`}
            </div>
          </div>
        )}

        {deepTestResult && (
          <div className="set-result">
            <div className={deepTestResult.early.ok ? 'set-ok' : 'set-err'}>
              早察測試：{deepTestResult.early.ok ? '已傳送 ✓' : `失敗 — ${deepTestResult.early.error || '未知'}`}
            </div>
            <div className={deepTestResult.confirm.ok ? 'set-ok' : 'set-err'}>
              確認測試：{deepTestResult.confirm.ok ? '已傳送 ✓' : `失敗 — ${deepTestResult.confirm.error || '未知'}`}
            </div>
          </div>
        )}

        <button type="button" className="set-help-toggle" onClick={() => setHelpOpen((v) => !v)}>
          {helpOpen ? '▾' : '▸'} 點樣攞 Bot Token?
        </button>
        {helpOpen && (
          <ol className="set-help">
            <li>
              Telegram 搜尋 <b>@BotFather</b> → 傳 <code>/newbot</code> → 跟指示改名 → 佢會俾你一串
              token。
            </li>
            <li>貼上面個 Token 欄。</li>
            <li>
              喺 Telegram <b>傳一句嘢俾你新開嗰個 bot</b>(隨便打字都得)。
            </li>
            <li>
              撳 Chat ID 隔籬個 <b>偵測</b> 掣 —— 會自動填。
            </li>
            <li>
              撳 <b>測試通知</b> 確認收到。搞掂!之後 recorder 跑住嘅時候,合資格訊號一 fire 就會通知你。
            </li>
          </ol>
        )}

        <div className="set-note">
          通知同入場監察只喺 headless recorder 運行時持續工作。設定 → README「24/7 收集」教你點樣開機自動行。
        </div>
      </div>

      <div className="card set-section">
        <div className="set-head">
          <span className="set-title">💾 匯出 / 匯入備份</span>
          <span className="set-sub">
            備份置頂清單、通知設定、模擬盤參數 —— port 漂移或重裝時唔使由頭嚟過
          </span>
        </div>
        <div className="set-actions">
          <button type="button" className="btn" onClick={exportBackup}>
            匯出備份
          </button>
          <label className="btn ghost">
            匯入備份
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importBackup(f);
                e.target.value = ''; // allow re-importing the same file
              }}
            />
          </label>
        </div>
        {importMsg && <div className="set-hint">{importMsg}</div>}
        <div className="set-note">
          備份檔<b>唔會</b>包含 Telegram token / chat ID(可以安心分享);匯入亦唔會覆蓋你而家嘅 token。
        </div>
      </div>
    </div>
  );
}
