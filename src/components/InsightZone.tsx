import type { Insight } from '../lib/interpret';
import { signalColor } from '../lib/signalColors';
import { fmtClockChart } from '../lib/format';

export default function InsightZone({ insights }: { insights: Insight[] }) {
  return (
    <section className="card iz">
      <div className="iz-head">
        <span className="iz-title">型態解讀 · Signal Read</span>
        <span className="iz-count">{insights.length > 0 ? `${insights.length} 項訊號` : ''}</span>
      </div>
      {insights.length === 0 ? (
        <div className="iz-empty">目前未偵測到顯著型態變化</div>
      ) : (
        <ul className="iz-list">
          {insights.map((ins, i) => (
            <li key={ins.id} className={`iz-item tone-${ins.tone}`}>
              {/* colour code — same colour as this read's circle marker on the K-line */}
              <span className="iz-dot" style={{ background: signalColor(i) }} title="對應 K 線標記顏色" />
              <span className="iz-tag">{ins.title}</span>
              {ins.atTime ? <span className="iz-time num">{fmtClockChart(ins.atTime)}</span> : null}
              <span className="iz-text">
                {ins.detail}
                {ins.next && <span className="iz-next">↳ 之後睇：{ins.next}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
