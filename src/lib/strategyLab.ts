import type {
  DataCoverage,
  ExecutionPolicy,
  ExecutionPolicyId,
  PortfolioPolicy,
  PromotionDecision,
  StrategyCandidate,
  StrategyId,
  StrategyOutcome,
  ThresholdOrdering,
} from '../types';

export const NATIVE_15M_MS = 15 * 60_000;
export const HOUR_MS = 60 * 60_000;

export const EXECUTION_POLICIES: Record<ExecutionPolicyId, ExecutionPolicy> = {
  'time24-sl3-v1': {
    id: 'time24-sl3-v1',
    roundTripCostBps: 30,
    hardStopPct: 3,
    maxHoldH: 24,
  },
  'ladder-4-8-15-sl3-v1': {
    id: 'ladder-4-8-15-sl3-v1',
    roundTripCostBps: 30,
    hardStopPct: 3,
    maxHoldH: 48,
  },
};

export const BALANCED_PORTFOLIO_POLICY: PortfolioPolicy = {
  id: 'balanced-v1',
  leverage: 1,
  riskPerTradePct: 0.5,
  maxPositionNotionalPct: 20,
  maxOpenPositions: 4,
  maxOpenRiskPct: 2,
  dailyLossBlockPct: 1.5,
  drawdownLockPct: 10,
};

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  'boarding-b2-v1': 'B2 EMA 收復',
  'boarding-b2-oi-v1': 'B2 + 合約 OI',
  'ema20-reclaim-control-v1': '普通 EMA20 收復',
  'organic-spot-v0': '現貨帶動 v0',
  'spot-led-v1': '真買盤現貨帶動',
  'virgin-v2': '🚀 處女擴倉',
  'rebuild-r1': '📈 重建增倉',
  'flush-breakout': '⚡ 縮倉突破',
  'deep-reclaim-v0': '深跌收復',
  'top-t1-reversal-v2': 'T1 反轉確認 v2（空）',
  'wbottom-w2-uncrowded-v2': 'W2 低擁擠趨勢 v2',
};

