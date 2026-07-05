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
// Parse + index + rising-edge logic live in the shared browser-safe core
// (src/lib/evalCore.ts); this CLI adds the fs I/O, the forward/summarize
// walkers, and the human table.
import fs from 'node:fs';
import path from 'node:path';
import { recordingsDir } from './recordFile';
import type { RecCoin } from '../src/lib/recording';
import { F, parseRecordings, risingEdges, SLOT_MS } from '../src/lib/evalCore';

const H4 = 16; // 4h in 15-min slots
const H24 = 96; // 24h in slots
type Row = RecCoin;

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
const { slots, bySlot, priceAt, top10At } = idx;
if (slots.length < 2) {
  console.error(`only ${slots.length} unique slot(s) across ${lines} line(s) — need more data to evaluate.`);
  process.exit(slots.length ? 0 : 1);
}

// forward MFE / fixed-horizon return from the recorded price path
function forward(sym: string, slot: number, hSlots: number): { mfe: number; ret: number } | null {
  const pm = priceAt.get(sym)!;
  const entry = pm.get(slot);
  if (!entry || entry <= 0) return null;
  let hi = -Infinity;
  let lastP = NaN;
  let lastSlot = -1;
  for (const s of slots) {
    if (s <= slot) continue;
    if (s > slot + hSlots) break;
    const p = pm.get(s);
    if (p == null || p <= 0) continue;
    hi = Math.max(hi, p);
    if (s > lastSlot) {
      lastSlot = s;
      lastP = p;
    }
  }
  if (lastSlot < 0) return null; // no forward data
  return { mfe: hi / entry - 1, ret: lastP / entry - 1 };
}

interface Sample {
  mfe: number;
  ret: number;
}
function summarize(xs: Sample[]) {
  const n = xs.length;
  if (!n) return { n: 0, hit: 0, meanMfe: 0, medMfe: 0, meanRet: 0 };
  const mfes = xs.map((x) => x.mfe).sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    n,
    hit: xs.filter((x) => x.mfe >= target / 100).length / n,
    meanMfe: mean(xs.map((x) => x.mfe)),
    medMfe: mfes[Math.floor(n / 2)],
    meanRet: mean(xs.map((x) => x.ret)),
  };
}

// state predicates on a row / slot (rising-edge sampling done by evalCore)
const STATES: Array<{ key: string; on: (row: Row, slot: number, sym: string) => boolean }> = [
  { key: '⚡ flushBreakout', on: (r) => r[F.FB] === 1 },
  { key: '蓄 earlyAccum', on: (r) => r[F.EA] === 1 },
  { key: 'strength≥70', on: (r) => (r[F.STR] as number) >= 70 },
  { key: 'top10', on: (_r, slot, sym) => top10At.get(slot)!.has(sym) },
  { key: 'organic-spot-lift', on: (r) => {
      const basis = r[F.BASIS] as number | null;
      const spotVol = r[F.SPOTVOL] as number | null;
      if (basis == null || spotVol == null) return false;
      return (r[F.RET4H] as number) >= 2 && basis <= 0 &&
             spotVol >= (r[F.VOL24H] as number) && (r[F.BUYSHARE] as number) > 0.55;
    } },
  { key: 'leverage-only-froth', on: (r) => {
      const basis = r[F.BASIS] as number | null;
      const spotVol = r[F.SPOTVOL] as number | null;
      if (basis == null || spotVol == null) return false;
      return (r[F.FUND] as number) >= 0.01 && basis >= 0.1 &&
             spotVol < 0.5 * (r[F.VOL24H] as number);
    } },
];

// baseline: every (sym, slot) observation with a valid forward window
const baseline: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
for (const slot of slots) {
  for (const c of bySlot.get(slot)!.coins as Row[]) {
    const sym = c[F.SYM] as string;
    for (const h of [H4, H24]) {
      const f = forward(sym, slot, h);
      if (f) baseline[h].push(f);
    }
  }
}

// signal samples on the rising edge (shared core), forward returns per event
const results: any = { dir, uniqueSlots: slots.length, spanHours: ((slots[slots.length - 1] - slots[0]) * SLOT_MS) / 3600000, target, states: {} };
for (const st of STATES) {
  const edges = risingEdges(idx, st.on);
  const samples: Record<number, Sample[]> = { [H4]: [], [H24]: [] };
  for (const e of edges) {
    for (const h of [H4, H24]) {
      const f = forward(e.sym, e.slot, h);
      if (f) samples[h].push(f);
    }
  }
  results.states[st.key] = {
    events: edges.length,
    h4: summarize(samples[H4]),
    h24: summarize(samples[H24]),
  };
}
results.baseline = { h4: summarize(baseline[H4]), h24: summarize(baseline[H24]) };

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
