import assert from 'node:assert/strict';
import { renderCandlePng } from './chartPng';
import type { Candle } from '../src/types';

const candles: Candle[] = [];
const start = 1_784_000_000;
let previous = 0.118;
for (let i = 0; i < 576; i++) {
  const wave = Math.sin(i / 18) * 0.0018 + Math.sin(i / 5) * 0.0004;
  const drift = i * 0.000006;
  const close = 0.118 + wave + drift;
  const open = previous;
  candles.push({
    time: start + i * 300,
    open,
    high: Math.max(open, close) + 0.00045,
    low: Math.min(open, close) - 0.0004,
    close,
  });
  previous = close;
}

const png = renderCandlePng(candles, {
  symbol: 'TEST',
  signal: 'FLUSH BREAKOUT',
  alertPrice: previous,
  watchLow: 0.1194,
  watchHigh: 0.1203,
  lastPrice: previous,
  change1hPct: 2.4,
  strength: 82,
  volZ: 3.2,
  oi4hPct: 4.5,
});

assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(png.readUInt32BE(16), 1000);
assert.equal(png.readUInt32BE(20), 640);
assert.ok(png.length > 10_000, 'dashboard should contain meaningful rendered detail');
assert.ok(png.length < 500_000, 'Telegram card should remain compact');

console.log('chart PNG dashboard render PASS (' + (png.length / 1024).toFixed(1) + ' KB, memory-only)');
