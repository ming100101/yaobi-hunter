import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  buildMonthlyUniverse,
  downloadArchiveCsv,
  isCoverageReusable,
  listArchiveSymbols,
  normalizeArchiveTimestamp,
  parseCacheArgs,
  parseChecksum,
  sha256,
  stableJson,
  summarizeKlineCsv,
  summarizeMetricsCsv,
  unzipSingle,
} from './evidenceCache';
import { addWithCooldown, asOf, earlySetupEnvelope, evaluateOutcome, fastBoardingFlags, parseAuditArgs, parseFundingText, parseMetricsText, squeezeD3Series, summarizeDetector, type Bar5 } from './evidenceAudit';
import { detectEarlySetup } from '../src/lib/analyze';
import { evaluateBoardingB2, evaluateEma20ReclaimControl } from '../src/lib/boardingB2';
import { squeezeSignals } from '../src/lib/interpret';
import type { Candle, Coin, SeriesPoint, VolumeBar } from '../src/types';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(() => { passed++; console.log(`PASS ${name}`); });
}

function zipOne(name: string, text: string): Buffer {
  const body = zlib.deflateRawSync(Buffer.from(text));
  const file = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(Buffer.byteLength(text), 22);
  header.writeUInt16LE(file.length, 26);
  return Buffer.concat([header, file, body]);
}

await test('timestamp parser accepts futures milliseconds and post-2025 spot microseconds', () => {
  assert.equal(normalizeArchiveTimestamp('1767225600000'), 1767225600000);
  assert.equal(normalizeArchiveTimestamp('1767225600000000'), 1767225600000);
  assert.equal(normalizeArchiveTimestamp('2026-01-01 00:05:00'), 1767225900000);
});

await test('checksum and single-file zip verification primitives', () => {
  const zip = zipOne('x.csv', 'a,b\n1,2\n');
  assert.equal(unzipSingle(zip), 'a,b\n1,2\n');
  assert.equal(parseChecksum(`${sha256(zip)}  x.zip`), sha256(zip));
  assert.equal(parseChecksum('not-a-checksum'), null);
});

await test('downloader handles verified archive, 404 and mismatch', async () => {
  const oldFetch = globalThis.fetch;
  const zip = zipOne('x.csv', 'a,b\n1,2\n');
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('missing')) return new Response('', { status: 404 });
      if (url.endsWith('.CHECKSUM')) return new Response(url.includes('bad') ? `${'0'.repeat(64)} x.zip` : `${sha256(zip)} x.zip`);
      return new Response(zip);
    }) as typeof fetch;
    assert.equal((await downloadArchiveCsv('https://fixture/good.zip'))?.csv, 'a,b\n1,2\n');
    assert.equal(await downloadArchiveCsv('https://fixture/missing.zip'), null);
    await assert.rejects(() => downloadArchiveCsv('https://fixture/bad.zip'), /checksum mismatch/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

await test('downloader retries transient archive failures', async () => {
  const oldFetch = globalThis.fetch;
  const zip = zipOne('x.csv', 'a,b\n1,2\n');
  let archiveCalls = 0;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('.CHECKSUM')) return new Response(`${sha256(zip)} x.zip`);
      archiveCalls++;
      return archiveCalls < 3 ? new Response('', { status: 503 }) : new Response(zip);
    }) as typeof fetch;
    assert.equal((await downloadArchiveCsv('https://fixture/retry.zip'))?.csv, 'a,b\n1,2\n');
    assert.equal(archiveCalls, 3);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

await test('archive symbol listing follows every S3 continuation page', async () => {
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (!url.includes('continuation-token=')) {
        return new Response('<ListBucketResult><IsTruncated>true</IsTruncated><CommonPrefixes><Prefix>data/spot/monthly/klines/AAAUSDT/</Prefix></CommonPrefixes><NextContinuationToken>token+one</NextContinuationToken></ListBucketResult>');
      }
      assert.equal(new URL(url).searchParams.get('continuation-token'), 'token+one');
      return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>data/spot/monthly/klines/ZZZUSDT/</Prefix></CommonPrefixes></ListBucketResult>');
    }) as typeof fetch;
    assert.deepEqual(await listArchiveSymbols('data/spot/monthly/klines/'), ['AAAUSDT', 'ZZZUSDT']);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

await test('kline and metrics coverage never zero-fill gaps', () => {
  const k = 'open_time,open,high,low,close,volume,close_time,quote_volume,trades,taker_base,taker_quote,ignore\n' +
    '1767225600000,1,2,1,2,1,0,10,1,0,6,0\n' +
    '1767226200000,2,3,2,3,1,0,20,1,0,11,0\n';
  const s = summarizeKlineCsv(k);
  assert.equal(s.rows, 2);
  assert.equal(s.gaps, 1);
  assert.equal(s.quoteVolume, 30);
  const m = 'create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio\n' +
    '2026-01-01 00:05:00,BTCUSDT,123,456,1.1,1.2,1.3,0.9\n';
  assert.equal(summarizeMetricsCsv(m).rows, 1);
});

