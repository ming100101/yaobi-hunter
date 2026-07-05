// Event-library lift analysis over recorded sweeps. Unlike backtest.ts (which
// reconstructs signals from a single ~30d OKX history window), this measures
// signals AS THEY ACTUALLY FIRED live, across however many months of recordings
// exist — no single-regime confinement, no reconstruction bias.
//
//   npm run eval-rec                 # default recordings dir, human table
//   npm run eval-rec -- --json       # machine-readable
//   npm run eval-rec -- --dir PATH --target 15
//
// Signals are sampled on their RISING EDGE (off->on) so a state that persists
// for many slots counts as one event, not N correlated samples. Forward returns
// use the recorded 15-min price path for the same symbol. Small samples until
// months accumulate — this verifies the mechanism; statistics come later.
//
// Parse + index + rising-edge + forward/summarize/lift logic all live in the
// shared browser-safe core (src/lib/evalCore.ts); this CLI just adds the fs I/O
// and the human table, so it and the 記錄 tab report identical numbers.
import fs from 'node:fs';
import path from 'node:path';
import { recordingsDir } from './recordFile';
import { parseRecordings, runEval } from '../src/lib/evalCore';

// ---- args ----
let dir = recordingsDir();
let target = 10; // % MFE for hit-rate
let json = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') dir = argv[++i];
  else if (argv[i] === '--target') target = Number(argv[++i]);
  else if (argv[i] === '--json') json = true;
}

// ---- load (fs) → shared parse/index core ----
if (!fs.existsSync(dir)) {
  console.error(`no recordings dir: ${dir}\n(run \`npm run recorder\` first, or pass --dir)`);
  process.exit(1);
}
let text = '';
let lines = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  text += content + '\n';
  for (const line of content.split('\n')) if (line.trim()) lines++;
}
const idx = parseRecordings(text);
const { slots } = idx;
if (slots.length < 2) {
  console.error(`only ${slots.length} unique slot(s) across ${lines} line(s) — need more data to evaluate.`);
  process.exit(slots.length ? 0 : 1);
}

// all eval math (forward walk, summarise, states, baseline) lives in evalCore now
const results: any = { dir, ...runEval(idx, target) };

// ---- output ----
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n=== recorded-signal lift (${dir}) ===`);
  console.log(`${slots.length} unique slots, ~${(results.spanHours / 24).toFixed(1)}d span, MFE target +${target}%`);
  const b4 = results.baseline.h4;
  const b24 = results.baseline.h24;
  console.log(`\nbaseline (all obs):  4h hit ${pc(b4.hit)} meanMFE ${pc(b4.meanMfe)} | 24h hit ${pc(b24.hit)} meanMFE ${pc(b24.meanMfe)}`);
  console.log('');
  console.log('state              events | 4h: hit  lift  meanMFE | 24h: hit  lift  meanMFE');
  for (const [key, r] of Object.entries<any>(results.states)) {
    const l4 = b4.hit > 0 ? r.h4.hit / b4.hit : 0;
    const l24 = b24.hit > 0 ? r.h24.hit / b24.hit : 0;
    console.log(
      `${key.padEnd(18)} ${String(r.events).padStart(6)} | ` +
        `${pc(r.h4.hit).padStart(6)} ${('×' + l4.toFixed(2)).padStart(6)} ${pc(r.h4.meanMfe).padStart(8)} | ` +
        `${pc(r.h24.hit).padStart(6)} ${('×' + l24.toFixed(2)).padStart(6)} ${pc(r.h24.meanMfe).padStart(8)}`,
    );
  }
  console.log('\n(small samples until months accumulate — mechanism check, not statistics)');
}
