import { useEffect, useMemo, useState } from 'react';
import {
  evalStates,
  forward,
  parseRecordings,
  risingEdges,
  runEval,
  type EvalResults,
  type RecIndex,
} from '../lib/evalCore';
import { fmtClock, fmtPct, fmtPrice } from '../lib/format';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

// M2 記錄 tab (session 1): 訊號日誌 + lift 表, both fed by the SAME evalCore the
// CLI (npm run eval-rec) uses — so the tab and the CLI can never disagree. The
// timeline scrubber, paper equity curve, and replay panel land in a later session.

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onSelect: (symbol: string) => void; // row click → open the coin's detail view
}

const DAY_MS = 24 * 3600 * 1000;
const TARGET = 10; // MFE % for the hit-rate / lift table (matches eval-rec default)
const MIN_SAMPLE = 20; // below this, a state's numbers are flagged 樣本不足
const JOURNAL_CAP = 250; // rows rendered (newest first); the count note shows the rest

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const liftCls = (l: number) => (l >= 1 ? 'up' : 'down');

// ---- lift table (evalCore states × 4h/24h vs baseline) ----
function LiftTable({ results }: { results: EvalResults }) {
  const b4 = results.baseline.h4;
  const b24 = results.baseline.h24;
  return (
    <div className="card hist-table">
      <div className="hist-lift-head">
        <span>訊號</span>
        <span className="ta-r">events</span>
        <span className="ta-r">4h 命中</span>
        <span className="ta-r">4h lift</span>
        <span className="ta-r">24h 命中</span>
        <span className="ta-r">24h lift</span>
        <span className="ta-r">24h MFE</span>
      </div>
      <div className="hist-lift-row">
        <span className="muted">基準(全部觀測)</span>
        <span className="ta-r muted">—</span>
        <span className="ta-r num">{pct(b4.hit)}</span>
        <span className="ta-r muted">×1.00</span>
        <span className="ta-r num">{pct(b24.hit)}</span>
        <span className="ta-r muted">×1.00</span>
        <span className="ta-r num">{pct(b24.meanMfe)}</span>
      </div>
      {Object.entries(results.states).map(([key, r]) => {
        const l4 = b4.hit > 0 ? r.h4.hit / b4.hit : 0;
        const l24 = b24.hit > 0 ? r.h24.hit / b24.hit : 0;
        return (
          <div className="hist-lift-row" key={key}>
            <span>
              {key}
              {r.events < MIN_SAMPLE && (
                <span className="hist-warn" title="樣本 < 20,數字未穩定,僅供參考">
                  樣本不足
                </span>
              )}
            </span>
            <span className="ta-r num">{r.events}</span>
            <span className="ta-r num">{pct(r.h4.hit)}</span>
            <span className={`ta-r num ${liftCls(l4)}`}>×{l4.toFixed(2)}</span>
            <span className="ta-r num">{pct(r.h24.hit)}</span>
            <span className={`ta-r num ${liftCls(l24)}`}>×{l24.toFixed(2)}</span>
            <span className="ta-r num">{pct(r.h24.meanMfe)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- signal journal (⚡/蓄 rising edges + forward returns) ----
interface JournalRow {
  sym: string;
  slot: number;
  ts: number;
  price: number;
  label: string;
  r1: number | null;
  r4: number | null;
  r24: number | null;
  mfe24: number | null;
}

function buildJournal(idx: RecIndex): JournalRow[] {
  const states = evalStates(idx).slice(0, 2); // ⚡ flushBreakout, 蓄 earlyAccum
  const label: Record<string, string> = { '⚡ flushBreakout': '⚡', '蓄 earlyAccum': '蓄' };
  const rows: JournalRow[] = [];
  for (const st of states) {
    for (const e of risingEdges(idx, st.on)) {
      const f1 = forward(idx, e.sym, e.slot, 4); // +1h (4 slots)
      const f4 = forward(idx, e.sym, e.slot, 16); // +4h
      const f24 = forward(idx, e.sym, e.slot, 96); // +24h
      rows.push({
        sym: e.sym,
        slot: e.slot,
        ts: e.ts,
        price: e.price,
        label: label[st.key] ?? st.key,
        r1: f1?.ret ?? null,
        r4: f4?.ret ?? null,
        r24: f24?.ret ?? null,
        mfe24: f24?.mfe ?? null,
      });
    }
  }
  return rows.sort((a, b) => b.slot - a.slot); // newest first
}

const RetCell = ({ x }: { x: number | null }) =>
  x == null ? (
    <span className="ta-r muted">—</span>
  ) : (
    <span className={`ta-r num ${x >= 0 ? 'up' : 'down'}`}>{fmtPct(x * 100, 1)}</span>
  );

function SignalJournal({ rows, onSelect }: { rows: JournalRow[]; onSelect: (s: string) => void }) {
  const shown = rows.slice(0, JOURNAL_CAP);
  return (
    <div className="card hist-table">
      <div className="hist-jrn-head">
        <span>時間</span>
        <span>幣</span>
        <span>訊號</span>
        <span className="ta-r">當時價</span>
        <span className="ta-r">+1h</span>
        <span className="ta-r">+4h</span>
        <span className="ta-r">+24h</span>
        <span className="ta-r">MFE24h</span>
      </div>
      {shown.map((r) => (
        <div
          key={`${r.sym}-${r.slot}-${r.label}`}
          className="hist-jrn-row"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(r.sym)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(r.sym);
            }
          }}
        >
          <span className="muted">{fmtClock(r.ts)}</span>
          <span className="sym">{r.sym}</span>
          <span className="hist-sig">{r.label}</span>
          <span className="ta-r num muted">{fmtPrice(r.price)}</span>
          <RetCell x={r.r1} />
          <RetCell x={r.r4} />
          <RetCell x={r.r24} />
          <span className={`ta-r num ${(r.mfe24 ?? 0) >= 0 ? 'up' : 'down'}`}>
            {r.mfe24 == null ? '—' : fmtPct(r.mfe24 * 100, 1)}
          </span>
        </div>
      ))}
      {rows.length === 0 && <div className="sr-empty muted">此範圍內未有 ⚡/蓄 訊號。</div>}
      {rows.length > JOURNAL_CAP && (
        <div className="hist-more muted">顯示最新 {JOURNAL_CAP} 筆,共 {rows.length} 筆。</div>
      )}
    </div>
  );
}

export default function HistoryView({ tab, onTab, onSelect }: Props) {
  const now = Date.now();
  const [from, setFrom] = useState(() => ymd(now - 14 * DAY_MS));
  const [to, setTo] = useState(() => ymd(now));
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  // Fetch on mount + whenever the range changes. Self-cancelling: if the user
  // leaves the tab (unmount) or changes the range mid-fetch, the stale response
  // is ignored (no setState-after-unmount) and the in-flight request is aborted.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      setStatus('loading');
      try {
        const res = await fetch(`/recordings?from=${from}&to=${to}`, { signal: ctrl.signal });
        if (cancelled) return;
        if (!res.ok) {
          setStatus(res.status === 413 ? 'error' : 'empty');
          setText(null);
          return;
        }
        const body = await res.text();
        if (cancelled) return;
        setText(body);
        setStatus(body.trim() ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [from, to]);

  const idx = useMemo(() => (text != null ? parseRecordings(text) : null), [text]);
  const results = useMemo(
    () => (idx && idx.slots.length >= 2 ? runEval(idx, TARGET) : null),
    [idx],
  );
  const journal = useMemo(() => (idx ? buildJournal(idx) : []), [idx]);

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">記錄回放 · 已錄訊號嘅 lift 同日誌(同 CLI eval-rec 同一套數)</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="hist-controls">
        <label className="hist-date">
          由 <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="hist-date">
          至 <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="muted hist-hint">MFE 命中門檻 +{TARGET}% · 上限 92 日</span>
      </div>

      {status === 'loading' && (
        <div className="card strat-msg">
          <div className="spinner" /> 載入記錄中…
        </div>
      )}
      {status === 'error' && (
        <div className="card strat-msg">讀取記錄失敗 — 需喺 dev 伺服器或 exe 內執行,範圍亦不可超過 92 日。</div>
      )}
      {status === 'empty' && (
        <div className="card strat-msg">
          此範圍未有記錄 — 行 <code>npm run recorder</code> 開始累積,或擴大日期範圍。
        </div>
      )}

      {status === 'ready' && (
        <>
          {results ? (
            <>
              <div className="hist-section-title">
                訊號 lift(~{(results.spanHours / 24).toFixed(1)} 日 · {results.uniqueSlots} 格)
              </div>
              <LiftTable results={results} />
            </>
          ) : (
            <div className="card strat-msg">記錄格數不足(需 ≥ 2 格)先計到 lift。</div>
          )}
          <div className="hist-section-title">訊號日誌(⚡/蓄 觸發即記,點列可開圖)</div>
          <SignalJournal rows={journal} onSelect={onSelect} />
          <div className="footer muted">
            數字為已記錄特徵嘅事後統計 · 小樣本僅供機制檢查,非投資建議
          </div>
        </>
      )}
    </div>
  );
}
