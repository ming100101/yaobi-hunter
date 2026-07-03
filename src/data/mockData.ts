import type {
  Candle,
  Coin,
  EntryKind,
  Regime,
  SeriesPoint,
  Signals,
  VolumeBar,
} from '../types';
import { hashString, makeRandn, mulberry32 } from '../lib/prng';
import { aggregateCandles, aggregateLast, aggregateVolume } from '../lib/aggregate';
import { detectFlushBreakout } from '../lib/analyze';

const BASE_SEC = 5 * 60; // 5m base resolution
const BASE_BARS = 576; // two days of 5m bars (divisible by every timeframe mult)
const SCAN_MS = 15 * 60 * 1000;
const BARS_24H = (24 * 60 * 60) / BASE_SEC; // 288

// Regime drift/sigma below are tuned per 15m bar; rescale them to the 5m base so
// aggregating 3 base bars back to 15m reproduces the same character. Drift is
// linear in time (×RES), diffusion scales with the square root of time.
const METRIC_MULT = 3; // base bars per 15m metric bar
const RES = BASE_SEC / (15 * 60); // 1/3
const SQRT_RES = Math.sqrt(RES);

interface Profile {
  symbol: string;
  base: number; // rough price magnitude
  volBase: number; // rough 24h USD volume
}

const UNIVERSE: Profile[] = [
  { symbol: 'PEPE', base: 0.0000112, volBase: 320e6 },
  { symbol: 'WIF', base: 1.87, volBase: 210e6 },
  { symbol: 'DOGE', base: 0.213, volBase: 540e6 },
  { symbol: 'SUI', base: 3.42, volBase: 380e6 },
  { symbol: 'SEI', base: 0.44, volBase: 90e6 },
  { symbol: 'TIA', base: 5.6, volBase: 120e6 },
  { symbol: 'ORDI', base: 38.5, volBase: 150e6 },
  { symbol: 'INJ', base: 24.8, volBase: 110e6 },
  { symbol: 'FET', base: 1.55, volBase: 95e6 },
  { symbol: 'ARKM', base: 1.9, volBase: 60e6 },
  { symbol: 'JTO', base: 2.9, volBase: 70e6 },
  { symbol: 'PYTH', base: 0.62, volBase: 55e6 },
  { symbol: 'BLUR', base: 0.41, volBase: 48e6 },
  { symbol: 'MEME', base: 0.026, volBase: 42e6 },
  { symbol: 'BOME', base: 0.0092, volBase: 66e6 },
  { symbol: 'TURBO', base: 0.0064, volBase: 38e6 },
];

const RISK_POOL: Record<Regime, string[]> = {
  accumulate: ['深度稀薄，滑價風險', '大盤相關性走弱'],
  pump: ['資金費率偏熱', 'OI 4h 增速過快', '離進場價過遠，追高風險'],
  distribute: ['高位放量滯漲', '資金費率過熱', '大額代幣轉入交易所', '主動買盤枯竭'],
};

const RISK_HIT_RATE: Record<Regime, number> = {
  accumulate: 0.25,
  pump: 0.45,
  distribute: 0.75,
};

