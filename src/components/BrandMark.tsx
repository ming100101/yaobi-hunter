export default function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6bf7" />
          <stop offset="1" stopColor="#5b3fd6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#bm-grad)" />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="1.6"
        strokeDasharray="3 2.4"
      />
      <path
        d="M16 9.5v4M16 18.5v4M9.5 16h4M18.5 16h4"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.2" fill="#ffd166" />
    </svg>
  );
}