export interface Native15mBar {
  openTs: number;
  closeTs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FundingCharge {
  ts: number;
  // Decimal cost for a long position. Positive means paid, negative is credit.
  rate: number;
}

const finitePrice = (x: number) => Number.isFinite(x) && x > 0;
const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export function nextNative15mOpen(decisionTs: number): number {
  return Math.ceil(decisionTs / NATIVE_15M_MS) * NATIVE_15M_MS;
}

export function normalizeNative15mBars(bars: Native15mBar[]): Native15mBar[] {
  const byOpen = new Map<number, Native15mBar>();
  for (const b of bars) {
    if (
      !Number.isFinite(b.openTs) ||
      b.closeTs !== b.openTs + NATIVE_15M_MS ||
      !finitePrice(b.open) ||
      !finitePrice(b.high) ||
      !finitePrice(b.low) ||
      !finitePrice(b.close) ||
      b.high < Math.max(b.open, b.close) ||
      b.low > Math.min(b.open, b.close)
    ) continue;
    byOpen.set(b.openTs, b);
  }
  return [...byOpen.values()].sort((a, b) => a.openTs - b.openTs);
}

function coverageFor(path: Native15mBar[], entryTs: number, horizonH: number): DataCoverage {
  const expected = horizonH * 4;
  let contiguous = path.length >= expected;
  for (let i = 0; i < Math.min(expected, path.length); i++) {
    if (path[i].openTs !== entryTs + i * NATIVE_15M_MS) {
      contiguous = false;
      break;
    }
  }
  const observed = Math.min(path.length, expected);
  return {
    complete: contiguous && observed === expected,
    barsExpected: expected,
    barsObserved: observed,
    contiguous,
    fundingComplete: true,
    ...(!contiguous || observed !== expected ? { reason: 'missing or non-contiguous native 15m path' } : {}),
  };
}

function orderingFor(entry: number, path: Native15mBar[], side: 'long' | 'short' = 'long'): ThresholdOrdering {
  let plus4At: number | undefined;
  let plus8At: number | undefined;
  let plus15At: number | undefined;
  let minus3At: number | undefined;
  for (const b of path) {
    // Conservative ordering: if both sides touch inside one candle, the stop
    // happened first. We never manufacture a favourable intra-bar sequence.
    if (minus3At == null && (side === 'long' ? b.low <= entry * 0.97 : b.high >= entry * 1.03)) minus3At = b.closeTs;
    if (minus3At === b.closeTs) continue;
    if (plus4At == null && (side === 'long' ? b.high >= entry * 1.04 : b.low <= entry * 0.96)) plus4At = b.closeTs;
    if (plus8At == null && (side === 'long' ? b.high >= entry * 1.08 : b.low <= entry * 0.92)) plus8At = b.closeTs;
    if (plus15At == null && (side === 'long' ? b.high >= entry * 1.15 : b.low <= entry * 0.85)) plus15At = b.closeTs;
  }
  return {
    plus4At,
    plus8At,
    plus15At,
    minus3At,
    plus4BeforeMinus3: plus4At != null && (minus3At == null || plus4At < minus3At),
  };
}

function fundingCost(charges: FundingCharge[], fromTs: number, toTs: number, remainingAt: (ts: number) => number): number {
  let out = 0;
  for (const f of charges) {
    if (!Number.isFinite(f.ts) || !Number.isFinite(f.rate) || f.ts < fromTs || f.ts > toTs) continue;
    out += f.rate * remainingAt(f.ts);
  }
  return out;
}

export function evaluateStrategyCandidate(
  candidate: StrategyCandidate,
  rawBars: Native15mBar[],
  policy: ExecutionPolicy = EXECUTION_POLICIES['time24-sl3-v1'],
  funding: FundingCharge[] = [],
): StrategyOutcome {
  const side = candidate.side ?? 'long';
  const bars = normalizeNative15mBars(rawBars);
  const entryTs = nextNative15mOpen(candidate.decisionTs);
  const expectedEntry = bars.find((b) => b.openTs === entryTs);
  const baseId = `${candidate.id}:${policy.id}`;
  if (!expectedEntry) {
    return {
      type: 'strategy-outcome', v: 1, id: baseId, candidateId: candidate.id,
      strategyId: candidate.strategyId, executionPolicyId: policy.id, sym: candidate.sym, side,
      decisionTs: candidate.decisionTs, entryTs, entryPx: 0, exitTs: entryTs,
      exitPx: 0, grossReturn: 0, costReturn: 0, fundingReturn: 0, netReturn: 0,
      mfe: 0, mae: 0, ordering: { plus4BeforeMinus3: false },
      coverage: { complete: false, barsExpected: policy.maxHoldH * 4, barsObserved: 0, contiguous: false, fundingComplete: true, reason: 'next native 15m open missing' },
      terminal: 'insufficient-data',
    };
  }

  const entry = expectedEntry.open;
  const deadline = entryTs + policy.maxHoldH * HOUR_MS;
  const path = bars.filter((b) => b.openTs >= entryTs && b.closeTs <= deadline);
  const coverage = coverageFor(path, entryTs, policy.maxHoldH);
  if (!coverage.complete) {
    return {
      type: 'strategy-outcome', v: 1, id: baseId, candidateId: candidate.id,
      strategyId: candidate.strategyId, executionPolicyId: policy.id, sym: candidate.sym, side,
      decisionTs: candidate.decisionTs, entryTs, entryPx: entry, exitTs: path.length ? path[path.length - 1].closeTs : entryTs,
      exitPx: path.length ? path[path.length - 1].close : entry, grossReturn: 0, costReturn: 0,
      fundingReturn: 0, netReturn: 0, mfe: 0, mae: 0,
      ordering: orderingFor(entry, path, side), coverage, terminal: 'insufficient-data',
    };
  }

  let mfe = -Infinity;
  let mae = Infinity;
  for (const b of path) {
    const favorable = side === 'long' ? b.high / entry - 1 : 1 - b.low / entry;
    const adverse = side === 'long' ? b.low / entry - 1 : 1 - b.high / entry;
    mfe = Math.max(mfe, favorable);
    mae = Math.min(mae, adverse);
  }
  const ordering = orderingFor(entry, path, side);
  const stop = entry * (side === 'long' ? 0.97 : 1.03);
  let terminal: StrategyOutcome['terminal'] = 'time';
  let exitTs = path[path.length - 1].closeTs;
  let exitPx = path[path.length - 1].close;
  let grossReturn = 0;
  const reductions: Array<{ ts: number; frac: number }> = [];

  if (policy.id === 'time24-sl3-v1') {
    const stopped = path.find((b) => side === 'long' ? b.low <= stop : b.high >= stop);
    if (stopped) {
      terminal = 'stop';
      exitTs = stopped.closeTs;
      exitPx = stop;
    }
    grossReturn = side === 'long' ? exitPx / entry - 1 : 1 - exitPx / entry;
  } else {
    let remaining = 1;
    let took4 = false;
    let took8 = false;
    for (const b of path) {
      if (side === 'long' ? b.low <= stop : b.high >= stop) {
        grossReturn += remaining * -0.03;
        reductions.push({ ts: b.closeTs, frac: remaining });
        remaining = 0;
        exitTs = b.closeTs;
        exitPx = stop;
        terminal = 'stop';
        break;
      }
      if (!took4 && (side === 'long' ? b.high >= entry * 1.04 : b.low <= entry * 0.96)) {
        grossReturn += 0.5 * 0.04;
        remaining -= 0.5;
        reductions.push({ ts: b.closeTs, frac: 0.5 });
        took4 = true;
      }
      if (!took8 && (side === 'long' ? b.high >= entry * 1.08 : b.low <= entry * 0.92)) {
        grossReturn += 0.3 * 0.08;
        remaining -= 0.3;
        reductions.push({ ts: b.closeTs, frac: 0.3 });
        took8 = true;
      }
      if (side === 'long' ? b.high >= entry * 1.15 : b.low <= entry * 0.85) {
        grossReturn += remaining * 0.15;
        reductions.push({ ts: b.closeTs, frac: remaining });
        remaining = 0;
        exitTs = b.closeTs;
        exitPx = entry * (side === 'long' ? 1.15 : 0.85);
        terminal = 'ladder-complete';
        break;
      }
    }
    if (remaining > 1e-9) {
      grossReturn += remaining * (side === 'long' ? exitPx / entry - 1 : 1 - exitPx / entry);
      reductions.push({ ts: exitTs, frac: remaining });
    }
  }

  const remainingAt = (ts: number) => {
    let rem = 1;
    for (const r of reductions) if (r.ts < ts) rem -= r.frac;
    return Math.max(0, rem);
  };
  const fundingReturn = fundingCost(funding, entryTs, exitTs, remainingAt) * (side === 'long' ? 1 : -1);
  const costReturn = policy.roundTripCostBps / 10_000;
  return {
    type: 'strategy-outcome', v: 1, id: baseId, candidateId: candidate.id,
    strategyId: candidate.strategyId, executionPolicyId: policy.id, sym: candidate.sym, side,
    decisionTs: candidate.decisionTs, entryTs, entryPx: entry, exitTs, exitPx,
    grossReturn, costReturn, fundingReturn, netReturn: grossReturn - costReturn - fundingReturn,
    mfe, mae, ordering, coverage, terminal,
  };
}

export interface OutcomeSummary {
  trades: number;
  coins: number;
  utcDays: number;
  months: number;
  coverage: number;
  netMean: number;
  netMedian: number;
  grossMean: number;
  winRate: number;
  plus4BeforeMinus3Rate: number;
  meanMfe: number;
  meanMae: number;
  maxDrawdown: number;
  profitFactor: number;
  topCoinProfitShare: number;
  topDayProfitShare: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function concentration(rows: StrategyOutcome[], key: (x: StrategyOutcome) => string): number {
  const sums = new Map<string, number>();
  for (const x of rows) sums.set(key(x), (sums.get(key(x)) ?? 0) + x.netReturn);
  const positive = [...sums.values()].filter((x) => x > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  return total > 0 ? Math.max(...positive, 0) / total : 1;
}

export function summarizeStrategyOutcomes(all: StrategyOutcome[]): OutcomeSummary {
  const valid = all.filter((x) => x.coverage.complete && x.coverage.fundingComplete && x.terminal !== 'insufficient-data');
  const returns = valid.map((x) => x.netReturn);
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const x of [...valid].sort((a, b) => a.entryTs - b.entryTs)) {
    equity *= Math.max(0.01, 1 + x.netReturn);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }
  const wins = returns.filter((x) => x > 0);
  const losses = returns.filter((x) => x < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  return {
    trades: valid.length,
    coins: new Set(valid.map((x) => x.sym)).size,
    utcDays: new Set(valid.map((x) => dayKey(x.entryTs))).size,
    months: new Set(valid.map((x) => monthKey(x.entryTs))).size,
    coverage: all.length ? valid.length / all.length : 0,
    netMean: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0,
    netMedian: median(returns),
    grossMean: valid.length ? valid.reduce((a, b) => a + b.grossReturn, 0) / valid.length : 0,
    winRate: valid.length ? wins.length / valid.length : 0,
    plus4BeforeMinus3Rate: valid.length ? valid.filter((x) => x.ordering.plus4BeforeMinus3).length / valid.length : 0,
    meanMfe: valid.length ? valid.reduce((a, b) => a + b.mfe, 0) / valid.length : 0,
    meanMae: valid.length ? valid.reduce((a, b) => a + b.mae, 0) / valid.length : 0,
    maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    topCoinProfitShare: concentration(valid, (x) => x.sym),
    topDayProfitShare: concentration(valid, (x) => dayKey(x.entryTs)),
  };
}

export interface PromotionInputs {
  strategyId: StrategyId;
  stage: 'shadow' | 'paper';
  outcomes: StrategyOutcome[];
  matchedLift?: number;
  sensitivityLifts?: number[];
  stressNetMean?: number;
  positiveWalkForwardFolds?: number;
  bootstrapLowerBound?: number;
}

export function evaluatePromotion(input: PromotionInputs): PromotionDecision {
  const s = summarizeStrategyOutcomes(input.outcomes);
  const shadow = input.stage === 'shadow';
  const reasons: string[] = [];
  const needTrades = shadow ? 100 : 200;
  const needCoins = shadow ? 40 : 60;
  const needDays = shadow ? 20 : 60;
  if (s.trades < needTrades) reasons.push(`trades ${s.trades}<${needTrades}`);
  if (s.coins < needCoins) reasons.push(`coins ${s.coins}<${needCoins}`);
  if (s.utcDays < needDays) reasons.push(`UTC days ${s.utcDays}<${needDays}`);
  if (!(s.netMean > 0)) reasons.push('after-cost expectancy is not positive');
  if (shadow) {
    if (!(input.matchedLift != null && input.matchedLift >= 1.3)) reasons.push('matched lift <1.30 or unavailable');
    if (!input.sensitivityLifts?.length || input.sensitivityLifts.some((x) => !(x > 1.15))) reasons.push('sensitivity floor <=1.15 or unavailable');
  } else {
    if (s.months < 3) reasons.push(`months ${s.months}<3`);
    if ((input.positiveWalkForwardFolds ?? 0) < 3) reasons.push('positive walk-forward folds <3');
    if (!(input.bootstrapLowerBound != null && input.bootstrapLowerBound > 0)) reasons.push('bootstrap lower bound <=0 or unavailable');
    if (!(input.stressNetMean != null && input.stressNetMean > 0)) reasons.push('60bps stress expectancy <=0 or unavailable');
    if (s.maxDrawdown > 0.1) reasons.push('max drawdown >10%');
    if (s.topCoinProfitShare > 0.1) reasons.push('one coin contributes >10% of positive PnL');
    if (s.topDayProfitShare > 0.2) reasons.push('one day contributes >20% of positive PnL');
  }
  return {
    strategyId: input.strategyId,
    stage: input.stage,
    pass: reasons.length === 0,
    reasons,
    counts: { trades: s.trades, coins: s.coins, utcDays: s.utcDays, months: s.months },
    netMean: s.netMean,
    maxDrawdown: s.maxDrawdown,
    matchedLift: input.matchedLift,
    stressNetMean: input.stressNetMean,
  };
}

export interface StrategyLabRow {
  strategyId: StrategyId;
  label: string;
  candidates: number;
  outcomes: number;
  active: number;
  summary: OutcomeSummary;
  shadowGate: PromotionDecision;
  paperGate: PromotionDecision;
  latestTs: number;
}

export interface StrategyLabSnapshot {
  v: 1;
  generatedAt: number;
  rows: StrategyLabRow[];
  candidates: StrategyCandidate[];
  outcomes: StrategyOutcome[];
  policy: PortfolioPolicy;
}

export function buildStrategyLabSnapshot(jsonl: string, now = Date.now()): StrategyLabSnapshot {
  const candidates: StrategyCandidate[] = [];
  const outcomes: StrategyOutcome[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.includes('strategy-')) continue;
    try {
      const x = JSON.parse(line);
      if (x?.type === 'strategy-candidate' && x.v === 1) candidates.push(x as StrategyCandidate);
      else if (x?.type === 'strategy-outcome' && x.v === 1) outcomes.push(x as StrategyOutcome);
    } catch {
      // Append-only audit streams tolerate a malformed line.
    }
  }
  // The lab always displays the full registered research universe. Strategies
  // with zero forward evidence must be visibly "collecting", not disappear and
  // invite survivorship bias.
  const ids = Object.keys(STRATEGY_LABELS) as StrategyId[];
  const rows = ids.map((strategyId): StrategyLabRow => {
    const cs = candidates.filter((x) => x.strategyId === strategyId);
    const os = outcomes.filter((x) => x.strategyId === strategyId);
    return {
      strategyId,
      label: STRATEGY_LABELS[strategyId],
      candidates: cs.length,
      outcomes: os.length,
      active: cs.filter((x) => x.status === 'shadow' && !os.some((o) => o.candidateId === x.id)).length,
      summary: summarizeStrategyOutcomes(os),
      shadowGate: evaluatePromotion({ strategyId, stage: 'shadow', outcomes: os }),
      paperGate: evaluatePromotion({ strategyId, stage: 'paper', outcomes: os }),
      latestTs: Math.max(0, ...cs.map((x) => x.decisionTs), ...os.map((x) => x.exitTs)),
    };
  });
  return { v: 1, generatedAt: now, rows, candidates, outcomes, policy: BALANCED_PORTFOLIO_POLICY };
}
