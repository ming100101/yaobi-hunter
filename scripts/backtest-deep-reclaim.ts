// Offline, cache-only study for deep-reclaim-v0.
//
// Price geometry and the base lifecycle come from src/lib/deepReclaim.ts.
// Binance Vision monthly 5m klines are aggregated into canonical completed 15m
// bars.  Quantity OI uses `sum_open_interest`; the USD-OI arm intentionally uses
// `sum_open_interest_value` as a contaminated control because price is embedded
// in that series.  Nothing in this file fetches or writes market data.
//
// Existing B2 and S14 remain external controls.  Their canonical definitions
// live in the 1H and early-pump harnesses respectively; silently reimplementing
// approximate versions here would create an attractive but invalid comparison.
//
// Run without editing package.json:
//   npx esbuild scripts/backtest-deep-reclaim.ts --bundle --format=esm --platform=node \
//     --outfile=scripts/.build/backtest-deep-reclaim.mjs && \
//   node scripts/.build/backtest-deep-reclaim.mjs --month 2026-06 --max 90

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEEP_RECLAIM_EXPIRY_MS,
  DEEP_RECLAIM_GEOMETRY_V0,
  DEEP_RECLAIM_RULESET_ID,
  DEEP_RECLAIM_SELECTION_POLICY_ID,
  DEEP_RECLAIM_OI_MAX_AGE_MS,
  DEEP_RECLAIM_SLOT_MS,
  armDeepReclaim,
  closed15mBars,
  deepReclaimOiDecision,
  evaluateDeepReclaimPriceWithRules,
  observeDeepReclaim,
  type DeepReclaimBar,
  type DeepReclaimGeometryRules,
  type DeepReclaimOiDecisionCode,
  type DeepReclaimOiObservation,
  type DeepReclaimPriceCandidate,
} from '../src/lib/deepReclaim';
import {
  DEEP_RECLAIM_GATE_PROTOCOL,
  blockBootstrapLowerBounds,
  isolateProtocolCohort,
  matchedPrecisionLift,
  purgedWalkForward,
  type ResearchGateRow,
} from '../src/lib/researchGate';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BAR5_MS = 5 * 60 * 1000;
const WARM_BARS = 100;
const FOLLOWUP_H = 48;
const FOLLOWUP_BARS = (FOLLOWUP_H * HOUR_MS) / DEEP_RECLAIM_SLOT_MS;
const COST_BPS = 30;

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.basename(here) === '.build' ? path.dirname(here) : here;
const data5Dir = path.join(scriptsDir, 'backtest-data', '5m');

interface Config {
  months: string[] | null; // null = every cached kline month
  maxSymbols: number;
  json: boolean;
}

type Method = 'price_only' | 'qty_oi' | 'usd_oi_control' | 'fixed_60m' | 'shifted_oi_placebo';
type Horizon = 24 | 48;

interface Kline5 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface MetricPoint {
  t: number;
  qty: number;
  usd: number;
}

interface OiSeries {
  qty: Array<DeepReclaimOiObservation | null>;
  usd: Array<DeepReclaimOiObservation | null>;
  shifted: Array<DeepReclaimOiObservation | null>;
}

interface Alert {
  id: string;
  sym: string;
  setupIdx: number;
  setupMonth: string;
  price: DeepReclaimPriceCandidate;
}

interface Outcome {
  net: number;
  target10Before5: boolean;
  mfe: number | null;
  mae: number | null;
}

interface MethodRow {
  id: string;
  sym: string;
  setupTs: number;
  setupMonth: string;
  method: Method | string;
  confirmed: boolean;
  confirmTs: number | null;
  fillTs: number | null;
  fillPx: number | null;
  delayH: number | null;
  terminal: 'confirmed' | 'invalidated' | 'missed' | 'oi-rejected' | 'expired' | 'no-next-open';
  h24: Outcome;
  h48: Outcome;
}

interface Summary {
  method: string;
  horizonH: Horizon;
  alerts: number;
  confirms: number;
  confirmRate: number;
  coins: number;
  days: number;
  months: number;
  netPerEvent: number;
  netPerCoin: number;
  netPerConfirm: number;
  hit10PerEvent: number;
  hit10PerConfirm: number;
  profitFactor: number;
  meanDelayH: number | null;
  meanMfe: number | null;
  meanMae: number | null;
  terminals: Record<MethodRow['terminal'], number>;
}

interface MatchedComparison {
  events: number;
  coins: number;
  netDeltaPerEvent: number;
  netDeltaPerCoin: number;
  hit10Delta: number;
}

interface Variant {
  name: string;
  q4Min: number;
  bandAtr: number;
  expiryH: number;
  costBps: number;
  geometryRules?: Readonly<DeepReclaimGeometryRules>;
  // 'band' (default) replicates the frozen rules: any 15m HIGH touching
  // L0+2·ATR is a terminal miss. Breakout modes treat a CLOSE >= L0+2·ATR as a
  // confirmation (chase entry at the next open) and never miss on a wick.
  confirm?: 'band' | 'breakout-or-band' | 'breakout-only';
}

const BASE_VARIANT: Variant = { name: 'base', q4Min: 3, bandAtr: 0.5, expiryH: 24, costBps: COST_BPS };
const ROBUST_VARIANTS: Variant[] = [
  { ...BASE_VARIANT, name: 'q4_lo_2.25', q4Min: 2.25 },
  { ...BASE_VARIANT, name: 'q4_hi_3.75', q4Min: 3.75 },
  { ...BASE_VARIANT, name: 'band_lo_0.375atr', bandAtr: 0.375 },
  { ...BASE_VARIANT, name: 'band_hi_0.625atr', bandAtr: 0.625 },
  { ...BASE_VARIANT, name: 'expiry_12h', expiryH: 12 },
  { ...BASE_VARIANT, name: 'expiry_18h', expiryH: 18 },
  { ...BASE_VARIANT, name: 'expiry_30h', expiryH: 30 },
  { ...BASE_VARIANT, name: 'expiry_36h', expiryH: 36 },
  { ...BASE_VARIANT, name: 'cost_40bps', costBps: 40 },
  { ...BASE_VARIANT, name: 'dd_min_lo_4.5', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ddMinPct: 4.5 } },
  { ...BASE_VARIANT, name: 'dd_min_hi_7.5', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ddMinPct: 7.5 } },
  { ...BASE_VARIANT, name: 'dd_max_lo_15', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ddMaxPct: 15 } },
  { ...BASE_VARIANT, name: 'dd_max_hi_25', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ddMaxPct: 25 } },
  { ...BASE_VARIANT, name: 'trough_min_lo_3', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, troughMinAgeBars: 3 } },
  { ...BASE_VARIANT, name: 'trough_min_hi_5', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, troughMinAgeBars: 5 } },
  { ...BASE_VARIANT, name: 'trough_max_lo_60', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, troughMaxAgeBars: 60 } },
  // 80 × 1.25 = 100, but a 96-bar window can causally observe at most age 95.
  { ...BASE_VARIANT, name: 'trough_max_hi_95_cap', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, troughMaxAgeBars: 95 } },
  { ...BASE_VARIANT, name: 'position_lo_0.525', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, posMax: 0.525 } },
  { ...BASE_VARIANT, name: 'position_hi_0.875', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, posMax: 0.875 } },
  { ...BASE_VARIANT, name: 'momentum_lo_4.5', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ret4hMaxPct: 4.5 } },
  { ...BASE_VARIANT, name: 'momentum_hi_7.5', geometryRules: { ...DEEP_RECLAIM_GEOMETRY_V0, ret4hMaxPct: 7.5 } },
];

