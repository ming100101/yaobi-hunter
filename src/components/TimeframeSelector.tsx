import { TIMEFRAMES, type Timeframe } from '../types';

export default function TimeframeSelector({
  tf,
  onTf,
}: {
  tf: Timeframe;
  onTf: (t: Timeframe) => void;
}) {
  return (
    <div className="tf-seg" role="tablist" aria-label="K 線週期">
      {TIMEFRAMES.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === tf}
          className={`tf-btn${t.key === tf ? ' active' : ''}`}
          onClick={() => onTf(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
