import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PortfolioPolicy, PromotionDecision, StrategyId } from '../types';
import type { OutcomeSummary } from '../lib/strategyLab';
import { paperBook, paperStats, type PaperState } from '../lib/paper';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  paper: PaperState | null;
}

interface LabRow {
  strategyId: StrategyId;
  label: string;
  candidates: number;
  outcomes: number;
  active: number;
  summary: OutcomeSummary;
  shadowGate: PromotionDecision;
  paperGate: PromotionDecision;
  latestTs: number;
}

interface LabSnapshot {
  v: 1;
  generatedAt: number;
  rows: LabRow[];
  policy: PortfolioPolicy;
}

const EMPTY_POLICY: PortfolioPolicy = {
  id: 'balanced-v1', leverage: 1, riskPerTradePct: 0.5, maxPositionNotionalPct: 20,
  maxOpenPositions: 4, maxOpenRiskPct: 2, dailyLossBlockPct: 1.5, drawdownLockPct: 10,
};

const fallbackRows: Array<Pick<LabRow, 'strategyId' | 'label'>> = [
  { strategyId: 'boarding-b2-v1', label: 'B2 EMA 收復' },
  { strategyId: 'boarding-b2-oi-v1', label: 'B2 + 合約數量 OI' },
  { strategyId: 'ema20-reclaim-control-v1', label: '普通 EMA20 收復對照' },
  { strategyId: 'organic-spot-v0', label: '現貨帶動 proxy' },
  { strategyId: 'spot-led-v1', label: '真實現貨帶動' },
  { strategyId: 'virgin-v2', label: '🚀 處女增倉 V2' },
  { strategyId: 'rebuild-r1', label: '📈 重建增倉 R1' },
  { strategyId: 'flush-breakout', label: '⚡ 縮倉突破' },
];

const pct = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');

function stateFor(row: LabRow): { text: string; cls: string } {
  if (row.paperGate.pass) return { text: '可選通知', cls: 'verified' };
  if (row.shadowGate.pass) return { text: '模擬合格', cls: 'paper' };
  if (row.outcomes >= 100) return { text: '未通過', cls: 'failed' };
  return { text: '收集中', cls: 'collecting' };
}

function reasonFor(row: LabRow): string {
  if (row.paperGate.pass) return '完整研究及模擬 gate 已通過；通知仍要在設定頁由你親自開啟。';
  if (row.shadowGate.pass) return '研究 gate 已通過，正以 balanced-v1 累積正式模擬盤證據。';
  const reasons = row.shadowGate.reasons.slice(0, 2);
  return reasons.length ? `而家唔入場：${reasons.join('；')}` : '而家唔入場：資料仍未完整。';
}

function Metric({ label, value, note, valueTone = 0 }: { label: string; value: string; note?: string; valueTone?: number }) {
  return (
    <div className="strategy-metric">
      <div className="strategy-metric-label">{label}</div>
      <div className={`strategy-metric-value num ${tone(valueTone)}`}>{value}</div>
      {note && <div className="strategy-metric-sub muted">{note}</div>}
    </div>
  );
}

