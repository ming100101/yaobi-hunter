import fs from 'node:fs';
import path from 'node:path';
import type { StrategyCandidate, StrategyId, StrategyOutcome } from '../src/types';
import { EXECUTION_POLICIES, evaluateStrategyCandidate, summarizeStrategyOutcomes, type FundingCharge, type Native15mBar } from '../src/lib/strategyLab';

const root = process.cwd();
const futuresDir = path.join(root, 'scripts', 'backtest-data', '5m');
const spotDir = path.join(root, 'scripts', 'backtest-data', 'spot5m');
const fundingDir = path.join(root, 'scripts', 'backtest-data', 'funding');
const reportFile = path.join(root, 'docs', 'roadmap', 'reports', 'UMM-SPOT-LED-V1.md');
const months = (process.argv.find((x) => x.startsWith('--months='))?.split('=')[1] ?? '2026-04,2026-05,2026-06').split(',');

interface Bar { t: number; o: number; h: number; l: number; c: number; q: number; tq: number }
interface Mapping { symbol: string; mult: number }
interface OiPoint { t: number; v: number }

function load(base: string, dir: string): Bar[] {
  const rows: Bar[] = [];
  for (const month of months) {
    const file = path.join(dir, `${base}-${month}.csv`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('open_time')) continue;
      const p = line.split(',');
      const nums = [0, 1, 2, 3, 4, 7, 10].map((i) => Number(p[i]));
      if (!nums.every(Number.isFinite)) continue;
      // Binance Vision spot files switched to microsecond epochs while the UM
      // futures archive remains milliseconds. Normalize before any join.
      const t = nums[0] > 100_000_000_000_000 ? Math.floor(nums[0] / 1000) : nums[0];
      rows.push({ t, o: nums[1], h: nums[2], l: nums[3], c: nums[4], q: nums[5], tq: nums[6] });
    }
  }
  return [...new Map(rows.map((x) => [x.t, x])).values()].sort((a, b) => a.t - b.t);
}

function aggregate15(rows: Bar[], priceMult = 1): Bar[] {
  const groups = new Map<number, Bar[]>();
  for (const x of rows) {
    const t = Math.floor(x.t / 900_000) * 900_000;
    const xs = groups.get(t) ?? [];
    xs.push(x); groups.set(t, xs);
  }
  const out: Bar[] = [];
  for (const [t, raw] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const xs = raw.sort((a, b) => a.t - b.t);
    if (xs.length !== 3 || xs.some((x, i) => x.t !== t + i * 300_000)) continue;
    out.push({ t, o: xs[0].o * priceMult, h: Math.max(...xs.map((x) => x.h)) * priceMult,
      l: Math.min(...xs.map((x) => x.l)) * priceMult, c: xs[2].c * priceMult,
      q: xs.reduce((a, x) => a + x.q, 0), tq: xs.reduce((a, x) => a + x.tq, 0) });
  }
  return out;
}

const native = (rows: Bar[]): Native15mBar[] => rows.map((x) => ({ openTs: x.t, closeTs: x.t + 900_000, open: x.o, high: x.h, low: x.l, close: x.c }));
const meanSd = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return [mean, Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)] as const;
};