// Missed-cohort experiment (2026-07-17). Live forward evidence showed the
// frozen rules terminate a watch the moment one 15m HIGH touches L0+2·ATR
// ('missed'), which discards exactly the fastest movers. These cells test the
// alternative confirmation seam (strong CLOSE through L0+2·ATR confirms with
// the same fresh quantity-OI gate, filled at the next open) against their own
// same-geometry price-only controls. Research-only: reported in a separate
// section and never fed into the promotion verdict, robustness battery, or
// the frozen production rules.
const EXPERIMENT_VARIANTS: Variant[] = [
  { ...BASE_VARIANT, name: 'confirm_breakout_or_band', confirm: 'breakout-or-band' },
  { ...BASE_VARIANT, name: 'confirm_breakout_only', confirm: 'breakout-only' },
  { ...BASE_VARIANT, name: 'confirm_breakout_cost40', confirm: 'breakout-or-band', costBps: 40 },
];

function parseArgs(): Config {
  const cfg: Config = { months: ['2026-06'], maxSymbols: Number.MAX_SAFE_INTEGER, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--month') {
      const raw = argv[++i];
      if (!raw) throw new Error('--month needs YYYY-MM, comma-separated months, or all');
      if (raw === 'all') cfg.months = null;
      else {
        const months = [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))].sort();
        if (!months.length || months.some((x) => !/^\d{4}-\d{2}$/.test(x))) throw new Error(`bad --month ${raw}`);
        cfg.months = months;
      }
    } else if (k === '--max') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error('--max must be a positive integer');
      cfg.maxSymbols = n;
    } else if (k === '--json') cfg.json = true;
    else throw new Error(`unknown arg ${k}`);
  }
  return cfg;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

function discoverKlineMonths(): string[] {
  const months = new Set<string>();
  if (!fs.existsSync(data5Dir)) return [];
  for (const file of fs.readdirSync(data5Dir)) {
    if (file.includes('-metrics-')) continue;
    const m = file.match(/-(\d{4}-\d{2})\.csv$/);
    if (m) months.add(m[1]);
  }
  return [...months].sort();
}

function discoverSymbols(months: string[]): string[] {
  const selected = new Set(months);
  const syms = new Set<string>();
  for (const file of fs.readdirSync(data5Dir)) {
    if (file.includes('-metrics-')) continue;
    const m = file.match(/^(.*)-(\d{4}-\d{2})\.csv$/);
    if (m && selected.has(m[2])) syms.add(m[1]);
  }
  return [...syms].sort();
}

function loadMonthsAround(selected: string[]): string[] {
  const out = new Set(selected);
  for (const month of selected) {
    out.add(shiftMonth(month, -1));
    out.add(shiftMonth(month, 1));
  }
  return [...out].sort();
}

function parseKlineFile(file: string): Kline5[] {
  const out: Kline5[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('open_time')) continue;
    const p = line.split(',');
    if (p.length < 5) continue;
    const row = { t: Number(p[0]), o: Number(p[1]), h: Number(p[2]), l: Number(p[3]), c: Number(p[4]) };
    if (
      ![row.t, row.o, row.h, row.l, row.c].every(Number.isFinite) ||
      row.t % BAR5_MS !== 0 || row.l <= 0 || row.l > row.o || row.l > row.c || row.h < row.o || row.h < row.c
    ) continue;
    out.push(row);
  }
  return out;
}

function load15m(sym: string, months: string[]): DeepReclaimBar[] {
  const raw: Kline5[] = [];
  for (const month of months) {
    const file = path.join(data5Dir, `${sym}-${month}.csv`);
    if (fs.existsSync(file)) raw.push(...parseKlineFile(file));
  }
  return closed15mBars(
    raw.map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c })),
    Number.MAX_SAFE_INTEGER,
  );
}

function parseMetricFile(file: string): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('create_time')) continue;
    const p = line.split(',');
    if (p.length < 4) continue;
    const t = Date.parse(p[0].trim().replace(' ', 'T') + 'Z');
    const qty = Number(p[2]);
    const usd = Number(p[3]);
    if (![t, qty, usd].every(Number.isFinite) || !(qty > 0) || !(usd > 0)) continue;
    out.push({ t, qty, usd });
  }
  return out;
}

