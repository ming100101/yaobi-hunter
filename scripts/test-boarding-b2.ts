import assert from 'node:assert/strict';
import type { Candle, VolumeBar } from '../src/types';
import {
  BOARDING_B2_RULESET_ID,
  boardingB2QuantityOiQualified,
  evaluateBoardingB2,
  evaluateEma20ReclaimControl,
} from '../src/lib/boardingB2';

const t0 = Date.UTC(2026, 0, 1) / 1000;
function fixture(): { candles: Candle[]; volume: VolumeBar[] } {
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  for (let i = 0; i < 101; i++) {
    const close = i < 52 ? 100 : i < 100 ? 90 : 95;
    candles.push({
      time: t0 + i * 3600,
      open: i === 100 ? 90 : close,
      high: i === 100 ? 100 : close * 1.002,
      low: i === 100 ? 89 : close * 0.998,
      close,
    });
    volume.push({ time: t0 + i * 3600, value: i === 100 ? 1000 : 100 + (i % 7), up: close >= (i === 100 ? 90 : close) });
  }
  return { candles, volume };
}

const f = fixture();
const control = evaluateEma20ReclaimControl(f.candles, f.volume);
const b2 = evaluateBoardingB2(f.candles, f.volume);
assert.ok(control);
assert.ok(b2);
assert.equal(b2?.rulesetId, BOARDING_B2_RULESET_ID);
assert.equal(b2?.hoursBelow, 48);
assert.ok((b2?.atr14 ?? 0) > 0);
assert.ok((b2?.volZ1h ?? 0) >= 1.5);

const gap = fixture();
gap.candles[80].time += 60;
gap.volume[80].time += 60;
assert.equal(evaluateBoardingB2(gap.candles, gap.volume), null, 'a broken 1H path fails closed');

assert.equal(boardingB2QuantityOiQualified(0.1, 3), true);
assert.equal(boardingB2QuantityOiQualified(0, 3), false);
assert.equal(boardingB2QuantityOiQualified(1, null), false);

console.log('boarding-b2 tests passed');