export default function StrategyView({ tab, onTab, paper }: Props) {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/strategy-lab', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setSnapshot(await res.json());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = useMemo(() => {
    const byId = new Map((snapshot?.rows ?? []).map((x) => [x.strategyId, x]));
    return fallbackRows.map((base) => byId.get(base.strategyId)).filter(Boolean) as LabRow[];
  }, [snapshot]);
  const active = rows.reduce((a, x) => a + x.active, 0);
  const completeOutcomes = rows.reduce((a, x) => a + x.summary.trades, 0);
  const policy = snapshot?.policy ?? EMPTY_POLICY;
  const oldBook = paper ? paperBook(paper, 'confirmed') : null;
  const oldStats = oldBook ? paperStats(oldBook) : null;

  return (
    <div className="page strategy-page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">策略實驗室</div>
            <div className="brand-sub">先證明有優勢，再用受控風險模擬</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <section className="card strategy-live-card" data-testid="strategy-risk-summary">
        <div className="strategy-section-head">
          <div>
            <div className="strategy-kicker">balanced-v1 資金防線</div>
            <h2>唔靠槓桿，先保住複利能力</h2>
          </div>
          <span className="chip strategy-policy">影子＋模擬盤 · 不落真單</span>
        </div>
        <div className="strategy-metric-grid">
          <Metric label="每單最多風險" value={`${policy.riskPerTradePct}%`} note={`單幣上限 ${policy.maxPositionNotionalPct}%`} />
          <Metric label="組合開放風險" value={`0 / ${policy.maxOpenRiskPct}%`} note={`最多 ${policy.maxOpenPositions} 個持倉`} />
          <Metric label="今日損失停止線" value={`−${policy.dailyLossBlockPct}%`} note="觸發後等下一個 UTC 日" />
          <Metric label="回撤鎖" value={`−${policy.drawdownLockPct}%`} note="鎖定 policy，等待研究覆核" />
        </div>
        <div className="strategy-live-note muted">
          現時通過 gate 嘅新策略持倉：0。未通過研究 gate 嘅 B2、現貨帶動、🚀、📈、⚡ 絕不會混入 combined portfolio。
        </div>
      </section>

      <section className="card strategy-focus-card">
        <div className="strategy-section-head">
          <div>
            <div className="strategy-kicker">因果式 forward evidence</div>
            <h2>每條策略獨立計數</h2>
          </div>
          <span className="chip strategy-policy">{active} 個等待 outcome · {completeOutcomes} 個完整結果</span>
        </div>

        {status === 'loading' && <div className="strat-msg"><div className="spinner" /> 載入研究資料…</div>}
        {status === 'error' && <div className="strat-msg">暫時讀唔到策略摘要；recorder 會在下一次新事件後重建。</div>}
        {status === 'ready' && !rows.length && (
          <div className="strategy-empty-state">1H market store 正在分批建立。B2 未 fire 前保持零交易，唔會補歷史價扮成交。</div>
        )}
        {rows.length > 0 && (
          <div className="lab-strategy-list">
            {rows.map((row) => {
              const state = stateFor(row);
              return (
                <article className="lab-strategy-row" key={row.strategyId} data-strategy={row.strategyId}>
                  <div className="lab-strategy-main">
                    <div className="lab-strategy-title">
                      <strong>{row.label}</strong>
                      <span className={`lab-status ${state.cls}`}>{state.text}</span>
                    </div>
                    <div className="lab-no-entry">{reasonFor(row)}</div>
                  </div>
                  <div className="lab-stat">
                    <span>成本後期望值</span>
                    <b className={`num ${tone(row.summary.netMean)}`}>{row.summary.trades ? pct(row.summary.netMean) : '等待'}</b>
                  </div>
                  <div className="lab-stat">
                    <span>最大回撤</span>
                    <b className="num">{row.summary.trades ? `${(row.summary.maxDrawdown * 100).toFixed(1)}%` : '—'}</b>
                  </div>
                  <div className="lab-stat">
                    <span>完整樣本</span>
                    <b className="num">{row.summary.trades}</b>
                  </div>
                  <div className="lab-stat">
                    <span>資料完整度</span>
                    <b className="num">{row.outcomes ? `${(row.summary.coverage * 100).toFixed(0)}%` : '—'}</b>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <details className="card strategy-details">
        <summary>進階／舊模擬盤對照</summary>
        <div className="strategy-details-body">
          <p>舊 confirmed、A/B/C 同 20x 記錄仍然保留，但唔再用作策略排名，亦唔會混入 balanced-v1。</p>
          <p className="muted">
            舊 confirmed book：{oldStats ? `${oldStats.openCount} 個持倉、${oldStats.closedCount} 個已完成` : '未載入'}。
            新研究成交固定使用訊號後下一根完整原生 15m open；45 分鐘內缺資料就標示失效，唔會補價。
          </p>
        </div>
      </details>
    </div>
  );
}
