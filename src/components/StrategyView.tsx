import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseRecordings } from '../lib/evalCore';
import {
  buildDailyReport,
  sideStats,
  type Fill,
  type SideStats,
  type StratDay,
  type StratTrade,
} from '../lib/strategyReport';
import { fmtClock, fmtPrice } from '../lib/format';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
}

const DAY_MS = 24 * 3600 * 1000;
const DAYS = 14;
const MIN_SAMPLE = 20; // below this, a side's numbers are flagged 樣本不足

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// ROI is in margin units (1.0 = +100%); show as a whole-percent, signed.
const roiPct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const dirCls = (x: number) => (x > 0 ? 'up' : x < 0 ? 'down' : 'muted');
const nLabel = (l: number, s: number) => (l === s ? String(l || 0) : `${l}/${s}`);

const FILL_LABEL: Record<Fill['kind'], string> = {
  tp1: 'TP1',
  tp2: 'TP2',
  sl: 'SL',
  eod: '收盤',
  mark: '持倉中',
};

function StatCell({ s }: { s: SideStats }) {
  if (s.n === 0) return <span className="muted">—</span>;
  return (
    <span className={`num ${dirCls(s.sum)}`} title={`${s.n} 單 · 勝率 ${(s.winRate * 100).toFixed(0)}%`}>
      {roiPct(s.sum)}
    </span>
  );
}

function SummaryCard({ title, s }: { title: string; s: SideStats }) {
  return (
    <div className="card strat-summary">
      <div className="strat-sum-title">{title}</div>
      <div className={`strat-sum-val num ${s.n ? dirCls(s.sum) : 'muted'}`}>{s.n ? roiPct(s.sum) : '—'}</div>
      <div className="strat-sum-sub muted">{s.n ? `${s.n} 單 · 勝率 ${(s.winRate * 100).toFixed(0)}%` : '無訊號'}</div>
    </div>
  );
}

function TradeBlock({ label, trades, skipped }: { label: string; trades: StratTrade[]; skipped: number }) {
  if (trades.length === 0 && skipped === 0) return null;
  return (
    <div className="strat-detail-block">
      <div className="strat-detail-head">{label}</div>
      {trades.map((t, i) => {
        const last = t.fills[t.fills.length - 1];
        return (
          <div key={`${t.sym}-${t.entryTs}-${i}`} className="strat-detail-row">
            <span className="muted">{fmtClock(t.entryTs)}→{last ? fmtClock(last.ts) : '—'}</span>
            <span className="sym">{t.sym}</span>
            <span className="num muted">{fmtPrice(t.entry)}</span>
            <span className="strat-fills">
              {t.fills.map((f, k) => (
                <span key={k} className={`strat-fill ${f.kind}`}>{FILL_LABEL[f.kind]}</span>
              ))}
            </span>
            <span className={`num ${dirCls(t.roi)}`}>{roiPct(t.roi)}</span>
          </div>
        );
      })}
      {skipped > 0 && <div className="strat-skip muted">跳過 {skipped}(無出場價)</div>}
    </div>
  );
}