function pickRegime(r: number): Regime {
  if (r < 0.44) return 'accumulate';
  if (r < 0.75) return 'pump';
  return 'distribute';
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// smoothstep on [0,1]
function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function buildCoin(p: Profile, seed: number, lastBarTime: number): Coin {
  const rand = mulberry32(seed);
  const randn = makeRandn(rand);
  const regime = pickRegime(rand());
  const t0 = lastBarTime - (BASE_BARS - 1) * BASE_SEC;

  const pumpStart = 0.55 + rand() * 0.2;
  const pumpPower = 0.0025 + rand() * 0.0035;
  const accLift = 0.0004 + rand() * 0.0006;
  const oiAccLate = 0.0025 + rand() * 0.003;

  const candles: Candle[] = [];
  const volume: VolumeBar[] = [];
  const oi: SeriesPoint[] = [];
  const fundingHist: SeriesPoint[] = [];
  const strengthHist: SeriesPoint[] = [];

  let price = p.base * (0.9 + rand() * 0.2);
  let oiVal = p.volBase * (0.25 + rand() * 0.2);
  let funding =
    regime === 'distribute'
      ? 0.05 + rand() * 0.05
      : regime === 'pump'
        ? 0.004 + rand() * 0.006
        : -0.012 + rand() * 0.014;

  for (let i = 0; i < BASE_BARS; i++) {
    const t = i / (BASE_BARS - 1);
    const time = t0 + i * BASE_SEC;

    let drift = 0;
    let sigma = 0.004;
    let volMult = 1;
    let oiDrift = 0.0002;
    let fundDrift = 0;

    if (regime === 'accumulate') {
      if (t < 0.45) {
        drift = -0.0007;
        sigma = 0.005;
        volMult = 0.9;
        oiDrift = 0.0001;
      } else if (t < 0.92) {
        drift = 0.00005;
        sigma = 0.0032;
        volMult = 0.75;
        oiDrift = 0.0006;
      } else {
        drift = accLift;
        sigma = 0.0035;
        volMult = 1.5;
        oiDrift = oiAccLate;
      }
      fundDrift = (-0.004 - funding) * 0.02;
    } else if (regime === 'pump') {
      if (t < pumpStart) {
        drift = 0.0001;
        sigma = 0.004;
        volMult = 0.85;
        oiDrift = 0.0004;
      } else {
        drift = pumpPower;
        sigma = 0.009;
        volMult = 2.6;
        oiDrift = 0.0035;
        fundDrift = 0.0009;
      }
    } else {
      if (t < 0.35) {
        drift = 0.0022;
        sigma = 0.007;
        volMult = 1.8;
        oiDrift = 0.002;
      } else if (t < 0.6) {
        drift = 0.0002;
        sigma = 0.008;
        volMult = 1.9;
        oiDrift = 0.0003;
      } else {
        drift = -0.0016;
        sigma = 0.009;
        volMult = 1.6;
        oiDrift = -0.0009;
        fundDrift = -0.0004;
      }
    }

    const open = price;
    const ret = drift * RES + sigma * SQRT_RES * randn();
    const close = open * (1 + ret);
    const wickSpan = sigma * SQRT_RES * (0.4 + rand());
    const high = Math.max(open, close) * (1 + wickSpan * rand());
    const low = Math.min(open, close) * (1 - wickSpan * rand());
    price = close;
    candles.push({ time, open, high, low, close });

    const vBase = p.volBase / BARS_24H;
    const v = vBase * volMult * (0.55 + rand() * 0.9) * (1 + Math.abs(ret) * 120);
    volume.push({ time, value: v, up: close >= open });

    oiVal *= 1 + oiDrift * RES + 0.0008 * SQRT_RES * randn();
    oi.push({ time, value: oiVal });

    funding = clamp(funding + fundDrift * RES + 0.0008 * SQRT_RES * randn(), -0.05, 0.15);
    fundingHist.push({ time, value: funding });
  }

  for (let i = 0; i < BASE_BARS; i++) {
    const t = i / (BASE_BARS - 1);
    let s: number;
    if (regime === 'accumulate') {
      s = 34 + 44 * smooth01((t - 0.35) / 0.6);
    } else if (regime === 'pump') {
      s = 46 + 44 * smooth01((t - pumpStart + 0.15) / 0.35);
    } else {
      s = 82 - 30 * smooth01((t - 0.45) / 0.5);
    }
    s += 2.2 * randn();
    strengthHist.push({ time: candles[i].time, value: clamp(s, 5, 98) });
  }

  // Scan metrics are computed on the 15m aggregation (the scanner's native
  // resolution) so they never shift when the display timeframe changes.
  const c15 = aggregateCandles(candles, METRIC_MULT);
  const vol15 = aggregateVolume(volume, c15, METRIC_MULT);
  const oi15 = aggregateLast(oi, METRIC_MULT);
  const f15 = aggregateLast(fundingHist, METRIC_MULT);
  const s15 = aggregateLast(strengthHist, METRIC_MULT);
  const M = c15.length; // 192

  const last = c15[M - 1].close;
  const change1h = (last / c15[M - 5].close - 1) * 100;
  const oi4h = (oi15[M - 1].value / oi15[M - 17].value - 1) * 100;

  const vols = vol15.map((v) => v.value);
  const prevWin = vols.slice(M - 97, M - 1);
  const mean = prevWin.reduce((a, b) => a + b, 0) / prevWin.length;
  const sd = Math.sqrt(prevWin.reduce((a, b) => a + (b - mean) ** 2, 0) / prevWin.length);
  const volZ = sd > 0 ? (vols[M - 1] - mean) / sd : 0;
  const vol24h = vols.slice(M - 96).reduce((a, b) => a + b, 0);

  const fundingNow = f15[M - 1].value;
  const strength = Math.round(s15[M - 1].value);

  const win = c15.slice(M - 96);
  const lo = Math.min(...win.map((c) => c.low));
  const hi = Math.max(...win.map((c) => c.high));
  const pricePos = hi > lo ? (last - lo) / (hi - lo) : 0.5;
  const last4h = vol15.slice(M - 16);
  const total4h = last4h.reduce((a, v) => a + v.value, 0);
  const greenShare =
    total4h > 0 ? last4h.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / total4h : 0.5;

  const signals: Signals = {
    fundsFirst: pricePos < 0.5 && oi4h > 1.2,
    mildRise: change1h > 0.2 && change1h < 3.2,
    oiHealthy: oi4h > 0.8 && oi4h < 14,
    buyHealthy: greenShare > 0.55,
  };

  const entry =
    regime === 'pump'
      ? c15[Math.min(M - 1, Math.floor(pumpStart * M))].close
      : last * (regime === 'accumulate' ? 1.002 : 0.995);
  const plan = {
    entry,
    kind: (regime === 'pump'
      ? 'pullback'
      : regime === 'accumulate'
        ? 'breakout'
        : 'reclaim') as EntryKind,
    tp1: entry * 1.04,
    tp2: entry * 1.08,
    tp3: entry * 1.15,
    sl: entry * 0.97,
    runnerPct: 5,
  };

  const riskFlags: string[] = [];
  for (const flag of RISK_POOL[regime]) {
    if (rand() < RISK_HIT_RATE[regime]) riskFlags.push(flag);
  }
  if (fundingNow > 0.06 && !riskFlags.includes('資金費率過熱')) riskFlags.push('資金費率過熱');

  return {
    symbol: p.symbol,
    regime,
    strength,
    change1h,
    oi4h,
    funding: fundingNow,
    volZ,
    vol24h,
    flushBreakout: !!detectFlushBreakout(candles, volume, oi, fundingHist),
    earlyAccum: null, // needs live long/short + BTC data — demo stays null
    riskFlags,
    signals,
    plan,
    candles,
    volume,
    oi,
    fundingHist,
    strengthHist,
  };
}

// Each scan is an independent synthetic snapshot: the full 2-day history is
// regenerated per 15-min slot (and per manual refresh via nonce), not appended
// to. Regime shapes are positioned relative to the window end by design, which
// is what a real data feed would replace. Returns FULL coins — the scan layer
// projects to CoinLite and keeps the fulls for offline detail views.
export function generateScan(nowMs: number, nonce = 0): { coins: Coin[]; scannedAt: number } {
  const slot = Math.floor(nowMs / SCAN_MS);
  // lightweight-charts renders UTCTimestamp in UTC, so shift bar times to
  // local. Computed per scan (not at module load) so it tracks DST changes.
  const tzShift = -new Date(nowMs).getTimezoneOffset() * 60;
  const lastBarTime = Math.floor(nowMs / 1000 / BASE_SEC) * BASE_SEC + tzShift;
  const coins = UNIVERSE.map((p) =>
    buildCoin(p, (hashString(p.symbol) ^ Math.imul(slot + nonce * 7919, 2654435761)) >>> 0, lastBarTime),
  );
  // strength desc, symbol asc as a stable tiebreak for equal integer scores
  coins.sort((a, b) => b.strength - a.strength || a.symbol.localeCompare(b.symbol));
  return { coins, scannedAt: nowMs };
}
