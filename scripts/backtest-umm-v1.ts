import fs from 'node:fs';
import path from 'node:path';
import type { Candle, StrategyCandidate, StrategyId, StrategyOutcome, VolumeBar } from '../src/types';
import { boardingB2QuantityOiQualified, evaluateBoardingB2, evaluateEma20ReclaimControl } from '../src/lib/boardingB2';
import {
  EXECUTION_POLICIES,
  evaluateStrategyCandidate,
  summarizeStrategyOutcomes,
  type FundingCharge,
  type Native15mBar,
} from '../src/lib/strategyLab';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, 'scripts', 'backtest-data', '5m');
const FUNDING_CACHE = path.join(ROOT, 'scripts', 'backtest-data', 'funding');
const REPORT = path.join(ROOT, 'docs', 'roadmap', 'reports', 'UMM-V1-HISTORICAL.md');
const monthsArg = process.argv.find((x) => x.startsWith('--months='))?.split('=')[1] ?? '2026-04,2026-05,2026-06';
const months = monthsArg.split(',');
const maxCoins = Number(process.argv.find((x) => x.startsWith('--max-coins='))?.split('=')[1] ?? 150);

interface Bar5 { t: number; o: number; h: number; l: number; c: number; q: number; tq: number | null }
interface Aggregate { candles: Candle[]; volume: VolumeBar[] }
interface QtyPoint { t: number; q: number }

function load5m(sym: string): Bar5[] {
  const out: Bar5[] = [];
  for (const month of months) {
    const file = path.join(CACHE, `${sym}-${month}.csv`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('open_time')) continue;
      const p = line.split(',');
      const t = Number(p[0]);
      const nums = [Number(p[1]), Number(p[2]), Number(p[3]), Number(p[4]), Number(p[7])];
      if (!Number.isFinite(t) || !nums.every(Number.isFinite)) continue;
      const tq = Number(p[10]);
      out.push({ t, o: nums[0], h: nums[1], l: nums[2], c: nums[3], q: nums[4], tq: Number.isFinite(tq) ? tq : null });
    }
  }
  const byTime = new Map(out.map((x) => [x.t, x]));
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function aggregate(rows: Bar5[], minutes: 15 | 60): Aggregate {
  const width = minutes * 60_000;
  const expected = minutes / 5;
  const groups = new Map<number, Bar5[]>();
  for (const row of rows) {
    const t = Math.floor(row.t / width) * width;
    const group = groups.get(t) ?? [];
    group.push(row);
    groups.set(t, group);
  }
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  for (const [t, raw] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const xs = raw.sort((a, b) => a.t - b.t);
    if (xs.length !== expected || xs.some((x, i) => x.t !== t + i * 300_000)) continue;
    const open = xs[0].o;
    const close = xs[xs.length - 1].c;
    const takerKnown = xs.every((x) => x.tq != null);
    candles.push({ time: t / 1000, open, high: Math.max(...xs.map((x) => x.h)), low: Math.min(...xs.map((x) => x.l)), close });
    volume.push({
      time: t / 1000,
      value: xs.reduce((a, x) => a + x.q, 0),
      up: close >= open,
      ...(takerKnown ? { takerBuy: xs.reduce((a, x) => a + (x.tq ?? 0), 0) } : {}),
    });
  }
  return { candles, volume };
}

