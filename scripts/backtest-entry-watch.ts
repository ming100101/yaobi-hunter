// Historical post-Telegram entry research for the shipped R1 (增) and V2 (擴)
// classes. Initial alerts are reconstructed on the same cached canonical 1H
// bars/OI used by scripts/backtest.ts; execution is simulated on cached Binance
// Vision 5m bars aggregated to clock-aligned 15m bars.
//
// Cache-only: this script never fetches or writes market data.
//
//   npm run entry-watch
//   npm run entry-watch -- --month 2026-06 --class rb --json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOUR_MS = 3_600_000;
const MIN15_MS = 900_000;
const DAY_MS = 24 * HOUR_MS;

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.basename(here) === '.build' ? path.dirname(here) : here;
const dataDir = path.join(scriptsDir, 'backtest-data');
const data5Dir = path.join(dataDir, '5m');

type SignalClass = 'rb' | 'vg';
type Method =
  | 'immediate'
  | 'breakout_retest'
  | 'atr_ema20'
  | 'atr_reclaim'
  | 'fixed'
  | 'ema20'
  | 'ema50';

interface HourBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface HourFile {
  symbol: string;
  instId: string;
  bars: HourBar[];
  oi: number[];
}

interface Bar5 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  q: number;
}

interface Bar15 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  q: number;
}

interface Alert {
  id: string;
  sym: string;
  instId: string;
  cls: SignalClass;
  barT: number;
  knownAt: number;
  px: number;
  support: number;
  atr: number;
}

interface JoinedAlert extends Alert {
  startIdx: number;
  joinGapPct: number;
}

interface Config {
  month: string;
  classFilter: SignalClass | 'all';
  cooldownH: number;
  minDelayMin: number;
  waitH: number;
  horizonH: number;
  costBps: number;
  retestAtr: number;
  pullbackAtr: number;
  fixedPct: number;
  json: boolean;
}

interface EntryResult {
  filled: boolean;
  fillT: number | null;
  fillPx: number | null;
  delayH: number | null;
  discountPct: number | null;
  ladderNet: number;
  target10: boolean;
  mfe: number | null;
  mae: number | null;
  missed15: boolean;
  terminal: 'filled' | 'expired' | 'invalidated' | 'missed';
}

interface RunRow {
  alert: JoinedAlert;
  method: Method;
  result: EntryResult;
}

interface Summary {
  method: Method;
  alerts: number;
  fills: number;
  fillRate: number;
  coins: number;
  days: number;
  netPerAlert: number;
  netPerCoin: number;
  netPerFill: number;
  deltaVsImmediate: number;
  hit10PerFill: number;
  hit10PerAlert: number;
  precisionLiftVsImmediate: number;
  profitFactor: number;
  meanDelayH: number | null;
  meanDiscountPct: number | null;
  meanMfe: number | null;
  meanMae: number | null;
  missed15RateNoFill: number;
  terminals: Record<EntryResult['terminal'], number>;
}

const DEFAULT: Config = {
  month: '2026-06',
  classFilter: 'all',
  cooldownH: 6,
  minDelayMin: 30,
  waitH: 24,
  horizonH: 48,
  costBps: 30,
  retestAtr: 0.5,
  pullbackAtr: 1.5,
  fixedPct: 5,
  json: false,
};

