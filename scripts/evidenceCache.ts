import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { parseUmSymbol } from '../src/data/binance';
import type { DatasetCoverage, EvidenceDataset, EvidenceManifest, MonthlyUniverseMember } from './evidenceTypes';

const FIVE_MIN_MS = 300_000;
const S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const DATA = 'https://data.binance.vision/data';
export const DEFAULT_EVIDENCE_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

export interface CacheConfig {
  root: string;
  months: string[];
  universe: 'archive';
  datasets: EvidenceDataset[];
  refresh: boolean;
  maxSymbols: number;
  concurrency: number;
}

export interface HoldoutCacheConfig {
  root: string;
  baselineRoot: string;
  month: string;
  asOf: string;
  datasets: Array<'futures5m' | 'metrics' | 'funding'>;
  refresh: boolean;
  maxSymbols: number;
  concurrency: number;
}

interface CsvSummary {
  rows: number;
  firstTs: number | null;
  lastTs: number | null;
  gaps: number;
  quoteVolume: number;
}

interface DownloadedCsv {
  csv: string;
  sourceUrl: string;
  archiveSha256: string;
}

interface ExistingArtifactIndex {
  byKey: Map<string, DatasetCoverage>;
  manifest: EvidenceManifest | null;
}

function artifactKey(dataset: EvidenceDataset, symbol: string, period: string): string {
  return `${dataset}:${symbol}:${period}`;
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function normalizeArchiveTimestamp(raw: string | number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const parsed = Date.parse(String(raw).trim().replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  // Binance spot archives use microseconds from 2025 onward; futures remain ms.
  if (n > 10_000_000_000_000) return Math.floor(n / 1000);
  if (n < 10_000_000_000) return Math.floor(n * 1000);
  return Math.floor(n);
}

export function parseChecksum(text: string): string | null {
  const m = text.trim().match(/^([a-f0-9]{64})(?:\s+\*?.+)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('bad zip signature');
  const method = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + compressedSize);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`unsupported zip method ${method}`);
}

function parseCsvTimes(
  csv: string,
  timestampIndex: number,
  expectedIntervalMs = FIVE_MIN_MS,
): { rows: number; firstTs: number | null; lastTs: number | null; gaps: number } {
  let rows = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let gaps = 0;
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const p = line.split(',');
    const ts = normalizeArchiveTimestamp(p[timestampIndex]?.trim());
    if (!Number.isFinite(ts)) continue;
    if (lastTs != null && expectedIntervalMs > 0 && ts - lastTs > expectedIntervalMs) {
      gaps += Math.max(1, Math.round((ts - lastTs) / expectedIntervalMs) - 1);
    }
    firstTs ??= ts;
    lastTs = ts;
    rows++;
  }
  return { rows, firstTs, lastTs, gaps };
}

export function summarizeKlineCsv(csv: string): CsvSummary {
  const time = parseCsvTimes(csv, 0);
  let quoteVolume = 0;
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const p = line.split(',');
    if (!Number.isFinite(normalizeArchiveTimestamp(p[0]?.trim()))) continue;
    const q = Number(p[7]);
    if (Number.isFinite(q) && q > 0) quoteVolume += q;
  }
  return { ...time, quoteVolume };
}

export function summarizeMetricsCsv(csv: string): CsvSummary {
  // create_time is column 0; sum_open_interest_value is column 3 in Binance metrics.
  const time = parseCsvTimes(csv, 0);
  return { ...time, quoteVolume: 0 };
}

export function buildMonthlyUniverse(
  month: string,
  candidates: Array<{ symbol: string; summary: CsvSummary }>,
): MonthlyUniverseMember[] {
  const best = new Map<string, MonthlyUniverseMember>();
  for (const row of candidates) {
    const parsed = parseUmSymbol(row.symbol);
    const s = row.summary;
    if (!parsed || !row.symbol.endsWith('USDT') || !s.rows || s.firstTs == null || s.lastTs == null) continue;
    const member: MonthlyUniverseMember = {
      month,
      base: parsed.base,
      symbol: row.symbol,
      mult: parsed.mult,
      quoteVolume: s.quoteVolume,
      priceRows: s.rows,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
    };
    const prev = best.get(member.base);
    if (!prev || member.quoteVolume > prev.quoteVolume || (member.quoteVolume === prev.quoteVolume && member.symbol < prev.symbol)) {
      best.set(member.base, member);
    }
  }
  return [...best.values()].sort((a, b) => a.base.localeCompare(b.base));
}

export function stableJson(value: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]));
    }
    return x;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function priorDays(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, -i));
    return d.toISOString().slice(0, 10);
  }).reverse();
}

function nextMonthDays(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m, i + 1)).toISOString().slice(0, 10));
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll('\\', '/');
}

function replaceFile(tmp: string, target: string): void {
  // Windows cannot rename over an existing destination. Both paths are exact
  // cache files (never globs/directories), so refresh replaces only that one
  // artifact after the complete temp file has been written.
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.renameSync(tmp, target);
}

