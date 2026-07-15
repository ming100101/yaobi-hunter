import type { PortfolioPolicy, StrategyCandidate, StrategyId } from '../types';
import { BALANCED_PORTFOLIO_POLICY, NATIVE_15M_MS, nextNative15mOpen, type Native15mBar } from './strategyLab';

export interface BalancedPaperPosition {
  id: string;
  strategyId: StrategyId;
  candidateId: string;
  sym: string;
  entryTs: number;
  entryPx: number;
  notional: number;
  riskAmount: number;
  stopPx: number;
}
export interface BalancedPaperState {
  v: 1;
  policyId: 'balanced-v1';
  startEquity: number;
  equity: number;
  peakEquity: number;
  day: string;
  dayStartEquity: number;
  dayRealized: number;
  dayBlocked: boolean;
  drawdownLocked: boolean;
  positions: BalancedPaperPosition[];
  eligibleStrategies: StrategyId[];
  updatedAt: number;
}

export interface PaperOpenResult {
  state: BalancedPaperState;
  opened?: BalancedPaperPosition;
  reason?: string;
}

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function createBalancedPaperState(startEquity = 10_000, eligibleStrategies: StrategyId[] = []): BalancedPaperState {
  return {
    v: 1,
    policyId: 'balanced-v1',
    startEquity,
    equity: startEquity,
    peakEquity: startEquity,
    day: '',
    dayStartEquity: startEquity,
    dayRealized: 0,
    dayBlocked: false,
    drawdownLocked: false,
    positions: [],
    eligibleStrategies: [...eligibleStrategies],
    updatedAt: 0,
  };
}

function rollDay(state: BalancedPaperState, ts: number): BalancedPaperState {
  const day = dayKey(ts);
  if (state.day === day) return state;
  return { ...state, day, dayStartEquity: state.equity, dayRealized: 0, dayBlocked: false, updatedAt: ts };
}

export function openBalancedPaperPosition(
  rawState: BalancedPaperState,
  candidate: StrategyCandidate,
  bar: Native15mBar | undefined,
  policy: PortfolioPolicy = BALANCED_PORTFOLIO_POLICY,
): PaperOpenResult {
  const state = rollDay(rawState, candidate.decisionTs);
  if (!state.eligibleStrategies.includes(candidate.strategyId)) return { state, reason: 'strategy has not passed the paper promotion gate' };
  if (state.drawdownLocked) return { state, reason: '10% portfolio drawdown lock is active' };
  if (state.dayBlocked) return { state, reason: 'UTC daily loss guard is active' };
  if (!bar || bar.openTs !== nextNative15mOpen(candidate.decisionTs)) return { state, reason: 'next complete native 15m open is unavailable' };
  if (bar.openTs - candidate.decisionTs > 45 * 60_000) return { state, reason: '45 minute entry window expired' };
  if (state.positions.some((x) => x.sym === candidate.sym)) return { state, reason: 'coin already has an open position' };
  if (state.positions.length >= policy.maxOpenPositions) return { state, reason: 'four-position cap reached' };

  const riskBudget = state.equity * (policy.riskPerTradePct / 100);
  const byStop = riskBudget / 0.03;
  const byNotionalCap = state.equity * (policy.maxPositionNotionalPct / 100);
  const openRisk = state.positions.reduce((a, x) => a + x.riskAmount, 0);
  const maxRisk = state.equity * (policy.maxOpenRiskPct / 100);
  if (openRisk + riskBudget > maxRisk + 1e-9) return { state, reason: '2% portfolio open-risk cap reached' };
  const notional = Math.min(byStop, byNotionalCap);
  if (!(notional > 0 && bar.open > 0)) return { state, reason: 'invalid simulated fill' };
  const opened: BalancedPaperPosition = {
    id: `${candidate.id}:balanced-v1`,
    strategyId: candidate.strategyId,
    candidateId: candidate.id,
    sym: candidate.sym,
    entryTs: bar.openTs,
    entryPx: bar.open,
    notional,
    riskAmount: riskBudget,
    stopPx: bar.open * 0.97,
  };
  return { state: { ...state, positions: [...state.positions, opened], updatedAt: bar.openTs }, opened };
}

export function settleBalancedPaperPosition(
  rawState: BalancedPaperState,
  positionId: string,
  netReturn: number,
  ts: number,
  policy: PortfolioPolicy = BALANCED_PORTFOLIO_POLICY,
): BalancedPaperState {
  let state = rollDay(rawState, ts);
  const position = state.positions.find((x) => x.id === positionId);
  if (!position || !Number.isFinite(netReturn)) return state;
  const pnl = position.notional * netReturn;
  const equity = Math.max(0, state.equity + pnl);
  const peakEquity = Math.max(state.peakEquity, equity);
  const dayRealized = state.dayRealized + pnl;
  const dayBlocked = state.dayBlocked || dayRealized <= -state.dayStartEquity * (policy.dailyLossBlockPct / 100);
  const drawdown = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 1;
  return {
    ...state,
    equity,
    peakEquity,
    dayRealized,
    dayBlocked,
    drawdownLocked: state.drawdownLocked || drawdown >= policy.drawdownLockPct / 100,
    positions: state.positions.filter((x) => x.id !== positionId),
    updatedAt: ts,
  };
}

export function balancedPaperRisk(state: BalancedPaperState): {
  openPositions: number;
  openRiskPct: number;
  todayPnlPct: number;
  drawdownPct: number;
} {
  const risk = state.positions.reduce((a, x) => a + x.riskAmount, 0);
  return {
    openPositions: state.positions.length,
    openRiskPct: state.equity > 0 ? (risk / state.equity) * 100 : 0,
    todayPnlPct: state.dayStartEquity > 0 ? (state.dayRealized / state.dayStartEquity) * 100 : 0,
    drawdownPct: state.peakEquity > 0 ? ((state.peakEquity - state.equity) / state.peakEquity) * 100 : 0,
  };
}
