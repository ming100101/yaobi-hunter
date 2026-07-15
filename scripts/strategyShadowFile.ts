import fs from 'node:fs';
import path from 'node:path';
import type { CoinLite, ExecutionPolicyId, StrategyCandidate } from '../src/types';
import {
  boardingB2QuantityOiQualified,
  evaluateBoardingB2,
  evaluateEma20ReclaimControl,
  type BoardingB2Signal,
} from '../src/lib/boardingB2';
import {
  EXECUTION_POLICIES,
  NATIVE_15M_MS,
  buildStrategyLabSnapshot,
  evaluateStrategyCandidate,
  type Native15mBar,
} from '../src/lib/strategyLab';
import {
  BN_LIVE,
  fetchClosedPerpCandles,
  fetchPerpFundingCharges,
  mapPool,
} from '../src/data/binance';
import { appendRecordLine, recordingsDir } from './recordFile';
import type { HourlyMarketStore } from './hourlyMarketFile';

const HOUR_MS = 3_600_000;
const ALL_POLICIES = Object.keys(EXECUTION_POLICIES) as ExecutionPolicyId[];

interface ActiveShadow {
  candidate: StrategyCandidate;
  completed: ExecutionPolicyId[];
}

interface StrategyShadowState {
  v: 1;
  updatedAt: number;
  active: Record<string, ActiveShadow>;
  // Durable id set prevents a restart from recreating the same hourly fire.
  seen: Record<string, number>;
}

const emptyState = (): StrategyShadowState => ({ v: 1, updatedAt: 0, active: {}, seen: {} });

export function defaultStrategyShadowPath(): string {
  return path.join(path.dirname(recordingsDir()), 'strategy-shadow.json');
}

export function defaultStrategyLabPath(): string {
  return path.join(path.dirname(recordingsDir()), 'strategy-lab.json');
}

export function readStrategyShadowState(file = defaultStrategyShadowPath()): StrategyShadowState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw?.v !== 1 || !raw.active || !raw.seen) return emptyState();
    return raw as StrategyShadowState;
  } catch {
    return emptyState();
  }
}

function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function writeStrategyShadowState(state: StrategyShadowState, file = defaultStrategyShadowPath()): void {
  atomicJson(file, state);
}

function idFor(strategyId: StrategyCandidate['strategyId'], sym: string, decisionTs: number): string {
  return `${strategyId}:${sym.toUpperCase()}:${decisionTs}`;
}

function fromSignal(
  strategyId: StrategyCandidate['strategyId'],
  rulesetId: string,
  sym: string,
  signal: BoardingB2Signal,
  coin: CoinLite | undefined,
): StrategyCandidate {
  return {
    type: 'strategy-candidate',
    v: 1,
    id: idFor(strategyId, sym, signal.decisionTs),
    strategyId,
    rulesetId,
    sym: sym.toUpperCase(),
    decisionTs: signal.decisionTs,
    signalPx: signal.signalPx,
    status: 'shadow',
    source: 'forward',
    strength: coin?.strength,
    ema20: signal.ema20,
    ema50: signal.ema50,
    atr: signal.atr14,
    oiQty1h: coin?.oiQty1h ?? null,
    oiQty4h: coin?.oiQty4h ?? null,
    takerBuyShare4h: coin?.feat?.takerBuyShare4h ?? null,
    spotVol24h: coin?.feat?.spotVol24h ?? null,
    perpVol24h: coin?.vol24h ?? null,
    basisPct: coin?.feat?.basisPct ?? null,
  };
}

