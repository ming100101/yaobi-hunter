import fs from 'node:fs';
import path from 'node:path';
import type { Candle, Coin, VolumeBar } from '../src/types';
import { recordingsDir } from './recordFile';

export const HOURLY_STORE_VERSION = 1;
export const HOURLY_STORE_CAP = 140;

export interface HourlySeries {
  candles: Candle[];
  volume: VolumeBar[];
}

export interface HourlyMarketState {
  v: 1;
  updatedAt: number;
  persistedHour: number;
  series: Record<string, HourlySeries>;
}

export function defaultHourlyMarketPath(): string {
  return path.join(path.dirname(recordingsDir()), 'market-1h.json');
}

const empty = (): HourlyMarketState => ({ v: 1, updatedAt: 0, persistedHour: 0, series: {} });

function sanitizeSeries(raw: any): HourlySeries | null {
  if (!raw || !Array.isArray(raw.candles) || !Array.isArray(raw.volume)) return null;
  const volumeByTime = new Map<number, VolumeBar>();
  for (const v of raw.volume) {
    if (Number.isFinite(v?.time) && Number.isFinite(v?.value) && v.value >= 0) volumeByTime.set(v.time, v);
  }
  const candles = raw.candles
    .filter((c: any) => Number.isFinite(c?.time) && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a: Candle, b: Candle) => a.time - b.time)
    .slice(-HOURLY_STORE_CAP);
  const volume = candles.map((c: Candle) => volumeByTime.get(c.time)).filter(Boolean) as VolumeBar[];
  if (volume.length !== candles.length) return null;
  return { candles, volume };
}

export function readHourlyMarketState(file = defaultHourlyMarketPath()): HourlyMarketState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = empty();
    state.updatedAt = Number(raw.updatedAt) || 0;
    state.persistedHour = Number(raw.persistedHour) || 0;
    for (const [sym, value] of Object.entries(raw.series ?? {})) {
      const series = sanitizeSeries(value);
      if (series) state.series[sym.toUpperCase()] = series;
    }
    return state;
  } catch {
    return empty();
  }
}

export function writeHourlyMarketState(state: HourlyMarketState, file = defaultHourlyMarketPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

export function mergeHourlySeries(state: HourlyMarketState, sym: string, incoming: HourlySeries): boolean {
  const key = sym.toUpperCase();
  const current = state.series[key] ?? { candles: [], volume: [] };
  const cMap = new Map(current.candles.map((x) => [x.time, x]));
  const vMap = new Map(current.volume.map((x) => [x.time, x]));
  for (const c of incoming.candles) cMap.set(c.time, c);
  for (const v of incoming.volume) vMap.set(v.time, v);
  const times = [...cMap.keys()].filter((t) => vMap.has(t)).sort((a, b) => a - b).slice(-HOURLY_STORE_CAP);
  const next = { candles: times.map((t) => cMap.get(t)!), volume: times.map((t) => vMap.get(t)!) };
  const beforeLast = current.candles[current.candles.length - 1]?.time ?? 0;
  const beforeN = current.candles.length;
  state.series[key] = next;
  state.updatedAt = Date.now();
  return beforeN !== next.candles.length || beforeLast !== (next.candles[next.candles.length - 1]?.time ?? 0);
}

export function completedHourlyFromFiveMinute(coin: Coin, nowMs: number): HourlySeries {
  const shift = -new Date(nowMs).getTimezoneOffset() * 60;
  const buckets = new Map<number, Array<{ c: Candle; v: VolumeBar }>>();
  for (let i = 0; i < Math.min(coin.candles.length, coin.volume.length); i++) {
    const c = coin.candles[i];
    const v = coin.volume[i];
    const utcTime = c.time - shift;
    const hour = Math.floor(utcTime / 3600) * 3600;
    if ((hour + 3600) * 1000 > nowMs) continue;
    const rows = buckets.get(hour) ?? [];
    rows.push({ c: { ...c, time: utcTime }, v: { ...v, time: utcTime } });
    buckets.set(hour, rows);
  }
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  for (const [hour, rows0] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const rows = rows0.sort((a, b) => a.c.time - b.c.time);
    if (rows.length !== 12) continue;
    let contiguous = true;
    for (let i = 0; i < 12; i++) if (rows[i].c.time !== hour + i * 300) contiguous = false;
    if (!contiguous) continue;
    const value = rows.reduce((a, x) => a + x.v.value, 0);
    const takerKnown = rows.every((x) => x.v.takerBuy != null);
    const open = rows[0].c.open;
    const close = rows[11].c.close;
    candles.push({
      time: hour,
      open,
      high: Math.max(...rows.map((x) => x.c.high)),
      low: Math.min(...rows.map((x) => x.c.low)),
      close,
    });
    volume.push({
      time: hour,
      value,
      up: close >= open,
      ...(takerKnown ? { takerBuy: rows.reduce((a, x) => a + (x.v.takerBuy ?? 0), 0) } : {}),
    });
  }
  return { candles, volume };
}

export class HourlyMarketStore {
  readonly file: string;
  state: HourlyMarketState;
  private dirty = false;

  constructor(file = defaultHourlyMarketPath()) {
    this.file = file;
    this.state = readHourlyMarketState(file);
  }

  get(sym: string): HourlySeries | undefined {
    return this.state.series[sym.toUpperCase()];
  }

  needsSeed(sym: string): boolean {
    return (this.get(sym)?.candles.length ?? 0) < 100;
  }

  ingestCoin(coin: Coin, nowMs: number): void {
    const series = completedHourlyFromFiveMinute(coin, nowMs);
    if (series.candles.length && mergeHourlySeries(this.state, coin.symbol, series)) this.dirty = true;
  }

  seed(sym: string, series: HourlySeries): void {
    if (mergeHourlySeries(this.state, sym, series)) this.dirty = true;
  }

  flush(nowMs = Date.now(), force = false): boolean {
    const hour = Math.floor(nowMs / 3600_000);
    if (!this.dirty || (!force && hour === this.state.persistedHour)) return false;
    this.state.persistedHour = hour;
    this.state.updatedAt = nowMs;
    writeHourlyMarketState(this.state, this.file);
    this.dirty = false;
    return true;
  }
}