await test('metrics keeps quantity OI separate from USD OI and funding stays decimal', () => {
  const rows = parseMetricsText('create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio\n2026-01-01 00:05:00,BTCUSDT,123,456,1.1,1.2,1.3,0.9\n');
  assert.equal(rows[0].qty, 123);
  assert.equal(rows[0].usd, 456);
  assert.equal(rows[0].ls, 1.3);
  const funding = parseFundingText('calc_time,funding_interval_hours,last_funding_rate\n1767225600000,8,0.0001\n');
  assert.equal(funding[0].rate, 0.0001);
});

await test('monthly universe handles listing gaps and multiplier aliases without survivorship filter', () => {
  const summary = (q: number) => ({ rows: 10, firstTs: 1, lastTs: 10, gaps: 0, quoteVolume: q });
  const u = buildMonthlyUniverse('2026-01', [
    { symbol: '1000BONKUSDT', summary: summary(200) },
    { symbol: 'BONKUSDT', summary: summary(100) },
    { symbol: 'NEWUSDT', summary: summary(50) },
    { symbol: 'OLDUSDT', summary: { ...summary(999), rows: 0 } },
  ]);
  assert.equal(u.find((x) => x.base === 'BONK')?.symbol, '1000BONKUSDT');
  assert.ok(u.some((x) => x.base === 'NEW'));
  assert.ok(!u.some((x) => x.base === 'OLD'));
});

await test('outcome starts at next native 15m open and fails closed on a missing bar', () => {
  const start = Date.parse('2026-01-01T00:00:00Z');
  const bars = Array.from({ length: 24 * 12 + 6 }, (_, i) => ({ t: start + i * 300_000, o: i === 3 ? 100 : 90, h: i >= 3 ? 111 : 500, l: 89, c: i === 24 * 12 + 2 ? 105 : 100, q: 1, tq: .5 }));
  const event = { key: 'x', label: 'x', sym: 'X', month: '2026-01', decisionTs: start + 1, side: 'long' as const, bars, funding: [{ t: start - 8 * 3_600_000, rate: .0001 }] };
  const out = evaluateOutcome(event, 10, 24);
  assert.equal(out.complete, true);
  assert.equal(out.hit, true);
  assert.ok(out.ret! > 0);
  const broken = { ...event, bars: bars.filter((x) => x.t !== start + 60 * 60_000) };
  assert.equal(evaluateOutcome(broken, 10, 24).complete, false);
  const shortBars = bars.map((x, i) => ({ ...x, o: i === 3 ? 100 : x.o, c: i === 24 * 12 + 2 ? 80 : x.c }));
  const short = evaluateOutcome({ ...event, side: 'short', bars: shortBars }, 10, 24);
  assert.ok(Math.abs(short.ret! - .2) < 1e-12, 'linear short return must use entry not exit as denominator');
});

await test('as-of observations never look forward and reject stale OI', () => {
  const points = [{ t: 1000, value: 1 }, { t: 2000, value: 2 }];
  assert.equal(asOf(points, 1999, 1000)?.value, 1);
  assert.equal(asOf(points, 2000, 1000)?.value, 2);
  assert.equal(asOf(points, 3001, 1000), null);
  assert.equal(asOf(points, 999, 1000), null);
});

await test('CLI defaults are offline and refresh is explicit', () => {
  assert.equal(parseAuditArgs(['--offline'], 'C:\\repo').offline, true);
  assert.equal(parseCacheArgs(['--refresh', '--months=2026-01'], 'C:\\repo').refresh, true);
  assert.equal(parseCacheArgs(['--months=2026-01'], 'C:\\repo').refresh, false);
});