function readExisting(root: string): ExistingArtifactIndex {
  const file = path.join(root, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as EvidenceManifest;
    return { manifest, byKey: new Map(manifest.artifacts.map((x) => [artifactKey(x.dataset, x.symbol, x.period), x])) };
  } catch {
    return { manifest: null, byKey: new Map() };
  }
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'YaobiHunter-evidence-audit/1' } });
      if (res.status === 404) return res;
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      last = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(`failed ${url}`);
}

export async function downloadArchiveCsv(url: string): Promise<DownloadedCsv | null> {
  const [zipRes, checksumRes] = await Promise.all([fetchWithRetry(url), fetchWithRetry(`${url}.CHECKSUM`)]);
  if (zipRes.status === 404) return null;
  if (!zipRes.ok) throw new Error(`HTTP ${zipRes.status} ${url}`);
  if (!checksumRes.ok) throw new Error(`checksum unavailable ${url}`);
  const zip = Buffer.from(await zipRes.arrayBuffer());
  const expected = parseChecksum(await checksumRes.text());
  if (!expected) throw new Error(`invalid checksum document ${url}`);
  const actual = sha256(zip);
  if (actual !== expected) throw new Error(`checksum mismatch ${url}: expected ${expected}, got ${actual}`);
  return { csv: unzipSingle(zip), sourceUrl: url, archiveSha256: actual };
}

export async function listArchiveSymbols(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let continuationToken: string | null = null;
  do {
    const url = new URL(S3);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('delimiter', '/');
    url.searchParams.set('prefix', prefix);
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
    const res = await fetchWithRetry(url.toString());
    if (!res.ok) throw new Error(`archive listing HTTP ${res.status}`);
    const xml = await res.text();
    const re = /<CommonPrefixes><Prefix>([^<]+)<\/Prefix><\/CommonPrefixes>/g;
    for (let m = re.exec(xml); m; m = re.exec(xml)) {
      const decoded = m[1].replaceAll('&amp;', '&');
      const parts = decoded.split('/').filter(Boolean);
      if (parts.length) out.push(parts[parts.length - 1]);
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    continuationToken = next ? next.replaceAll('&amp;', '&') : null;
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && !continuationToken) {
      throw new Error(`archive listing truncated without continuation token: ${prefix}`);
    }
  } while (continuationToken);
  return [...new Set(out)].sort();
}

