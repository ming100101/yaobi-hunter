import { useState } from 'react';
import type { PaperState } from '../lib/paper';
import { paperBook, paperStats } from '../lib/paper';
import { fmtClock, fmtMoney, fmtPct, fmtPrice } from '../lib/format';

// Compact 模擬盤 chip for the screener topbar (M1). Clicking opens a small
// popover with open positions, the last 10 ledger fills, and the four headline
// stats. Deliberately minimal — the full visual home arrives with M2's tab.
const ACTION_LABEL: Record<string, string> = {
  open: '開倉',
  tp1: 'TP1',
  tp2: 'TP2',
  tp3: 'TP3',
  sl: 'SL',
  timeout: '逾時',
};

export default function PaperChip({ paper }: { paper: PaperState | null }) {
  const [open, setOpen] = useState(false);
  if (!paper) return null;

  const confirmed = paperBook(paper, 'confirmed');
  const book = confirmed ?? paper;
  const st = paperStats(book);
  const up = st.retPct >= 0;
  const ledger = book.ledger.slice(-6).reverse();
  const label = confirmed ? '確認盤' : '模擬盤';

  return (
    <span className="paper-wrap">
      <button
        type="button"
        className={`chip paper-chip ${up ? 'up' : 'down'}`}
        onClick={() => setOpen((v) => !v)}
        title="確認盤：訊號先排隊，下一個完整 15 分鐘 sweep 先用實際記錄價成交。"
        aria-expanded={open}
      >
        {label} {fmtMoney(book.equity)} <span className="num">({fmtPct(st.retPct, 1)})</span>
      </button>

      {open && (
        <>
          <div className="paper-backdrop" onClick={() => setOpen(false)} />
          <div className="paper-pop card" role="dialog" aria-label="模擬盤詳情">
            <div className="paper-pop-head">
              <span>{label} · 下一個完整 15m 入場</span>
              <span className={`num ${up ? 'up' : 'down'}`}>
                {fmtMoney(book.equity)} · {fmtPct(st.retPct, 1)}
              </span>
            </div>

            <div className="paper-stats">
              <div>
                <span className="k">勝率</span>
                <span className="v">{st.closedCount ? `${(st.winRate * 100).toFixed(0)}%` : '—'}</span>
              </div>
              <div>
                <span className="k">獲利因子</span>
                <span className="v">
                  {st.closedCount === 0 ? '—' : Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞'}
                </span>
              </div>
              <div>
                <span className="k">最大回撤</span>
                <span className="v down">{(st.maxDrawdown * 100).toFixed(1)}%</span>
              </div>
              <div>
                <span className="k">平均 R</span>
                <span className={`v ${st.avgR >= 0 ? 'up' : 'down'}`}>
                  {st.closedCount ? `${st.avgR >= 0 ? '+' : ''}${st.avgR.toFixed(2)}R` : '—'}
                </span>
              </div>
            </div>

            <div className="paper-sec">
              持倉 {book.positions.length}/5 · 等入場 {book.pending?.length ?? 0} · 已平 {st.closedCount}
            </div>
            {book.positions.length > 0 && (
              <div className="paper-list">
                {book.positions.map((p) => (
                  <div key={p.id} className="paper-li">
                    <span className="sym">{p.sym}</span>
                    <span className="muted num">進 {fmtPrice(p.entry)}</span>
                    <span className="muted num">餘 {Math.round(p.remainingFrac * 100)}%</span>
                  </div>
                ))}
              </div>
            )}

            <details className="paper-more">
              <summary>最近成交</summary>
              {ledger.length === 0 ? (
                <div className="muted paper-empty">未有成交</div>
              ) : (
                <div className="paper-list">
                  {ledger.map((r, i) => (
                    <div key={i} className="paper-li fill">
                      <span className="sym">{r.sym}</span>
                      <span className={`paper-act ${r.action}`}>{ACTION_LABEL[r.action] ?? r.action}</span>
                      <span className="muted num">{fmtPrice(r.px)}</span>
                      <span className={`num ${r.pnl >= 0 ? 'up' : 'down'}`}>
                        {r.pnl >= 0 ? '+' : ''}{r.pnl.toFixed(2)}
                      </span>
                      <span className="muted num">{fmtClock(r.ts)}</span>
                    </div>
                  ))}
                </div>
              )}
            </details>

            <div className="paper-note muted">
              舊即時入場帳保留喺「記錄」作 control；兩本帳不混合。非投資建議。
            </div>
          </div>
        </>
      )}
    </span>
  );
}
