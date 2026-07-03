// Charts read theme tokens at create time. If the stylesheet has not applied
// yet (dev CSS injection, slow CDN), getComputedStyle returns '' and the
// series would keep broken colors until remount, so fall back to the same
// values theme.css defines.
const FALLBACK: Record<string, string> = {
  '--text-3': '#9c8fca',
  '--grid': 'rgba(167, 139, 250, 0.08)',
  '--accent': '#a78bfa',
  '--accent-deep': '#8f6cff',
  '--accent-fill': 'rgba(167, 139, 250, 0.24)',
  '--accent-fill-0': 'rgba(167, 139, 250, 0)',
  '--up': '#2bd9a0',
  '--up-fill': 'rgba(43, 217, 160, 0.2)',
  '--down': '#ff5f87',
  '--down-fill': 'rgba(255, 95, 135, 0.18)',
  '--warn': '#f2b04e',
  '--ema20': '#ffb454',
  '--ema50': '#56b4ff',
  '--bb': '#6f5f9e',
  '--vol-up': 'rgba(43, 217, 160, 0.5)',
  '--vol-down': 'rgba(255, 95, 135, 0.45)',
};

export function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || FALLBACK[name] || '';
}