function loadMetrics(sym: string, months: string[]): { points: MetricPoint[]; cachedMonths: string[]; rows: number } {
  const all: MetricPoint[] = [];
  const cachedMonths: string[] = [];
  for (const month of months) {
    const file = path.join(data5Dir, `${sym}-metrics-${month}.csv`);
    if (!fs.existsSync(file)) continue;
    const rows = parseMetricFile(file);
    if (rows.length) {
      cachedMonths.push(month);
      all.push(...rows);
    }
  }
  all.sort((a, b) => a.t - b.t);
  const dedup: MetricPoint[] = [];
  for (const p of all) {
    if (dedup.length && dedup[dedup.length - 1].t === p.t) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return { points: dedup, cachedMonths, rows: dedup.length };
}

function upperBound<T>(xs: T[], value: number, key: (x: T) => number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(xs[mid]) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function shiftedMetrics(points: MetricPoint[]): MetricPoint[] {
  if (points.length < 2) return [];
  const shift = Math.max(1, Math.floor(points.length / 3));
  return points.map((p, i) => {
    const source = points[(i + shift) % points.length];
    return { t: p.t, qty: source.qty, usd: source.usd };
  });
}

function observationsFor(
  bars: DeepReclaimBar[],
  points: MetricPoint[],
  field: 'qty' | 'usd',
): Array<DeepReclaimOiObservation | null> {
  if (!points.length) return bars.map(() => null);
  const atOrBefore = (ts: number): MetricPoint | null => {
    const i = upperBound(points, ts, (p) => p.t) - 1;
    return i >= 0 ? points[i] : null;
  };
  return bars.map((bar) => {
    const now = atOrBefore(bar.closeTs);
    const h1 = atOrBefore(bar.closeTs - HOUR_MS);
    const h4 = atOrBefore(bar.closeTs - 4 * HOUR_MS);
    if (!now || !h1 || !h4) return null;
    if (
      bar.closeTs - now.t > DEEP_RECLAIM_OI_MAX_AGE_MS ||
      bar.closeTs - HOUR_MS - h1.t > DEEP_RECLAIM_OI_MAX_AGE_MS ||
      bar.closeTs - 4 * HOUR_MS - h4.t > DEEP_RECLAIM_OI_MAX_AGE_MS
    ) return null;
    const a = now[field];
    const b = h1[field];
    const c = h4[field];
    if (!(a > 0 && b > 0 && c > 0)) return null;
    return {
      observedAt: now.t,
      qty1h: (a / b - 1) * 100,
      qty4h: (a / c - 1) * 100,
    };
  });
}

function buildOiSeries(bars: DeepReclaimBar[], points: MetricPoint[]): OiSeries {
  const shifted = shiftedMetrics(points);
  return {
    qty: observationsFor(bars, points, 'qty'),
    usd: observationsFor(bars, points, 'usd'),
    shifted: observationsFor(bars, shifted, 'qty'),
  };
}

function fullFollowup(bars: DeepReclaimBar[], setupIdx: number): boolean {
  const end = setupIdx + FOLLOWUP_BARS;
  return end < bars.length && bars[end].closeTs === bars[setupIdx].closeTs + FOLLOWUP_BARS * DEEP_RECLAIM_SLOT_MS;
}

function extractAlerts(
  sym: string,
  bars: DeepReclaimBar[],
  selected: Set<string>,
  geometryRules: Readonly<DeepReclaimGeometryRules> = DEEP_RECLAIM_GEOMETRY_V0,
): { alerts: Alert[]; noFollowup: number } {
  const alerts: Alert[] = [];
  let noFollowup = 0;
  let nextEligibleAt = 0;
  for (let i = WARM_BARS - 1; i < bars.length; i++) {
    const setupMonth = monthOf(bars[i].closeTs);
    if (!selected.has(setupMonth) || bars[i].closeTs < nextEligibleAt) continue;
    const evaluated = evaluateDeepReclaimPriceWithRules(sym, bars.slice(i - (WARM_BARS - 1), i + 1), geometryRules);
    if (!evaluated.qualified) continue;
    const price = evaluated.candidate;
    // One independent setup per symbol per 24h avoids counting serial EMA
    // recrosses from the same drawdown as independent evidence.
    nextEligibleAt = price.setupTs + DAY_MS;
    if (!fullFollowup(bars, i)) {
      noFollowup++;
      continue;
    }
    alerts.push({ id: `${sym}:${price.setupTs}`, sym, setupIdx: i, setupMonth, price });
  }
  return { alerts, noFollowup };
}

function zeroOutcome(): Outcome {
  return { net: 0, target10Before5: false, mfe: null, mae: null };
}

function evaluateFill(
  alert: Alert,
  bars: DeepReclaimBar[],
  fillIdx: number,
  horizonH: Horizon,
  costBps: number,
): Outcome {
  const entry = bars[fillIdx].open;
  const cutoff = alert.price.setupTs + horizonH * HOUR_MS;
  let remaining = 1;
  let realized = 0;
  let tp1 = false;
  let tp2 = false;
  let tp3 = false;
  let targetResolved = false;
  let target10Before5 = false;
  let high = entry;
  let low = entry;
  let endClose = entry;
  let walked = false;
  for (let i = fillIdx; i < bars.length; i++) {
    const bar = bars[i];
    const openTs = bar.closeTs - DEEP_RECLAIM_SLOT_MS;
    if (openTs >= cutoff) break;
    walked = true;
    endClose = bar.close;
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);

    // Conservative stop-first ordering on ambiguous OHLC bars.
    if (remaining > 0 && bar.low <= entry * 0.97) {
      realized += remaining * -0.03;
      remaining = 0;
    } else if (remaining > 0) {
      if (!tp1 && bar.high >= entry * 1.04) {
        realized += 0.5 * 0.04;
        remaining -= 0.5;
        tp1 = true;
      }
      if (!tp2 && bar.high >= entry * 1.08) {
        realized += 0.3 * 0.08;
        remaining -= 0.3;
        tp2 = true;
      }
      if (!tp3 && bar.high >= entry * 1.15) {
        realized += remaining * 0.15;
        remaining = 0;
        tp3 = true;
      }
    }

    // Independent precision metric: +10% must occur before -5%, stop-first.
    if (!targetResolved) {
      if (bar.low <= entry * 0.95) targetResolved = true;
      else if (bar.high >= entry * 1.1) {
        target10Before5 = true;
        targetResolved = true;
      }
    }
  }
  if (!walked) return { net: -costBps / 10_000, target10Before5: false, mfe: 0, mae: 0 };
  if (remaining > 1e-9) realized += remaining * (endClose / entry - 1);
  return {
    net: realized - costBps / 10_000,
    target10Before5,
    mfe: high / entry - 1,
    mae: low / entry - 1,
  };
}

function completedRow(
  method: Method | string,
  alert: Alert,
  bars: DeepReclaimBar[],
  fillIdx: number | null,
  terminal: MethodRow['terminal'],
  confirmTs: number | null,
  costBps: number,
): MethodRow {
  if (fillIdx == null) {
    return {
      id: alert.id, sym: alert.sym, setupTs: alert.price.setupTs, setupMonth: alert.setupMonth, method,
      confirmed: false, confirmTs: null, fillTs: null, fillPx: null, delayH: null, terminal,
      h24: zeroOutcome(), h48: zeroOutcome(),
    };
  }
  const fill = bars[fillIdx];
  const fillTs = fill.closeTs - DEEP_RECLAIM_SLOT_MS;
  return {
    id: alert.id,
    sym: alert.sym,
    setupTs: alert.price.setupTs,
    setupMonth: alert.setupMonth,
    method,
    confirmed: true,
    confirmTs,
    fillTs,
    fillPx: fill.open,
    delayH: (fillTs - alert.price.setupTs) / HOUR_MS,
    terminal: 'confirmed',
    h24: evaluateFill(alert, bars, fillIdx, 24, costBps),
    h48: evaluateFill(alert, bars, fillIdx, 48, costBps),
  };
}

function simulateModuleWatch(
  method: Method,
  alert: Alert,
  bars: DeepReclaimBar[],
  observations: Array<DeepReclaimOiObservation | null> | null,
): MethodRow | null {
  const setupOi = observations
    ? observations[alert.setupIdx]
    : { observedAt: alert.price.setupTs, qty1h: 1, qty4h: 3 };
  const armed = armDeepReclaim(alert.price, setupOi);
  if (!armed.candidate) return null; // setup did not satisfy this method's definition
  let watch = armed.candidate;
  for (let i = alert.setupIdx + 1; i < bars.length; i++) {
    const oi = observations ? observations[i] : { observedAt: bars[i].closeTs, qty1h: 1, qty4h: 3 };
    const transition = observeDeepReclaim(watch, bars[i], oi);
    watch = transition.candidate;
    if (watch.status === 'watching') continue;
    if (watch.status === 'confirmed') {
      const fillIdx = i + 1;
      if (fillIdx >= bars.length) return completedRow(method, alert, bars, null, 'no-next-open', null, COST_BPS);
      return completedRow(method, alert, bars, fillIdx, 'confirmed', bars[i].closeTs, COST_BPS);
    }
    return completedRow(method, alert, bars, null, watch.status, null, COST_BPS);
  }
  return completedRow(method, alert, bars, null, 'expired', null, COST_BPS);
}

function simulateFixedDelay(alert: Alert, bars: DeepReclaimBar[]): MethodRow {
  const readyAt = alert.price.setupTs + HOUR_MS;
  const expiresAt = alert.price.setupTs + DEEP_RECLAIM_EXPIRY_MS;
  for (let i = alert.setupIdx + 1; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.closeTs >= expiresAt) return completedRow('fixed_60m', alert, bars, null, 'expired', null, COST_BPS);
    if (bar.close < alert.price.troughLow) return completedRow('fixed_60m', alert, bars, null, 'invalidated', null, COST_BPS);
    if (bar.high >= alert.price.missedAbove) return completedRow('fixed_60m', alert, bars, null, 'missed', null, COST_BPS);
    if (bar.closeTs >= readyAt) {
      const fillIdx = i + 1;
      if (fillIdx >= bars.length) return completedRow('fixed_60m', alert, bars, null, 'no-next-open', null, COST_BPS);
      return completedRow('fixed_60m', alert, bars, fillIdx, 'confirmed', bar.closeTs, COST_BPS);
    }
  }
  return completedRow('fixed_60m', alert, bars, null, 'expired', null, COST_BPS);
}

