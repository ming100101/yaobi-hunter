import type { Regime } from '../types';

export const REGIME_META: Record<Regime, { label: string; cls: string }> = {
  accumulate: { label: '蓄力', cls: 'pill-acc' },
  pump: { label: '拉升', cls: 'pill-pump' },
  distribute: { label: '出貨', cls: 'pill-dist' },
};

export function RegimeTag({ regime }: { regime: Regime }) {
  const m = REGIME_META[regime];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}
