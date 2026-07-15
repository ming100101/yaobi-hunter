// Forward-recording audit for paper entry execution. This compares only two
// frozen policies over the exact same rising edges:
//   signal    = optimistic legacy fill at the already-completed signal close
//   confirmed = deployable fill at the immediately-next completed 15m close
// It is a mechanism/slippage audit, not a parameter search or promotion gate.
import fs from 'node:fs';
import path from 'node:path';
import { recordingsDir } from './recordFile';
import { parseRecordings, SLOT_MS } from '../src/lib/evalCore';
import {
  buildDailyReport,
  sideStats,
  type StratEntryMode,
  type StratMode,
  type StratTrade,
} from '../src/lib/strategyReport';

const dir = recordingsDir();
if (!fs.existsSync(dir)) throw new Error(`recordings directory missing: ${dir}`);
let text = '';
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
  text += fs.readFileSync(path.join(dir, file), 'utf8') + '\n';
}
const idx = parseRecordings(text);
if (idx.slots.length < 3) throw new Error('need at least three recorded slots');
const nowMs = (idx.slots[idx.slots.length - 1] + 1) * SLOT_MS;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};
const pc = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;

console.log(`\n=== paper-entry execution audit ===`);
console.log(`${idx.slots.length} unique slots · ${(idx.slots.length * 0.25 / 24).toFixed(1)} slot-days (gaps possible)`);
console.log('policy      exit     lane      n   win   meanROI   med slip   mean slip');

for (const entryMode of ['signal', 'confirmed'] as StratEntryMode[]) {
  for (const mode of ['ladder', 'allout'] as StratMode[]) {
    const days = buildDailyReport(idx, 30, nowMs, mode, entryMode);
    const lanes: Array<[string, StratTrade[]]> = [
      ['⚡ long', days.flatMap((d) => d.fb.long)],
      ['⚡ short', days.flatMap((d) => d.fb.short)],
      ['>70 long', days.flatMap((d) => d.s70.long)],
      ['>70 short', days.flatMap((d) => d.s70.short)],
    ];
    for (const [label, trades] of lanes) {
      const stats = sideStats(trades);
      const slips = trades.map((t) => t.entrySlippagePct);
      const meanSlip = slips.length ? slips.reduce((a, b) => a + b, 0) / slips.length : 0;
      console.log(
        `${entryMode.padEnd(11)} ${mode.padEnd(8)} ${label.padEnd(9)} ${String(stats.n).padStart(3)} ` +
          `${String(Math.round(stats.winRate * 100)).padStart(3)}% ` +
          `${pc(stats.mean * 100).padStart(9)} ${pc(median(slips)).padStart(10)} ${pc(meanSlip).padStart(11)}`,
      );
    }
  }
}

console.log('\nconfirmed is the current paper policy for execution fidelity; performance remains forward research.');
