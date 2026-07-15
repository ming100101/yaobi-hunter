import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Coin } from '../src/types';
import { HourlyMarketStore, completedHourlyFromFiveMinute, readHourlyMarketState } from './hourlyMarketFile';

const utc = Date.UTC(2026, 6, 1, 0, 0);
const shift = 8 * 3600;
const candles = Array.from({ length: 25 }, (_, i) => {
  const open = 100 + i;
  return { time: utc / 1000 + shift + i * 300, open, high: open + 2, low: open - 1, close: open + 1 };
});
const volume = candles.map((c, i) => ({ time: c.time, value: 100 + i, up: true, takerBuy: 60 + i }));
const coin = { symbol: 'TEST', candles, volume } as Coin;
const hourly = completedHourlyFromFiveMinute(coin, utc + 2 * 3600_000 + 1);
assert.equal(hourly.candles.length, 2, 'the forming third hour is excluded');
assert.equal(hourly.candles[0].time, utc / 1000, 'display timezone shift is removed');
assert.equal(hourly.candles[0].open, 100);
assert.equal(hourly.candles[0].close, 112);
assert.equal(hourly.volume[0].takerBuy, volume.slice(0, 12).reduce((a, b) => a + b.takerBuy, 0));

const gapped = { ...coin, candles: candles.filter((_, i) => i !== 4), volume: volume.filter((_, i) => i !== 4) } as Coin;
assert.equal(completedHourlyFromFiveMinute(gapped, utc + 2 * 3600_000 + 1).candles.length, 1, 'an incomplete clock hour is discarded');

const file = path.resolve('scripts/.build/test-hourly-market.json');
try { fs.unlinkSync(file); } catch { /* clean fixture */ }
const store = new HourlyMarketStore(file);
store.seed('TEST', hourly);
assert.equal(store.flush(Date.now(), true), true);
const restored = readHourlyMarketState(file);
assert.equal(restored.series.TEST.candles.length, 2);
try { fs.unlinkSync(file); } catch { /* clean fixture */ }

console.log('hourly-market tests passed');