// One shared definition produces forward candidates for the recorder.  A
// candidate is accepted only during the hour immediately after its completed
// 1H decision bar, preventing a freshly seeded store from backfilling trades.
export function collectB2ShadowCandidates(
  store: HourlyMarketStore,
  coins: CoinLite[],
  nowMs: number,
): StrategyCandidate[] {
  const bySym = new Map(coins.map((c) => [c.symbol.toUpperCase(), c]));
  const out: StrategyCandidate[] = [];
  for (const [sym, series] of Object.entries(store.state.series)) {
    const coin = bySym.get(sym);
    const control = evaluateEma20ReclaimControl(series.candles, series.volume);
    if (!control || control.decisionTs > nowMs || nowMs - control.decisionTs > 75 * 60_000) continue;
    out.push(fromSignal('ema20-reclaim-control-v1', 'ema20-reclaim-control-v1@2026-07-15', sym, control, coin));
    const b2 = evaluateBoardingB2(series.candles, series.volume);
    if (!b2) continue;
    out.push(fromSignal('boarding-b2-v1', b2.rulesetId, sym, b2, coin));
    if (boardingB2QuantityOiQualified(coin?.oiQty1h, coin?.oiQty4h)) {
      out.push(fromSignal('boarding-b2-oi-v1', `${b2.rulesetId}+quantity-oi-v1`, sym, b2, coin));
    }
  }
  return out;
}

export function collectSpotShadowCandidates(coins: CoinLite[], decisionTs: number): StrategyCandidate[] {
  const out: StrategyCandidate[] = [];
  for (const coin of coins) {
    const f = coin.feat;
    const base = {
      type: 'strategy-candidate' as const,
      v: 1 as const,
      sym: coin.symbol.toUpperCase(),
      decisionTs,
      signalPx: coin.lastPrice,
      status: 'shadow' as const,
      source: 'forward' as const,
      strength: coin.strength,
      takerBuyShare4h: f?.spotTakerBuyShare4h ?? null,
      spotVol24h: f?.spotVol24h ?? null,
      perpVol24h: coin.vol24h,
      basisPct: f?.basisPct ?? null,
      oiQty1h: coin.oiQty1h ?? null,
      oiQty4h: coin.oiQty4h ?? null,
    };
    // v0 deliberately replays the shipped proxy exactly; it is a control, not
    // silently relabelled as real taker-buy flow.
    if (coin.spotPump === true) {
      const strategyId = 'organic-spot-v0' as const;
      out.push({ ...base, strategyId, rulesetId: 'organic-spot-v0@frozen', id: idFor(strategyId, coin.symbol, decisionTs) });
    }
    // v1 fails closed unless every cross-market input has its real semantics.
    if (
      f?.ret4h != null && f.ret4h >= 2 &&
      f.spotTakerBuyShare4h != null && f.spotTakerBuyShare4h > 0.55 &&
      f.basisPct != null && f.basisPct <= 0 &&
      f.spotVol24h != null && f.spotVol24h >= coin.vol24h
    ) {
      const strategyId = 'spot-led-v1' as const;
      out.push({ ...base, strategyId, rulesetId: 'spot-led-v1@2026-07-15', id: idFor(strategyId, coin.symbol, decisionTs) });
    }
  }
  return out;
}

export function collectExistingSignalShadowCandidates(coins: CoinLite[], decisionTs: number): StrategyCandidate[] {
  const out: StrategyCandidate[] = [];
  const defs: Array<[keyof CoinLite, StrategyCandidate['strategyId'], string]> = [
    ['virginBreakout', 'virgin-v2', 'virgin-v2@shipped'],
    ['rebuildBreakout', 'rebuild-r1', 'rebuild-r1@shipped'],
    ['flushBreakout', 'flush-breakout', 'flush-breakout@shipped'],
  ];
  for (const coin of coins) {
    for (const [field, strategyId, rulesetId] of defs) {
      if (coin[field] !== true) continue;
      out.push({
        type: 'strategy-candidate', v: 1, id: idFor(strategyId, coin.symbol, decisionTs),
        strategyId, rulesetId, sym: coin.symbol.toUpperCase(), decisionTs,
        signalPx: coin.lastPrice, status: 'shadow', source: 'forward', strength: coin.strength,
        oiQty1h: coin.oiQty1h ?? null, oiQty4h: coin.oiQty4h ?? null,
        takerBuyShare4h: coin.feat?.takerBuyShare4h ?? null,
        spotVol24h: coin.feat?.spotVol24h ?? null, perpVol24h: coin.vol24h,
        basisPct: coin.feat?.basisPct ?? null,
      });
    }
  }
  return out;
}