function variantOiDecision(
  observation: DeepReclaimOiObservation | null,
  barCloseTs: number,
  q4Min: number,
): DeepReclaimOiDecisionCode {
  const base = deepReclaimOiDecision(observation, barCloseTs);
  if (!base.fresh || !observation) return base.code;
  return observation.qty1h > 0 && observation.qty4h >= q4Min ? 'pass' : 'rejected';
}

// Local variant runner changes only declared robustness knobs. Base production
// behavior above always calls armDeepReclaim/observeDeepReclaim directly.
function simulateVariant(
  alert: Alert,
  bars: DeepReclaimBar[],
  observations: Array<DeepReclaimOiObservation | null> | null,
  variant: Variant,
): MethodRow | null {
  if (observations && variantOiDecision(observations[alert.setupIdx], alert.price.setupTs, variant.q4Min) !== 'pass') return null;
  const confirmMode = variant.confirm ?? 'band';
  const expiresAt = alert.price.setupTs + variant.expiryH * HOUR_MS;
  const bandHigh = alert.price.l0 + variant.bandAtr * alert.price.atr14;
  for (let i = alert.setupIdx + 1; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.closeTs >= expiresAt) return completedRow(variant.name, alert, bars, null, 'expired', null, variant.costBps);
    if (bar.close < alert.price.troughLow) return completedRow(variant.name, alert, bars, null, 'invalidated', null, variant.costBps);
    if (confirmMode === 'band' && bar.high >= alert.price.missedAbove) return completedRow(variant.name, alert, bars, null, 'missed', null, variant.costBps);
    const bandConfirm = bar.close >= alert.price.l0 && bar.close <= bandHigh;
    const breakoutConfirm = bar.close >= alert.price.missedAbove;
    const priceConfirm =
      confirmMode === 'band' ? bandConfirm :
      confirmMode === 'breakout-or-band' ? bandConfirm || breakoutConfirm :
      breakoutConfirm;
    if (!priceConfirm) continue;
    const oiCode = observations ? variantOiDecision(observations[i], bar.closeTs, variant.q4Min) : 'pass';
    if (oiCode === 'missing' || oiCode === 'stale' || oiCode === 'future') continue;
    if (oiCode === 'rejected') return completedRow(variant.name, alert, bars, null, 'oi-rejected', null, variant.costBps);
    const fillIdx = i + 1;
    if (fillIdx >= bars.length) return completedRow(variant.name, alert, bars, null, 'no-next-open', null, variant.costBps);
    return completedRow(variant.name, alert, bars, fillIdx, 'confirmed', bar.closeTs, variant.costBps);
  }
  return completedRow(variant.name, alert, bars, null, 'expired', null, variant.costBps);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function researchRows(rows: MethodRow[], horizonH: Horizon): ResearchGateRow[] {
  const key = horizonH === 24 ? 'h24' : 'h48';
  const raw = rows.map((row) => ({
    id: row.id,
    sym: row.sym,
    ts: row.setupTs,
    confirmed: row.confirmed,
    value: row[key].net,
    success: row[key].target10Before5,
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
    cohortMonth: row.setupMonth,
  }));
  const cohort = isolateProtocolCohort(raw, {
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
  });
  if (cohort.excluded) throw new Error(`generated research rows lost provenance: ${JSON.stringify(cohort.excludedByReason)}`);
  return cohort.included;
}

function summary(method: string, rows: MethodRow[], horizonH: Horizon): Summary {
  const key = horizonH === 24 ? 'h24' : 'h48';
  const confirmed = rows.filter((r) => r.confirmed);
  const byCoin = new Map<string, number[]>();
  for (const row of rows) {
    const xs = byCoin.get(row.sym) ?? [];
    xs.push(row[key].net);
    byCoin.set(row.sym, xs);
  }
  const positive = confirmed.reduce((n, r) => n + Math.max(0, r[key].net), 0);
  const negative = confirmed.reduce((n, r) => n + Math.max(0, -r[key].net), 0);
  const terminals: Summary['terminals'] = {
    confirmed: 0, invalidated: 0, missed: 0, 'oi-rejected': 0, expired: 0, 'no-next-open': 0,
  };
  for (const row of rows) terminals[row.terminal]++;
  return {
    method,
    horizonH,
    alerts: rows.length,
    confirms: confirmed.length,
    confirmRate: confirmed.length / Math.max(1, rows.length),
    coins: new Set(confirmed.map((r) => r.sym)).size,
    days: new Set(confirmed.map((r) => new Date(r.setupTs).toISOString().slice(0, 10))).size,
    months: new Set(confirmed.map((r) => r.setupMonth)).size,
    netPerEvent: mean(rows.map((r) => r[key].net)),
    netPerCoin: mean([...byCoin.values()].map(mean)),
    netPerConfirm: mean(confirmed.map((r) => r[key].net)),
    hit10PerEvent: rows.filter((r) => r[key].target10Before5).length / Math.max(1, rows.length),
    hit10PerConfirm: confirmed.filter((r) => r[key].target10Before5).length / Math.max(1, confirmed.length),
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? Infinity : 0,
    meanDelayH: confirmed.length ? mean(confirmed.map((r) => r.delayH as number)) : null,
    meanMfe: confirmed.length ? mean(confirmed.map((r) => r[key].mfe as number)) : null,
    meanMae: confirmed.length ? mean(confirmed.map((r) => r[key].mae as number)) : null,
    terminals,
  };
}