async function listNonCoinPerpetuals(): Promise<string[]> {
  const res = await fetchWithRetry('https://fapi.binance.com/fapi/v1/exchangeInfo');
  if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
  const json = await res.json() as { symbols?: Array<{ symbol?: string; quoteAsset?: string; contractType?: string; underlyingType?: string }> };
  // Delisted basket/index contracts no longer appear in current exchangeInfo,
  // but remain in the historical archive and are not coin candidates.
  const historicalKnown = ['BLUEBIRDUSDT', 'BTCDOMUSDT', 'DEFIUSDT', 'FOOTBALLUSDT'];
  const current = (json.symbols ?? [])
    .filter((x) => x.quoteAsset === 'USDT' && x.contractType === 'PERPETUAL' && x.underlyingType && x.underlyingType !== 'COIN')
    .map((x) => x.symbol!)
    .filter(Boolean);
  return [...new Set([...historicalKnown, ...current])].sort();
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function cachedCoverage(
  root: string,
  existing: ExistingArtifactIndex,
  dataset: EvidenceDataset,
  symbol: string,
  period: string,
  refresh: boolean,
): DatasetCoverage | null {
  if (refresh) return null;
  let old = existing.byKey.get(artifactKey(dataset, symbol, period));
  if (!old) {
    const sidecar = path.join(root, '.parts', 'coverage', dataset, symbol, `${period}.json`);
    try { old = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as DatasetCoverage; } catch { /* absent/corrupt sidecar */ }
  }
  return old && isCoverageReusable(root, old, refresh) ? old : null;
}

export function isCoverageReusable(root: string, coverage: DatasetCoverage, refresh = false): boolean {
  if (refresh || coverage.status === 'invalid') return false;
  if (coverage.status === 'missing') return true;
  if (!coverage.relativePath || !coverage.cacheSha256) return false;
  const file = path.join(root, coverage.relativePath);
  return fs.existsSync(file) && sha256(fs.readFileSync(file)) === coverage.cacheSha256;
}

function writeCoverageSidecar(root: string, coverage: DatasetCoverage): void {
  const file = path.join(root, '.parts', 'coverage', coverage.dataset, coverage.symbol, `${coverage.period}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, stableJson(coverage));
  replaceFile(`${file}.tmp`, file);
}

function writeCsvCoverage(
  root: string,
  dataset: EvidenceDataset,
  symbol: string,
  base: string,
  period: string,
  file: string,
  dl: DownloadedCsv,
  summary: CsvSummary,
  status: DatasetCoverage['status'] = 'complete',
  note?: string,
): DatasetCoverage {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dl.csv);
  const coverage: DatasetCoverage = {
    dataset, symbol, base, period, status, relativePath: relative(root, file), sourceUrl: dl.sourceUrl,
    archiveSha256: dl.archiveSha256, cacheSha256: sha256(dl.csv), rows: summary.rows,
    firstTs: summary.firstTs, lastTs: summary.lastTs, gaps: summary.gaps, note,
  };
  writeCoverageSidecar(root, coverage);
  return coverage;
}

async function cacheMonthlyCsv(
  cfg: CacheConfig,
  existing: ExistingArtifactIndex,
  dataset: 'futures5m' | 'spot5m' | 'funding',
  symbol: string,
  base: string,
  month: string,
): Promise<{ coverage: DatasetCoverage; summary: CsvSummary | null }> {
  const cached = cachedCoverage(cfg.root, existing, dataset, symbol, month, cfg.refresh);
  if (cached?.status === 'missing') return { coverage: cached, summary: null };
  if (cached?.relativePath) {
    const csv = fs.readFileSync(path.join(cfg.root, cached.relativePath), 'utf8');
    return { coverage: cached, summary: dataset === 'funding' ? { ...parseCsvTimes(csv, 0, 8 * 60 * 60_000), quoteVolume: 0 } : summarizeKlineCsv(csv) };
  }
  const url = dataset === 'futures5m'
    ? `${DATA}/futures/um/monthly/klines/${symbol}/5m/${symbol}-5m-${month}.zip`
    : dataset === 'spot5m'
      ? `${DATA}/spot/monthly/klines/${symbol}/5m/${symbol}-5m-${month}.zip`
      : `${DATA}/futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`;
  try {
    const dl = await downloadArchiveCsv(url);
    if (!dl) {
      const coverage: DatasetCoverage = { dataset, symbol, base, period: month, status: 'missing', sourceUrl: url, rows: 0, firstTs: null, lastTs: null, gaps: 0 };
      writeCoverageSidecar(cfg.root, coverage);
      return { coverage, summary: null };
    }
    const summary = dataset === 'funding' ? { ...parseCsvTimes(dl.csv, 0, 8 * 60 * 60_000), quoteVolume: 0 } : summarizeKlineCsv(dl.csv);
    const file = path.join(cfg.root, dataset, symbol, `${month}.csv`);
    const status = summary.gaps > 0 ? 'partial' : 'complete';
    const note = summary.gaps > 0 ? `${summary.gaps} missing 5m intervals` : undefined;
    return { coverage: writeCsvCoverage(cfg.root, dataset, symbol, base, month, file, dl, summary, status, note), summary };
  } catch (e) {
    return { coverage: { dataset, symbol, base, period: month, status: 'invalid', sourceUrl: url, rows: 0, firstTs: null, lastTs: null, gaps: 0, note: e instanceof Error ? e.message : String(e) }, summary: null };
  }
}

async function cacheDailyAggregate(
  cfg: CacheConfig,
  existing: ExistingArtifactIndex,
  dataset: 'futures5m' | 'spot5m' | 'metrics' | 'funding',
  symbol: string,
  base: string,
  period: string,
  days: string[],
): Promise<DatasetCoverage> {
  const cached = cachedCoverage(cfg.root, existing, dataset, symbol, period, cfg.refresh);
  if (cached) return cached;
  const parts: string[] = [];
  const hashes: string[] = [];
  const missing: string[] = [];
  for (const day of days) {
    const url = dataset === 'futures5m'
      ? `${DATA}/futures/um/daily/klines/${symbol}/5m/${symbol}-5m-${day}.zip`
      : dataset === 'spot5m'
        ? `${DATA}/spot/daily/klines/${symbol}/5m/${symbol}-5m-${day}.zip`
        : dataset === 'metrics'
          ? `${DATA}/futures/um/daily/metrics/${symbol}/${symbol}-metrics-${day}.zip`
          : `${DATA}/futures/um/daily/fundingRate/${symbol}/${symbol}-fundingRate-${day}.zip`;
    try {
      const partDir = path.join(cfg.root, '.parts', dataset, symbol);
      const partCsv = path.join(partDir, `${day}.csv`);
      const partMeta = path.join(partDir, `${day}.json`);
      let dl: DownloadedCsv | null = null;
      let knownMissing = false;
      if (!cfg.refresh && fs.existsSync(partCsv) && fs.existsSync(partMeta)) {
        try {
          const meta = JSON.parse(fs.readFileSync(partMeta, 'utf8')) as Omit<DownloadedCsv, 'csv'> & { cacheSha256: string };
          const csv = fs.readFileSync(partCsv, 'utf8');
          if (meta.sourceUrl === url && meta.cacheSha256 === sha256(csv)) dl = { csv, sourceUrl: url, archiveSha256: meta.archiveSha256 };
        } catch { /* corrupt part is downloaded again */ }
      } else if (!cfg.refresh && fs.existsSync(partMeta)) {
        try { knownMissing = (JSON.parse(fs.readFileSync(partMeta, 'utf8')) as { status?: string }).status === 'missing'; } catch { /* retry */ }
      }
      if (!dl && !knownMissing) {
        dl = await downloadArchiveCsv(url);
        if (dl) {
          fs.mkdirSync(partDir, { recursive: true });
          fs.writeFileSync(`${partCsv}.tmp`, dl.csv);
          replaceFile(`${partCsv}.tmp`, partCsv);
          fs.writeFileSync(`${partMeta}.tmp`, stableJson({ sourceUrl: url, archiveSha256: dl.archiveSha256, cacheSha256: sha256(dl.csv) }));
          replaceFile(`${partMeta}.tmp`, partMeta);
        } else {
          fs.mkdirSync(partDir, { recursive: true });
          fs.writeFileSync(`${partMeta}.tmp`, stableJson({ status: 'missing', sourceUrl: url }));
          replaceFile(`${partMeta}.tmp`, partMeta);
        }
      }
      if (!dl) { missing.push(day); continue; }
      hashes.push(dl.archiveSha256);
      parts.push(dl.csv.trimEnd());
    } catch (e) {
      return { dataset, symbol, base, period, status: 'invalid', sourceUrl: url, rows: 0, firstTs: null, lastTs: null, gaps: 0, note: e instanceof Error ? e.message : String(e) };
    }
  }
  const csv = parts.length ? `${parts.join('\n')}\n` : '';
  if (!csv) return { dataset, symbol, base, period, status: 'missing', rows: 0, firstTs: null, lastTs: null, gaps: 0, note: `missing ${missing.length}/${days.length} days` };
  const summary = dataset === 'metrics'
    ? summarizeMetricsCsv(csv)
    : dataset === 'funding'
      ? { ...parseCsvTimes(csv, 0, 8 * 60 * 60_000), quoteVolume: 0 }
      : summarizeKlineCsv(csv);
  const file = path.join(cfg.root, dataset, symbol, `${period}.csv`);
  return writeCsvCoverage(
    cfg.root, dataset, symbol, base, period, file,
    { csv, sourceUrl: `${DATA}/${dataset === 'metrics' ? 'futures/um/daily/metrics' : dataset === 'spot5m' ? 'spot/daily/klines' : dataset === 'funding' ? 'futures/um/daily/fundingRate' : 'futures/um/daily/klines'}/${symbol}`, archiveSha256: sha256(hashes.join('\n')) },
    summary, missing.length || summary.gaps ? 'partial' : 'complete',
    [missing.length ? `missing ${missing.length}/${days.length} days` : '', summary.gaps ? `${summary.gaps} missing intervals` : ''].filter(Boolean).join('; ') || undefined,
  );
}

async function cacheFundingRestBuffer(
  cfg: CacheConfig,
  existing: ExistingArtifactIndex,
  symbol: string,
  base: string,
  period: string,
  days: string[],
): Promise<DatasetCoverage> {
  const cached = cachedCoverage(cfg.root, existing, 'funding', symbol, period, cfg.refresh);
  if (cached) return cached;
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days.at(-1)}T23:59:59.999Z`);
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&startTime=${start}&endTime=${end}&limit=1000`;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const rows = await res.json() as Array<{ fundingTime?: number; fundingRate?: string }>;
    const clean = rows
      .filter((x) => Number.isFinite(Number(x.fundingTime)) && Number.isFinite(Number(x.fundingRate)))
      .sort((a, b) => Number(a.fundingTime) - Number(b.fundingTime));
    if (!clean.length) return { dataset: 'funding', symbol, base, period, status: 'missing', sourceUrl: url, rows: 0, firstTs: null, lastTs: null, gaps: 0 };
    const csv = `calc_time,funding_interval_hours,last_funding_rate\n${clean.map((x) => `${x.fundingTime},8,${x.fundingRate}`).join('\n')}\n`;
    const summary = { ...parseCsvTimes(csv, 0, 8 * 60 * 60_000), quoteVolume: 0 };
    const file = path.join(cfg.root, 'funding', symbol, `${period}.csv`);
    return writeCsvCoverage(
      cfg.root, 'funding', symbol, base, period, file,
      { csv, sourceUrl: url, archiveSha256: sha256(stableJson(clean)) }, summary,
      summary.gaps ? 'partial' : 'complete',
      `REST outcome buffer; public archive checksum unavailable at run time`,
    );
  } catch (e) {
    return { dataset: 'funding', symbol, base, period, status: 'invalid', sourceUrl: url, rows: 0, firstTs: null, lastTs: null, gaps: 0, note: e instanceof Error ? e.message : String(e) };
  }
}

function activeDays(member: MonthlyUniverseMember): string[] {
  const first = new Date(member.firstTs).toISOString().slice(0, 10);
  const last = new Date(member.lastTs).toISOString().slice(0, 10);
  return daysInMonth(member.month).filter((d) => d >= first && d <= last);
}

function spotCandidatesByBase(symbols: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const symbol of symbols) {
    if (!symbol.endsWith('USDT')) continue;
    const p = parseUmSymbol(symbol);
    if (!p) continue;
    const arr = out.get(p.base) ?? [];
    arr.push(symbol);
    out.set(p.base, arr);
  }
  for (const arr of out.values()) arr.sort();
  return out;
}

export async function cacheEvidence(cfg: CacheConfig, log: (line: string) => void = console.log): Promise<EvidenceManifest> {
  fs.mkdirSync(cfg.root, { recursive: true });
  const existing = readExisting(cfg.root);
  const artifacts = new Map<string, DatasetCoverage>();
  const keep = (x: DatasetCoverage) => artifacts.set(artifactKey(x.dataset, x.symbol, x.period), x);
  const warmupMonth = previousMonth(cfg.months[0]);
  const outcomeThrough = `${new Date(Date.UTC(Number(cfg.months.at(-1)!.slice(0, 4)), Number(cfg.months.at(-1)!.slice(5, 7)), 3)).toISOString().slice(0, 10)}`;

  log('[cache] listing Binance futures archive symbols');
  const excludedNonCoinSymbols = await listNonCoinPerpetuals();
  const excluded = new Set(excludedNonCoinSymbols);
  let futuresSymbols = (await listArchiveSymbols('data/futures/um/monthly/klines/')).filter((s) => s.endsWith('USDT') && !excluded.has(s));
  if (cfg.maxSymbols > 0) futuresSymbols = futuresSymbols.slice(0, cfg.maxSymbols);
  log(`[cache] ${futuresSymbols.length} raw USDT futures symbols`);

  const monthlyUniverse: Record<string, MonthlyUniverseMember[]> = {};
  for (const month of cfg.months) {
    const candidates: Array<{ symbol: string; summary: CsvSummary }> = [];
    let completed = 0;
    const rows = await mapPool(futuresSymbols, cfg.concurrency, async (symbol) => {
      const base = parseUmSymbol(symbol)?.base ?? symbol;
      const row = await cacheMonthlyCsv(cfg, existing, 'futures5m', symbol, base, month);
      completed++;
      if (completed % 50 === 0 || completed === futuresSymbols.length) log(`[cache] futures ${month}: ${completed}/${futuresSymbols.length}`);
      return { symbol, ...row };
    });
    for (const row of rows) {
      keep(row.coverage);
      if (row.summary) candidates.push({ symbol: row.symbol, summary: row.summary });
    }
    monthlyUniverse[month] = buildMonthlyUniverse(month, candidates);
    log(`[cache] universe ${month}: ${monthlyUniverse[month].length} normalized bases`);
  }

  // One prior month is data-only warm-up for January; the next three days are
  // outcome-only coverage for June 48h evaluations.
  const janMembers = monthlyUniverse[cfg.months[0]] ?? [];
  const junMembers = monthlyUniverse[cfg.months.at(-1)!] ?? [];
  await mapPool(janMembers, cfg.concurrency, async (member) => {
    const row = await cacheMonthlyCsv(cfg, existing, 'futures5m', member.symbol, member.base, warmupMonth);
    keep(row.coverage);
  });
  const outcomeDays = daysInMonth(outcomeThrough.slice(0, 7)).filter((d) => d <= outcomeThrough);
  await mapPool(junMembers, cfg.concurrency, async (member) => keep(await cacheDailyAggregate(cfg, existing, 'futures5m', member.symbol, member.base, `${outcomeThrough.slice(0, 7)}-buffer`, outcomeDays)));

  const winnerRows = cfg.months.flatMap((month) => monthlyUniverse[month] ?? []);
  if (cfg.datasets.includes('metrics')) {
    let completed = 0;
    await mapPool(winnerRows, cfg.concurrency, async (member) => {
      keep(await cacheDailyAggregate(cfg, existing, 'metrics', member.symbol, member.base, member.month, activeDays(member)));
      completed++;
      if (completed % 50 === 0 || completed === winnerRows.length) log(`[cache] metrics: ${completed}/${winnerRows.length} coin-months`);
    });
    await mapPool(janMembers, cfg.concurrency, async (member) => keep(await cacheDailyAggregate(cfg, existing, 'metrics', member.symbol, member.base, warmupMonth, daysInMonth(warmupMonth))));
    const warmupRows = [...new Map(winnerRows.map((m) => [`${m.symbol}:${m.month}`, m])).values()];
    await mapPool(warmupRows, cfg.concurrency, async (member) => {
      keep(await cacheDailyAggregate(cfg, existing, 'metrics', member.symbol, member.base, `${member.month}-warmup`, priorDays(member.month, 5)));
    });
    // A watch opened near month-end may confirm during the next 24–48h. Most
    // contracts are also the next month's representative and already have a
    // full metrics artifact; only cache a three-day outcome seam when that
    // exact contract is otherwise absent (for example after an alias switch).
    await mapPool(warmupRows, cfg.concurrency, async (member) => {
      if (member.month === cfg.months.at(-1)) return; // the explicit July buffer below covers this seam
      const followingMonth = nextMonth(member.month);
      if (artifacts.has(artifactKey('metrics', member.symbol, followingMonth))) return;
      keep(await cacheDailyAggregate(cfg, existing, 'metrics', member.symbol, member.base, `${member.month}-outcome`, nextMonthDays(member.month, 3)));
    });
    await mapPool(junMembers, cfg.concurrency, async (member) => keep(await cacheDailyAggregate(cfg, existing, 'metrics', member.symbol, member.base, `${outcomeThrough.slice(0, 7)}-buffer`, outcomeDays)));
  }

  if (cfg.datasets.includes('funding')) {
    const fundingRows = [...new Map(winnerRows.map((m) => [`${m.symbol}:${m.month}`, m])).values()];
    let completed = 0;
    await mapPool(fundingRows, cfg.concurrency, async (member) => {
      const row = await cacheMonthlyCsv(cfg, existing, 'funding', member.symbol, member.base, member.month);
      keep(row.coverage);
      completed++;
      if (completed % 100 === 0 || completed === fundingRows.length) log(`[cache] funding: ${completed}/${fundingRows.length} coin-months`);
    });
    const fundingWarmupRows = [...new Map(winnerRows.map((m) => [`${m.symbol}:${previousMonth(m.month)}`, m])).values()];
    await mapPool(fundingWarmupRows, cfg.concurrency, async (member) => {
      const row = await cacheMonthlyCsv(cfg, existing, 'funding', member.symbol, member.base, previousMonth(member.month));
      keep(row.coverage);
    });
    await mapPool(junMembers, cfg.concurrency, async (member) => {
      keep(await cacheFundingRestBuffer(cfg, existing, member.symbol, member.base, `${outcomeThrough.slice(0, 7)}-buffer`, outcomeDays));
    });
    await mapPool(fundingRows, cfg.concurrency, async (member) => {
      if (member.month === cfg.months.at(-1)) return; // explicit July buffer above
      if (artifacts.has(artifactKey('funding', member.symbol, nextMonth(member.month)))) return;
      const following = nextMonthDays(member.month, 3);
      keep(await cacheFundingRestBuffer(cfg, existing, member.symbol, member.base, `${member.month}-outcome`, following));
    });
  }

  if (cfg.datasets.includes('spot5m')) {
    log('[cache] listing Binance spot archive symbols');
    const spotByBase = spotCandidatesByBase(await listArchiveSymbols('data/spot/monthly/klines/'));
    let completed = 0;
    const selectedSpot = new Map<string, string>();
    await mapPool(winnerRows, Math.max(1, Math.floor(cfg.concurrency / 2)), async (member) => {
      const candidates = spotByBase.get(member.base) ?? [];
      const downloaded: Array<{ symbol: string; coverage: DatasetCoverage; summary: CsvSummary }> = [];
      for (const symbol of candidates) {
        const row = await cacheMonthlyCsv(cfg, existing, 'spot5m', symbol, member.base, member.month);
        keep(row.coverage);
        if (row.summary) downloaded.push({ symbol, coverage: row.coverage, summary: row.summary });
      }
      // Record the winning mapping in a tiny synthetic note on each successful
      // artifact; loaders deterministically choose the same highest-volume row.
      const winner = downloaded.sort((a, b) => b.summary.quoteVolume - a.summary.quoteVolume || a.symbol.localeCompare(b.symbol))[0];
      if (winner) {
        winner.coverage.note = `selected-for-base ${member.base}`;
        keep(winner.coverage);
        selectedSpot.set(`${member.month}:${member.base}`, winner.symbol);
      }
      completed++;
      if (completed % 50 === 0 || completed === winnerRows.length) log(`[cache] spot: ${completed}/${winnerRows.length} coin-months`);
    });
    await mapPool(janMembers, Math.max(1, Math.floor(cfg.concurrency / 2)), async (member) => {
      const symbol = selectedSpot.get(`${member.month}:${member.base}`);
      if (!symbol) return;
      const row = await cacheMonthlyCsv(cfg, existing, 'spot5m', symbol, member.base, warmupMonth);
      keep(row.coverage);
    });
    await mapPool(junMembers, Math.max(1, Math.floor(cfg.concurrency / 2)), async (member) => {
      const symbol = selectedSpot.get(`${member.month}:${member.base}`);
      if (!symbol) return;
      keep(await cacheDailyAggregate(cfg, existing, 'spot5m', symbol, member.base, `${outcomeThrough.slice(0, 7)}-buffer`, outcomeDays));
    });
  }

  // Preserve valid artifacts outside the requested dataset subset, allowing a
  // price-only run followed by an enrichment run without losing provenance.
  for (const old of existing.manifest?.artifacts ?? []) {
    if (excluded.has(old.symbol) || old.status === 'invalid') continue;
    if (!artifacts.has(artifactKey(old.dataset, old.symbol, old.period))) keep(old);
  }
  const sortedArtifacts = [...artifacts.values()].sort((a, b) =>
    a.dataset.localeCompare(b.dataset) || a.symbol.localeCompare(b.symbol) || a.period.localeCompare(b.period));
  const materialFingerprint = sha256(stableJson({ months: cfg.months, artifacts: sortedArtifacts, monthlyUniverse, excludedNonCoinSymbols }));
  const previousFingerprint = existing.manifest
    ? sha256(stableJson({ months: existing.manifest.months, artifacts: existing.manifest.artifacts, monthlyUniverse: existing.manifest.monthlyUniverse, excludedNonCoinSymbols: existing.manifest.excludedNonCoinSymbols ?? [] }))
    : '';
  const generatedAt = existing.manifest && materialFingerprint === previousFingerprint
    ? existing.manifest.generatedAt
    : new Date().toISOString();
  const manifest: EvidenceManifest = {
    v: 1, source: 'binance-public-data', months: [...cfg.months], warmupMonth, outcomeThrough,
    generatedAt, excludedNonCoinSymbols, artifacts: sortedArtifacts, monthlyUniverse,
  };
  const manifestFile = path.join(cfg.root, 'manifest.json');
  fs.writeFileSync(`${manifestFile}.tmp`, stableJson(manifest));
  replaceFile(`${manifestFile}.tmp`, manifestFile);
  log(`[cache] wrote manifest: ${sortedArtifacts.length} artifacts`);
  return manifest;
}

function linkedBaselineCoverage(root: string, baselineRoot: string, coverage: DatasetCoverage): DatasetCoverage | null {
  if (!coverage.relativePath || !coverage.cacheSha256 || coverage.status === 'invalid' || coverage.status === 'missing') return null;
  const source = path.join(baselineRoot, coverage.relativePath);
  if (!fs.existsSync(source) || sha256(fs.readFileSync(source)) !== coverage.cacheSha256) return null;
  return {
    ...coverage,
    relativePath: relative(root, source),
    note: [coverage.note, 'linked verified H1 warm-up artifact'].filter(Boolean).join('; '),
  };
}

// Current-month holdout cache. Unlike cacheEvidence, this intentionally uses
// daily archives for the study month because Binance has not published the
// monthly zip yet. It lives in a separate root and links verified prior-month
// artifacts from the immutable H1 cache, so the H1 manifest/fingerprint never
// changes and large warm-up files are not duplicated.
export async function cacheEvidenceHoldout(
  cfg: HoldoutCacheConfig,
  log: (line: string) => void = console.log,
): Promise<EvidenceManifest> {
  fs.mkdirSync(cfg.root, { recursive: true });
  const existing = readExisting(cfg.root);
  const baselineFile = path.join(cfg.baselineRoot, 'manifest.json');
  if (!fs.existsSync(baselineFile)) throw new Error(`baseline evidence manifest not found: ${baselineFile}`);
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as EvidenceManifest;
  const artifacts = new Map<string, DatasetCoverage>();
  const keep = (coverage: DatasetCoverage) => artifacts.set(artifactKey(coverage.dataset, coverage.symbol, coverage.period), coverage);
  const days = daysInMonth(cfg.month).filter((day) => day <= cfg.asOf);
  if (!days.length || !cfg.asOf.startsWith(`${cfg.month}-`)) throw new Error('holdout --as-of must be a day inside --month');

  log('[holdout-cache] listing Binance futures archive symbols');
  const excludedNonCoinSymbols = await listNonCoinPerpetuals();
  const excluded = new Set(excludedNonCoinSymbols);
  let symbols = (await listArchiveSymbols('data/futures/um/monthly/klines/'))
    .filter((symbol) => symbol.endsWith('USDT') && !excluded.has(symbol));
  if (cfg.maxSymbols > 0) symbols = symbols.slice(0, cfg.maxSymbols);
  log(`[holdout-cache] ${symbols.length} raw USDT futures symbols; ${days[0]}..${days.at(-1)}`);

  const candidates: Array<{ symbol: string; summary: CsvSummary }> = [];
  let priceDone = 0;
  const priceRows = await mapPool(symbols, cfg.concurrency, async (symbol) => {
    const base = parseUmSymbol(symbol)?.base ?? symbol;
    const coverage = await cacheDailyAggregate(cfg as CacheConfig, existing, 'futures5m', symbol, base, cfg.month, days);
    priceDone++;
    if (priceDone % 25 === 0 || priceDone === symbols.length) log(`[holdout-cache] futures: ${priceDone}/${symbols.length}`);
    return { symbol, coverage };
  });
  for (const row of priceRows) {
    keep(row.coverage);
    if (!row.coverage.relativePath || row.coverage.status === 'missing' || row.coverage.status === 'invalid') continue;
    const csv = fs.readFileSync(path.join(cfg.root, row.coverage.relativePath), 'utf8');
    candidates.push({ symbol: row.symbol, summary: summarizeKlineCsv(csv) });
  }
  const universe = buildMonthlyUniverse(cfg.month, candidates);
  log(`[holdout-cache] universe ${cfg.month}: ${universe.length} normalized bases`);

  if (cfg.datasets.includes('metrics')) {
    let done = 0;
    await mapPool(universe, cfg.concurrency, async (member) => {
      keep(await cacheDailyAggregate(cfg as CacheConfig, existing, 'metrics', member.symbol, member.base, cfg.month, days));
      done++;
      if (done % 25 === 0 || done === universe.length) log(`[holdout-cache] metrics: ${done}/${universe.length}`);
    });
  }
  if (cfg.datasets.includes('funding')) {
    let done = 0;
    await mapPool(universe, cfg.concurrency, async (member) => {
      const archived = await cacheDailyAggregate(cfg as CacheConfig, existing, 'funding', member.symbol, member.base, cfg.month, days);
      if (archived.status === 'missing') {
        const rest = await cacheFundingRestBuffer(cfg as CacheConfig, existing, member.symbol, member.base, `${cfg.month}-rest`, days);
        keep({
          ...rest,
          period: cfg.month,
          note: [rest.note, 'daily funding archive unavailable; REST fallback frozen for holdout'].filter(Boolean).join('; '),
        });
      } else {
        keep(archived);
      }
      done++;
      if (done % 50 === 0 || done === universe.length) log(`[holdout-cache] funding: ${done}/${universe.length}`);
    });
  }

  const warmupMonth = previousMonth(cfg.month);
  for (const member of universe) {
    for (const dataset of cfg.datasets) {
      const old = baseline.artifacts.find((coverage) => coverage.dataset === dataset && coverage.symbol === member.symbol && coverage.period === warmupMonth);
      if (!old) continue;
      const linked = linkedBaselineCoverage(cfg.root, cfg.baselineRoot, old);
      if (linked) keep(linked);
    }
  }
  for (const old of existing.manifest?.artifacts ?? []) {
    if (old.status !== 'invalid' && !artifacts.has(artifactKey(old.dataset, old.symbol, old.period))) keep(old);
  }
  const btc = universe.find((member) => member.base === 'BTC');
  const btcCoverage = btc ? artifacts.get(artifactKey('futures5m', btc.symbol, cfg.month)) : null;
  if (!btcCoverage?.lastTs) throw new Error('BTC holdout archive coverage unavailable; cannot freeze a common as-of boundary');
  const availableThrough = new Date(btcCoverage.lastTs).toISOString().slice(0, 10);
  if (availableThrough < cfg.asOf) log(`[holdout-cache] requested through ${cfg.asOf}; archive currently available through ${availableThrough}`);
  const sortedArtifacts = [...artifacts.values()].sort((a, b) =>
    a.dataset.localeCompare(b.dataset) || a.symbol.localeCompare(b.symbol) || a.period.localeCompare(b.period));
  const monthlyUniverse = { [cfg.month]: universe };
  const materialFingerprint = sha256(stableJson({
    months: [cfg.month], outcomeThrough: availableThrough, artifacts: sortedArtifacts, monthlyUniverse, excludedNonCoinSymbols,
  }));
  const previousFingerprint = existing.manifest
    ? sha256(stableJson({
      months: existing.manifest.months,
      outcomeThrough: existing.manifest.outcomeThrough,
      artifacts: existing.manifest.artifacts,
      monthlyUniverse: existing.manifest.monthlyUniverse,
      excludedNonCoinSymbols: existing.manifest.excludedNonCoinSymbols ?? [],
    }))
    : '';
  const manifest: EvidenceManifest = {
    v: 1,
    source: 'binance-public-data',
    months: [cfg.month],
    warmupMonth,
    outcomeThrough: availableThrough,
    generatedAt: existing.manifest && materialFingerprint === previousFingerprint ? existing.manifest.generatedAt : new Date().toISOString(),
    excludedNonCoinSymbols,
    artifacts: sortedArtifacts,
    monthlyUniverse,
  };
  const manifestFile = path.join(cfg.root, 'manifest.json');
  fs.writeFileSync(`${manifestFile}.tmp`, stableJson(manifest));
  replaceFile(`${manifestFile}.tmp`, manifestFile);
  log(`[holdout-cache] wrote manifest: ${sortedArtifacts.length} artifacts`);
  return manifest;
}

export function parseCacheArgs(argv: string[], cwd = process.cwd()): CacheConfig {
  const cfg: CacheConfig = {
    root: path.join(cwd, 'scripts', 'backtest-data', 'evidence-v1'),
    months: [...DEFAULT_EVIDENCE_MONTHS], universe: 'archive',
    datasets: ['futures5m', 'metrics', 'funding', 'spot5m'], refresh: false,
    maxSymbols: 0, concurrency: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg === '--refresh') cfg.refresh = true;
    else if (arg.startsWith('--months')) { cfg.months = value.split(','); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--datasets')) { cfg.datasets = value.split(',') as EvidenceDataset[]; if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--max-symbols')) { cfg.maxSymbols = Number(value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--concurrency')) { cfg.concurrency = Number(value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--root')) { cfg.root = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--universe')) { if (value !== 'archive') throw new Error('only --universe=archive is supported'); if (!arg.includes('=')) i++; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!cfg.months.length || cfg.months.some((m) => !/^\d{4}-\d{2}$/.test(m))) throw new Error('months must be comma-separated YYYY-MM');
  if (!Number.isFinite(cfg.concurrency) || cfg.concurrency < 1 || cfg.concurrency > 32) throw new Error('concurrency must be 1..32');
  if (!Number.isFinite(cfg.maxSymbols) || cfg.maxSymbols < 0) throw new Error('max-symbols must be >=0');
  const valid = new Set<EvidenceDataset>(['futures5m', 'metrics', 'funding', 'spot5m']);
  if (cfg.datasets.some((d) => !valid.has(d))) throw new Error('bad datasets');
  return cfg;
}