function loadQty(sym: string): QtyPoint[] {
  const out: QtyPoint[] = [];
  for (const month of months) {
    const file = path.join(CACHE, `${sym}-metrics-${month}.csv`);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('create_time')) continue;
      const p = line.split(',');
      const t = Date.parse(`${p[0].trim().replace(' ', 'T')}Z`);
      const q = Number(p[2]);
      if (Number.isFinite(t) && Number.isFinite(q) && q > 0) out.push({ t, q });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function qtyChanges(points: QtyPoint[], decisionTs: number): { q1: number; q4: number } | null {
  let i = points.length - 1;
  while (i >= 0 && points[i].t > decisionTs) i--;
  if (i < 0 || decisionTs - points[i].t > 10 * 60_000) return null;
  const ref = (hours: number): number | null => {
    const target = points[i].t - hours * 3_600_000;
    let j = i - 1;
    while (j >= 0 && points[j].t > target) j--;
    return j >= 0 && target - points[j].t <= 10 * 60_000 ? points[j].q : null;
  };
  const a = ref(1); const b = ref(4);
  return a && b ? { q1: (points[i].q / a - 1) * 100, q4: (points[i].q / b - 1) * 100 } : null;
}

function native15(a: Aggregate): Native15mBar[] {
  return a.candles.map((c) => ({
    openTs: c.time * 1000, closeTs: c.time * 1000 + 900_000,
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));
}

async function fundingFor(sym: string, from: number, to: number): Promise<FundingCharge[] | null> {
  fs.mkdirSync(FUNDING_CACHE, { recursive: true });
  const file = path.join(FUNDING_CACHE, `${sym}-${months[0]}_${months[months.length - 1]}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const out: FundingCharge[] = [];
    let cursor = from;
    while (cursor <= to) {
      const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(sym + 'USDT')}` +
        `&startTime=${cursor}&endTime=${to}&limit=1000`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const rows: any[] = await res.json();
      if (!rows.length) break;
      for (const x of rows) {
        const ts = Number(x.fundingTime);
        const rate = Number(x.fundingRate);
        if (Number.isFinite(ts) && Number.isFinite(rate)) out.push({ ts, rate });
      }
      const next = Number(rows[rows.length - 1]?.fundingTime) + 1;
      if (!(next > cursor)) break;
      cursor = next;
    }
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  } catch {
    return null;
  }
}

function candidate(strategyId: StrategyId, sym: string, signal: NonNullable<ReturnType<typeof evaluateBoardingB2>>): StrategyCandidate {
  return {
    type: 'strategy-candidate', v: 1, id: `${strategyId}:${sym}:${signal.decisionTs}`,
    strategyId, rulesetId: signal.rulesetId, sym, decisionTs: signal.decisionTs,
    signalPx: signal.signalPx, status: 'shadow', source: 'historical', ema20: signal.ema20,
    ema50: signal.ema50, atr: signal.atr14,
  };
}

function fmtPct(x: number): string { return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`; }

function bootstrapDayLowerBound(rows: StrategyOutcome[], rounds = 2000): number {
  const days = new Map<string, number[]>();
  for (const x of rows) {
    const day = new Date(x.entryTs).toISOString().slice(0, 10);
    const xs = days.get(day) ?? [];
    xs.push(x.netReturn);
    days.set(day, xs);
  }
  const blocks = [...days.values()];
  if (blocks.length < 2) return NaN;
  let seed = 0x51a7e;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const means: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const sample: number[] = [];
    for (let i = 0; i < blocks.length; i++) sample.push(...blocks[Math.floor(rand() * blocks.length)]);
    means.push(sample.reduce((a, b) => a + b, 0) / sample.length);
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(rounds * 0.025)];
}

async function main(): Promise<void> {
  const monthSet = new Set(months);
  const counts = new Map<string, number>();
  for (const name of fs.readdirSync(CACHE)) {
    const m = name.match(/^(.+)-(\d{4}-\d{2})\.csv$/);
    if (!m || m[1].endsWith('-metrics') || !monthSet.has(m[2])) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const symbols = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxCoins).map((x) => x[0]);
  const candidateRows: StrategyCandidate[] = [];
  const paths = new Map<string, Native15mBar[]>();

  for (let s = 0; s < symbols.length; s++) {
    const sym = symbols[s];
    const rows = load5m(sym);
    const qty = loadQty(sym);
    const h1 = aggregate(rows, 60);
    paths.set(sym, native15(aggregate(rows, 15)));
    for (let i = 99; i < h1.candles.length; i++) {
      const candles = h1.candles.slice(Math.max(0, i - 139), i + 1);
      const volume = h1.volume.slice(Math.max(0, i - 139), i + 1);
      const control = evaluateEma20ReclaimControl(candles, volume);
      if (control) candidateRows.push(candidate('ema20-reclaim-control-v1', sym, control));
      const b2 = evaluateBoardingB2(candles, volume);
      if (b2) {
        candidateRows.push(candidate('boarding-b2-v1', sym, b2));
        const q = qtyChanges(qty, b2.decisionTs);
        if (q && boardingB2QuantityOiQualified(q.q1, q.q4)) {
          candidateRows.push({ ...candidate('boarding-b2-oi-v1', sym, b2), oiQty1h: q.q1, oiQty4h: q.q4 });
        }
        const placebo = qtyChanges(qty, b2.decisionTs - 24 * 3_600_000);
        if (placebo && boardingB2QuantityOiQualified(placebo.q1, placebo.q4)) {
          candidateRows.push({ ...candidate('boarding-b2-oi-v1', sym, b2), id: `boarding-b2-oi-v1:placebo:${sym}:${b2.decisionTs}`, reason: 'quantity OI shifted -24h placebo' });
        }
      }
    }
    if ((s + 1) % 25 === 0) console.log(`loaded ${s + 1}/${symbols.length} symbols`);
  }

  const bySym = new Map<string, StrategyCandidate[]>();
  for (const c of candidateRows) {
    const xs = bySym.get(c.sym) ?? [];
    xs.push(c);
    bySym.set(c.sym, xs);
  }
  const outcomes: StrategyOutcome[] = [];
  let missingFunding = 0;
  for (const [sym, cs] of bySym) {
    const funding = await fundingFor(sym, cs[0].decisionTs, cs[cs.length - 1].decisionTs + 48 * 3_600_000);
    if (!funding) missingFunding++;
    for (const c of cs) {
      for (const policy of Object.values(EXECUTION_POLICIES)) {
        const o = evaluateStrategyCandidate(c, paths.get(sym) ?? [], policy, funding ?? []);
        o.coverage.fundingComplete = funding != null;
        if (!funding) o.coverage.reason = `${o.coverage.reason ? `${o.coverage.reason}; ` : ''}funding unavailable`;
        outcomes.push(o);
      }
    }
  }

  const lines = [
    '# Ultimate Money Maker v1 — Historical evaluator report', '',
    `Generated: ${new Date().toISOString()}`, '',
    `Source: Binance Vision futures 5m cache (${months.join(', ')}), ${symbols.length} symbols.`,
    'Execution: next complete native 15m open; conservative stop-first ordering; 30 bps round trip plus actual Binance funding.',
    `Funding unavailable for ${missingFunding} event-bearing symbols; those rows remain visible but cannot pass a gate.`, '',
    '| Strategy | Exit | Complete | Coins | UTC days | Net mean | 60bps stress | Median | +4 before -3 | Max DD | Coverage |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const strategyId of ['boarding-b2-v1', 'boarding-b2-oi-v1', 'ema20-reclaim-control-v1'] as StrategyId[]) {
    for (const policyId of Object.keys(EXECUTION_POLICIES)) {
      const rows = outcomes.filter((x) => x.strategyId === strategyId && x.executionPolicyId === policyId && x.coverage.fundingComplete && !x.candidateId.includes(':placebo:'));
      const s = summarizeStrategyOutcomes(rows);
      lines.push(`| ${strategyId} | ${policyId} | ${s.trades} | ${s.coins} | ${s.utcDays} | ${fmtPct(s.netMean)} | ${fmtPct(s.netMean - 0.003)} | ${fmtPct(s.netMedian)} | ${(s.plus4BeforeMinus3Rate * 100).toFixed(1)}% | ${(s.maxDrawdown * 100).toFixed(1)}% | ${(s.coverage * 100).toFixed(1)}% |`);
    }
  }
  const b2 = outcomes.filter((x) => x.strategyId === 'boarding-b2-v1' && x.executionPolicyId === 'time24-sl3-v1' && x.coverage.complete && x.coverage.fundingComplete);
  const ctl = outcomes.filter((x) => x.strategyId === 'ema20-reclaim-control-v1' && x.executionPolicyId === 'time24-sl3-v1' && x.coverage.complete && x.coverage.fundingComplete);
  const b2Rate = b2.length ? b2.filter((x) => x.ordering.plus4BeforeMinus3).length / b2.length : 0;
  const ctlRate = ctl.length ? ctl.filter((x) => x.ordering.plus4BeforeMinus3).length / ctl.length : 0;
  lines.push('', `Matched directional lift (B2 / ordinary EMA20 reclaim, +4 before -3): ${ctlRate > 0 ? (b2Rate / ctlRate).toFixed(2) : 'n/a'}.`, '');
  lines.push('| B2 24h month | Trades | Net mean | +4 before -3 |', '|---|---:|---:|---:|');
  let positiveMonths = 0;
  for (const month of months) {
    const rows = b2.filter((x) => new Date(x.entryTs).toISOString().startsWith(month));
    const s = summarizeStrategyOutcomes(rows);
    if (s.netMean > 0) positiveMonths++;
    lines.push(`| ${month} | ${s.trades} | ${fmtPct(s.netMean)} | ${(s.plus4BeforeMinus3Rate * 100).toFixed(1)}% |`);
  }
  const b2Summary = summarizeStrategyOutcomes(b2);
  lines.push('', `Walk-forward positive monthly folds: ${positiveMonths}/${months.length}.`);
  lines.push(`Day-block bootstrap 95% lower bound for mean B2 return: ${fmtPct(bootstrapDayLowerBound(b2))}.`);
  lines.push(`PnL concentration: top coin ${(b2Summary.topCoinProfitShare * 100).toFixed(1)}%, top UTC day ${(b2Summary.topDayProfitShare * 100).toFixed(1)}%.`, '');
  const oiReal = outcomes.filter((x) => x.strategyId === 'boarding-b2-oi-v1' && x.executionPolicyId === 'time24-sl3-v1' && !x.candidateId.includes(':placebo:'));
  const oiPlacebo = outcomes.filter((x) => x.executionPolicyId === 'time24-sl3-v1' && x.candidateId.includes(':placebo:'));
  const or = summarizeStrategyOutcomes(oiReal); const op = summarizeStrategyOutcomes(oiPlacebo);
  lines.push(`Quantity-OI challenger: ${or.trades} trades, net mean ${fmtPct(or.netMean)}, +4-before-3 ${(or.plus4BeforeMinus3Rate * 100).toFixed(1)}%.`);
  lines.push(`24h-shifted OI placebo: ${op.trades} trades, net mean ${fmtPct(op.netMean)}, +4-before-3 ${(op.plus4BeforeMinus3Rate * 100).toFixed(1)}%.`, '');
  lines.push('This is a fixed-rule research replay, not a promotion decision. The initial OI ablation is sample-starved; full-month OI coverage, parameter sensitivity and promotion gates remain outstanding.');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(`wrote ${REPORT}`);
  console.log(lines.slice(-3).join('\n'));
}

void main();
