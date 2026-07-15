import { useMemo, useState } from 'react';
import type { RecIndex } from '../lib/evalCore';
import {
  evaluateSignalOutcome,
  type SignalEntryMode,
  type SignalNotifyEvent,
  type SignalOutcome,
} from '../lib/signalEvents';
import { fmtPct } from '../lib/format';

type ClassFilter = 'all' | SignalNotifyEvent['cls'];

const CLASS_LABEL: Record<ClassFilter, string> = {
  all: '全部',
  fb: '⚡',
  rb: '📈 增',
  vg: '🚀 擴',
};
const MODE_LABEL: Record<SignalEntryMode, string> = {
  'tg-card': 'TG 卡價參考',
  'next-15m': '下一格 15m 掃描價',
};
const HORIZONS = [
  { slots: 16, label: '4h' },
  { slots: 96, label: '24h' },
  { slots: 192, label: '48h' },
] as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (rows: SignalOutcome[], predicate: (row: SignalOutcome) => boolean) =>
  rows.length ? rows.filter(predicate).length / rows.length : null;
const showPct = (value: number | null, digits = 1) =>
  value == null ? '—' : fmtPct(value * 100, digits);

function OutcomeCard({
  idx,
  events,
  mode,
}: {
  idx: RecIndex;
  events: SignalNotifyEvent[];
  mode: SignalEntryMode;
}) {
  const rows = HORIZONS.map(({ slots, label }) => {
    const outcomes = events.map((event) => evaluateSignalOutcome(idx, event, slots, mode));
    const complete = outcomes.filter((outcome) => outcome.status === 'complete');
    const pending = outcomes.filter((outcome) => outcome.status === 'pending').length;
    const missing = outcomes.filter((outcome) => outcome.status === 'data-missing').length;
    return {
      label,
      complete,
      pending,
      missing,
      mfe: mean(complete.flatMap((x) => (x.mfe == null ? [] : [x.mfe]))),
      mae: mean(complete.flatMap((x) => (x.mae == null ? [] : [x.mae]))),
      ret: mean(complete.flatMap((x) => (x.ret == null ? [] : [x.ret]))),
      slip: mean(complete.flatMap((x) => (x.entrySlippagePct == null ? [] : [x.entrySlippagePct / 100]))),
      up4: rate(complete, (x) => x.hits?.up4 != null),
      up8: rate(complete, (x) => x.hits?.up8 != null),
      up10: rate(complete, (x) => x.hits?.up10 != null),
      down3: rate(complete, (x) => x.hits?.down3 != null),
      down5: rate(complete, (x) => x.hits?.down5 != null),
      order4: rate(complete, (x) => x.hits?.plus4BeforeMinus3 === true),
      order10: rate(complete, (x) => x.hits?.plus10BeforeMinus5 === true),
    };
  });

  return (
    <div className={`card tg-outcome-card ${mode}`}>
      <div className="tg-outcome-card-title">
        <strong>{MODE_LABEL[mode]}</strong>
        <span className="muted">{events.length} 張成功 TG 卡</span>
      </div>
      <div className="tg-outcome-head">
        <span>窗</span><span>完整</span><span>等待</span><span>不足</span><span>MFE</span><span>MAE</span>
        <span>期末</span><span>扣30bps</span><span>+4</span><span>+8</span><span>+10</span><span>−3</span><span>−5</span>
        <span>+4先−3</span><span>+10先−5</span>{mode === 'next-15m' && <span>滑點</span>}
      </div>
      {rows.map((row) => (
        <div className="tg-outcome-row" key={row.label}>
          <strong>{row.label}</strong>
          <span className="num">{row.complete.length}</span>
          <span className="num muted">{row.pending}</span>
          <span className="num muted">{row.missing}</span>
          <span className="num up">{showPct(row.mfe)}</span>
          <span className="num down">{showPct(row.mae)}</span>
          <span className={`num ${(row.ret ?? 0) >= 0 ? 'up' : 'down'}`}>{showPct(row.ret)}</span>
          <span className={`num ${(row.ret ?? 0) >= 0.003 ? 'up' : 'down'}`}>
            {showPct(row.ret == null ? null : row.ret - 0.003)}
          </span>
          <span className="num">{showPct(row.up4, 0)}</span>
          <span className="num">{showPct(row.up8, 0)}</span>
          <span className="num">{showPct(row.up10, 0)}</span>
          <span className="num">{showPct(row.down3, 0)}</span>
          <span className="num">{showPct(row.down5, 0)}</span>
          <span className="num">{showPct(row.order4, 0)}</span>
          <span className="num">{showPct(row.order10, 0)}</span>
          {mode === 'next-15m' && <span className="num">{showPct(row.slip)}</span>}
        </div>
      ))}
    </div>
  );
}

export default function TgOutcomeSection({ idx, events }: { idx: RecIndex; events: SignalNotifyEvent[] }) {
  const [filter, setFilter] = useState<ClassFilter>('all');
  const selected = useMemo(
    () => (filter === 'all' ? events : events.filter((event) => event.cls === filter)),
    [events, filter],
  );
  return (
    <section className="tg-outcome-section">
      <div className="hist-section-title tg-outcome-title">
        <span>TG 成效</span>
        <span className="tg-outcome-filters">
          {(Object.keys(CLASS_LABEL) as ClassFilter[]).map((key) => (
            <button key={key} type="button" className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
              {CLASS_LABEL[key]}
            </button>
          ))}
        </span>
      </div>
      <p className="muted tg-outcome-note">
        TG 卡價只係卡面掃描參考，唔係成交價。確認比較由下一個完整、連續 15m 時格開始；缺格或未完成視窗只顯示等待／資料不足，唔會補價或當輸贏。
      </p>
      <div className="tg-outcome-grid">
        <OutcomeCard idx={idx} events={selected} mode="tg-card" />
        <OutcomeCard idx={idx} events={selected} mode="next-15m" />
      </div>
    </section>
  );
}