await test('cache corruption is rejected and refresh bypasses an otherwise valid artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-cache-test-'));
  try {
    fs.writeFileSync(path.join(root, 'x.csv'), 'verified\n');
    const coverage = {
      dataset: 'futures5m' as const, symbol: 'XUSDT', base: 'X', period: '2026-01', status: 'complete' as const,
      relativePath: 'x.csv', cacheSha256: sha256('verified\n'), rows: 1, firstTs: 1, lastTs: 1, gaps: 0,
    };
    assert.equal(isCoverageReusable(root, coverage), true);
    assert.equal(isCoverageReusable(root, coverage, true), false);
    fs.writeFileSync(path.join(root, 'x.csv'), 'corrupt\n');
    assert.equal(isCoverageReusable(root, coverage), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test('stable JSON is byte-identical across key order', () => {
  assert.equal(stableJson({ b: 2, a: { d: 4, c: 3 } }), stableJson({ a: { c: 3, d: 4 }, b: 2 }));
});

await test('historical broad evaluators have zero bar mismatch with production pure detectors', () => {
  const start = Date.parse('2025-12-20T00:00:00Z');
  let seed = 123456789;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const h1: Bar5[] = [];
  const usd: number[] = [];
  const fund: number[] = [];
  let close = 100;
  let oi = 1_000_000;
  for (let i = 0; i < 180; i++) {
    const open = close;
    close *= 1 + (random() - .49) * .02;
    oi *= 1 + (random() - .5) * .012;
    const range = .003 + random() * .02;
    h1.push({ t: start + i * 3_600_000, o: open, h: Math.max(open, close) * (1 + range), l: Math.min(open, close) * (1 - range), c: close, q: (1 + random() * 3) * (i % 17 === 0 ? 5 : 1), tq: 0 });
    usd.push(oi);
    fund.push(i % 9 === 0 ? -.001 : .002);
  }
  const sq = squeezeD3Series(h1, usd, fund);
  const candles1h: Candle[] = h1.map((x) => ({ time: x.t / 1000, open: x.o, high: x.h, low: x.l, close: x.c }));
  const volume1h: VolumeBar[] = h1.map((x) => ({ time: x.t / 1000, value: x.q, up: x.c >= x.o }));
  for (let i = 100; i < h1.length; i++) {
    const c = candles1h.slice(0, i + 1);
    const v = volume1h.slice(0, i + 1);
    const fast = fastBoardingFlags(h1, i);
    assert.equal(fast.control, evaluateEma20ReclaimControl(c, v) != null, `EMA control mismatch at ${i}`);
    assert.equal(fast.b2, evaluateBoardingB2(c, v) != null, `B2 mismatch at ${i}`);

    const first = Math.max(0, i - 47);
    const c5: Candle[] = [];
    const v5: VolumeBar[] = [];
    const o5: SeriesPoint[] = [];
    const f5: SeriesPoint[] = [];
    for (let j = first; j <= i; j++) for (let k = 0; k < 12; k++) {
      const time = (h1[j].t + k * 300_000) / 1000;
      c5.push({ time, open: h1[j].o, high: h1[j].h, low: h1[j].l, close: h1[j].c });
      v5.push({ time, value: h1[j].q / 12, up: h1[j].c >= h1[j].o });
      o5.push({ time, value: usd[j] });
      f5.push({ time, value: fund[j] });
    }
    const coin = {
      symbol: 'FIX', regime: 'accumulate', strength: 50, change1h: 0,
      oi4h: i >= 4 ? (usd[i] / usd[i - 4] - 1) * 100 : 0, oiTrusted: true,
      funding: fund[i], volZ: 0, vol24h: 1, flushBreakout: false, earlyAccum: null,
      riskFlags: [], signals: { fundsFirst: false, mildRise: false, oiHealthy: false, buyHealthy: false },
      plan: { entry: close, kind: 'breakout', tp1: close, tp2: close, tp3: close, sl: close, runnerPct: 0 },
      candles: c5, volume: v5, oi: o5, fundingHist: f5,
      strengthHist: c5.map((x) => ({ time: x.time, value: 50 })),
    } satisfies Coin;
    const prodSq = squeezeSignals(coin);
    assert.equal(sq.setup[i], prodSq?.[0] === 1, `squeeze setup mismatch at ${i}`);
    assert.equal(sq.breakout[i], prodSq?.[1] === 1, `squeeze breakout mismatch at ${i}`);
    assert.equal(earlySetupEnvelope(h1, usd, fund, i), detectEarlySetup(c5, o5, f5) != null, `early setup mismatch at ${i}`);
  }
});

await test('statistics cover cooldown, monthly folds, bootstrap, coverage and concentration', () => {
  const makeEvent = (n: number, key: string, rising: boolean) => {
    const month = `2026-${String(n % 6 + 1).padStart(2, '0')}`;
    const decisionTs = Date.parse(`${month}-${String(Math.floor(n / 6) + 1).padStart(2, '0')}T00:00:00Z`);
    const bars = Array.from({ length: 600 }, (_, i) => {
      const px = rising ? 100 * (1 + .2 * i / 599) : 100;
      return { t: decisionTs + i * 300_000, o: px, h: px * 1.002, l: px * .998, c: px, q: 1, tq: .5 };
    });
    return { key, label: key, sym: `C${n % 8}`, month, decisionTs, side: 'long' as const, bars, funding: [{ t: decisionTs - 8 * 3_600_000, rate: 0 }] };
  };
  const cooldownEvents: any[] = [];
  const last = new Map<string, number>();
  const base = makeEvent(0, 'cool', true);
  addWithCooldown(cooldownEvents, last, base);
  addWithCooldown(cooldownEvents, last, { ...base, decisionTs: base.decisionTs + 23 * 3_600_000 });
  addWithCooldown(cooldownEvents, last, { ...base, decisionTs: base.decisionTs + 24 * 3_600_000 });
  assert.equal(cooldownEvents.length, 2);

  const events = Array.from({ length: 30 }, (_, i) => makeEvent(i, 'sig', true));
  const controls = Array.from({ length: 30 }, (_, i) => makeEvent(i, 'ctl', i % 3 === 0));
  const result = summarizeDetector({ key: 'sig', label: 'Signal', matchedKey: 'ctl' }, events, controls, .875);
  assert.equal(result.months, 6);
  assert.equal(result.coverage, .875);
  assert.equal(result.walkForwardTotal, 6);
  assert.ok(result.bootstrapLower95 != null);
  assert.ok(result.topCoinProfitShare != null);
  assert.ok(result.topDayProfitShare != null);
  assert.equal(result.horizons.length, 4);
});

console.log(`${passed}/${passed} evidence tests passed`);