function nativeBars(candles: Awaited<ReturnType<typeof fetchClosedPerpCandles>>): Native15mBar[] {
  return candles.map((c) => ({
    openTs: c.time * 1000,
    closeTs: c.time * 1000 + NATIVE_15M_MS,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function refreshStrategyLabFile(nowMs: number, file = defaultStrategyLabPath()): void {
  const dir = recordingsDir();
  let jsonl = '';
  try {
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort().slice(-120);
    jsonl = files.map((x) => fs.readFileSync(path.join(dir, x), 'utf8')).join('\n');
  } catch {
    // An empty first-run snapshot is still a valid API response.
  }
  atomicJson(file, buildStrategyLabSnapshot(jsonl, nowMs));
}

export async function runStrategyShadowCycle(
  candidates: StrategyCandidate[],
  nowMs = Date.now(),
  stateFile = defaultStrategyShadowPath(),
): Promise<{ armed: number; outcomes: number; active: number }> {
  const state = readStrategyShadowState(stateFile);
  let changed = false;
  let armed = 0;
  let outcomes = 0;

  for (const candidate of candidates) {
    if (state.seen[candidate.id]) continue;
    const prefix = `${candidate.strategyId}:${candidate.sym.toUpperCase()}:`;
    const cooling = Object.entries(state.seen).some(([id, ts]) => id.startsWith(prefix) && nowMs - ts < 24 * HOUR_MS);
    if (cooling) continue;
    appendRecordLine(JSON.stringify(candidate));
    state.seen[candidate.id] = nowMs;
    state.active[candidate.id] = { candidate, completed: [] };
    armed++;
    changed = true;
  }

  // At most one market-data request per symbol, even if base/control/OI all
  // fired together.  Mature policies are then evaluated against the same path.
  const bySym = new Map<string, ActiveShadow[]>();
  for (const active of Object.values(state.active)) {
    const rows = bySym.get(active.candidate.sym) ?? [];
    rows.push(active);
    bySym.set(active.candidate.sym, rows);
  }
  await mapPool(
    [...bySym.entries()],
    3,
    async ([sym, activeRows]) => {
      const oldest = Math.min(...activeRows.map((x) => x.candidate.decisionTs));
      // Nothing can complete before the 24h policy horizon.
      if (nowMs < oldest + 24 * HOUR_MS) return;
      try {
        const candles = await fetchClosedPerpCandles(BN_LIVE, sym, '15m', 500);
        const bars = nativeBars(candles);
        const funding = await fetchPerpFundingCharges(BN_LIVE, sym, oldest, nowMs);
        for (const active of activeRows) {
          for (const policyId of ALL_POLICIES) {
            if (active.completed.includes(policyId)) continue;
            const policy = EXECUTION_POLICIES[policyId];
            const readyAt = active.candidate.decisionTs + policy.maxHoldH * HOUR_MS;
            if (nowMs < readyAt) continue;
            const outcome = evaluateStrategyCandidate(active.candidate, bars, policy, funding);
            // A missing next slot becomes terminal after the fixed 45m entry
            // validity window. Other recent gaps stay pending for one extra
            // slot, then are recorded explicitly as insufficient-data.
            if (!outcome.coverage.complete && nowMs < readyAt + 45 * 60_000) continue;
            appendRecordLine(JSON.stringify(outcome));
            active.completed.push(policyId);
            outcomes++;
            changed = true;
          }
          if (ALL_POLICIES.every((p) => active.completed.includes(p))) delete state.active[active.candidate.id];
        }
      } catch (e) {
        console.error(`  [strategy-shadow] ${sym} data skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    120,
  );

  // Bound the restart de-duplication index without ever dropping live entries.
  const keepAfter = nowMs - 180 * 24 * HOUR_MS;
  for (const [id, ts] of Object.entries(state.seen)) if (ts < keepAfter && !state.active[id]) delete state.seen[id];
  if (changed) {
    state.updatedAt = nowMs;
    writeStrategyShadowState(state, stateFile);
  }
  if (changed || !fs.existsSync(defaultStrategyLabPath())) refreshStrategyLabFile(nowMs);
  return { armed, outcomes, active: Object.keys(state.active).length };
}
