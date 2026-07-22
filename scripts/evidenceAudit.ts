import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Candle, Coin, SeriesPoint, VolumeBar } from '../src/types';
import { computeStrengthSeries, detectEarlyPump, detectEarlySetup, detectFlushBreakout } from '../src/lib/analyze';
import { evaluateBoardingB2, evaluateEma20ReclaimControl } from '../src/lib/boardingB2';
import { aggregateCandles, aggregateLast, aggregateVolume } from '../src/lib/aggregate';
import { distTopSignals, rebuildSignals, spotSignals, squeezeSignals, virginSignals, wbottomSignals } from '../src/lib/interpret';
import { hashString, mulberry32 } from '../src/lib/prng';
import { parseUmSymbol } from '../src/data/binance';
import {
  armDeepReclaim,
  detectDeepReclaimPriceCandidate,
  observeDeepReclaim,
  type DeepReclaimBar,
  type DeepReclaimOiObservation,
  type DeepReclaimWatch,
} from '../src/lib/deepReclaim';
import { createEntryWatchCandidate, observeEntryWatch } from '../src/lib/entryWatch';
import type { EvidenceRemediationFeatures } from '../src/lib/evidenceRemediation';
import type {
  DatasetCoverage,
  EvidenceAuditReport,
  EvidenceCapability,
  EvidenceItem,
  EvidenceManifest,
  HistoricalGateResult,
  HorizonResult,
  MonthlyUniverseMember,
} from './evidenceTypes';
import { sha256, stableJson } from './evidenceCache';

const BAR5 = 5 * 60_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const COST = 0.003;
const TARGETS = [10, 15] as const;
const HORIZONS = [24, 48] as const;

export interface AuditConfig {
  root: string;
  months: string[];
  offline: true;
  outputJson: string;
  outputMarkdown: string;
  maxCoinMonths: number;
  writeOutputs?: boolean;
  captureResearch?: (collection: EvidenceResearchCollection) => void;
}

export interface Bar5 {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  q: number;
  tq: number;
}

export interface MetricPoint {
  t: number;
  qty: number;
  usd: number;
  ls: number;
  topAccountLs: number;
  topPositionLs: number;
  takerRatio: number;
}

export interface FundingPoint { t: number; rate: number }
type Side = 'long' | 'short';

export type EvidenceResearchFeatures = EvidenceRemediationFeatures;

export interface EvalEvent {
  key: string;
  label: string;
  sym: string;
  month: string;
  decisionTs: number;
  side: Side;
  bars?: Bar5[];
  funding?: FundingPoint[];
  outcomes?: Outcome[];
  research?: EvidenceResearchFeatures;
}

export interface EvidenceResearchCollection {
  events: EvalEvent[];
  controls: EvalEvent[];
  coverage: number;
  spotCoverage: number;
}

interface Outcome {
  key: string;
  sym: string;
  month: string;
  day: string;
  decisionTs: number;
  side: Side;
  target: number;
  horizon: number;
  complete: boolean;
  hit: boolean;
  ret: number | null;
  net: number | null;
}

export interface DetectorDef { key: string; label: string; side: Side; matchedKey: string }

export const EVIDENCE_DETECTORS: DetectorDef[] = [
  { key: 'flush-breakout', label: '⚡ 縮倉突破', side: 'long', matchedKey: 'breakout' },
  { key: 'early-setup', label: '蓄 早期累積 setup', side: 'long', matchedKey: 'early-setup-envelope' },
  { key: 'squeeze-d3', label: 'D3 squeeze breakout', side: 'long', matchedKey: 'breakout' },
  { key: 'boarding-b2', label: 'B2 EMA20 reclaim', side: 'long', matchedKey: 'ema-reclaim' },
  { key: 'rebuild-r1', label: 'R1 增倉突破', side: 'long', matchedKey: 'breakout' },
  { key: 'rebuild-r2', label: 'R2 淨增倉', side: 'long', matchedKey: 'breakout' },
  { key: 'rebuild-r3', label: 'R3 funding-cap rebuild', side: 'long', matchedKey: 'breakout' },
  { key: 'virgin-v1', label: 'V1 處女擴張', side: 'long', matchedKey: 'breakout' },
  { key: 'virgin-v2', label: 'V2 處女增倉突破', side: 'long', matchedKey: 'breakout' },
  { key: 'virgin-v3', label: 'V3 funding-cap virgin', side: 'long', matchedKey: 'breakout' },
  { key: 'top-t1', label: 'S10 T1 雙頂拒絕', side: 'short', matchedKey: 'top-envelope' },
  { key: 'top-t2', label: 'S10 T2 新高背離', side: 'short', matchedKey: 'top-envelope' },
  { key: 'top-t3', label: 'S10 T3 climax rejection', side: 'short', matchedKey: 'top-envelope' },
  { key: 'top-t4', label: 'S10 T4 funding stall', side: 'short', matchedKey: 'top-envelope' },
  { key: 'wbottom-w1', label: 'S11 W1 雙底', side: 'long', matchedKey: 'w-envelope' },
  { key: 'wbottom-w2', label: 'S11 W2 spring', side: 'long', matchedKey: 'w-envelope' },
  { key: 'wbottom-w3', label: 'S11 W3 OI-confirmed', side: 'long', matchedKey: 'w-envelope' },
  { key: 'early-pump', label: 'S14 early pump', side: 'long', matchedKey: 'early-envelope' },
  { key: 'spot-pump', label: 'Spot pump', side: 'long', matchedKey: 'spot-momentum' },
  { key: 'spot-accum', label: 'Spot accumulation', side: 'long', matchedKey: 'spot-flat' },
  { key: 'organic-spot', label: 'Organic spot proxy', side: 'long', matchedKey: 'spot-momentum' },
  { key: 'leverage-froth', label: 'Leverage froth control', side: 'long', matchedKey: 'spot-momentum' },
  { key: 'true-spot-led', label: 'True spot-led', side: 'long', matchedKey: 'spot-momentum' },
  { key: 'umm-ema-control', label: 'UMM EMA20 reclaim control', side: 'long', matchedKey: 'all' },
  { key: 'umm-b2', label: 'UMM B2', side: 'long', matchedKey: 'ema-reclaim' },
  { key: 'umm-b2-oi', label: 'UMM B2 quantity-OI challenger', side: 'long', matchedKey: 'ema-reclaim' },
  { key: 'deep-reclaim-armed', label: 'S15 deep reclaim quantity-OI armed', side: 'long', matchedKey: 'deep-price-only' },
  { key: 'deep-reclaim-confirmed', label: 'S15 deep reclaim confirmed', side: 'long', matchedKey: 'deep-price-only' },
  { key: 'entry-watch-r1', label: 'Entry-watch R1 breakout retest', side: 'long', matchedKey: 'entry-r1-immediate' },
  { key: 'entry-watch-v2', label: 'Entry-watch V2 breakout retest', side: 'long', matchedKey: 'entry-v2-immediate' },
];

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function monthStart(month: string): number { return Date.parse(`${month}-01T00:00:00Z`); }
function monthEnd(month: string): number { return monthStart(nextMonth(month)); }

function readLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