export default function StrategyView({ tab, onTab }: Props) {
  const [days, setDays] = useState<StratDay[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const now = Date.now();
      const res = await fetch(`/recordings?from=${ymd(now - DAYS * DAY_MS)}&to=${ymd(now)}`);
      if (!res.ok) {
        setStatus('empty');
        setDays([]);
        return;
      }
      const idx = parseRecordings(await res.text());
      if (idx.slots.length === 0) {
        setStatus('empty');
        setDays([]);
        return;
      }
      setDays(buildDailyReport(idx, DAYS, now));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // no cron: re-derive when the local date rolls over (yesterday freezes, a fresh
  // 今日 row appears) — effectively「00:00 更新」.
  useEffect(() => {
    let lastDay = new Date().getDate();
    const id = setInterval(() => {
      const d = new Date().getDate();
      if (d !== lastDay) {
        lastDay = d;
        void load();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const yesterday = useMemo(() => {
    if (!days) return null;
    const yStart = new Date(Date.now() - DAY_MS).setHours(0, 0, 0, 0);
    return days.find((d) => d.dayStartMs === yStart) ?? null;
  }, [days]);

  const totals = useMemo(() => {
    const all = days ?? [];
    return {
      fbLong: all.flatMap((d) => d.fb.long),
      fbShort: all.flatMap((d) => d.fb.short),
      s70Long: all.flatMap((d) => d.s70.long),
      s70Short: all.flatMap((d) => d.s70.short),
    };
  }, [days]);

  const emptySide = { long: [] as StratTrade[], short: [] as StratTrade[], skippedLong: 0, skippedShort: 0 };
  const yFb = yesterday?.fb ?? emptySide;
  const yS70 = yesterday?.s70 ?? emptySide;

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">策略對照 · 20x 全跟正反手(透明鏡子,非投資建議)</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      {status === 'loading' && (
        <div className="card strat-msg">
          <div className="spinner" /> 計算中…
        </div>
      )}
      {status === 'error' && <div className="card strat-msg">讀取記錄失敗 — 需喺 dev 伺服器或 exe 內執行。</div>}
      {status === 'empty' && (
        <div className="card strat-msg">
          未有記錄數據 — 行 <code>npm run recorder</code>(見 README「24/7 收集」)開始累積,tab 就會有數。
        </div>
      )}

      {status === 'ready' && days && (
        <>
          <div className="strat-summary-grid">
            <SummaryCard title="尋日 ⚡ 多" s={sideStats(yFb.long)} />
            <SummaryCard title="尋日 ⚡ 空" s={sideStats(yFb.short)} />
            <SummaryCard title="尋日 >70 多" s={sideStats(yS70.long)} />
            <SummaryCard title="尋日 >70 空" s={sideStats(yS70.short)} />
          </div>

          <div className="card table-card">
            <div className="strat-head">
              <span>日期</span>
              <span className="ta-r">⚡ n</span>
              <span className="ta-r">⚡ 多</span>
              <span className="ta-r">⚡ 空</span>
              <span className="ta-r">&gt;70 n</span>
              <span className="ta-r">&gt;70 多</span>
              <span className="ta-r">&gt;70 空</span>
            </div>
            {days.map((d) => {
              const fbL = sideStats(d.fb.long);
              const fbS = sideStats(d.fb.short);
              const sL = sideStats(d.s70.long);
              const sS = sideStats(d.s70.short);
              const open = expanded === d.dayStartMs;
              return (
                <div key={d.dayStartMs}>
                  <div
                    className={`strat-row${open ? ' open' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpanded(open ? null : d.dayStartMs)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpanded(open ? null : d.dayStartMs);
                      }
                    }}
                  >
                    <span className="strat-date">
                      {dayLabel(d.dayStartMs)}
                      {!d.final && <span className="chip mini strat-live">進行中</span>}
                    </span>
                    <span className="ta-r num">{nLabel(d.fb.long.length, d.fb.short.length)}</span>
                    <span className="ta-r"><StatCell s={fbL} /></span>
                    <span className="ta-r"><StatCell s={fbS} /></span>
                    <span className="ta-r num">{nLabel(d.s70.long.length, d.s70.short.length)}</span>
                    <span className="ta-r"><StatCell s={sL} /></span>
                    <span className="ta-r"><StatCell s={sS} /></span>
                  </div>
                  {open && (
                    <div className="strat-detail">
                      <TradeBlock label="⚡ 多" trades={d.fb.long} skipped={d.fb.skippedLong} />
                      <TradeBlock label="⚡ 空" trades={d.fb.short} skipped={d.fb.skippedShort} />
                      <TradeBlock label=">70 多" trades={d.s70.long} skipped={d.s70.skippedLong} />
                      <TradeBlock label=">70 空" trades={d.s70.short} skipped={d.s70.skippedShort} />
                      {d.fb.long.length + d.fb.short.length + d.s70.long.length + d.s70.short.length === 0 && (
                        <div className="muted strat-skip">當日無成交(訊號稀少或記錄有 gap 屬正常)。</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {days.length === 0 && <div className="sr-empty muted">近 {DAYS} 日未有訊號記錄。</div>}
          </div>

          <div className="card strat-footer">
            <div className="strat-foot-head">近 {DAYS} 日合計(20x、等權每注、ROI = 保證金倍數)</div>
            <div className="strat-foot-grid">
              {([
                ['⚡ 多', totals.fbLong],
                ['⚡ 空', totals.fbShort],
                ['>70 多', totals.s70Long],
                ['>70 空', totals.s70Short],
              ] as [string, StratTrade[]][]).map(([label, trades]) => {
                const s = sideStats(trades);
                return (
                  <div key={label} className="strat-foot-cell">
                    <span className="muted">{label}</span>
                    <StatCell s={s} />
                    {s.n > 0 && s.n < MIN_SAMPLE && <span className="chip mini strat-thin">樣本不足</span>}
                  </div>
                );
              })}
            </div>
            <div className="strat-method muted">
              20x 槓桿:幣價 ±5% = 保證金 ±100%。TP1(幣 +5%)出本金、TP2(+10%)出餘半、SL(−5%)清零、餘倉日終平。以 15
              分鐘記錄價觸發、SL 優先(偏保守);未計費用/資金費率/爆倉緩衝;穩定幣剔除;正反手各自行路徑(參數鏡像但結果唔對稱)。非投資建議。
            </div>
          </div>
        </>
      )}
    </div>
  );
}
