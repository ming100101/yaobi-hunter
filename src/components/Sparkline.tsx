import { memo } from 'react';

// tiny 24h trend thumbnail for a screener row; pure SVG, colors via CSS vars
function Sparkline({ pts, up }: { pts?: number[]; up: boolean }) {
  if (!pts || pts.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min; // 0 → flat series; norm() then centers on the mid-line
  const W = 64,
    H = 20,
    PAD = 1.5;
  const norm = (v: number) => (range ? (v - min) / range : 0.5); // 0 = low, 1 = high, flat = mid
  const points = pts
    .map(
      (v, i) =>
        `${((i / (pts.length - 1)) * W).toFixed(1)},${(PAD + (1 - norm(v)) * (H - PAD * 2)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={up ? 'var(--up)' : 'var(--down)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default memo(Sparkline);
