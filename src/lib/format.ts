// sign and direction come from the ROUNDED value so a cell never reads
// "-0.00%" or colors a visually-zero number directional
export function fmtPct(x: number, digits = 2, sign = true): string {
  const r = Number(x.toFixed(digits)) + 0; // +0 normalizes -0
  const s = sign && r > 0 ? '+' : '';
  return `${s}${r.toFixed(digits)}%`;
}

export function pctSign(x: number, digits = 2): number {
  return Math.sign(Number(x.toFixed(digits)) + 0);
}

export function strengthCls(s: number): string {
  if (s >= 70) return 's-hi';
  if (s >= 50) return 's-mid';
  return 's-lo';
}

export function fmtMoney(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
}

export function fmtCompact(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toFixed(0);
}

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '';
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(1);
  if (abs >= 10) return p.toFixed(2);
  if (abs >= 0.1) return p.toFixed(4);
  if (abs >= 0.001) return p.toFixed(5);
  if (abs === 0) return '0';
  return p.toPrecision(4);
}

export function priceMinMove(p: number): number {
  if (p >= 1000) return 0.1;
  if (p >= 10) return 0.01;
  if (p >= 0.1) return 0.0001;
  if (p >= 0.001) return 0.00001;
  return Math.pow(10, Math.floor(Math.log10(Math.max(p, 1e-12))) - 3);
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// elapsed time since `since`, compact zh units: 47分 / 3時20分 / 2日5時
export function fmtAge(since: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - since) / 60_000));
  if (mins < 60) return `${mins}分`;
  const h = Math.floor(mins / 60);
  if (h < 24) {
    const m = mins % 60;
    return m > 0 ? `${h}時${m}分` : `${h}時`;
  }
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh > 0 ? `${d}日${hh}時` : `${d}日`;
}