function parseArgs(): Config {
  const a = { ...DEFAULT };
  const argv = process.argv.slice(2);
  const num = (i: number) => {
    const n = Number(argv[i + 1]);
    if (!Number.isFinite(n)) throw new Error(`bad number after ${argv[i]}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--month') a.month = argv[++i];
    else if (k === '--class') {
      const v = argv[++i];
      if (v !== 'rb' && v !== 'vg' && v !== 'all') throw new Error(`bad --class ${v}`);
      a.classFilter = v;
    } else if (k === '--cooldown-h') a.cooldownH = num(i++);
    else if (k === '--min-delay-min') a.minDelayMin = num(i++);
    else if (k === '--wait-h') a.waitH = num(i++);
    else if (k === '--horizon-h') a.horizonH = num(i++);
    else if (k === '--cost-bps') a.costBps = num(i++);
    else if (k === '--retest-atr') a.retestAtr = num(i++);
    else if (k === '--pullback-atr') a.pullbackAtr = num(i++);
    else if (k === '--fixed-pct') a.fixedPct = num(i++);
    else if (k === '--json') a.json = true;
    else throw new Error(`unknown arg ${k}`);
  }
  if (!/^\d{4}-\d{2}$/.test(a.month)) throw new Error(`bad --month ${a.month}`);
  if (!(a.waitH > 0 && a.horizonH > 0 && a.waitH <= a.horizonH)) {
    throw new Error('require 0 < wait-h <= horizon-h');
  }
  return a;
}

function monthBounds(month: string): [number, number] {
  const [y, m] = month.split('-').map(Number);
  return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function multiplierOf(instId: string): number {
  let b = instId.endsWith('USDT') ? instId.slice(0, -4) : instId;
  if (b.startsWith('1000000')) return 1_000_000;
  if (b.startsWith('1M') && b.length > 3) return 1_000_000;
  if (b.startsWith('1000')) return 1000;
  return 1;
}

function volZAt(bars: HourBar[], i: number): number {
  const win = bars.slice(Math.max(0, i - 24), i).map((b) => b.v);
  if (win.length < 8) return 0;
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
  return sd > 0 ? (bars[i].v - mean) / sd : 0;
}

// Production freezes a simple ATR14 from the completed 1H signal bar. This is
// intentionally not a 15m execution-time ATR and is never recomputed while a
// candidate waits.
function hourAtr14At(bars: HourBar[], i: number): number {
  if (i < 14) return NaN;
  let total = 0;
  for (let j = i - 13; j <= i; j++) {
    const b = bars[j];
    const prevClose = bars[j - 1].c;
    total += Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose));
  }
  return total / 14;
}

function alertFlags(d: HourFile, i: number): { rb: boolean; vg: boolean; support: number } {
  const { bars, oi } = d;
  if (i < 52 || i >= oi.length) return { rb: false, vg: false, support: NaN };
  let support = -Infinity;
  for (let j = i - 24; j < i; j++) support = Math.max(support, bars[j].h);
  if (!(support > 0) || !(bars[i].c > support) || volZAt(bars, i) < 1.5) {
    return { rb: false, vg: false, support };
  }
  if (!(oi[i - 4] > 0) || !(oi[i] > 0)) return { rb: false, vg: false, support };
  const oi4h = (oi[i] / oi[i - 4] - 1) * 100;
  if (!(oi4h >= 3)) return { rb: false, vg: false, support };
  let maxOi = 0;
  let maxJ = -1;
  for (let j = i - 48; j <= i; j++) {
    if (oi[j] > maxOi) {
      maxOi = oi[j];
      maxJ = j;
    }
  }
  if (!(maxOi > 0)) return { rb: false, vg: false, support };
  let minAfter = Infinity;
  for (let j = maxJ; j <= i; j++) if (oi[j] > 0) minAfter = Math.min(minAfter, oi[j]);
  const hasFlush = Number.isFinite(minAfter) && minAfter <= maxOi * 0.92;
  const rb = hasFlush;
  const oi24h = oi[i - 24] > 0 ? (oi[i] / oi[i - 24] - 1) * 100 : NaN;
  const vg = !hasFlush && oi24h >= 8;
  return { rb, vg, support };
}

function extractAlerts(d: HourFile, month: string, cooldownH: number): Alert[] {
  const [from, to] = monthBounds(month);
  const out: Alert[] = [];
  let prevRb = false;
  let prevVg = false;
  let lastRb = -Infinity;
  let lastVg = -Infinity;
  for (let i = 0; i < d.bars.length; i++) {
    const f = alertFlags(d, i);
    const knownAt = d.bars[i].t + HOUR_MS;
    const atr = hourAtr14At(d.bars, i);
    if (f.rb && !prevRb && knownAt - lastRb >= cooldownH * HOUR_MS) {
      lastRb = knownAt;
      if (knownAt >= from && knownAt < to) {
        out.push({
          id: `${d.symbol}-rb-${knownAt}`,
          sym: d.symbol,
          instId: d.instId,
          cls: 'rb',
          barT: d.bars[i].t,
          knownAt,
          px: d.bars[i].c,
          support: f.support,
          atr,
        });
      }
    }
    if (f.vg && !prevVg && knownAt - lastVg >= cooldownH * HOUR_MS) {
      lastVg = knownAt;
      if (knownAt >= from && knownAt < to) {
        out.push({
          id: `${d.symbol}-vg-${knownAt}`,
          sym: d.symbol,
          instId: d.instId,
          cls: 'vg',
          barT: d.bars[i].t,
          knownAt,
          px: d.bars[i].c,
          support: f.support,
          atr,
        });
      }
    }
    prevRb = f.rb;
    prevVg = f.vg;
  }
  return out;
}

function parse5mFile(file: string, mult: number): Bar5[] {
  const out: Bar5[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('open_time')) continue;
    const p = line.split(',');
    if (p.length < 8) continue;
    const t = Number(p[0]);
    const o = Number(p[1]) / mult;
    const h = Number(p[2]) / mult;
    const l = Number(p[3]) / mult;
    const c = Number(p[4]) / mult;
    const q = Number(p[7]);
    if (![t, o, h, l, c, q].every(Number.isFinite) || !(c > 0)) continue;
    out.push({ t, o, h, l, c, q });
  }
  return out;
}

function load5m(sym: string, instId: string, month: string): Bar5[] {
  const mult = multiplierOf(instId);
  const rows: Bar5[] = [];
  for (const m of [shiftMonth(month, -1), month, shiftMonth(month, 1)]) {
    const f = path.join(data5Dir, `${sym}-${m}.csv`);
    if (fs.existsSync(f)) rows.push(...parse5mFile(f, mult));
  }
  rows.sort((a, b) => a.t - b.t);
  const dedup: Bar5[] = [];
  for (const b of rows) {
    if (dedup.length && dedup[dedup.length - 1].t === b.t) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  return dedup;
}

function aggregate15(base: Bar5[]): Bar15[] {
  const buckets = new Map<number, Bar5[]>();
  for (const b of base) {
    const k = Math.floor(b.t / MIN15_MS) * MIN15_MS;
    const arr = buckets.get(k) ?? [];
    arr.push(b);
    buckets.set(k, arr);
  }
  const out: Bar15[] = [];
  for (const [t, src] of [...buckets].sort((a, b) => a[0] - b[0])) {
    src.sort((a, b) => a.t - b.t);
    if (
      src.length !== 3 ||
      src[0].t !== t ||
      src[1].t !== t + 300_000 ||
      src[2].t !== t + 600_000
    ) {
      continue;
    }
    out.push({
      t,
      o: src[0].o,
      h: Math.max(...src.map((b) => b.h)),
      l: Math.min(...src.map((b) => b.l)),
      c: src[2].c,
      q: src.reduce((a, b) => a + b.q, 0),
    });
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function lowerBound<T>(xs: T[], value: number, key: (x: T) => number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(xs[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function findEntry(
  method: Method,
  e: JoinedAlert,
  bars: Bar15[],
  e20: number[],
  e50: number[],
  cfg: Config,
): { idx: number | null; terminal: EntryResult['terminal'] } {
  if (method === 'immediate') return { idx: e.startIdx, terminal: 'filled' };
  const minAt = e.knownAt + cfg.minDelayMin * 60_000;
  const expires = e.knownAt + cfg.waitH * HOUR_MS;
  const invalidBelow = e.support - e.atr;
  const missedAbove = e.px * 1.15;
  let peak = e.px;
  let atrTouched = false;
  for (let j = e.startIdx; j < bars.length; j++) {
    const b = bars[j];
    const completedAt = b.t + MIN15_MS;
    // Production evaluates completed bars by their close time. A bar closing
    // at the expiry boundary expires before it can become ready.
    if (completedAt >= expires) return { idx: null, terminal: 'expired' };
    if (method === 'breakout_retest') {
      // Mirror the production candidate ordering: invalid/missed before ready.
      if (b.c < invalidBelow) return { idx: null, terminal: 'invalidated' };
      if (b.h >= missedAbove) return { idx: null, terminal: 'missed' };
    }
    if (completedAt >= minAt) {
      const ema20Prev = j > 0 ? e20[j - 1] : NaN;
      const ema50Prev = j > 0 ? e50[j - 1] : NaN;
      const atrLevel = peak - cfg.pullbackAtr * e.atr;
      if (b.l <= atrLevel) atrTouched = true;
      let ready = false;
      if (method === 'breakout_retest') {
        const lo = e.support - cfg.retestAtr * e.atr;
        const hi = e.support + cfg.retestAtr * e.atr;
        ready = b.h >= lo && b.l <= hi && b.c >= e.support && b.c <= hi;
      } else if (method === 'atr_ema20') {
        ready = atrTouched && Number.isFinite(ema20Prev) && b.l <= ema20Prev && b.c >= ema20Prev;
      } else if (method === 'atr_reclaim') {
        ready = b.l <= atrLevel && b.c >= atrLevel;
      } else if (method === 'fixed') {
        const lvl = peak * (1 - cfg.fixedPct / 100);
        ready = b.l <= lvl && b.c >= lvl;
      } else if (method === 'ema20') {
        ready = Number.isFinite(ema20Prev) && b.l <= ema20Prev && b.c >= ema20Prev;
      } else if (method === 'ema50') {
        ready = Number.isFinite(ema50Prev) && b.l <= ema50Prev && b.c >= ema50Prev;
      }
      if (ready && j + 1 < bars.length && bars[j + 1].t <= expires) {
        return { idx: j + 1, terminal: 'filled' };
      }
    }
    peak = Math.max(peak, b.h); // current high becomes causal only for later bars
  }
  return { idx: null, terminal: 'expired' };
}

function evaluateEntry(
  entryIdx: number,
  e: JoinedAlert,
  bars: Bar15[],
  cfg: Config,
): Omit<EntryResult, 'filled' | 'fillT' | 'fillPx' | 'delayH' | 'discountPct' | 'missed15' | 'terminal'> {
  const entry = bars[entryIdx].o;
  const cutoff = e.knownAt + cfg.horizonH * HOUR_MS;
  const end = lowerBound(bars, cutoff, (b) => b.t) - 1;
  if (end < entryIdx) return { ladderNet: -cfg.costBps / 10_000, target10: false, mfe: 0, mae: 0 };

  let remaining = 1;
  let realized = 0;
  let tp1 = false;
  let tp2 = false;
  let target10 = false;
  let targetDone = false;
  let hi = entry;
  let lo = entry;
  for (let i = entryIdx; i <= end; i++) {
    const b = bars[i];
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    // Stop-first is deliberately conservative when OHLC cannot reveal ordering.
    if (b.l <= entry * 0.97) {
      realized += remaining * -0.03;
      remaining = 0;
    } else {
      if (!tp1 && b.h >= entry * 1.04) {
        realized += 0.5 * 0.04;
        remaining -= 0.5;
        tp1 = true;
      }
      if (!tp2 && b.h >= entry * 1.08) {
        realized += 0.3 * 0.08;
        remaining -= 0.3;
        tp2 = true;
      }
      if (b.h >= entry * 1.15 && remaining > 0) {
        realized += remaining * 0.15;
        remaining = 0;
      }
    }
    if (!targetDone) {
      if (b.l <= entry * 0.95) {
        targetDone = true;
      } else if (b.h >= entry * 1.1) {
        target10 = true;
        targetDone = true;
      }
    }
    if (remaining <= 1e-9 && targetDone) break;
  }
  if (remaining > 1e-9) realized += remaining * (bars[end].c / entry - 1);
  return {
    ladderNet: realized - cfg.costBps / 10_000,
    target10,
    mfe: hi / entry - 1,
    mae: lo / entry - 1,
  };
}

function simulate(
  method: Method,
  e: JoinedAlert,
  bars: Bar15[],
  e20: number[],
  e50: number[],
  cfg: Config,
): EntryResult {
  const found = findEntry(method, e, bars, e20, e50, cfg);
  const waitEnd = e.knownAt + cfg.waitH * HOUR_MS;
  let waitHi = e.px;
  for (let i = e.startIdx; i < bars.length && bars[i].t + MIN15_MS < waitEnd; i++) {
    waitHi = Math.max(waitHi, bars[i].h);
  }
  if (found.idx == null) {
    return {
      filled: false,
      fillT: null,
      fillPx: null,
      delayH: null,
      discountPct: null,
      ladderNet: 0,
      target10: false,
      mfe: null,
      mae: null,
      missed15: waitHi >= e.px * 1.15,
      terminal: found.terminal,
    };
  }
  const fill = bars[found.idx];
  const ev = evaluateEntry(found.idx, e, bars, cfg);
  return {
    filled: true,
    fillT: fill.t,
    fillPx: fill.o,
    delayH: (fill.t - e.knownAt) / HOUR_MS,
    discountPct: (fill.o / e.px - 1) * 100,
    ...ev,
    missed15: false,
    terminal: 'filled',
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function summarize(method: Method, rows: RunRow[], immediate: Map<string, EntryResult>): Summary {
  const rs = rows.filter((r) => r.method === method);
  const fills = rs.filter((r) => r.result.filled);
  const positive = fills.filter((r) => r.result.ladderNet > 0).reduce((a, r) => a + r.result.ladderNet, 0);
  const negative = fills.filter((r) => r.result.ladderNet < 0).reduce((a, r) => a - r.result.ladderNet, 0);
  const hitFill = fills.filter((r) => r.result.target10).length / Math.max(1, fills.length);
  // Matched lift: compare each method only with the immediate outcome of the
  // exact same original alerts that this method filled. Comparing against all
  // alerts would quietly reward a selective method for skipping hard cases.
  const matchedImmediate = fills
    .map((r) => immediate.get(r.alert.id))
    .filter((r): r is EntryResult => r != null);
  const immHits = matchedImmediate.filter((r) => r.target10).length / Math.max(1, matchedImmediate.length);
  const noFills = rs.filter((r) => !r.result.filled);
  const byCoin = new Map<string, number[]>();
  for (const r of rs) {
    const values = byCoin.get(r.alert.sym) ?? [];
    values.push(r.result.ladderNet);
    byCoin.set(r.alert.sym, values);
  }
  const terminals: Summary['terminals'] = { filled: 0, expired: 0, invalidated: 0, missed: 0 };
  rs.forEach((r) => terminals[r.result.terminal]++);
  return {
    method,
    alerts: rs.length,
    fills: fills.length,
    fillRate: fills.length / Math.max(1, rs.length),
    coins: new Set(fills.map((r) => r.alert.sym)).size,
    days: new Set(fills.map((r) => new Date(r.alert.knownAt).toISOString().slice(0, 10))).size,
    netPerAlert: mean(rs.map((r) => r.result.ladderNet)),
    netPerCoin: mean([...byCoin.values()].map(mean)),
    netPerFill: mean(fills.map((r) => r.result.ladderNet)),
    deltaVsImmediate: mean(
      rs.map((r) => r.result.ladderNet - (immediate.get(r.alert.id)?.ladderNet ?? 0)),
    ),
    hit10PerFill: hitFill,
    hit10PerAlert: rs.filter((r) => r.result.target10).length / Math.max(1, rs.length),
    precisionLiftVsImmediate: immHits > 0 ? hitFill / immHits : 0,
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? Infinity : 0,
    meanDelayH: fills.length ? mean(fills.map((r) => r.result.delayH as number)) : null,
    meanDiscountPct: fills.length ? mean(fills.map((r) => r.result.discountPct as number)) : null,
    meanMfe: fills.length ? mean(fills.map((r) => r.result.mfe as number)) : null,
    meanMae: fills.length ? mean(fills.map((r) => r.result.mae as number)) : null,
    missed15RateNoFill: noFills.length ? noFills.filter((r) => r.result.missed15).length / noFills.length : 0,
    terminals,
  };
}

function gate(
  primary: Summary,
  immediate: Summary,
  generic: Summary,
  robust: Summary[],
): { pass: boolean; reasons: string[]; worstRobustLift: number; worstRobustDelta: number } {
  const reasons: string[] = [];
  if (primary.fills < 100) reasons.push(`fills ${primary.fills}<100`);
  if (primary.coins < 40) reasons.push(`coins ${primary.coins}<40`);
  if (primary.days < 20) reasons.push(`days ${primary.days}<20`);
  if (!(primary.netPerAlert > 0)) reasons.push('net/alert <=0');
  if (!(primary.netPerCoin > 0)) reasons.push('coin-weighted net <=0');
  if (!(primary.deltaVsImmediate > 0)) reasons.push('does not beat immediate expectancy');
  if (!(primary.netPerAlert > generic.netPerAlert)) reasons.push('does not beat generic pullback expectancy');
  if (!(primary.precisionLiftVsImmediate >= 1.3)) reasons.push('precision lift <1.30');
  const worstRobustLift = robust.length ? Math.min(...robust.map((s) => s.precisionLiftVsImmediate)) : 0;
  const worstRobustDelta = robust.length ? Math.min(...robust.map((s) => s.deltaVsImmediate)) : 0;
  if (!(worstRobustLift > 1.15)) reasons.push('robustness lift floor <=1.15');
  if (!(worstRobustDelta > 0)) reasons.push('a robustness cell loses to immediate');
  if (!robust.every((s) => s.netPerAlert > 0)) reasons.push('a 24/48h or parameter cell has non-positive event-weighted net');
  if (!robust.every((s) => s.netPerCoin > 0)) reasons.push('a 24/48h or parameter cell has non-positive coin-weighted net');
  if (!(immediate.alerts > 0)) reasons.push('no immediate baseline');
  // A promotion verdict additionally requires out-of-calendar folds and a
  // symbol/date block-bootstrap confidence interval. This cache has only one
  // usable month, so those proofs are explicitly unavailable rather than
  // silently treating the point estimate as a pass.
  reasons.push('calendar-fold evidence unavailable');
  reasons.push('block-bootstrap confidence interval unavailable');
  return { pass: reasons.length === 0, reasons, worstRobustLift, worstRobustDelta };
}

const METHODS: Method[] = [
  'immediate',
  'breakout_retest',
  'atr_ema20',
  'atr_reclaim',
  'fixed',
  'ema20',
  'ema50',
];

const LABEL: Record<Method, string> = {
  immediate: '即時',
  breakout_retest: '破位回踩',
  atr_ema20: 'ATR+EMA20',
  atr_reclaim: 'ATR回吐',
  fixed: '固定回吐',
  ema20: 'EMA20',
  ema50: 'EMA50',
};

async function main(): Promise<void> {
  const cfg = parseArgs();
  if (!fs.existsSync(dataDir) || !fs.existsSync(data5Dir)) throw new Error('backtest cache missing');
  const fiveMinSymbols = new Set<string>();
  const re = new RegExp(`^(.*)-${cfg.month.replace('-', '\\-')}\\.csv$`);
  for (const f of fs.readdirSync(data5Dir)) {
    if (f.includes('-metrics-')) continue;
    const m = f.match(re);
    if (m) fiveMinSymbols.add(m[1]);
  }

  const variants: Array<[string, Partial<Config>]> = [
    ['base', {}],
    ['retest_lo', { retestAtr: cfg.retestAtr * 0.75 }],
    ['retest_hi', { retestAtr: cfg.retestAtr * 1.25 }],
    ['atr_lo', { pullbackAtr: cfg.pullbackAtr * 0.75 }],
    ['atr_hi', { pullbackAtr: cfg.pullbackAtr * 1.25 }],
    ['fixed_lo', { fixedPct: cfg.fixedPct * 0.75 }],
    ['fixed_hi', { fixedPct: cfg.fixedPct * 1.25 }],
    ['wait_12h', { waitH: Math.min(12, cfg.horizonH) }],
    ['wait_36h', { waitH: Math.min(36, cfg.horizonH) }],
    ['horizon_24h', { horizonH: 24, waitH: Math.min(cfg.waitH, 24) }],
  ];
  const runs = new Map<string, Record<SignalClass, RunRow[]>>();
  variants.forEach(([name]) => runs.set(name, { rb: [], vg: [] }));

  const hourlyFiles = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
  const detectedAll = { rb: 0, vg: 0 };
  const detectedJoinable = { rb: 0, vg: 0 };
  const eligible = { rb: 0, vg: 0 };
  let hourlyRead = 0;
  let joinedSymbols = 0;
  let noFollowup = 0;
  let joinMismatch = 0;
  const joinGaps: number[] = [];

  for (const file of hourlyFiles) {
    let d: HourFile;
    try {
      d = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) as HourFile;
    } catch {
      continue;
    }
    if (!d.symbol || !d.instId || !Array.isArray(d.bars) || !Array.isArray(d.oi)) continue;
    hourlyRead++;
    const alerts = extractAlerts(d, cfg.month, cfg.cooldownH);
    alerts.forEach((a) => detectedAll[a.cls]++);
    if (!fiveMinSymbols.has(d.symbol) || !alerts.length) continue;
    alerts.forEach((a) => detectedJoinable[a.cls]++);
    const b5 = load5m(d.symbol, d.instId, cfg.month);
    const b15 = aggregate15(b5);
    if (!b15.length) continue;
    joinedSymbols++;
    const closes = b15.map((b) => b.c);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    for (const raw of alerts) {
      if (cfg.classFilter !== 'all' && raw.cls !== cfg.classFilter) continue;
      const startIdx = lowerBound(b15, raw.knownAt, (b) => b.t);
      const cutoff = raw.knownAt + cfg.horizonH * HOUR_MS;
      if (startIdx >= b15.length || b15[b15.length - 1].t < cutoff - MIN15_MS) {
        noFollowup++;
        continue;
      }
      if (!(raw.atr > 0) || raw.atr >= raw.support) {
        noFollowup++;
        continue;
      }
      const gap = Math.abs(b15[startIdx].o / raw.px - 1) * 100;
      if (gap > 5) {
        joinMismatch++;
        continue;
      }
      joinGaps.push(gap);
      const alert: JoinedAlert = { ...raw, startIdx, joinGapPct: gap };
      eligible[alert.cls]++;
      for (const [variant, patch] of variants) {
        const vc = { ...cfg, ...patch };
        const target = runs.get(variant)![alert.cls];
        for (const method of METHODS) {
          target.push({ alert, method, result: simulate(method, alert, b15, e20, e50, vc) });
        }
      }
    }
  }

  const selectedClasses: SignalClass[] = cfg.classFilter === 'all' ? ['rb', 'vg'] : [cfg.classFilter];
  const output: any = {
    params: cfg,
    data: {
      hourlyFiles: hourlyRead,
      fiveMinSymbols: fiveMinSymbols.size,
      joinedSymbols,
      detectedAll,
      detectedJoinable,
      eligible,
      noFollowup,
      joinMismatch,
      meanJoinGapPct: mean(joinGaps),
      maxJoinGapPct: joinGaps.length ? Math.max(...joinGaps) : 0,
      note: 'Initial events use cached 1H OI; 5m Vision metrics are not used.',
    },
    classes: {},
  };

  for (const cls of selectedClasses) {
    const baseRows = runs.get('base')![cls];
    const immediateMap = new Map(
      baseRows.filter((r) => r.method === 'immediate').map((r) => [r.alert.id, r.result]),
    );
    const baseSummaries = Object.fromEntries(
      METHODS.map((m) => [m, summarize(m, baseRows, immediateMap)]),
    ) as Record<Method, Summary>;
    const variantSummaries: Record<string, Record<string, Summary>> = {};
    for (const [name] of variants) {
      if (name === 'base') continue;
      const rows = runs.get(name)![cls];
      const imm = new Map(
        rows.filter((r) => r.method === 'immediate').map((r) => [r.alert.id, r.result]),
      );
      variantSummaries[name] = {
        breakout_retest: summarize('breakout_retest', rows, imm),
        atr_ema20: summarize('atr_ema20', rows, imm),
        fixed: summarize('fixed', rows, imm),
      };
    }
    const primaryRobust = ['retest_lo', 'retest_hi', 'wait_12h', 'wait_36h', 'horizon_24h'].map(
      (n) => variantSummaries[n].breakout_retest,
    );
    const secondaryRobust = ['atr_lo', 'atr_hi', 'wait_12h', 'wait_36h', 'horizon_24h'].map(
      (n) => variantSummaries[n].atr_ema20,
    );
    const primaryGate = gate(
      baseSummaries.breakout_retest,
      baseSummaries.immediate,
      baseSummaries.fixed,
      primaryRobust,
    );
    const secondaryGate = gate(
      baseSummaries.atr_ema20,
      baseSummaries.immediate,
      baseSummaries.atr_reclaim,
      secondaryRobust,
    );
    output.classes[cls] = {
      summaries: baseSummaries,
      gates: { breakout_retest: primaryGate, atr_ema20: secondaryGate },
      robustness: variantSummaries,
    };
  }

  if (cfg.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`\n=== post-TG entry watch — ${cfg.month} ===`);
  console.log(
    `1H files ${hourlyRead} · 5m symbols ${fiveMinSymbols.size} · joined ${joinedSymbols} · ` +
      `events all rb=${detectedAll.rb}/vg=${detectedAll.vg} · eligible rb=${eligible.rb}/vg=${eligible.vg}`,
  );
  console.log(
    `alignment mean ${mean(joinGaps).toFixed(3)}% / max ${(joinGaps.length ? Math.max(...joinGaps) : 0).toFixed(3)}% · ` +
      `no ${cfg.horizonH}h follow-up ${noFollowup} · mismatch>5% ${joinMismatch}`,
  );
  console.log(
    `entry wait ${cfg.waitH}h · horizon signal+${cfg.horizonH}h · min delay ${cfg.minDelayMin}m · ` +
      `cost ${cfg.costBps}bps · ATR=frozen completed-1H ATR14`,
  );
  for (const cls of selectedClasses) {
    const c = output.classes[cls];
    console.log(`\n[${cls === 'rb' ? '增 R1' : '擴 V2'}] ${eligible[cls]} eligible alert(s)`);
    console.log('method       fills  rate  coins days  net/alert net/coin  Δimmed   hit10/fill lift   PF   delay  discount  missed');
    for (const m of METHODS) {
      const s = c.summaries[m] as Summary;
      const pf = Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf';
      const delay = s.meanDelayH == null ? '—' : `${s.meanDelayH.toFixed(1)}h`;
      const discount = s.meanDiscountPct == null ? '—' : `${s.meanDiscountPct.toFixed(1)}%`;
      console.log(
        `${LABEL[m].padEnd(12)} ${String(s.fills).padStart(4)}  ${(s.fillRate * 100).toFixed(0).padStart(3)}%  ` +
          `${String(s.coins).padStart(5)} ${String(s.days).padStart(4)}  ${(s.netPerAlert * 100).toFixed(2).padStart(8)}%  ` +
          `${(s.netPerCoin * 100).toFixed(2).padStart(7)}%  ` +
          `${(s.deltaVsImmediate * 100).toFixed(2).padStart(7)}%  ${(s.hit10PerFill * 100).toFixed(0).padStart(5)}%  ` +
          `${s.precisionLiftVsImmediate.toFixed(2).padStart(4)}  ${pf.padStart(4)}  ${delay.padStart(6)}  ` +
          `${discount.padStart(8)}  ${(s.missed15RateNoFill * 100).toFixed(0).padStart(3)}%`,
      );
    }
    for (const [name, g] of Object.entries(c.gates) as Array<[string, ReturnType<typeof gate>]>) {
      console.log(
        `gate ${name}: ${g.pass ? 'PASS' : 'FAIL/INCONCLUSIVE'} · worst robust lift ${g.worstRobustLift.toFixed(2)} · ` +
          `worst Δimmed ${(g.worstRobustDelta * 100).toFixed(2)}%` +
          (g.reasons.length ? ` · ${g.reasons.join('; ')}` : ''),
      );
    }
  }
  console.log('\nCaveat: gate is historical/internal only; no untouched future-month confirmation is present.');
}

void main();
