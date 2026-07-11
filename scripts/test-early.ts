// S14 fidelity: the LIVE detectEarlyPump (analyze.ts) must reproduce the harness
// signalEarlyAt (backtest5m.ts) bar-for-bar. Runs the live detector over a cached
// Vision 5m coin with the harness's warmup+cooldown and prints the fire count;
// compare to `backtest5m --exp early --symbols <SYM>` per-coin count. Run:
//   npm run test-early -- AVAX
import fs from 'node:fs';
import path from 'node:path';
import { detectEarlyPump } from '../src/lib/analyze';
import type { Candle, VolumeBar } from '../src/types';

const sym = process.argv[2] || 'AVAX';
const months = ['2026-05', '2026-06'];
const dir = path.resolve('scripts/backtest-data/5m');
const candles: Candle[] = [];
const volume: VolumeBar[] = [];
for (const mo of months) {
  const f = path.join(dir, `${sym}-${mo}.csv`);
  if (!fs.existsSync(f)) {
    console.error('missing cache', f);
    process.exit(1);
  }
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line || line.startsWith('open_time')) continue;
    const p = line.split(',');
    if (p.length < 8) continue;
    const t = Number(p[0]);
    if (!Number.isFinite(t)) continue;
    const time = Math.floor(t / 1000);
    candles.push({ time, open: +p[1], high: +p[2], low: +p[3], close: +p[4] });
    volume.push({ time, value: +p[7], up: +p[4] >= +p[1] });
  }
}

// mirror the harness main loop: warmup 601, cooldown 288, horizon 288. Slice a
// fixed 289-bar window per bar — detectEarlyPump only looks at the last 289, so
// this is identical to feeding candles[0..i] but O(window) not O(i).
const horizon = 288;
const cooldown = 288;
const warmup = Math.max(24 + 2, 601, 289);
const lastEval = candles.length - horizon - 1;
let count = 0;
let cooldownUntil = -1;
for (let i = warmup; i <= lastEval; i++) {
  if (i < cooldownUntil) continue;
  const win = candles.slice(i - 288, i + 1);
  const wv = volume.slice(i - 288, i + 1);
  if (detectEarlyPump(win, wv)) {
    count++;
    cooldownUntil = i + cooldown;
  }
}
console.log(`${sym}: ${candles.length} bars · live detectEarlyPump fires ${count}`);
console.log(`(compare to: node scripts/.build/backtest5m.mjs --exp early --symbols ${sym} 2>&1 | grep '${sym}:')`);
