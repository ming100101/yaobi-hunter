import { useEffect, useState } from 'react';
import type { NotifyCfg } from '../types';
import { kvGet, kvSet } from '../data/cache';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
}

const DEFAULT: NotifyCfg = { telegramToken: '', telegramChatId: '', toast: true, cooldownH: 6 };

interface Channel {
  ok: boolean;
  error?: string;
}

export default function SettingsView({ tab, onTab }: Props) {
  const [cfg, setCfg] = useState<NotifyCfg>(DEFAULT);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<null | 'detect' | 'test'>(null);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ telegram: Channel; toast: Channel } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void kvGet<NotifyCfg>('notify').then((v) => {
      if (v) setCfg({ ...DEFAULT, ...v });
    });
  }, []);

  // Merge a patch into the LATEST config via the functional updater (never a
  // stale closure — matters because `detect` awaits a network round-trip during
  // which the user may edit a field) and persist to kv, which the recorder
  // reads. `edit` = local-only (text fields, each keystroke); `persist` = write
  // current state (on blur / explicit actions).
  const patch = (p: Partial<NotifyCfg>) => {
    setCfg((prev) => {
      const next = { ...prev, ...p };
      void kvSet('notify', next);
      return next;
    });
  };
  const edit = (p: Partial<NotifyCfg>) => setCfg((prev) => ({ ...prev, ...p }));
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

  const tokenSet = cfg.telegramToken.trim().length > 0;
  const chatSet = cfg.telegramChatId.trim().length > 0;

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">設定 · 通知</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="card set-section">
        <div className="set-head">
          <span className="set-title">⚡ 訊號通知</span>
          <span className="set-sub">
            閂咗 app 都收到 ⚡ 縮倉突破 —— 由 headless recorder 發 Telegram + Windows 通知
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
              disabled={!tokenSet || busy === 'detect'}
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

        <div className="set-actions">
          <button type="button" className="btn" onClick={test} disabled={!tokenSet || busy === 'test'}>
            {busy === 'test' ? '傳送中…' : '測試通知'}
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
              撳 <b>測試通知</b> 確認收到。搞掂!之後 recorder 跑住嘅時候,⚡ 一 fire 就會通知你。
            </li>
          </ol>
        )}

        <div className="set-note">
          通知只喺 headless recorder(或 app / exe)運行時發出。設定 → README「24/7 收集」教你點樣開機自動行。
        </div>
      </div>
    </div>
  );
}
