import type { Insight } from '../lib/interpret';

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
          {insights.map((ins) => (
            <li key={ins.id} className={`iz-item tone-${ins.tone}`}>
              <span className="iz-tag">{ins.title}</span>
              <span className="iz-text">{ins.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
