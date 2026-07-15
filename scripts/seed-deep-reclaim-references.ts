import { readKvFile, writeKvKey } from './kvFile';
import type { RefSignal } from '../src/types';

export type ProvisionalRefSignal = RefSignal & {
  anchorMethod: 'chart-entry-cross-estimate';
  uncertaintyMs: number;
  gateEligible: false;
};

const atHkt = (iso: string): number => Date.parse(`${iso}:00+08:00`);
const note = '圖中進場線穿越時間估算，並非 Telegram 實際發佈時間；只作假設，排除於升班 gate。';

export const DEEP_RECLAIM_REFERENCE_SEEDS: ProvisionalRefSignal[] = [
  ['GUA', '2026-07-12T13:45', '蓄力加倉', 81, 0.05266],
  ['TLM', '2026-07-12T13:30', '蓄力加倉', 81, 0.001887],
  ['MMT', '2026-07-12T13:15', '接人上車', 78, 0.1854],
  ['EDGE', '2026-07-12T12:00', '蓄力加倉', 81, 0.3822],
  ['GWEI', '2026-07-12T07:45', '蓄力加倉', 81, 0.0652],
  ['RESOLV', '2026-07-12T02:15', '蓄力加倉', 74, 0.01982],
].map(([sym, ts, kind, strength, px]) => ({
  ts: atHkt(String(ts)),
  tsProvisional: true,
  src: 'laozhan',
  sym: String(sym),
  side: 'LONG',
  kind: String(kind),
  refStrength: Number(strength),
  px: Number(px),
  notes: note,
  anchorMethod: 'chart-entry-cross-estimate',
  uncertaintyMs: 15 * 60_000,
  gateEligible: false,
}));

export function mergeDeepReclaimReferenceSeeds(existing: RefSignal[]): RefSignal[] {
  const out = existing.slice();
  for (const seed of DEEP_RECLAIM_REFERENCE_SEEDS) {
    const same = out.some((x) => x.src === seed.src && x.sym === seed.sym && x.ts === seed.ts);
    if (!same) out.push(seed);
  }
  return out.sort((a, b) => a.ts - b.ts || a.sym.localeCompare(b.sym));
}
if (process.argv[1]?.includes('seed-deep-reclaim-references')) {
  const existing = ((readKvFile()['ref-signals'] as RefSignal[] | undefined) ?? []).slice();
  const merged = mergeDeepReclaimReferenceSeeds(existing);
  if (!process.argv.includes('--dry-run')) writeKvKey('ref-signals', merged);
  console.log(`deep-reclaim references: ${existing.length} -> ${merged.length}${process.argv.includes('--dry-run') ? ' (dry-run)' : ''}`);
}
