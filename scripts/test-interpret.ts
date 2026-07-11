// Part 1 — offline regression: a throttled partial coin (fundingHist/oi
// shorter than candles, the 429 scan-path fallback) must degrade to
// skipped/neutral reads, never throw "Cannot read properties of undefined".
// Part 2 — headless live check: fetch a few real coins and print which
// interpretation patterns fire. Bundle with esbuild, run with node.
import { BN_LIVE, fetchLiveCoin, searchInstruments } from '../src/data/binance';
import { analyze, featureVector } from '../src/lib/analyze';
import { interpret, spotSignals, squeezeSignals } from '../src/lib/interpret';
import type { Candle, Coin, SeriesPoint, VolumeBar } from '../src/types';

// ---- Part 1: partial-coin regression ---------------------------------------

const N = 576; // 48h of 5m bars — same base length as a live scan coin
const T0 = 1_751_000_000;

interface Series {
  candles: Candle[];
  volume: VolumeBar[];
  oi: SeriesPoint[];
  fundingHist: SeriesPoint[];
}

function synthSeries(): Series {
  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  const oi: SeriesPoint[] = [];
  const fundingHist: SeriesPoint[] = [];
  let px = 1;
  for (let i = 0; i < N; i++) {
    const time = T0 + i * 300;
    const open = px;
    const close = px * (1 + 0.004 * Math.sin(i / 24) + (i % 7 === 0 ? 0.003 : -0.001));
    candles.push({
      time,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
    });
    volume.push({ time, value: 1e6 * (1 + 0.5 * Math.sin(i / 10)), up: close >= open });
    oi.push({ time, value: 5e7 * (1 + 0.1 * Math.sin(i / 50)) });
    fundingHist.push({ time, value: 0.01 * Math.sin(i / 30) });
    px = close;
  }
  return { candles, volume, oi, fundingHist };
}

function makeCoin(mut: (s: Series) => void): Coin {
  const s = synthSeries();
  mut(s);
  const derived = analyze({ ...s }); // must survive partial series
  return { symbol: 'TEST', ...s, ...derived, earlyAccum: null };
}

const partialCases: Array<[string, (s: Series) => void]> = [
  ['control (full-length series)', () => {}],
  ['fundingHist empty (429 catch fallback)', (s) => { s.fundingHist = []; }],
  ['fundingHist half-length', (s) => { s.fundingHist = s.fundingHist.slice(0, N / 2); }],
  ['oi half-length', (s) => { s.oi = s.oi.slice(0, N / 2); }],
  ['fundingHist + oi short', (s) => { s.fundingHist = s.fundingHist.slice(0, 60); s.oi = s.oi.slice(0, 100); }],
];

console.log('partial-coin regression:');
for (const [name, mut] of partialCases) {
  const coin = makeCoin(mut);
  const ins = interpret(coin);
  if (!Array.isArray(ins)) throw new Error(`${name}: interpret did not return an array`);
  if (!Number.isFinite(coin.strength)) throw new Error(`${name}: non-finite strength`);
  if (!Number.isFinite(coin.funding)) throw new Error(`${name}: non-finite funding`);
  squeezeSignals(coin);
  featureVector(coin.candles, coin.volume, coin.fundingHist);
  console.log(`  PASS ${name} (${ins.length} reads, str=${coin.strength})`);
}
// spot candidate with a failed funding fetch — spotSignals/buildCtx must skip
const spotCoin = makeCoin((s) => { s.fundingHist = []; });
spotCoin.spotCandles = spotCoin.candles;
spotCoin.spotVolume = spotCoin.volume;
spotCoin.basisPct = 0;
if (spotSignals(spotCoin) !== null) throw new Error('spot candidate with empty funding: expected null spotSignals');
console.log('  PASS spot candidate, fundingHist empty (spotSignals null)');

// ---- Part 2: live check -----------------------------------------------------

const hits = (await searchInstruments(BN_LIVE, '')).slice(0, 5);
for (const hit of hits) {
  const coin = await fetchLiveCoin(BN_LIVE, hit.base, Date.now());
  const ins = interpret(coin);
  console.log(
    `${coin.symbol.padEnd(7)} ${coin.regime.padEnd(10)} str=${String(coin.strength).padStart(2)} | ` +
      (ins.map((i) => `[${i.tone}] ${i.title}`).join('  ') || '—'),
  );
  for (const i of ins) console.log(`    ${i.detail}`);
}