function parseKlines(files: string[], mult: number, cache?: Map<string, Bar5[]>): Bar5[] {
  const byTs = new Map<number, Bar5>();
  for (const file of files) {
    const key = `${file}:${mult}`;
    let rows = cache?.get(key);
    if (!rows) {
      const fileRows = new Map<number, Bar5>();
      for (const line of readLines(file)) {
        const p = line.split(',');
        let t = Number(p[0]);
        if (t > 10_000_000_000_000) t = Math.floor(t / 1000);
        const nums = [t, ...[1, 2, 3, 4, 7, 10].map((i) => Number(p[i]))];
        if (!nums.every(Number.isFinite)) continue;
        fileRows.set(t, { t, o: nums[1] / mult, h: nums[2] / mult, l: nums[3] / mult, c: nums[4] / mult, q: nums[5], tq: nums[6] });
      }
      rows = [...fileRows.values()].sort((a, b) => a.t - b.t);
      cache?.set(key, rows);
    }
    for (const row of rows) byTs.set(row.t, row);
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

export function parseMetricsText(csv: string): MetricPoint[] {
  const byTs = new Map<number, MetricPoint>();
  for (const line of csv.split(/\r?\n/).filter(Boolean)) {
    const p = line.split(',');
    const t = Date.parse(`${p[0]?.trim().replace(' ', 'T')}Z`);
    const values = [2, 3, 4, 5, 6, 7].map((i) => Number(p[i]));
    if (!Number.isFinite(t) || !values.every(Number.isFinite) || !(values[0] > 0) || !(values[1] > 0)) continue;
    byTs.set(t, { t, qty: values[0], usd: values[1], topAccountLs: values[2], topPositionLs: values[3], ls: values[4], takerRatio: values[5] });
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

function parseMetrics(files: string[], cache?: Map<string, MetricPoint[]>): MetricPoint[] {
  const byTs = new Map<number, MetricPoint>();
  for (const file of files) {
    let rows = cache?.get(file);
    if (!rows) {
      rows = parseMetricsText(fs.readFileSync(file, 'utf8'));
      cache?.set(file, rows);
    }
    for (const row of rows) byTs.set(row.t, row);
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

export function parseFundingText(csv: string): FundingPoint[] {
  const byTs = new Map<number, FundingPoint>();
  for (const line of csv.split(/\r?\n/).filter(Boolean)) {
    const p = line.split(',');
    const t = Number(p[0]);
    const rate = Number(p[2]);
    if (Number.isFinite(t) && Number.isFinite(rate)) byTs.set(t, { t, rate });
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

function parseFunding(files: string[], cache?: Map<string, FundingPoint[]>): FundingPoint[] {
  const byTs = new Map<number, FundingPoint>();
  for (const file of files) {
    let rows = cache?.get(file);
    if (!rows) {
      rows = parseFundingText(fs.readFileSync(file, 'utf8'));
      cache?.set(file, rows);
    }
    for (const row of rows) byTs.set(row.t, row);
  }
  return [...byTs.values()].sort((a, b) => a.t - b.t);
}

const verifiedCacheFiles = new Map<string, string>();

function checkedFile(root: string, artifact: DatasetCoverage | undefined): string | null {
  if (!artifact?.relativePath || !artifact.cacheSha256 || (artifact.status !== 'complete' && artifact.status !== 'partial')) return null;
  const file = path.join(root, artifact.relativePath);
  if (!fs.existsSync(file)) throw new Error(`cache file missing: ${artifact.relativePath}`);
  const actual = verifiedCacheFiles.get(file) ?? sha256(fs.readFileSync(file));
  if (actual !== artifact.cacheSha256) throw new Error(`cache corruption: ${artifact.relativePath}`);
  verifiedCacheFiles.set(file, actual);
  return file;
}

function aggregateHour(rows: Bar5[]): Bar5[] {
  const buckets = new Map<number, Bar5[]>();
  for (const row of rows) {
    const bucket = Math.floor(row.t / HOUR) * HOUR;
    const xs = buckets.get(bucket) ?? [];
    xs.push(row);
    buckets.set(bucket, xs);
  }
  const out: Bar5[] = [];
  for (const [bucket, xs] of [...buckets].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a.t - b.t);
    if (xs.length !== 12 || xs.some((x, j) => x.t !== bucket + j * BAR5)) continue;
    out.push({ t: bucket, o: xs[0].o, h: Math.max(...xs.map((x) => x.h)), l: Math.min(...xs.map((x) => x.l)), c: xs[11].c, q: xs.reduce((a, x) => a + x.q, 0), tq: xs.reduce((a, x) => a + x.tq, 0) });
  }
  return out;
}

function aggregate15(rows: Bar5[]): DeepReclaimBar[] {
  const width = 15 * 60_000;
  const buckets = new Map<number, Bar5[]>();
  for (const row of rows) {
    const bucket = Math.floor(row.t / width) * width;
    const xs = buckets.get(bucket) ?? [];
    xs.push(row);
    buckets.set(bucket, xs);
  }
  const out: DeepReclaimBar[] = [];
  for (const [bucket, xs] of [...buckets].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a.t - b.t);
    if (xs.length !== 3 || xs.some((x, j) => x.t !== bucket + j * BAR5)) continue;
    out.push({ closeTs: bucket + width, open: xs[0].o, high: Math.max(...xs.map((x) => x.h)), low: Math.min(...xs.map((x) => x.l)), close: xs[2].c });
  }
  return out;
}

export function asOf<T extends { t: number }>(xs: T[], ts: number, maxAge = 10 * 60_000): T | null {
  let lo = 0;
  let hi = xs.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid].t <= ts) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return hit >= 0 && ts - xs[hit].t <= maxAge ? xs[hit] : null;
}

function toSeries(rows: Bar5[], metrics: MetricPoint[], funding: FundingPoint[]): {
  candles: Candle[]; volume: VolumeBar[]; oiUsd: SeriesPoint[]; fundingPct: SeriesPoint[]; metricAt: Array<MetricPoint | null>;
} {
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  const oiUsd: SeriesPoint[] = [];
  const fundingPct: SeriesPoint[] = [];
  const metricAt: Array<MetricPoint | null> = [];
  let fundingCursor = 0;
  let currentFunding = NaN;
  for (const b of rows) {
    const closeTs = b.t + BAR5;
    while (fundingCursor < funding.length && funding[fundingCursor].t <= closeTs) currentFunding = funding[fundingCursor++].rate * 100;
    const m = asOf(metrics, closeTs);
    candles.push({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c });
    volume.push({ time: b.t / 1000, value: b.q, up: b.c >= b.o, takerBuy: b.tq });
    oiUsd.push({ time: b.t / 1000, value: m?.usd ?? NaN });
    fundingPct.push({ time: b.t / 1000, value: currentFunding });
    metricAt.push(m);
  }
  return { candles, volume, oiUsd, fundingPct, metricAt };
}

function volZ(rows: Bar5[], i: number, win = 24): number {
  const xs = rows.slice(Math.max(0, i - win), i).map((x) => x.q);
  if (xs.length < 8) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return sd > 0 ? (rows[i].q - m) / sd : 0;
}

function ema(xs: number[], period: number): number[] {
  const out = new Array(xs.length).fill(NaN);
  if (xs.length < period) return out;
  let e = xs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  const k = 2 / (period + 1);
  for (let i = period; i < xs.length; i++) out[i] = e = xs[i] * k + e * (1 - k);
  return out;
}

function breakoutEnvelope(h1: Bar5[], i: number): boolean {
  if (i < 25 || volZ(h1, i) < 1.5) return false;
  return h1[i].c > Math.max(...h1.slice(i - 24, i).map((x) => x.h));
}

function topEnvelope(h1: Bar5[], i: number): boolean {
  if (i < 25 || (h1[i].c / h1[i - 24].c - 1) * 100 < 15 || volZ(h1, i) < 1.5) return false;
  const w = h1.slice(i - 23, i + 1);
  const lo = Math.min(...w.map((x) => x.l));
  const hi = Math.max(...w.map((x) => x.h));
  return hi > lo && (h1[i].c - lo) / (hi - lo) >= 0.8;
}

function wEnvelope(h1: Bar5[], i: number): boolean {
  return i >= 24 && (h1[i].c / h1[i - 24].c - 1) * 100 >= 10;
}

export function earlySetupEnvelope(h1: Bar5[], usdOi: number[], fundingPct: number[], i: number): boolean {
  if (i < 48 || !Number.isFinite(usdOi[i]) || !Number.isFinite(fundingPct[i])) return false;
  const mx = Math.max(...usdOi.slice(i - 47, i + 1).filter(Number.isFinite));
  if (!(mx > 0) || usdOi[i] > mx * .92 || !(usdOi[i] > usdOi[i - 6] * 1.005) || Math.abs(fundingPct[i]) > .01) return false;
  const closes = h1.slice(i - 24, i).map((x) => x.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  return lo > 0 && (hi / lo - 1) * 100 <= 6;
}

export function squeezeD3Series(h1: Bar5[], usdOi: number[], fundingPct: number[]): { setup: boolean[]; breakout: boolean[] } {
  const n = h1.length;
  const setup = new Array(n).fill(false);
  const breakout = new Array(n).fill(false);
  const squeezed = new Array(n).fill(false);
  for (let i = 20; i < n; i++) {
    const w = h1.slice(i - 19, i + 1);
    const m = w.reduce((a, x) => a + x.c, 0) / 20;
    if (!(m > 0)) continue;
    let variance = 0;
    let tr = 0;
    for (let k = i - 19; k <= i; k++) {
      variance += (h1[k].c - m) ** 2;
      const prev = h1[k - 1].c;
      tr += Math.max(h1[k].h - h1[k].l, Math.abs(h1[k].h - prev), Math.abs(h1[k].l - prev));
    }
    const bw = 4 * Math.sqrt(variance / 20) / m;
    const atrN = tr / 20 / m;
    squeezed[i] = atrN > 0 && bw <= 3 * atrN;
    if (!squeezed[i]) continue;
    if (fundingPct[i] <= 0) setup[i] = true;
    else if (i >= 4 && usdOi[i - 4] > 0 && usdOi[i] / usdOi[i - 4] - 1 >= 0) {
      const v = h1.slice(i - 3, i + 1);
      const total = v.reduce((a, x) => a + x.q, 0);
      setup[i] = total > 0 && v.filter((x) => x.c >= x.o).reduce((a, x) => a + x.q, 0) / total >= .5;
    }
  }
  for (let i = 21; i < n; i++) {
    let first = -1;
    for (let j = Math.max(20, i - 6); j < i; j++) if (setup[j]) { first = j; break; }
    if (first >= 0 && h1[i].c > Math.max(...h1.slice(first, i).map((x) => x.h)) && volZ(h1, i) >= 1.5) breakout[i] = true;
  }
  return { setup, breakout };
}

export function fastBoardingFlags(h1: Bar5[], i: number, cachedE20?: number[], cachedE50?: number[]): { control: boolean; b2: boolean } {
  if (i < 52) return { control: false, b2: false };
  const closes = h1.map((x) => x.c);
  const e20 = cachedE20 ?? ema(closes, 20);
  const e50 = cachedE50 ?? ema(closes, 50);
  if (!(h1[i].c > e20[i] && h1[i - 1].c <= e20[i - 1]) || volZ(h1, i) < 1.5) return { control: false, b2: false };
  const ret4 = (h1[i].c / h1[i - 4].c - 1) * 100;
  const w = h1.slice(i - 23, i + 1);
  const lo = Math.min(...w.map((x) => x.l));
  const hi = Math.max(...w.map((x) => x.h));
  const pos24 = hi > lo ? (h1[i].c - lo) / (hi - lo) : .5;
  const control = ret4 <= 6 && pos24 <= .7;
  if (!control || i < 98) return { control, b2: false };
  for (let j = i - 48; j < i; j++) if (!(h1[j].c < e50[j])) return { control, b2: false };
  return { control, b2: true };
}

function spotFacts(fut: Bar5[], spotByTs: Map<number, Bar5>, i: number, metric: MetricPoint | null): {
  present: boolean; ret4: number; basis: number; volZ: number; volRatio: number; buy4: number; buy24: number; spot24: number; perp24: number; oi4: number;
} | null {
  if (i < 48 || !metric) return null;
  const s = spotByTs.get(fut[i].t);
  const s4 = spotByTs.get(fut[i - 4].t);
  if (!s || !s4) return null;
  const sw = fut.slice(i - 48, i + 1).map((x) => spotByTs.get(x.t));
  if (sw.some((x) => !x)) return null;
  const spots = sw as Bar5[];
  const prior = spots.slice(-25, -1).map((x) => x.q);
  const m = prior.reduce((a, b) => a + b, 0) / prior.length;
  const sd = Math.sqrt(prior.reduce((a, b) => a + (b - m) ** 2, 0) / prior.length);
  const recent8 = spots.slice(-8).reduce((a, x) => a + x.q, 0) / 8;
  const prior40 = spots.slice(0, 40).reduce((a, x) => a + x.q, 0) / 40;
  const buy4Den = spots.slice(-4).reduce((a, x) => a + x.q, 0);
  const buy24Den = spots.slice(-24).reduce((a, x) => a + x.q, 0);
  const oldMetric = null; // caller computes quantity OI from its aligned series.
  void oldMetric;
  return {
    present: true,
    ret4: (fut[i].c / fut[i - 4].c - 1) * 100,
    basis: (fut[i].c / s.c - 1) * 100,
    volZ: sd > 0 ? (s.q - m) / sd : 0,
    volRatio: prior40 > 0 ? recent8 / prior40 : 0,
    buy4: buy4Den > 0 ? spots.slice(-4).reduce((a, x) => a + x.tq, 0) / buy4Den : 0,
    buy24: buy24Den > 0 ? spots.slice(-24).reduce((a, x) => a + x.tq, 0) / buy24Den : 0,
    spot24: spots.slice(-24).reduce((a, x) => a + x.q, 0),
    perp24: fut.slice(i - 23, i + 1).reduce((a, x) => a + x.q, 0),
    oi4: NaN,
  };
}

function makeCoin(
  sym: string,
  rows: Bar5[],
  series: ReturnType<typeof toSeries>,
  end: number,
  oi4h: number,
  spotByTs: Map<number, Bar5>,
): Coin {
  const start = Math.max(0, end - 575);
  const candles = series.candles.slice(start, end + 1);
  const volume = series.volume.slice(start, end + 1);
  const oi = series.oiUsd.slice(start, end + 1);
  const fundingHist = series.fundingPct.slice(start, end + 1);
  const strengthHist = candles.map((x) => ({ time: x.time, value: 50 }));
  const selectedSpot = rows.slice(start, end + 1).map((x) => spotByTs.get(x.t));
  const hasSpot = selectedSpot.length === candles.length && selectedSpot.every(Boolean);
  const spot = hasSpot ? selectedSpot as Bar5[] : [];
  const spotCandles: Candle[] | undefined = hasSpot ? spot.map((x) => ({ time: x.t / 1000, open: x.o, high: x.h, low: x.l, close: x.c })) : undefined;
  const spotVolume: VolumeBar[] | undefined = hasSpot ? spot.map((x) => ({ time: x.t / 1000, value: x.q, up: x.c >= x.o, takerBuy: x.tq })) : undefined;
  const spot24 = spot.slice(-288);
  const spotQ = spot24.reduce((a, x) => a + x.q, 0);
  const basisPct = hasSpot && spot.at(-1)!.c > 0 ? (rows[end].c / spot.at(-1)!.c - 1) * 100 : null;
  return {
    symbol: sym,
    regime: 'accumulate',
    strength: 50,
    change1h: end >= 12 ? (rows[end].c / rows[end - 12].c - 1) * 100 : 0,
    oi4h,
    oiTrusted: Number.isFinite(oi4h),
    funding: fundingHist.at(-1)?.value ?? NaN,
    volZ: 0,
    vol24h: rows.slice(Math.max(0, end - 287), end + 1).reduce((a, x) => a + x.q, 0),
    flushBreakout: false,
    earlyAccum: null,
    riskFlags: [],
    signals: { fundsFirst: false, mildRise: false, oiHealthy: false, buyHealthy: false },
    plan: { entry: rows[end].c, kind: 'breakout', tp1: rows[end].c, tp2: rows[end].c, tp3: rows[end].c, sl: rows[end].c, runnerPct: 0 },
    candles, volume, oi, fundingHist, strengthHist,
    ...(hasSpot ? {
      spotCandles,
      spotVolume,
      spotTakerBuyShare24h: spotQ > 0 ? spot24.reduce((a, x) => a + x.tq, 0) / spotQ : null,
      basisPct,
      spotVol24h: spotQ,
    } : {}),
  };
}

export function addWithCooldown(
  out: EvalEvent[],
  last: Map<string, number>,
  event: EvalEvent,
  cooldownMs = DAY,
): void {
  const k = `${event.key}:${event.sym}`;
  if (event.decisionTs - (last.get(k) ?? -Infinity) < cooldownMs) return;
  out.push(event);
  last.set(k, event.decisionTs);
}

function addCompactWithCooldown(
  out: EvalEvent[],
  last: Map<string, number>,
  event: EvalEvent,
  cooldownMs = DAY,
): boolean {
  const k = `${event.key}:${event.sym}`;
  if (event.decisionTs - (last.get(k) ?? -Infinity) < cooldownMs) return false;
  out.push(compactEvent(event));
  last.set(k, event.decisionTs);
  return true;
}

function eventFor(
  def: DetectorDef,
  member: MonthlyUniverseMember,
  ts: number,
  bars: Bar5[],
  funding: FundingPoint[],
  research?: EvidenceResearchFeatures,
): EvalEvent {
  return { key: def.key, label: def.label, sym: member.base, month: member.month, decisionTs: ts, side: def.side, bars, funding, research };
}

interface RankRow { score: number; event: EvalEvent }

function evaluateCoinMonth(
  member: MonthlyUniverseMember,
  bars: Bar5[],
  metrics: MetricPoint[],
  funding: FundingPoint[],
  spot: Bar5[],
  btcClose: Map<number, number>,
  events: EvalEvent[],
  controls: EvalEvent[],
  ranks: Map<number, RankRow[]>,
  lastFire: Map<string, number>,
  lastControl: Map<string, number>,
): { eligible: number; expected: number; spotEligible: number } {
  const series = toSeries(bars, metrics, funding);
  const strength = computeStrengthSeries(series.candles, series.volume, series.oiUsd, series.fundingPct);
  const h1 = aggregateHour(bars);
  const h1ByOpen = new Map(h1.map((x, i) => [x.t, i]));
  const barIndex = new Map(bars.map((x, i) => [x.t, i]));
  const spotH1 = aggregateHour(spot);
  const spotByTs = new Map(spotH1.map((x) => [x.t, x]));
  const spotBy5Ts = new Map(spot.map((x) => [x.t, x]));
  const h1Metric = h1.map((x) => asOf(metrics, x.t + HOUR));
  const h1Usd = h1Metric.map((x) => x?.usd ?? NaN);
  const h1Funding = h1.map((x) => (asOf(funding, x.t + HOUR, 12 * HOUR)?.rate ?? NaN) * 100);
  const h1Closes = h1.map((x) => x.c);
  const h1E20 = ema(h1Closes, 20);
  const h1E50 = ema(h1Closes, 50);
  const squeeze = squeezeD3Series(h1, h1Usd, h1Funding);
  const monthFrom = monthStart(member.month);
  const monthTo = monthEnd(member.month);
  const defs = new Map(EVIDENCE_DETECTORS.map((x) => [x.key, x]));
  let eligible = 0;
  let expected = 0;
  let spotEligible = 0;
  let strengthWasHigh = false;
  let strengthStateKnown = false;
  let previousEntryR1 = false;
  let previousEntryV2 = false;
  let entryStateKnown = false;
  for (const hb of h1) {
    const decisionTs = hb.t + HOUR;
    if (decisionTs < monthFrom || decisionTs >= monthTo) continue;
    expected++;
    const i5 = barIndex.get(hb.t + 55 * 60_000);
    const i1 = h1ByOpen.get(hb.t)!;
    if (i5 == null || i5 < 575 || i1 < 100) continue;
    const currentMetric = h1Metric[i1];
    const refMetric = asOf(metrics, decisionTs - 4 * HOUR);
    const currentFunding = asOf(funding, decisionTs, 12 * HOUR);
    if (!currentMetric || !refMetric || !currentFunding || !(refMetric.qty > 0)) continue;
    eligible++;
    const oi4h = (currentMetric.qty / refMetric.qty - 1) * 100;
    const prior24 = h1.slice(i1 - 24, i1);
    const range24 = h1.slice(i1 - 23, i1 + 1);
    const avgVolume24 = mean(prior24.map((x) => x.q));
    const rangeHigh24 = Math.max(...range24.map((x) => x.h));
    const rangeLow24 = Math.min(...range24.map((x) => x.l));
    const btcNowForResearch = btcClose.get(hb.t);
    const btcOldForResearch = btcClose.get(hb.t - DAY);
    const research: EvidenceResearchFeatures = {
      assetRet1h: finiteOrNull(hb.c / h1[i1 - 1].c - 1),
      assetRet4h: finiteOrNull(hb.c / h1[i1 - 4].c - 1),
      assetRet24h: finiteOrNull(hb.c / h1[i1 - 24].c - 1),
      btcRet24h: finiteOrNull(btcNowForResearch && btcOldForResearch ? btcNowForResearch / btcOldForResearch - 1 : NaN),
      oi4h: finiteOrNull(oi4h / 100),
      fundingRate: finiteOrNull(currentFunding.rate),
      takerBuy1h: finiteOrNull(hb.q > 0 ? hb.tq / hb.q : NaN),
      volumeRatio24h: finiteOrNull(avgVolume24 && avgVolume24 > 0 ? hb.q / avgVolume24 : NaN),
      rangePos24h: finiteOrNull(rangeHigh24 > rangeLow24 ? (hb.c - rangeLow24) / (rangeHigh24 - rangeLow24) : NaN),
      strength: finiteOrNull(strength[i5]?.value ?? NaN),
    };
    let coinMemo: Coin | null = null;
    const coin = () => coinMemo ??= makeCoin(member.base, bars, series, i5, oi4h, spotBy5Ts);
    if (!entryStateKnown) {
      const priorMetric = asOf(metrics, decisionTs - HOUR);
      const priorRef = asOf(metrics, decisionTs - 5 * HOUR);
      const priorEnd = i5 - 12;
      if (i1 > 0 && priorEnd >= 575 && priorMetric && priorRef && priorRef.qty > 0 && breakoutEnvelope(h1, i1 - 1)) {
        const priorCoin = makeCoin(member.base, bars, series, priorEnd, (priorMetric.qty / priorRef.qty - 1) * 100, spotBy5Ts);
        previousEntryR1 = rebuildSignals(priorCoin)?.[0] === 1;
        previousEntryV2 = virginSignals(priorCoin)?.[1] === 1;
      }
      entryStateKnown = true;
    }
    const fire = (key: string) => addCompactWithCooldown(events, lastFire, eventFor(defs.get(key)!, member, decisionTs, bars, funding, research));
    const control = (matchedKey: string, side: Side = 'long') => addCompactWithCooldown(controls, lastControl, {
      key: matchedKey, label: matchedKey, sym: member.base, month: member.month, decisionTs, side, bars, funding, research,
    });
    const entrySource = (sourceKey: 'entry-source-r1' | 'entry-source-v2', watchKey: 'entry-watch-r1' | 'entry-watch-v2') => {
      const source: EvalEvent = {
        key: sourceKey, label: `${sourceKey} rising edge`, sym: member.base, month: member.month,
        decisionTs, side: 'long', bars, funding, research,
      };
      const accepted: EvalEvent[] = [];
      addWithCooldown(accepted, lastControl, source, 6 * HOUR);
      if (!accepted.length) return;
      controls.push(compactEvent({ ...source, key: watchKey === 'entry-watch-r1' ? 'entry-r1-immediate' : 'entry-v2-immediate', label: 'immediate source alert' }));
      const filled = deriveEntryWatch(source, watchKey);
      if (filled) events.push(compactEvent(filled));
    };

    const genericBreakout = breakoutEnvelope(h1, i1);
    if (genericBreakout) control('breakout');
    if (topEnvelope(h1, i1)) control('top-envelope', 'short');
    if (wEnvelope(h1, i1)) control('w-envelope');

    const boardingFast = fastBoardingFlags(h1, i1, h1E20, h1E50);

    if (earlySetupEnvelope(h1, h1Usd, h1Funding, i1)) {
      control('early-setup-envelope');
      const c = coin();
      if (genericBreakout && detectFlushBreakout(c.candles, c.volume, c.oi, c.fundingHist)) fire('flush-breakout');
      const setup = detectEarlySetup(c.candles, c.oi, c.fundingHist);
      const oldLs = asOf(metrics, decisionTs - DAY);
      const btcNow = btcClose.get(hb.t);
      const btcOld = btcClose.get(hb.t - DAY);
      const rs = btcNow && btcOld && i1 >= 24 ? ((hb.c / h1[i1 - 24].c) - (btcNow / btcOld)) * 100 : NaN;
      const lsDrop = oldLs?.ls && currentMetric.ls > 0 ? (1 - currentMetric.ls / oldLs.ls) * 100 : NaN;
      if (setup && lsDrop >= 5 && rs >= 2) fire('early-setup');
    }

    if (squeeze.breakout[i1] && squeezeSignals(coin())?.[1]) fire('squeeze-d3');
    if (boardingFast.control) {
        const b2Candles: Candle[] = h1.slice(0, i1 + 1).map((x) => ({ time: x.t / 1000, open: x.o, high: x.h, low: x.l, close: x.c }));
        const b2Volume: VolumeBar[] = h1.slice(0, i1 + 1).map((x) => ({ time: x.t / 1000, value: x.q, up: x.c >= x.o, takerBuy: x.tq }));
        if (evaluateEma20ReclaimControl(b2Candles, b2Volume)) {
          control('ema-reclaim');
          fire('umm-ema-control');
          if (boardingFast.b2 && evaluateBoardingB2(b2Candles, b2Volume)) { fire('boarding-b2'); fire('umm-b2'); if (oi4h >= 3) fire('umm-b2-oi'); }
        }
    }

    let entryR1 = false;
    let entryV2 = false;
    if (genericBreakout) {
      const rb = rebuildSignals(coin());
      const vg = virginSignals(coin());
      entryR1 = rb?.[0] === 1;
      entryV2 = vg?.[1] === 1;
      if (entryR1) fire('rebuild-r1');
      if (rb?.[1]) fire('rebuild-r2');
      if (rb?.[2]) fire('rebuild-r3');
      if (vg?.[0]) fire('virgin-v1');
      if (entryV2) fire('virgin-v2');
      if (vg?.[2]) fire('virgin-v3');
    }
    if (entryR1 && !previousEntryR1) entrySource('entry-source-r1', 'entry-watch-r1');
    if (entryV2 && !previousEntryV2) entrySource('entry-source-v2', 'entry-watch-v2');
    previousEntryR1 = entryR1;
    previousEntryV2 = entryV2;
    if (topEnvelope(h1, i1)) {
      const top = distTopSignals(coin());
      top?.forEach((x, j) => { if (x) fire(`top-t${j + 1}`); });
    }
    if (wEnvelope(h1, i1)) {
      const wb = wbottomSignals(coin());
      wb?.forEach((x, j) => { if (x) fire(`wbottom-w${j + 1}`); });
    }

    // S14 is a native-5m detector. The audit samples it on the recorder's
    // completed hourly evidence clock and calls the production pure function.
    if (detectEarlyPump(series.candles.slice(i5 - 575, i5 + 1), series.volume.slice(i5 - 575, i5 + 1))) fire('early-pump');
    const earlyWindow = bars.slice(i5 - 288, i5);
    const hi24 = Math.max(...earlyWindow.map((x) => x.h));
    const lo24 = Math.min(...earlyWindow.map((x) => x.l));
    const below = (hi24 / bars[i5].c - 1) * 100;
    const pos = hi24 > lo24 ? (bars[i5].c - lo24) / (hi24 - lo24) : 0;
    if (below >= 2 && below <= 12 && pos >= .5 && bars[i5].c > bars[i5 - 12].c) control('early-envelope');

    const facts = spotFacts(h1, spotByTs, i1, currentMetric);
    if (facts) {
      spotEligible++;
      facts.oi4 = oi4h;
      if (facts.ret4 >= 2) control('spot-momentum');
      if (Math.abs(facts.ret4) < 1) control('spot-flat');
      const needsProductionSpot =
        (facts.ret4 >= 2 && Math.abs(oi4h) < 1.5 && facts.basis <= .05) ||
        (Math.abs(facts.ret4) < 1 && Math.abs(oi4h) < 2 && facts.volRatio >= 1.5 && facts.buy24 >= .55);
      const productionSpot = needsProductionSpot ? spotSignals(coin()) : null;
      if (productionSpot?.[0]) fire('spot-pump');
      if (productionSpot?.[1]) fire('spot-accum');
      if (facts.ret4 >= 2 && facts.buy4 > .55 && facts.basis <= 0 && facts.spot24 >= facts.perp24) fire('organic-spot');
      if (currentFunding.rate >= .0001 && facts.basis >= .1 && facts.spot24 < .5 * facts.perp24) fire('leverage-froth');
      if (facts.ret4 >= 2 && facts.buy4 > .55 && facts.basis <= 0 && facts.spot24 >= facts.perp24) fire('true-spot-led');
    }

    const score = strength[i5]?.value;
    if (Number.isFinite(score)) {
      const rankEvent: EvalEvent = { key: 'top10', label: '全市場 Top 10', sym: member.base, month: member.month, decisionTs, side: 'long', bars, funding, research };
      const arr = ranks.get(decisionTs) ?? [];
      const worst = arr.at(-1);
      if (arr.length < 10 || !worst || score > worst.score || (score === worst.score && member.base.localeCompare(worst.event.sym) < 0)) {
        arr.push({ score, event: compactEvent(rankEvent) });
        arr.sort((a, b) => b.score - a.score || a.event.sym.localeCompare(b.event.sym));
        if (arr.length > 10) arr.length = 10;
      }
      ranks.set(decisionTs, arr);
      if (!strengthStateKnown) {
        strengthWasHigh = Number.isFinite(strength[i5 - 1]?.value) && strength[i5 - 1].value >= 70;
        strengthStateKnown = true;
      }
      if (score >= 70 && !strengthWasHigh) addCompactWithCooldown(events, lastFire, { ...rankEvent, key: 'strength70', label: 'Strength ≥70 crossing' });
      strengthWasHigh = score >= 70;
    }
    control('all');
  }


  // Deep-reclaim runs on completed native 15m bars. A cheap fresh-EMA cross
  // prefilter avoids calling the production 100-bar evaluator on every bar;
  // every candidate and lifecycle transition is still decided by the shared
  // production functions.
  const bars15 = aggregate15(bars);
  const close15 = bars15.map((x) => x.close);
  const ema20_15 = ema(close15, 20);
  let active: DeepReclaimWatch | null = null;
  const observation = (ts: number): DeepReclaimOiObservation | null => {
    const cur = asOf(metrics, ts);
    const q1 = asOf(metrics, ts - HOUR);
    const q4 = asOf(metrics, ts - 4 * HOUR);
    if (!cur || !q1 || !q4 || !(q1.qty > 0) || !(q4.qty > 0)) return null;
    return { observedAt: cur.t, qty1h: (cur.qty / q1.qty - 1) * 100, qty4h: (cur.qty / q4.qty - 1) * 100 };
  };
  const deepArmed = EVIDENCE_DETECTORS.find((x) => x.key === 'deep-reclaim-armed')!;
  const deepConfirmed = EVIDENCE_DETECTORS.find((x) => x.key === 'deep-reclaim-confirmed')!;
  const researchAt = (ts: number): EvidenceResearchFeatures | undefined => {
    const open = Math.floor(ts / HOUR) * HOUR - HOUR;
    const j = h1ByOpen.get(open);
    if (j == null || j < 24) return undefined;
    const current = asOf(metrics, ts);
    const reference = asOf(metrics, ts - 4 * HOUR);
    const knownFunding = asOf(funding, ts, 12 * HOUR);
    if (!current || !reference || !(reference.qty > 0) || !knownFunding) return undefined;
    const row = h1[j];
    const prior = h1.slice(j - 24, j);
    const range = h1.slice(j - 23, j + 1);
    const avgVolume = mean(prior.map((x) => x.q));
    const hi = Math.max(...range.map((x) => x.h));
    const lo = Math.min(...range.map((x) => x.l));
    const btcNow = btcClose.get(row.t);
    const btcOld = btcClose.get(row.t - DAY);
    const strengthIndex = barIndex.get(row.t + 55 * 60_000);
    return {
      assetRet1h: finiteOrNull(row.c / h1[j - 1].c - 1),
      assetRet4h: finiteOrNull(row.c / h1[j - 4].c - 1),
      assetRet24h: finiteOrNull(row.c / h1[j - 24].c - 1),
      btcRet24h: finiteOrNull(btcNow && btcOld ? btcNow / btcOld - 1 : NaN),
      oi4h: finiteOrNull(current.qty / reference.qty - 1),
      fundingRate: finiteOrNull(knownFunding.rate),
      takerBuy1h: finiteOrNull(row.q > 0 ? row.tq / row.q : NaN),
      volumeRatio24h: finiteOrNull(avgVolume && avgVolume > 0 ? row.q / avgVolume : NaN),
      rangePos24h: finiteOrNull(hi > lo ? (row.c - lo) / (hi - lo) : NaN),
      strength: finiteOrNull(strengthIndex == null ? NaN : strength[strengthIndex]?.value ?? NaN),
    };
  };
  for (let i = 100; i < bars15.length; i++) {
    const bar = bars15[i];
    if (bar.closeTs < monthFrom) continue;
    const insideStudyMonth = bar.closeTs < monthTo;
    if (!insideStudyMonth && !active) break;
    if (active) {
      const transition = observeDeepReclaim(active, bar, observation(bar.closeTs));
      active = transition.candidate.status === 'watching' ? transition.candidate : null;
      if (transition.event?.event === 'confirmed') {
        addCompactWithCooldown(events, lastFire, eventFor(deepConfirmed, member, bar.closeTs, bars, funding, researchAt(bar.closeTs)));
      }
      if (active) continue;
    }
    if (!insideStudyMonth) break;
    if (!(close15[i] > ema20_15[i] && close15[i - 1] <= ema20_15[i - 1])) continue;
    const price = detectDeepReclaimPriceCandidate(member.base, bars15.slice(i - 99, i + 1));
    if (!price) continue;
    addCompactWithCooldown(controls, lastControl, { key: 'deep-price-only', label: 'deep-price-only', sym: member.base, month: member.month, decisionTs: price.setupTs, side: 'long', bars, funding, research: researchAt(price.setupTs) });
    const armed = armDeepReclaim(price, observation(price.setupTs));
    if (armed.candidate) {
      active = armed.candidate;
      addCompactWithCooldown(events, lastFire, eventFor(deepArmed, member, price.setupTs, bars, funding, researchAt(price.setupTs)));
    }
  }
  return { eligible, expected, spotEligible };
}

const outcomeCache = new WeakMap<EvalEvent, Map<string, Outcome>>();

export function evaluateOutcome(event: EvalEvent, target: number, horizon: number): Outcome {
  const materialized = event.outcomes?.find((x) => x.target === target && x.horizon === horizon);
  if (materialized) return materialized;
  const cache = outcomeCache.get(event) ?? new Map<string, Outcome>();
  outcomeCache.set(event, cache);
  const cacheKey = `${target}:${horizon}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const entryTs = Math.ceil(event.decisionTs / (15 * 60_000)) * 15 * 60_000;
  const needed = horizon * 12;
  let lo = 0;
  if (!event.bars || !event.funding) throw new Error(`outcome cell ${target}/${horizon} was not materialized for ${event.key}`);
  const bars = event.bars;
  const funding = event.funding;
  let hi = bars.length - 1;
  let start = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid].t < entryTs) lo = mid + 1;
    else if (bars[mid].t > entryTs) hi = mid - 1;
    else { start = mid; break; }
  }
  const entryBar = start >= 0 ? bars[start] : undefined;
  const path = start >= 0 ? bars.slice(start, start + needed) : [];
  const contiguous = path.length === needed && path.every((x, i) => x.t === entryTs + i * BAR5);
  const day = new Date(event.decisionTs).toISOString().slice(0, 10);
  if (!entryBar || !contiguous) {
    const out = { key: event.key, sym: event.sym, month: event.month, day, decisionTs: event.decisionTs, side: event.side, target, horizon, complete: false, hit: false, ret: null, net: null } satisfies Outcome;
    cache.set(cacheKey, out);
    return out;
  }
  const entry = entryBar.o;
  const exit = path.at(-1)!.c;
  const hit = event.side === 'long'
    ? path.some((x) => x.h >= entry * (1 + target / 100))
    : path.some((x) => x.l <= entry * (1 - target / 100));
  const ret = event.side === 'long' ? exit / entry - 1 : 1 - exit / entry;
  const exitTs = entryTs + horizon * HOUR;
  const priorFunding = [...funding].reverse().find((x) => x.t <= entryTs);
  const fundingKnown = priorFunding != null && entryTs - priorFunding.t <= 12 * HOUR;
  if (!fundingKnown) {
    const out = { key: event.key, sym: event.sym, month: event.month, day, decisionTs: event.decisionTs, side: event.side, target, horizon, complete: false, hit, ret, net: null } satisfies Outcome;
    cache.set(cacheKey, out);
    return out;
  }
  const longFundingCost = funding.filter((x) => x.t > entryTs && x.t <= exitTs).reduce((a, x) => a + x.rate, 0);
  const fundingCost = event.side === 'long' ? longFundingCost : -longFundingCost;
  const out = { key: event.key, sym: event.sym, month: event.month, day, decisionTs: event.decisionTs, side: event.side, target, horizon, complete: true, hit, ret, net: ret - COST - fundingCost } satisfies Outcome;
  cache.set(cacheKey, out);
  return out;
}

function compactEvent(event: EvalEvent): EvalEvent {
  if (event.outcomes) return event;
  const outcomes = TARGETS.flatMap((target) => HORIZONS.map((horizon) => evaluateOutcome(event, target, horizon)));
  return {
    key: event.key,
    label: event.label,
    sym: event.sym,
    month: event.month,
    decisionTs: event.decisionTs,
    side: event.side,
    research: event.research,
    outcomes,
  };
}

function bootstrapLower95(rows: Outcome[], seedKey: string): number | null {
  const complete = rows.filter((x) => x.complete && x.net != null);
  const byDay = new Map<string, number[]>();
  for (const x of complete) {
    const arr = byDay.get(x.day) ?? [];
    arr.push(x.net!);
    byDay.set(x.day, arr);
  }
  const blocks = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values);
  if (blocks.length < 5) return null;
  const rand = mulberry32(hashString(seedKey));
  const sims: number[] = [];
  for (let n = 0; n < 1000; n++) {
    const picked: number[] = [];
    for (let j = 0; j < blocks.length; j++) picked.push(...blocks[Math.floor(rand() * blocks.length)]);
    sims.push(mean(picked) ?? 0);
  }
  sims.sort((a, b) => a - b);
  return sims[Math.floor(sims.length * .05)];
}

function concentration(rows: Outcome[], field: 'sym' | 'day'): number | null {
  const by = new Map<string, number>();
  for (const x of rows) if (x.complete && x.net != null) by.set(x[field], (by.get(x[field]) ?? 0) + x.net);
  const positive = [...by.values()].filter((x) => x > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  return total > 0 ? Math.max(...positive) / total : null;
}

export function summarizeDetector(
  def: { key: string; label: string; matchedKey: string },
  events: EvalEvent[],
  controls: EvalEvent[],
  coverage: number,
): HistoricalGateResult {
  const ownEvents = events.filter((x) => x.key === def.key);
  const controlEvents = controls.filter((x) => x.key === def.matchedKey);
  const allOwn = TARGETS.flatMap((target) => HORIZONS.flatMap((horizon) => ownEvents.map((x) => evaluateOutcome(x, target, horizon))));
  const allControl = TARGETS.flatMap((target) => HORIZONS.flatMap((horizon) => controlEvents.map((x) => evaluateOutcome(x, target, horizon))));
  const horizons: HorizonResult[] = [];
  for (const target of TARGETS) for (const horizon of HORIZONS) {
    const own = allOwn.filter((x) => x.target === target && x.horizon === horizon);
    const ctl = allControl.filter((x) => x.target === target && x.horizon === horizon);
    const complete = own.filter((x) => x.complete);
    const completeCtl = ctl.filter((x) => x.complete);
    const hitRate = complete.length ? complete.filter((x) => x.hit).length / complete.length : null;
    const baselineRate = completeCtl.length ? completeCtl.filter((x) => x.hit).length / completeCtl.length : null;
    const rets = complete.map((x) => x.ret!).filter(Number.isFinite);
    const nets = complete.map((x) => x.net!).filter(Number.isFinite);
    horizons.push({
      targetPct: target, horizonH: horizon, events: own.length, complete: complete.length,
      hitRate, baselineRate, lift: hitRate != null && baselineRate != null && baselineRate > 0 ? hitRate / baselineRate : null,
      meanReturn: mean(rets), medianReturn: median(rets), netAfterCost: mean(nets),
    });
  }
  const primary = allOwn.filter((x) => x.target === 10 && x.horizon === 24 && x.complete);
  const monthlyNet: Record<string, number | null> = {};
  for (const month of [...new Set(ownEvents.map((x) => x.month))].sort()) monthlyNet[month] = mean(primary.filter((x) => x.month === month).map((x) => x.net!));
  const positiveMonths = Object.values(monthlyNet).filter((x) => x != null && x > 0).length;
  const lifts = horizons.map((x) => x.lift).filter((x): x is number => x != null);
  const worstLift = lifts.length ? Math.min(...lifts) : null;
  const primaryCell = horizons.find((x) => x.targetPct === 10 && x.horizonH === 24)!;
  const bootLower95 = bootstrapLower95(primary, def.key);
  const months = Object.values(monthlyNet).filter((x) => x != null).length;
  const counts = {
    events: ownEvents.length,
    coins: new Set(ownEvents.map((x) => x.sym)).size,
    days: new Set(ownEvents.map((x) => new Date(x.decisionTs).toISOString().slice(0, 10))).size,
    months,
  };
  const strictFamily = def.key.startsWith('umm-') || def.key.startsWith('entry-watch-') || def.key.startsWith('deep-reclaim-');
  const isDeepReclaim = def.key.startsWith('deep-reclaim-');
  const enough = strictFamily
    ? counts.events >= 100 && counts.coins >= 40 && counts.days >= (isDeepReclaim ? 60 : 20) && counts.months >= 3
    : counts.events >= 20 && counts.months >= 3;
  const confidencePass = !strictFamily || (bootLower95 != null && bootLower95 > 0);
  const pass = enough && confidencePass && (primaryCell.lift ?? 0) >= 1.3 && (primaryCell.netAfterCost ?? -Infinity) > 0 && worstLift != null && worstLift > 1.15 && positiveMonths >= Math.ceil(Math.max(1, months) / 2);
  const reasons = [
    `${counts.events} events / ${counts.coins} coins / ${counts.days} days / ${counts.months} months`,
    `10%×24h matched lift ${primaryCell.lift == null ? 'n/a' : primaryCell.lift.toFixed(2)}`,
    `after-cost/funding mean ${primaryCell.netAfterCost == null ? 'n/a' : `${(primaryCell.netAfterCost * 100).toFixed(2)}%`}`,
    `${positiveMonths}/${months} positive monthly folds`,
  ];
  if (!enough) reasons.push('pre-registered sample/span floor not met');
  if (!confidencePass) reasons.push('pre-registered block-bootstrap lower bound is unavailable or non-positive');
  if (!pass) reasons.push('one or more fixed historical gates failed');
  return {
    key: def.key, label: def.label, capability: pass ? 'historical-pass' : 'historical-fail',
    ...counts, coverage, horizons, monthlyNet,
    walkForwardPositive: positiveMonths, walkForwardTotal: months,
    bootstrapLower95: bootLower95,
    topCoinProfitShare: concentration(primary, 'sym'), topDayProfitShare: concentration(primary, 'day'),
    robustness: {
      status: worstLift == null ? 'unavailable' : worstLift > 1.15 ? 'pass' : 'fail',
      worstLift,
      note: 'Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.',
    },
    reasons,
  };
}

function operationalItems(): EvidenceItem[] {
  return [
    ['telegram-delivery', 'Telegram 實際送達', '送達只會喺真實時間發生', 'forward-only', false, 'message id、API response、用戶端收件', '保留 forward audit，歷史 replay 不計送達'],
    ['top1-runtime-selection', 'Top-1 runtime selection', '同 sweep 候選、排序及發送狀態屬 runtime', 'forward-only', false, '完整同輪候選及實際 selected row', '保留 forward-only'],
    ['runtime-cooldown', '通知 cooldown', '依賴持久化狀態及 process lifecycle', 'forward-only', false, '跨 restart runtime audit', '保留 forward-only'],
    ['recorder-uptime', 'Recorder uptime', '歷史市場資料不能證明 recorder 當時在線', 'forward-only', false, 'heartbeat / process telemetry', '保留 forward-only'],
    ['paper-account', 'Paper account / T1 一個月正 P&L', '實際 paper book 路徑不可由 replay 冒充', 'forward-only', false, '連續一個月同規則 paper P&L', '維持 Strategy Lab 分隔'],
    ['real-slippage', '真實 slippage', 'archive 無本系統實際下單及成交', 'forward-only', false, '真實成交或 paper execution telemetry', '保留 forward-only'],
    ['e2-forward-holdout', 'E2 連續月份／市場漂移確認', '歷史 H1 可做固定初步 gate，但不能證明部署後市場無漂移', 'forward-confirmation-required', true, '同規則 live-era 連續月份 holdout', '歷史 pass 只列候選，等 forward confirmation'],
    ['liquidations', 'Liquidation detector', 'Binance Vision 無 liquidation archive', 'source-unavailable', false, '前向 websocket liquidation stream', '保留收集；不可零值補齊'],
    ['e4-protected-source', 'E4 protected Telegram reference', '受保護外部來源不可由市場 archive 還原', 'manual-external', false, '人手保存原訊號及 timestamp', '維持 manual-external'],
    ['vision-history-claim', '「Binance 只有 30 日歷史」舊結論', '舊文件混淆 REST retention 同 Vision archive', 'superseded', true, '無', '保留舊文並加 superseded note'],
  ].map(([key, label, oldBlocker, capability, canBackfill, remainingForwardEvidence, recommendation]) => ({
    key: key as string, label: label as string, oldBlocker: oldBlocker as string,
    capability: capability as EvidenceCapability, canBackfill: canBackfill as boolean,
    remainingForwardEvidence: remainingForwardEvidence as string, recommendation: recommendation as string,
  }));
}

function deriveEntryWatch(source: EvalEvent, key: 'entry-watch-r1' | 'entry-watch-v2'): EvalEvent | null {
  if (!source.bars) return null;
  const h1 = aggregateHour(source.bars);
  const signalOpen = source.decisionTs - HOUR;
  const i = h1.findIndex((x) => x.t === signalOpen);
  if (i < 24) return null;
  const support = Math.max(...h1.slice(i - 24, i).map((x) => x.h));
  let tr = 0;
  for (let j = i - 13; j <= i; j++) tr += Math.max(h1[j].h - h1[j].l, Math.abs(h1[j].h - h1[j - 1].c), Math.abs(h1[j].l - h1[j - 1].c));
  const atr = tr / 14;
  if (!(support > 0) || !(atr > 0) || atr >= support) return null;
  const signalPx = h1[i].c;
  let candidate = createEntryWatchCandidate({
    id: `historical:${key}:${source.sym}:${source.decisionTs}`,
    sym: source.sym,
    cls: key === 'entry-watch-r1' ? 'rb' : 'vg',
    attemptedAt: source.decisionTs,
    ts: source.decisionTs,
    deliveredAt: source.decisionTs,
    px: signalPx,
    strength: 0,
    via: 'text',
    plan: { entry: signalPx, kind: 'breakout', tp1: signalPx, tp2: signalPx, tp3: signalPx, sl: signalPx, runnerPct: 0 },
    support,
    atr,
    followupEnabled: false,
  });
  const bars15 = aggregate15(source.bars);
  for (const b of bars15) {
    if (b.closeTs <= source.decisionTs) continue;
    const transition = observeEntryWatch(candidate, { ts: b.closeTs, high: b.high, low: b.low, close: b.close });
    candidate = transition.candidate;
    if (transition.event?.event === 'ready') {
      return { ...source, key, label: key === 'entry-watch-r1' ? 'Entry-watch R1 breakout retest' : 'Entry-watch V2 breakout retest', decisionTs: b.closeTs };
    }
    if (candidate.status !== 'watching') return null;
  }
  return null;
}

function artifactIndex(manifest: EvidenceManifest): Map<string, DatasetCoverage> {
  return new Map(manifest.artifacts.map((x) => [`${x.dataset}:${x.symbol}:${x.period}`, x]));
}

function artifactFile(
  root: string,
  index: Map<string, DatasetCoverage>,
  dataset: DatasetCoverage['dataset'],
  symbol: string,
  period: string,
): string | null {
  return checkedFile(root, index.get(`${dataset}:${symbol}:${period}`));
}

function filesFor(
  root: string,
  index: Map<string, DatasetCoverage>,
  dataset: DatasetCoverage['dataset'],
  symbol: string,
  periods: string[],
): string[] {
  return periods.map((p) => artifactFile(root, index, dataset, symbol, p)).filter((x): x is string => x != null);
}

function btcCloseMap(root: string, manifest: EvidenceManifest, index: Map<string, DatasetCoverage>, months: string[]): Map<number, number> {
  const files = new Set<string>();
  let mult = 1;
  for (const month of months) {
    const member = manifest.monthlyUniverse[month]?.find((x) => x.base === 'BTC');
    if (!member) continue;
    mult = member.mult;
    for (const period of [previousMonth(month), month, nextMonth(month), `${nextMonth(month)}-buffer`]) {
      const f = artifactFile(root, index, 'futures5m', member.symbol, period);
      if (f) files.add(f);
    }
  }
  return new Map(aggregateHour(parseKlines([...files], mult)).map((x) => [x.t, x.c]));
}

function resultItems(results: HistoricalGateResult[]): EvidenceItem[] {
  const blockerFor = (key: string): string => {
    if (key.startsWith('deep-reclaim-')) return '舊結論指 quantity-OI 無法歷史 backfill，只得一個月，需等 forward recordings';
    if (key.startsWith('entry-watch-')) return '舊 study 只有 2026-06 execution month，calendar folds / bootstrap 不可用';
    if (key.startsWith('umm-')) return '舊 UMM replay 只有部分月份與 OI coverage，標作 sample-starved';
    if (key === 'strength70' || key === 'top10') return '舊 recording state 樣本及 span 太短，未可行動';
    return '舊文標作 recording-only、等待 E1 或歷史窗不足';
  };
  return results.map((r) => ({
    key: r.key,
    label: r.label,
    oldBlocker: blockerFor(r.key),
    capability: r.capability,
    canBackfill: true,
    remainingForwardEvidence: r.capability === 'historical-pass' ? '市場漂移及連續月份仍可用 forward holdout 覆核；不可自動升 live' : '歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究',
    recommendation: r.capability === 'historical-pass' ? '候選覆核（不自動升級）' : '退休／停止寫成「收集中」',
    resultKey: r.key,
  }));
}

function pct(x: number | null): string { return x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`; }
function lift(x: number | null): string { return x == null ? 'n/a' : `×${x.toFixed(2)}`; }

export function renderAuditMarkdown(report: EvidenceAuditReport): string {
  const lines = [
    '# HISTORICAL EVIDENCE AUDIT — 2026 H1', '',
    `審計窗：${report.months.join('、')}。來源指紋：\`${report.sourceFingerprint}\`。`, '',
    '市場資料：[Binance Public Data](https://github.com/binance/binance-public-data#readme) daily/monthly archives；archive 檔案逐一核對官方 checksum。', '',
    '> 呢份係歷史 replay 證據，唔係 Telegram 實際送達、paper 成交或 live 升降班決定。所有 live badge、通知、paper rule 同 tier map 維持不變。', '',
    '## Universe 與 coverage', '',
    `- ${report.universe.coinMonths} coin-months；${report.universe.uniqueCoins} 個 normalized bases。`,
    `- 每月 universe：${Object.entries(report.universe.byMonth).map(([m, n]) => `${m}=${n}`).join('、')}。`,
    `- Cache artifacts：complete ${report.coverage.complete}、partial ${report.coverage.partial}、missing ${report.coverage.missing}、invalid ${report.coverage.invalid}。缺資料一律 fail-closed，冇用零值補。`, '',
    '| Dataset | Complete | Partial | Missing | Invalid |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(report.coverage.byDataset).map(([dataset, c]) => `| ${dataset} | ${c.complete} | ${c.partial} | ${c.missing} | ${c.invalid} |`), '',
    '## 歷史結果', '',
    '| 項目 | 分類 | Events / Coins / Days / Months | Coverage | 10%×24h matched lift | 淨期望值 | Walk-forward | Bootstrap L95 | Robustness |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of report.results) {
    const p = r.horizons.find((x) => x.targetPct === 10 && x.horizonH === 24);
    lines.push(`| ${r.label} | \`${r.capability}\` | ${r.events} / ${r.coins} / ${r.days} / ${r.months} | ${(r.coverage * 100).toFixed(1)}% | ${lift(p?.lift ?? null)} | ${pct(p?.netAfterCost ?? null)} | ${r.walkForwardPositive}/${r.walkForwardTotal} | ${pct(r.bootstrapLower95)} | ${r.robustness.status}${r.robustness.worstLift == null ? '' : ` ${lift(r.robustness.worstLift)}`} |`);
  }
  lines.push('', '## Evidence 分類主表', '',
    '| 項目 | 舊阻塞理由 | 可 backfill | 分類 | 尚欠 forward 證據 | 建議 |',
    '|---|---|---:|---|---|---|');
  for (const x of report.items) lines.push(`| ${x.label} | ${x.oldBlocker} | ${x.canBackfill ? '是' : '否'} | \`${x.capability}\` | ${x.remainingForwardEvidence} | ${x.recommendation} |`);
  lines.push('', '## Detector 詳細統計', '');
  for (const r of report.results) {
    lines.push(`### ${r.label}`, '',
      `分類：\`${r.capability}\`；樣本 ${r.events} events / ${r.coins} coins / ${r.days} UTC days / ${r.months} months；coverage ${(r.coverage * 100).toFixed(1)}%。`, '',
      '| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const h of r.horizons) lines.push(`| ${h.targetPct}% | ${h.horizonH}h | ${h.events} | ${h.complete} | ${pct(h.hitRate)} | ${pct(h.baselineRate)} | ${lift(h.lift)} | ${pct(h.meanReturn)} | ${pct(h.medianReturn)} | ${pct(h.netAfterCost)} |`);
    lines.push('',
      `月度 walk-forward：${Object.entries(r.monthlyNet).map(([month, value]) => `${month} ${pct(value)}`).join('；') || 'n/a'}。`,
      `Day-block bootstrap L95：${pct(r.bootstrapLower95)}；正 P&L 集中度：top coin ${pct(r.topCoinProfitShare)}、top UTC day ${pct(r.topDayProfitShare)}。`,
      `Robustness：${r.robustness.status}${r.robustness.worstLift == null ? '' : `，worst lift ${lift(r.robustness.worstLift)}`}。${r.robustness.note}`, '',
      ...r.reasons.map((reason) => `- ${reason}`), '');
  }
  lines.push('## 產品邊界', '', ...report.boundaries.map((x) => `- ${x}`), '',
    '## 統計註記', '',
    '- Entry 係 decision 後下一個 native 15m open；只用 completed bars、as-of quantity/USD OI 同當時已知 funding。',
    '- 每個 detector 每幣 24h cooldown；結果同時報 10%/15% × 24h/48h、30bps 後加實際 funding、月度 folds、day-block bootstrap 同集中度。',
    '- `historical-pass` 只代表固定歷史 gate；唔會自動改任何產品 surface。', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

export function runEvidenceAudit(cfg: AuditConfig, log: (line: string) => void = console.log): EvidenceAuditReport {
  const manifestFile = path.join(cfg.root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`verified cache manifest not found: ${manifestFile}`);
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText) as EvidenceManifest;
  if (cfg.months.some((m) => !manifest.months.includes(m))) throw new Error('requested month absent from cache manifest');
  const index = artifactIndex(manifest);
  const btc = btcCloseMap(cfg.root, manifest, index, cfg.months);
  const events: EvalEvent[] = [];
  const controls: EvalEvent[] = [];
  const ranks = new Map<number, RankRow[]>();
  const lastFire = new Map<string, number>();
  const lastControl = new Map<string, number>();
  let expected = 0;
  let eligible = 0;
  let spotEligible = 0;
  const coinMonths = cfg.months.flatMap((month) => manifest.monthlyUniverse[month] ?? []);
  const selectedRaw = cfg.maxCoinMonths > 0 ? coinMonths.slice(0, cfg.maxCoinMonths) : coinMonths;
  const selected = [...selectedRaw].sort((a, b) => a.base.localeCompare(b.base) || a.month.localeCompare(b.month) || a.symbol.localeCompare(b.symbol));
  let cachedBase = '';
  const klineCache = new Map<string, Bar5[]>();
  const metricCache = new Map<string, MetricPoint[]>();
  const fundingCache = new Map<string, FundingPoint[]>();
  let done = 0;
  for (const member of selected) {
    if (member.base !== cachedBase) {
      cachedBase = member.base;
      klineCache.clear();
      metricCache.clear();
      fundingCache.clear();
    }
    const periods = [previousMonth(member.month), member.month, nextMonth(member.month), `${nextMonth(member.month)}-buffer`];
    const priceFiles = filesFor(cfg.root, index, 'futures5m', member.symbol, periods);
    const metricFiles = filesFor(cfg.root, index, 'metrics', member.symbol, [
      `${member.month}-warmup`, previousMonth(member.month), member.month, nextMonth(member.month),
      `${member.month}-outcome`, `${nextMonth(member.month)}-buffer`,
    ]);
    const fundingFiles = filesFor(cfg.root, index, 'funding', member.symbol, periods.concat(`${member.month}-outcome`));
    if (!priceFiles.length) continue;
    const bars = parseKlines(priceFiles, member.mult, klineCache);
    const metrics = parseMetrics(metricFiles, metricCache);
    const funding = parseFunding(fundingFiles, fundingCache);
    const selectedSpot = manifest.artifacts.find((x) => x.dataset === 'spot5m' && x.base === member.base && x.period === member.month && x.note?.includes('selected-for-base'));
    let spot: Bar5[] = [];
    if (selectedSpot) {
      const spotFiles = filesFor(cfg.root, index, 'spot5m', selectedSpot.symbol, [previousMonth(member.month), member.month]);
      spot = parseKlines(spotFiles, parseUmSymbol(selectedSpot.symbol)?.mult ?? 1, klineCache);
    }
    const c = evaluateCoinMonth(member, bars, metrics, funding, spot, btc, events, controls, ranks, lastFire, lastControl);
    expected += c.expected;
    eligible += c.eligible;
    spotEligible += c.spotEligible;
    done++;
    if (done % 25 === 0 || done === selected.length) log(`[audit] ${done}/${selected.length} coin-months`);
  }

  const topLast = new Map<string, number>();
  let previousTop = new Set<string>();
  for (const [ts, rows] of [...ranks.entries()].sort((a, b) => a[0] - b[0])) {
    const top = rows;
    const now = new Set(top.map((x) => x.event.sym));
    for (const row of top) if (!previousTop.has(row.event.sym)) addWithCooldown(events, topLast, row.event);
    previousTop = now;
    void ts;
  }

  const coverage = expected > 0 ? eligible / expected : 0;
  const spotCoverage = expected > 0 ? spotEligible / expected : 0;
  cfg.captureResearch?.({ events, controls, coverage, spotCoverage });
  const defs = [
    ...EVIDENCE_DETECTORS,
    { key: 'strength70', label: 'Strength ≥70 crossing', side: 'long' as const, matchedKey: 'all' },
    { key: 'top10', label: '全市場 Top 10 entry', side: 'long' as const, matchedKey: 'all' },
  ];
  const spotKeys = new Set(['spot-pump', 'spot-accum', 'organic-spot', 'leverage-froth', 'true-spot-led']);
  const results = defs.map((x) => summarizeDetector(x, events, controls, spotKeys.has(x.key) ? spotCoverage : coverage));
  const byMonth = Object.fromEntries(cfg.months.map((m) => [m, (manifest.monthlyUniverse[m] ?? []).length]));
  const coverageCounts = { complete: 0, partial: 0, missing: 0, invalid: 0 };
  const byDataset = Object.fromEntries(['futures5m', 'metrics', 'funding', 'spot5m'].map((dataset) => [dataset, { complete: 0, partial: 0, missing: 0, invalid: 0 }])) as EvidenceAuditReport['coverage']['byDataset'];
  for (const a of manifest.artifacts) {
    coverageCounts[a.status]++;
    byDataset[a.dataset][a.status]++;
  }
  const report: EvidenceAuditReport = {
    v: 1,
    auditId: 'historical-evidence-audit-2026-h1',
    months: [...cfg.months],
    sourceFingerprint: crypto.createHash('sha256').update(manifestText).digest('hex'),
    universe: { coinMonths: selected.length, uniqueCoins: new Set(selected.map((x) => x.base)).size, byMonth },
    coverage: { ...coverageCounts, byDataset },
    results,
    items: [...resultItems(results), ...operationalItems()],
    boundaries: [
      '歷史 Strategy replay 同 forward Strategy Lab 分開。',
      'T1「一個月正 paper P&L」不可由 backtest 代替。',
      'Telegram delivery、Top-1 runtime selection、cooldown、uptime、paper account、真實 slippage 只可用 forward evidence。',
      '本工具唔會改 live badge、Telegram、paper entry rule 或 signal tier。',
    ],
  };
  if (cfg.writeOutputs !== false) {
    fs.mkdirSync(path.dirname(cfg.outputJson), { recursive: true });
    fs.writeFileSync(cfg.outputJson, stableJson(report));
    fs.writeFileSync(cfg.outputMarkdown, renderAuditMarkdown(report));
    log(`[audit] wrote ${cfg.outputJson}`);
    log(`[audit] wrote ${cfg.outputMarkdown}`);
  }
  return report;
}

export function parseAuditArgs(argv: string[], cwd = process.cwd()): AuditConfig {
  const cfg: AuditConfig = {
    root: path.join(cwd, 'scripts', 'backtest-data', 'evidence-v1'),
    months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
    offline: true,
    outputJson: path.join(cwd, 'HISTORICAL-EVIDENCE-AUDIT-2026-H1.json'),
    outputMarkdown: path.join(cwd, 'HISTORICAL-EVIDENCE-AUDIT-2026-H1.md'),
    maxCoinMonths: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg === '--offline') continue;
    if (arg.startsWith('--months')) { cfg.months = value.split(','); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--root')) { cfg.root = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-json')) { cfg.outputJson = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-md')) { cfg.outputMarkdown = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--max-coin-months')) { cfg.maxCoinMonths = Number(value); if (!arg.includes('=')) i++; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!cfg.months.length || cfg.months.some((x) => !/^\d{4}-\d{2}$/.test(x))) throw new Error('months must be comma-separated YYYY-MM');
  if (!Number.isInteger(cfg.maxCoinMonths) || cfg.maxCoinMonths < 0) throw new Error('max-coin-months must be a non-negative integer');
  return cfg;
}