function loadOiUsd(sym: string): OiPoint[] {
  const out: OiPoint[] = [];
  for (const month of months) {
    const file = path.join(futuresDir, `${sym}-metrics-${month}.csv`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('create_time')) continue;
      const p = line.split(',');
      const t = Date.parse(`${p[0].trim().replace(' ', 'T')}Z`);
      const v = Number(p[3]);
      if (Number.isFinite(t) && Number.isFinite(v) && v > 0) out.push({ t, v });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function oiChange4h(points: OiPoint[], decisionTs: number): number | null {
  let i = points.length - 1;
  while (i >= 0 && points[i].t > decisionTs) i--;
  if (i < 0 || decisionTs - points[i].t > 10 * 60_000) return null;
  const target = points[i].t - 4 * 3_600_000;
  let j = i - 1;
  while (j >= 0 && points[j].t > target) j--;
  if (j < 0 || target - points[j].t > 10 * 60_000) return null;
  return (points[i].v / points[j].v - 1) * 100;
}

function makeCandidate(strategyId: StrategyId, sym: string, bar: Bar, details: Partial<StrategyCandidate>): StrategyCandidate {
  return { type: 'strategy-candidate', v: 1, id: `${strategyId}:${sym}:${bar.t + 900_000}`, strategyId,
    rulesetId: `${strategyId}@2026-07-15`, sym, decisionTs: bar.t + 900_000, signalPx: bar.c,
    status: 'shadow', source: 'historical', ...details };
}

function detect(sym: string, futures: Bar[], spot: Bar[], oiUsd: OiPoint[]): StrategyCandidate[] {
  const spotAt = new Map(spot.map((x) => [x.t, x]));
  const out: StrategyCandidate[] = [];
  const lastBy = new Map<StrategyId, number>();
  for (let i = 96; i < futures.length; i++) {
    const f = futures[i];
    const s = spotAt.get(f.t);
    const ref = futures[i - 16];
    if (!s || !ref || f.t - ref.t !== 16 * 900_000) continue;
    const spotWin = futures.slice(i - 95, i + 1).map((x) => spotAt.get(x.t));
    if (spotWin.some((x) => !x)) continue;
    const sw = spotWin as Bar[];
    const ret4 = (f.c / ref.c - 1) * 100;
    if (ret4 < 2) continue;
    const basisPct = (f.c / s.c - 1) * 100;
    const spotVol24 = sw.reduce((a, x) => a + x.q, 0);
    const perpVol24 = futures.slice(i - 95, i + 1).reduce((a, x) => a + x.q, 0);
    const buy4 = sw.slice(-16).reduce((a, x) => a + x.tq, 0) / sw.slice(-16).reduce((a, x) => a + x.q, 0);
    const prior = sw.slice(0, 95).map((x) => x.q);
    const [m, sd] = meanSd(prior);
    const spotVolZ = sd > 0 ? (s.q - m) / sd : 0;
    const oi4h = oiChange4h(oiUsd, f.t + 900_000);
    const conditions: Array<[StrategyId, boolean]> = [
      ['organic-spot-v0', oi4h != null && Math.abs(oi4h) < 1.5 && spotVolZ >= 2 && basisPct <= 0.05],
      ['spot-led-v1', buy4 > 0.55 && basisPct <= 0 && spotVol24 >= perpVol24],
    ];
    for (const [strategyId, pass] of conditions) {
      if (!pass || f.t - (lastBy.get(strategyId) ?? -Infinity) < 86_400_000) continue;
      out.push(makeCandidate(strategyId, sym, f, { takerBuyShare4h: buy4, spotVol24h: spotVol24, perpVol24h: perpVol24, basisPct }));
      lastBy.set(strategyId, f.t);
    }
    // Momentum is a control encoded with the ordinary EMA control id only in
    // this standalone report; it never enters runtime Strategy Lab state.
    const controlId = 'ema20-reclaim-control-v1' as const;
    if (f.t - (lastBy.get(controlId) ?? -Infinity) >= 86_400_000) {
      out.push(makeCandidate(controlId, sym, f, { reason: 'ret4h>=2 momentum control' }));
      lastBy.set(controlId, f.t);
    }
  }
  return out;
}

function funding(sym: string): FundingCharge[] {
  const file = path.join(fundingDir, `${sym}-${months[0]}_${months[months.length - 1]}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
const p = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;

function main(): void {
  const mapping: Record<string, Mapping> = JSON.parse(fs.readFileSync(path.join(spotDir, 'symbol-map.json'), 'utf8'));
  const all: StrategyOutcome[] = [];
  for (const [sym, map] of Object.entries(mapping)) {
    const fut = aggregate15(load(sym, futuresDir));
    const spot = aggregate15(load(sym, spotDir), map.mult);
    if (!fut.length || !spot.length) continue;
    const bars = native(fut);
    const charges = funding(sym);
    for (const c of detect(sym, fut, spot, loadOiUsd(sym))) {
      for (const policy of Object.values(EXECUTION_POLICIES)) all.push(evaluateStrategyCandidate(c, bars, policy, charges));
    }
  }
  const labels: Array<[StrategyId, string]> = [
    ['ema20-reclaim-control-v1', 'ret4h>=2 momentum control'],
    ['organic-spot-v0', 'organic spot-volume proxy'],
    ['spot-led-v1', 'true spot-led v1'],
  ];
  const lines = ['# UMM Spot-led v1 historical replay', '', `Generated: ${new Date().toISOString()}`, '',
    `Source: ${Object.keys(mapping).length} spot/perp matched symbols, ${months.join(', ')}. Prices multiplier-aligned. Organic proxy requires fresh USD OI metrics and therefore uses only covered months.`,
    'Execution: common next-native-15m evaluator, 30bps plus actual funding. Fixed 24h per-strategy cooldown.', '',
    '| Cohort | Exit | Trades | Coins | Days | Net mean | 60bps | +4 before -3 | Max DD |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [id, label] of labels) for (const policyId of Object.keys(EXECUTION_POLICIES)) {
    const rows = all.filter((x) => x.strategyId === id && x.executionPolicyId === policyId);
    const s = summarizeStrategyOutcomes(rows);
    lines.push(`| ${label} | ${policyId} | ${s.trades} | ${s.coins} | ${s.utcDays} | ${p(s.netMean)} | ${p(s.netMean - .003)} | ${(s.plus4BeforeMinus3Rate * 100).toFixed(1)}% | ${(s.maxDrawdown * 100).toFixed(1)}% |`);
  }
  fs.writeFileSync(reportFile, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  console.log(`wrote ${reportFile}`);
}

main();
