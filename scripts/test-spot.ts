// S1 checks:
//  (1) getSpotTickers hits the live Binance spot host and returns a populated map.
//  (2) the recording path serializes a coin's feat.spotVol24h/basisPct into the
//      reserved idx 19/20 (and stays null when absent) — deterministic, offline.
import { BN_LIVE, getSpotTickers } from '../src/data/binance';
import { buildScanRecord } from '../src/lib/recording';
import type { CoinLite } from '../src/types';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  (got ${JSON.stringify(got)})`}`);
};

// (1) live fetch
const map = await getSpotTickers(BN_LIVE);
console.log('spot map size:', map.size, '| BTC', JSON.stringify(map.get('BTC')));
ok('getSpotTickers returns >200 USDT pairs', map.size > 200, map.size);
ok('BTC spot present with USD volume', (map.get('BTC')?.volUsd ?? 0) > 1e7, map.get('BTC'));

// (2) recording serialization (idx 19 = spotVol24h, idx 20 = basisPct)
const base = (spot: { spotVol24h?: number | null; basisPct?: number | null }): CoinLite => ({
  symbol: 'BTC', regime: 'pump', strength: 80, change1h: 1, change24h: 2, oi4h: 3,
  funding: 0.01, volZ: 1.5, vol24h: 1e9, lastPrice: 62500, oiUsd: 1e9,
  flushBreakout: false, earlyAccum: false, riskFlags: [],
  signals: { fundsFirst: false, mildRise: true, oiHealthy: true, buyHealthy: true },
  feat: { ret4h: 1, pos: 0.5, buyShare4h: 0.6, f8h: 0.01, bbPctile: 0.5, lsDropPct: null, rsPct: null, oiDropPct: null, ...spot },
});

const withSpot = buildScanRecord([base({ spotVol24h: 361406323, basisPct: -0.05 })], 1_783_000_000_000, 'binance').coins[0];
ok('idx 19 spotVol24h rounded', withSpot[19] === 361406323, withSpot[19]);
ok('idx 20 basisPct (3dp)', withSpot[20] === -0.05, withSpot[20]);

const noSpot = buildScanRecord([base({})], 1_783_000_000_000, 'binance').coins[0];
ok('idx 19 null when no spot pair', noSpot[19] === null, noSpot[19]);
ok('idx 20 null when no spot pair', noSpot[20] === null, noSpot[20]);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