function matchedComparison(primary: MethodRow[], control: MethodRow[], horizonH: Horizon): MatchedComparison {
  const key = horizonH === 24 ? 'h24' : 'h48';
  const byId = new Map(control.map((r) => [r.id, r]));
  const pairs = primary.map((p) => [p, byId.get(p.id)] as const).filter((x): x is readonly [MethodRow, MethodRow] => x[1] != null);
  const byCoin = new Map<string, number[]>();
  for (const [p, c] of pairs) {
    const xs = byCoin.get(p.sym) ?? [];
    xs.push(p[key].net - c[key].net);
    byCoin.set(p.sym, xs);
  }
  return {
    events: pairs.length,
    coins: byCoin.size,
    netDeltaPerEvent: mean(pairs.map(([p, c]) => p[key].net - c[key].net)),
    netDeltaPerCoin: mean([...byCoin.values()].map(mean)),
    hit10Delta: mean(pairs.map(([p, c]) => Number(p[key].target10Before5) - Number(c[key].target10Before5))),
  };
}

function pc(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function liftText(x: number): string {
  return Number.isFinite(x) ? x.toFixed(2) : x > 0 ? 'inf' : 'n/a';
}

async function main(): Promise<void> {
  const cfg = parseArgs();
  if (!fs.existsSync(data5Dir)) throw new Error(`cache missing: ${data5Dir}`);
  const cachedKlineMonths = discoverKlineMonths();
  const months = cfg.months ?? cachedKlineMonths;
  if (!months.length) throw new Error('no cached kline months selected');
  const selected = new Set(months);
  const loadMonths = loadMonthsAround(months);
  const symbols = discoverSymbols(months).slice(0, cfg.maxSymbols);

  const methodRows: Record<Method, MethodRow[]> = {
    price_only: [], qty_oi: [], usd_oi_control: [], fixed_60m: [], shifted_oi_placebo: [],
  };
  const variantRows = new Map(ROBUST_VARIANTS.map((v) => [v.name, [] as MethodRow[]]));
  const variantControlRows = new Map(ROBUST_VARIANTS.map((v) => [v.name, [] as MethodRow[]]));
  const variantCandidateCounts = new Map(ROBUST_VARIANTS.map((v) => [v.name, 0]));
  const experimentRows = new Map(EXPERIMENT_VARIANTS.map((v) => [v.name, [] as MethodRow[]]));
  const experimentControlRows = new Map(EXPERIMENT_VARIANTS.map((v) => [v.name, [] as MethodRow[]]));
  const metricsMonths = new Set<string>();
  const setupOi = {
    qty: { pass: 0, missing: 0, stale: 0, future: 0, rejected: 0 },
    usd: { pass: 0, missing: 0, stale: 0, future: 0, rejected: 0 },
    shifted: { pass: 0, missing: 0, stale: 0, future: 0, rejected: 0 },
  } satisfies Record<'qty' | 'usd' | 'shifted', Record<DeepReclaimOiDecisionCode, number>>;
  let priceCandidates = 0;
  let noFollowup = 0;
  let symbolsWithBars = 0;
  let symbolsWithMetrics = 0;
  let metricRows = 0;

  for (const sym of symbols) {
    const bars = load15m(sym, loadMonths);
    if (bars.length < WARM_BARS) continue;
    symbolsWithBars++;
    const metrics = loadMetrics(sym, loadMonths);
    if (metrics.points.length) {
      symbolsWithMetrics++;
      metricRows += metrics.rows;
      metrics.cachedMonths.forEach((m) => metricsMonths.add(m));
    }
    const oi = buildOiSeries(bars, metrics.points);
    const extracted = extractAlerts(sym, bars, selected);
    priceCandidates += extracted.alerts.length;
    noFollowup += extracted.noFollowup;

    for (const alert of extracted.alerts) {
      const price = simulateModuleWatch('price_only', alert, bars, null);
      if (price) methodRows.price_only.push(price);
      methodRows.fixed_60m.push(simulateFixedDelay(alert, bars));

      for (const [kind, method, observations] of [
        ['qty', 'qty_oi', oi.qty],
        ['usd', 'usd_oi_control', oi.usd],
        ['shifted', 'shifted_oi_placebo', oi.shifted],
      ] as const) {
        const decision = deepReclaimOiDecision(observations[alert.setupIdx], alert.price.setupTs);
        setupOi[kind][decision.code]++;
        const row = simulateModuleWatch(method, alert, bars, observations);
        if (row) methodRows[method].push(row);
      }

    }

    // Every geometry cell re-runs candidate discovery over the full timeline.
    // Filtering only the production candidates would introduce survivorship bias.
    for (const variant of ROBUST_VARIANTS) {
      const alerts = variant.geometryRules
        ? extractAlerts(sym, bars, selected, variant.geometryRules).alerts
        : extracted.alerts;
      variantCandidateCounts.set(variant.name, (variantCandidateCounts.get(variant.name) ?? 0) + alerts.length);
      for (const alert of alerts) {
        const row = simulateVariant(alert, bars, oi.qty, variant);
        if (row) variantRows.get(variant.name)!.push(row);
        const control = simulateVariant(alert, bars, null, variant);
        if (control) variantControlRows.get(variant.name)!.push(control);
      }
    }

    // Missed-cohort experiment cells share the production geometry candidates.
    for (const variant of EXPERIMENT_VARIANTS) {
      for (const alert of extracted.alerts) {
        const row = simulateVariant(alert, bars, oi.qty, variant);
        if (row) experimentRows.get(variant.name)!.push(row);
        const control = simulateVariant(alert, bars, null, variant);
        if (control) experimentControlRows.get(variant.name)!.push(control);
      }
    }
  }

  const summaries = Object.fromEntries(
    (Object.keys(methodRows) as Method[]).map((method) => [
      method,
      { h24: summary(method, methodRows[method], 24), h48: summary(method, methodRows[method], 48) },
    ]),
  ) as Record<Method, { h24: Summary; h48: Summary }>;

  const comparisons = {
    h24: {
      priceOnly: matchedComparison(methodRows.qty_oi, methodRows.price_only, 24),
      fixed60m: matchedComparison(methodRows.qty_oi, methodRows.fixed_60m, 24),
      usdOi: matchedComparison(methodRows.qty_oi, methodRows.usd_oi_control, 24),
      shiftedOi: matchedComparison(methodRows.qty_oi, methodRows.shifted_oi_placebo, 24),
    },
    h48: {
      priceOnly: matchedComparison(methodRows.qty_oi, methodRows.price_only, 48),
      fixed60m: matchedComparison(methodRows.qty_oi, methodRows.fixed_60m, 48),
      usdOi: matchedComparison(methodRows.qty_oi, methodRows.usd_oi_control, 48),
      shiftedOi: matchedComparison(methodRows.qty_oi, methodRows.shifted_oi_placebo, 48),
    },
  };

  const baseQty = summaries.qty_oi.h48;
  const robustness = Object.fromEntries(
    ROBUST_VARIANTS.map((variant) => {
      const rows = variantRows.get(variant.name)!;
      const controls = variantControlRows.get(variant.name)!;
      const h24 = summary(variant.name, rows, 24);
      const h48 = summary(variant.name, rows, 48);
      const retention = h48.confirms / Math.max(1, baseQty.confirms);
      const lift24All = matchedPrecisionLift(researchRows(rows, 24), researchRows(controls, 24), false);
      const lift24Confirmed = matchedPrecisionLift(researchRows(rows, 24), researchRows(controls, 24), true);
      const lift48All = matchedPrecisionLift(researchRows(rows, 48), researchRows(controls, 48), false);
      const lift48Confirmed = matchedPrecisionLift(researchRows(rows, 48), researchRows(controls, 48), true);
      const delta24 = matchedComparison(rows, controls, 24);
      const delta48 = matchedComparison(rows, controls, 48);
      const pass =
        h24.netPerEvent > 0 && h24.netPerCoin > 0 &&
        h48.netPerEvent > 0 && h48.netPerCoin > 0 &&
        delta24.netDeltaPerEvent > 0 && delta24.netDeltaPerCoin > 0 &&
        delta48.netDeltaPerEvent > 0 && delta48.netDeltaPerCoin > 0 &&
        lift24All.lift > DEEP_RECLAIM_GATE_PROTOCOL.robustnessLiftExclusive &&
        lift24Confirmed.lift > DEEP_RECLAIM_GATE_PROTOCOL.robustnessLiftExclusive &&
        lift48All.lift > DEEP_RECLAIM_GATE_PROTOCOL.robustnessLiftExclusive &&
        lift48Confirmed.lift > DEEP_RECLAIM_GATE_PROTOCOL.robustnessLiftExclusive &&
        retention >= 0.75;
      return [variant.name, {
        params: variant, candidates: variantCandidateCounts.get(variant.name) ?? 0,
        matchedControlAlerts: controls.length, h24, h48, confirmRetentionVsBase: retention,
        matchedLift: { h24: { all: lift24All, confirmed: lift24Confirmed }, h48: { all: lift48All, confirmed: lift48Confirmed } },
        matchedDelta: { h24: delta24, h48: delta48 },
        pass,
      }];
    }),
  );

  // Missed-cohort experiment report (research-only, never a gate input).
  const baseQtyById = new Map(methodRows.qty_oi.map((r) => [r.id, r]));
  const baseMissedCount = methodRows.qty_oi.filter((r) => r.terminal === 'missed').length;
  const experiments = Object.fromEntries(
    EXPERIMENT_VARIANTS.map((variant) => {
      const rows = experimentRows.get(variant.name)!;
      const controls = experimentControlRows.get(variant.name)!;
      const h24 = summary(variant.name, rows, 24);
      const h48 = summary(variant.name, rows, 48);
      const lift = Object.fromEntries(
        ([24, 48] as Horizon[]).map((horizon) => [`h${horizon}`, {
          all: matchedPrecisionLift(researchRows(rows, horizon), researchRows(controls, horizon), false),
          confirmed: matchedPrecisionLift(researchRows(rows, horizon), researchRows(controls, horizon), true),
        }]),
      );
      const delta = { h24: matchedComparison(rows, controls, 24), h48: matchedComparison(rows, controls, 48) };
      // The motivating cohort: alerts the frozen rules terminally missed.
      const onBaseMissed = rows.filter((r) => baseQtyById.get(r.id)?.terminal === 'missed');
      const captured = onBaseMissed.filter((r) => r.confirmed);
      const missedCohort = {
        baseMissed: baseMissedCount,
        evaluated: onBaseMissed.length,
        captured: captured.length,
        h24NetPerConfirm: mean(captured.map((r) => r.h24.net)),
        h48NetPerConfirm: mean(captured.map((r) => r.h48.net)),
        h24Hit10: captured.filter((r) => r.h24.target10Before5).length,
        meanDelayH: captured.length ? mean(captured.map((r) => r.delayH as number)) : null,
      };
      return [variant.name, { params: variant, h24, h48, matchedLift: lift, matchedDelta: delta, missedCohort }];
    }),
  );

  const matchedLift = Object.fromEntries(
    ([24, 48] as Horizon[]).map((horizon) => {
      const primary = researchRows(methodRows.qty_oi, horizon);
      return [`h${horizon}`, {
        priceOnly: {
          all: matchedPrecisionLift(primary, researchRows(methodRows.price_only, horizon), false),
          confirmed: matchedPrecisionLift(primary, researchRows(methodRows.price_only, horizon), true),
        },
        fixed60m: {
          all: matchedPrecisionLift(primary, researchRows(methodRows.fixed_60m, horizon), false),
          confirmed: matchedPrecisionLift(primary, researchRows(methodRows.fixed_60m, horizon), true),
        },
      }];
    }),
  ) as Record<'h24' | 'h48', Record<'priceOnly' | 'fixed60m', { all: ReturnType<typeof matchedPrecisionLift>; confirmed: ReturnType<typeof matchedPrecisionLift> }>>;

  const bootstrap = {
    h24: blockBootstrapLowerBounds(researchRows(methodRows.qty_oi, 24), { seed: `${DEEP_RECLAIM_GATE_PROTOCOL.id}:qty:h24` }),
    h48: blockBootstrapLowerBounds(researchRows(methodRows.qty_oi, 48), { seed: `${DEEP_RECLAIM_GATE_PROTOCOL.id}:qty:h48` }),
  };
  const walkForward = {
    h24: purgedWalkForward(researchRows(methodRows.qty_oi, 24)),
    h48: purgedWalkForward(researchRows(methodRows.qty_oi, 48)),
  };
  const placeboBootstrap = {
    h24: blockBootstrapLowerBounds(researchRows(methodRows.shifted_oi_placebo, 24), { seed: `${DEEP_RECLAIM_GATE_PROTOCOL.id}:placebo:h24` }),
    h48: blockBootstrapLowerBounds(researchRows(methodRows.shifted_oi_placebo, 48), { seed: `${DEEP_RECLAIM_GATE_PROTOCOL.id}:placebo:h48` }),
  };
  const placeboLift = {
    h24: matchedPrecisionLift(researchRows(methodRows.shifted_oi_placebo, 24), researchRows(methodRows.price_only, 24), false),
    h48: matchedPrecisionLift(researchRows(methodRows.shifted_oi_placebo, 48), researchRows(methodRows.price_only, 48), false),
  };
  const placeboAvailable =
    metricsMonths.size >= DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths &&
    summaries.shifted_oi_placebo.h48.alerts >= DEEP_RECLAIM_GATE_PROTOCOL.placeboMinEvents &&
    placeboBootstrap.h24.available && placeboBootstrap.h48.available;
  const placeboFailedAsExpected = placeboAvailable && ([24, 48] as Horizon[]).every((horizon) => {
    const key = `h${horizon}` as 'h24' | 'h48';
    const s = summaries.shifted_oi_placebo[key];
    const b = placeboBootstrap[key];
    return s.netPerEvent <= 0 || s.netPerCoin <= 0 || (b.eventLower ?? 0) <= 0 || (b.coinLower ?? 0) <= 0 || placeboLift[key].lift < DEEP_RECLAIM_GATE_PROTOCOL.robustnessLiftExclusive;
  });
  const placebo = { available: placeboAvailable, failedAsExpected: placeboFailedAsExpected, bootstrap: placeboBootstrap, liftVsPriceOnly: placeboLift };

  const selectionReplay = {
    policyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    exact: false,
    available: false,
    reason: 'Binance Vision 5m cache has OHLC only and cannot reconstruct the live buyShare4h ranking input',
    evaluatedCohort: 'all quantity-OI-qualified detector events; not the delivered per-sweep Top-1 feed',
  } as const;

  const reasons: string[] = [];
  if (DEEP_RECLAIM_GATE_PROTOCOL.requireExactSelectionReplay && !selectionReplay.available) {
    reasons.push(`runtime Top-1 selection replay unavailable: ${selectionReplay.reason}`);
  }
  if (baseQty.confirms < DEEP_RECLAIM_GATE_PROTOCOL.minConfirmations) reasons.push(`confirms ${baseQty.confirms}<${DEEP_RECLAIM_GATE_PROTOCOL.minConfirmations}`);
  if (baseQty.coins < DEEP_RECLAIM_GATE_PROTOCOL.minSymbols) reasons.push(`confirmed coins ${baseQty.coins}<${DEEP_RECLAIM_GATE_PROTOCOL.minSymbols}`);
  if (baseQty.days < DEEP_RECLAIM_GATE_PROTOCOL.minUtcDays) reasons.push(`confirmed UTC days ${baseQty.days}<${DEEP_RECLAIM_GATE_PROTOCOL.minUtcDays}`);
  if (baseQty.months < DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths) reasons.push(`confirmed months ${baseQty.months}<${DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths}`);
  if (metricsMonths.size < DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths) reasons.push(`cached quantity-metrics months ${metricsMonths.size}<${DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths}`);
  for (const [h, s] of [[24, summaries.qty_oi.h24], [48, summaries.qty_oi.h48]] as const) {
    if (!(s.netPerEvent > 0)) reasons.push(`${h}h net/event <=0`);
    if (!(s.netPerCoin > 0)) reasons.push(`${h}h net/coin <=0`);
  }
  for (const horizon of ['h24', 'h48'] as const) {
    for (const name of ['priceOnly', 'fixed60m'] as const) {
      const cmp = comparisons[horizon][name];
      if (!cmp.events) reasons.push(`${horizon} no matched ${name} control events`);
      else if (!(cmp.netDeltaPerEvent > 0 && cmp.netDeltaPerCoin > 0)) {
        reasons.push(`${horizon} does not beat matched ${name} control on event+coin expectancy`);
      }
      const lifts = matchedLift[horizon][name];
      if (!(lifts.all.lift >= DEEP_RECLAIM_GATE_PROTOCOL.matchedLift && lifts.confirmed.lift >= DEEP_RECLAIM_GATE_PROTOCOL.matchedLift)) {
        reasons.push(`${horizon} ${name} matched precision lift <${DEEP_RECLAIM_GATE_PROTOCOL.matchedLift.toFixed(2)}`);
      }
    }
  }
  for (const horizon of ['h24', 'h48'] as const) {
    const b = bootstrap[horizon];
    if (!b.available) reasons.push(`${horizon} block-bootstrap unavailable`);
    else if (!((b.eventLower ?? 0) > 0 && (b.coinLower ?? 0) > 0)) reasons.push(`${horizon} block-bootstrap lower bound <=0`);
    const w = walkForward[horizon];
    if (!w.available) reasons.push(`${horizon} purged walk-forward unavailable`);
    else if (!w.pass) reasons.push(`${horizon} purged walk-forward has non-positive fold`);
  }
  if (!placebo.available) reasons.push('shifted-OI placebo failure evidence unavailable');
  else if (!placebo.failedAsExpected) reasons.push('shifted-OI placebo did not fail');
  const failedRobust = Object.entries(robustness).filter(([, x]) => !x.pass).map(([name]) => name);
  if (failedRobust.length) reasons.push(`robustness failed: ${failedRobust.join(',')}`);
  const robustnessCoverage = {
    complete: true,
    implemented: [
      'quantity-OI 4h', 'confirmation ATR band', '12/18/30/36h expiry', '40bps cost stress',
      'drawdown min/max', 'trough-age min/max', '24h range-position cap', '4h momentum cap',
    ],
    missing: [] as string[],
  };
  if (!robustnessCoverage.complete) reasons.push(`geometry ±25% robustness unavailable: ${robustnessCoverage.missing.join(',')}`);
  const gate = {
    pass: reasons.length === 0,
    verdict: reasons.length ? 'HARD FAIL / RESEARCH ONLY' : 'PASS RESEARCH GATE (still requires live holdout approval)',
    counts: { confirms: baseQty.confirms, coins: baseQty.coins, days: baseQty.days, months: baseQty.months },
    minimums: {
      confirms: DEEP_RECLAIM_GATE_PROTOCOL.minConfirmations,
      coins: DEEP_RECLAIM_GATE_PROTOCOL.minSymbols,
      days: DEEP_RECLAIM_GATE_PROTOCOL.minUtcDays,
      months: DEEP_RECLAIM_GATE_PROTOCOL.minCalendarMonths,
    },
    reasons,
  };

  const output = {
    strategy: 'deep-reclaim-v0',
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    researchProtocol: DEEP_RECLAIM_GATE_PROTOCOL,
    params: {
      months,
      maxSymbols: cfg.maxSymbols,
      completed15m: true,
      next15mOpenFill: true,
      costBps: COST_BPS,
      ladder: { tp1: [4, 0.5], tp2: [8, 0.3], tp3: [15, 0.2], stop: -3 },
      precision: '+10% before -5%, OHLC stop-first',
      horizonsH: [24, 48],
      cooldownH: 24,
      noConfirmReturn: 0,
      shiftedOiPlacebo: 'quantity-OI values circularly shifted forward by floor(N/3) per symbol timeline',
    },
    data: {
      cacheOnly: true,
      cachedKlineMonths,
      selectedMonths: months,
      cachedMetricMonths: [...metricsMonths].sort(),
      requestedSymbols: symbols.length,
      symbolsWithBars,
      symbolsWithMetrics,
      metricRows,
      priceCandidates,
      no48hFollowup: noFollowup,
      setupOi,
      warning: metricsMonths.size < 3
        ? 'Quantity metrics do not cover three months; OI arms and promotion gate are necessarily underpowered.'
        : null,
    },
    summaries,
    matchedComparisons: comparisons,
    matchedLift,
    robustness,
    experiments,
    robustnessCoverage,
    bootstrap,
    walkForward,
    placebo,
    selectionReplay,
    gate,
    externalControls: {
      B2: 'Not replayed here; use the canonical 1H boarding harness.',
      S14: 'Not replayed here; use scripts/backtest5m.ts --exp early --matched.',
    },
  };

  if (cfg.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`\n=== deep-reclaim-v0 offline study: ${months.join(', ')} ===`);
  console.log(
    `cache-only · symbols ${symbolsWithBars}/${symbols.length} · metrics ${symbolsWithMetrics} · ` +
      `price candidates ${priceCandidates} · no 48h follow-up ${noFollowup}`,
  );
  console.log(`cached metric months: ${[...metricsMonths].sort().join(', ') || 'NONE'}`);
  console.log(
    `setup quantity-OI: pass ${setupOi.qty.pass} · rejected ${setupOi.qty.rejected} · ` +
      `missing/stale/future ${setupOi.qty.missing}/${setupOi.qty.stale}/${setupOi.qty.future}`,
  );
  console.log('\nmethod                H  alerts conf rate coins days mons  net/event net/coin hit10/event   PF  delay   MFE    MAE');
  for (const method of Object.keys(methodRows) as Method[]) {
    for (const horizon of [24, 48] as Horizon[]) {
      const s = horizon === 24 ? summaries[method].h24 : summaries[method].h48;
      const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf';
      console.log(
        `${method.padEnd(21)} ${String(horizon).padStart(2)} ` +
          `${String(s.alerts).padStart(6)} ${String(s.confirms).padStart(4)} ${pc(s.confirmRate).padStart(7)} ` +
          `${String(s.coins).padStart(5)} ${String(s.days).padStart(4)} ${String(s.months).padStart(4)} ` +
          `${pc(s.netPerEvent).padStart(10)} ${pc(s.netPerCoin).padStart(8)} ${pc(s.hit10PerEvent).padStart(11)} ` +
          `${pf.padStart(5)} ${(s.meanDelayH == null ? '-' : `${s.meanDelayH.toFixed(1)}h`).padStart(6)} ` +
          `${(s.meanMfe == null ? '-' : pc(s.meanMfe)).padStart(7)} ${(s.meanMae == null ? '-' : pc(s.meanMae)).padStart(7)}`,
      );
    }
  }
  console.log('\nqty-OI matched net deltas (qty minus control):');
  for (const horizon of ['h24', 'h48'] as const) {
    for (const [name, c] of Object.entries(comparisons[horizon])) {
      console.log(
        `${horizon} vs ${name.padEnd(10)} n=${String(c.events).padStart(4)} · ` +
          `event ${pc(c.netDeltaPerEvent)} · coin ${pc(c.netDeltaPerCoin)} · hit10 ${pc(c.hit10Delta)}`,
      );
    }
  }
  console.log('\npre-registered matched precision lift (+10 before -5):');
  for (const horizon of ['h24', 'h48'] as const) {
    for (const [name, x] of Object.entries(matchedLift[horizon])) {
      console.log(
        `${horizon} vs ${name.padEnd(10)} all ${liftText(x.all.lift)} (n=${x.all.eligible}) · ` +
          `confirmed ${liftText(x.confirmed.lift)} (n=${x.confirmed.eligible})`,
      );
    }
  }
  console.log('\nrobustness (qty-OI):');
  for (const [name, x] of Object.entries(robustness)) {
    const worstLift = Math.min(
      x.matchedLift.h24.all.lift, x.matchedLift.h24.confirmed.lift,
      x.matchedLift.h48.all.lift, x.matchedLift.h48.confirmed.lift,
    );
    console.log(
      `${name.padEnd(24)} ${x.pass ? 'PASS' : 'FAIL'} · cand ${x.candidates} · conf ${x.h48.confirms} ` +
        `(retain ${pc(x.confirmRetentionVsBase)}) · 24h event/coin ${pc(x.h24.netPerEvent)}/${pc(x.h24.netPerCoin)} ` +
        `· 48h ${pc(x.h48.netPerEvent)}/${pc(x.h48.netPerCoin)} · worst lift ${liftText(worstLift)}`,
    );
  }
  console.log('\nmissed-cohort experiment (research-only, NOT a promotion input):');
  for (const [name, x] of Object.entries(experiments)) {
    const worstLift = Math.min(
      x.matchedLift.h24.all.lift, x.matchedLift.h24.confirmed.lift,
      x.matchedLift.h48.all.lift, x.matchedLift.h48.confirmed.lift,
    );
    console.log(
      `${name.padEnd(24)} alerts ${x.h48.alerts} · conf ${x.h48.confirms} (${pc(x.h48.confirmRate)}) · ` +
        `24h event/coin ${pc(x.h24.netPerEvent)}/${pc(x.h24.netPerCoin)} · 48h ${pc(x.h48.netPerEvent)}/${pc(x.h48.netPerCoin)} · ` +
        `PF24 ${liftText(x.h24.profitFactor)} · vs price-only worst lift ${liftText(worstLift)} ` +
        `(Δevent 24h ${pc(x.matchedDelta.h24.netDeltaPerEvent)})`,
    );
    const m = x.missedCohort;
    console.log(
      `  base-missed cohort: ${m.baseMissed} missed by frozen rules · captured ${m.captured} · ` +
        `net/confirm 24h ${pc(m.h24NetPerConfirm)} / 48h ${pc(m.h48NetPerConfirm)} · ` +
        `hit10 ${m.h24Hit10}/${m.captured} · mean delay ${m.meanDelayH == null ? '-' : `${m.meanDelayH.toFixed(1)}h`}`,
    );
  }

  console.log('\nanti-overfit evidence:');
  for (const horizon of ['h24', 'h48'] as const) {
    const b = bootstrap[horizon];
    const w = walkForward[horizon];
    console.log(
      `${horizon} bootstrap ${b.available ? `event ${pc(b.eventLower ?? 0)} / coin ${pc(b.coinLower ?? 0)}` : `UNAVAILABLE (${b.reason})`} · ` +
        `walk-forward ${w.available ? `${w.pass ? 'PASS' : 'FAIL'} [${w.folds.map((fold) => `${fold.months.join('+')}:${pc(fold.eventMean)}/${pc(fold.coinMean)}`).join(', ')}]` : `UNAVAILABLE (${w.reason})`}`,
    );
  }
  console.log(
    `shifted-OI placebo: ${placebo.available ? (placebo.failedAsExpected ? 'FAILED AS REQUIRED' : 'DID NOT FAIL') : 'UNAVAILABLE'} ` +
      `(24h lift ${liftText(placebo.liftVsPriceOnly.h24.lift)}, 48h lift ${liftText(placebo.liftVsPriceOnly.h48.lift)})`,
  );
  console.log(`runtime Top-1 replay: ${selectionReplay.available ? 'AVAILABLE' : `UNAVAILABLE (${selectionReplay.reason})`}`);
  console.log(`\nPROMOTION: ${gate.verdict}`);
  console.log(
    `counts confirms ${gate.counts.confirms}/100 · coins ${gate.counts.coins}/40 · ` +
      `days ${gate.counts.days}/60 · months ${gate.counts.months}/3`,
  );
  if (gate.reasons.length) console.log(`reasons: ${gate.reasons.join('; ')}`);
  console.log('B2/S14 are external controls; this harness does not fabricate approximate replays of them.');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
