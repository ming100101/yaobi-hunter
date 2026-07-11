import fs from 'node:fs';
import path from 'node:path';
import { readKvFile } from './kvFile';
import { recordingsDir } from './recordFile';
import {
  forwardReturns,
  joinToRecordings,
  leadTimeVsProxy,
  parseRecordings,
  simLadder,
} from '../src/lib/refSignals';
import type { RefSignal } from '../src/types';

/* E4 — 對照表: for every logged 老詹 signal, dump OUR features at his message
 * moment, forward returns anchored at the message-ts slot px, his TP/SL ladder
 * simulated on 15-min marks (SL-first, conservative), and lead-time vs our
 * str≥60∧regime≠D proxy. Aggregates his self-reported hit rate vs our measured
 * one on the coins we can see.
 *
 *   npm run ref-eval
 */

const sigs = ((readKvFile()['ref-signals'] as RefSignal[] | undefined) ?? []).sort((a, b) => a.ts - b.ts);
if (!sigs.length) {
  console.log('logbook empty — log signals with: npm run ref-log -- --sym ... (see scripts/ref-log.ts)');
  process.exit(0);
}

const dir = recordingsDir();
const jsonl = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
  : '';
const series = parseRecordings(jsonl);

const hk = (t: number) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false }).replace(',', '');
const n1 = (x: number | null | undefined, suffix = '') => (x == null ? '—' : x.toFixed(1) + suffix);

let measurable = 0;
let tp1Hits = 0;
const leadTimes: number[] = [];

for (const s of sigs) {
  const arr = series.get(s.sym);
  console.log(`\n===== ${s.sym} ${s.kind} 強度${s.refStrength} @${s.px} · ${hk(s.ts)}${s.tsProvisional ? ' (ts PROVISIONAL)' : ''} =====`);
  if (s.notes) console.log(`  notes: ${s.notes}`);
  if (s.refHitRate) console.log(`  老詹自報: ${s.refHitRate.windowDays}天 ${s.refHitRate.wins}/${s.refHitRate.alerts} 勝 · 最佳 +${s.refHitRate.bestPct}%`);
  const j = joinToRecordings(s, arr);
  if (!j) {
    console.log('  無對照數據(幣唔喺 universe 或時段冇 recordings)');
    continue;
  }
  const div = Math.abs(j.anchorDivergencePct);
  console.log(
    `  同刻我方: px ${j.slotPx}${div > 1.5 ? ` ⚠ anchor 偏離 ${n1(j.anchorDivergencePct, '%')}(查 ts!)` : ''} · 強度 ${j.strength} · regime ${j.regime} · volZ ${n1(j.volZ)} · buySh ${j.buyShare4h == null ? '—' : (j.buyShare4h * 100).toFixed(0) + '%'}`,
  );
  console.log(
    `           ret4h ${n1(j.ret4h, '%')} · ch24h ${n1(j.change24h, '%')} · ch1h ${n1(j.change1h, '%')} · pos ${j.pos == null ? '—' : j.pos.toFixed(2)} · bbPctile ${j.bbPctile == null ? '—' : j.bbPctile.toFixed(2)} · oi4h(raw) ${n1(j.oi4hTrue, '%')} · funding ${j.funding}`,
  );
  const fwd = forwardReturns(s, arr);
  if (fwd.length) {
    console.log(
      '  forward:  ' +
        fwd.map((f) => `+${f.h}h ${n1(f.lastPct, '%')} (peak ${n1(f.peakPct, '%')})${f.covered ? '' : '*'}`).join(' · ') +
        '   (*=coverage 未夠鐘)',
    );
  }
  const sim = simLadder(s, arr);
  if (sim) {
    measurable++;
    const tp1 = sim.hits.some((h) => h.startsWith('TP1'));
    if (tp1) tp1Hits++;
    console.log(
      `  階梯模擬: entry ${sim.entry} → ${sim.hits.length ? sim.hits.join(', ') : '無 TP'}${sim.slHit ? ' · ' + sim.slHit : ''} · 期末 ${n1(sim.endPct, '%')} (行咗 ${sim.coveredH.toFixed(0)}h)`,
    );
  }
  const lead = leadTimeVsProxy(s, arr);
  if (lead != null) {
    leadTimes.push(lead);
    console.log(`  lead-time: 我方 proxy(str≥60∧≠D)${lead >= 0 ? `遲 ${lead.toFixed(1)}h` : `早 ${(-lead).toFixed(1)}h`}`);
  } else {
    console.log('  lead-time: 我方 proxy ±24h 內冇 fire');
  }
}

console.log(`\n===== aggregate =====`);
console.log(`logged ${sigs.length} · 可量度(有 recordings + 階梯)${measurable} · TP1 命中 ${tp1Hits}/${measurable}`);
if (leadTimes.length) {
  const med = [...leadTimes].sort((a, b) => a - b)[Math.floor(leadTimes.length / 2)];
  console.log(`lead-time 中位: ${med >= 0 ? `我方遲 ${med.toFixed(1)}h` : `我方早 ${(-med).toFixed(1)}h`} (n=${leadTimes.length})`);
}
const selfReported = sigs.filter((s) => s.refHitRate);
if (selfReported.length) {
  const a = selfReported.reduce((acc, s) => acc + s.refHitRate!.alerts, 0);
  const w = selfReported.reduce((acc, s) => acc + s.refHitRate!.wins, 0);
  console.log(`老詹自報合計: ${w}/${a} (${((w / a) * 100).toFixed(0)}%) — 自報 ≠ 實測,佢嘅「勝」定義未知`);
}
console.log('紀律提醒: 樣本 <15 前唔開 E5;本表只供假說生成,唔准調參 (S7 反 overfit 協議)。');
