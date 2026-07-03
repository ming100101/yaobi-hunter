/* ---------------------------------------------------------------------------
 * Backtest harness for the "OI flush + basing" hypothesis (縮倉築底).
 *
 * Question under test: when a coin's open interest has been flushed well below
 * its recent high, price is compressed in a base, and funding is neutral —
 * does that identify small-cap pumps EARLIER than chasing, and with what lift
 * over the unconditional base rate?
 *
 * Data: OKX public endpoints at 1H resolution, ~30 days (rubik OI keeps ~720
 * hourly points). Fetched once, cached under backtest-data/, so parameter
 * sweeps are instant and agent-friendly.
 *
 * Usage (from yaobi-hunter/):
 *   npm run backtest                      # defaults: setup mode, small caps
 *   npm run backtest -- --mode breakout --volz 1.5
 *   npm run backtest -- --target 20 --horizon 48 --json
 *   npm run backtest -- --refresh        # refetch market data
 *
 * Modes:
 *   setup    — signal fires on flush+basing+neutral funding (+OI inflection).
 *              Tests "can we flag it BEFORE the move".
 *   breakout — additionally requires price to break the base high on volume.
 *              Tests the confirmed-trigger version.
 *
 * Honesty notes printed with every run: one ~30d window = one market regime;
 * signals cluster by coin; MFE uses intra-bar highs (optimistic vs fills).
 * ------------------------------------------------------------------------- */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBinancePerpBases } from '../src/data/binanceUniverse';

const OKX = 'https://www.okx.com';
const BNV = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'backtest-data');

// ---------------------------------------------------------------- CLI args
interface Args {
  mode: 'setup' | 'breakout';
  refresh: boolean;
  json: boolean;
  maxCoins: number;
  minVol: number;
  maxVol: number;
  flushPct: number; // OI now below its lookback max by at least this %
  flushHours: number;
  inflectHours: number; // OI rising over the last N hours (0 disables)
  baseHours: number;
  baseRange: number; // max close-to-close range % of the base window
  neutralFunding: number; // |funding %| ceiling
  fundingAsym: boolean; // asymmetric gate: only exclude funding ABOVE the ceiling (negative = shorts pay = bullish, allowed) — motivated by the PEPE post-mortem
  volz: number; // breakout-mode volume z requirement
  target: number; // pump target % (MFE within horizon)
  horizon: number; // hours forward
  cooldown: number; // hours between signals per coin
  cacheHours: number;
  // ---- ablation filters (each 0/null = disabled) ----
  takerShare: number; // require taker BUY share over the base window ≥ this (e.g. 0.53)
  lsDrop: number; // require long/short account ratio to have dropped ≥ this % over the base window
  rsMin: number | null; // require coin-vs-BTC relative return (%) over the base window ≥ this
}

function parseArgs(): Args {
  const a: Args = {
    mode: 'setup',
    refresh: false,
    json: false,
    maxCoins: 0, // 0 = no cap
    minVol: 2e6,
    maxVol: 150e6,
    flushPct: 8,
    flushHours: 48,
    inflectHours: 6,
    baseHours: 24,
    baseRange: 6,
    neutralFunding: 0.01,
    fundingAsym: false,
    volz: 1.5,
    target: 15,
    horizon: 24,
    cooldown: 24,
    cacheHours: 12,
    takerShare: 0,
    lsDrop: 0,
    rsMin: null,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const num = () => {
      i++;
      return Number(v);
    };
    if (k === '--mode') {
      i++;
      if (v !== 'setup' && v !== 'breakout') throw new Error(`bad --mode ${v}`);
      a.mode = v;
    } else if (k === '--refresh') a.refresh = true;
    else if (k === '--json') a.json = true;
    else if (k === '--max-coins') a.maxCoins = num();
    else if (k === '--min-vol') a.minVol = num();
    else if (k === '--max-vol') a.maxVol = num();
    else if (k === '--flush-pct') a.flushPct = num();
    else if (k === '--flush-hours') a.flushHours = num();
    else if (k === '--inflect-hours') a.inflectHours = num();
    else if (k === '--base-hours') a.baseHours = num();
    else if (k === '--base-range') a.baseRange = num();
    else if (k === '--neutral-funding') a.neutralFunding = num();
    else if (k === '--funding-asym') a.fundingAsym = true;
    else if (k === '--volz') a.volz = num();
    else if (k === '--target') a.target = num();
    else if (k === '--horizon') a.horizon = num();
    else if (k === '--cooldown') a.cooldown = num();
    else if (k === '--cache-hours') a.cacheHours = num();
    else if (k === '--taker-share') a.takerShare = num();
    else if (k === '--ls-drop') a.lsDrop = num();
    else if (k === '--rs-min') a.rsMin = num();
    else throw new Error(`unknown arg ${k}`);
  }
  return a;
}

// ---------------------------------------------------------------- fetching
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function okxGet(pathname: string, tries = 3): Promise<any[]> {
  let lastErr: unknown;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(OKX + pathname);
      if (res.status === 429 || res.status >= 500) {
        await sleep(600 * (k + 1));
        continue;
      }
      const j: any = await res.json();
      if (j.code !== undefined && j.code !== '0') throw new Error(`okx ${j.code} ${j.msg}`);
      return j.data ?? [];
    } catch (e) {
      lastErr = e;
      await sleep(400 * (k + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`okx failed: ${pathname}`);
}

interface Bar {
  t: number; // ms epoch, hour-open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // USDT notional
}

// bump when the cached shape changes — older cache entries are refetched
const DATA_VERSION = 2;

interface CoinData {
  version?: number;
  symbol: string;
  instId: string;
  vol24hUsd: number;
  bars: Bar[]; // ascending
  oi: number[]; // aligned to bars
  funding: number[]; // % per 8h, aligned (step)
  takerBuy: number[]; // taker BUY volume per bar (rubik, aligned)
  takerSell: number[]; // taker SELL volume per bar
  lsRatio: number[]; // long/short account ratio, aligned (step)
  fetchedAt: number;
}

async function fetch1hCandles(instId: string): Promise<Bar[]> {
  let rows: any[] = [];
  let after = '';
  for (let page = 0; page < 3; page++) {
    const q = `/api/v5/market/candles?instId=${instId}&bar=1H&limit=300` + (after ? `&after=${after}` : '');
    const p = await okxGet(q);
    if (!p.length) break;
    rows = rows.concat(p);
    after = p[p.length - 1][0];
  }
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)))
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[7]),
    }));
}

function alignSeries(bars: Bar[], src: Array<{ t: number; v: number }>): number[] {
  const s = [...src].sort((a, b) => a.t - b.t);
  const out: number[] = [];
  let j = 0;
  let cur = s.length ? s[0].v : 0;
  for (const b of bars) {
    while (j < s.length && s[j].t <= b.t) {
      cur = s[j].v;
      j++;
    }
    out.push(cur);
  }
  return out;
}

async function fetchCoin(symbol: string, instId: string, vol24hUsd: number): Promise<CoinData | null> {
  const bars = await fetch1hCandles(instId);
  if (bars.length < 200) return null; // too newly listed for a 30d test
  const oiRows = await okxGet(`/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${symbol}&period=1H`).catch(
    () => [],
  );
  if (!oiRows.length) return null; // hypothesis needs OI
  const fundRows = await okxGet(`/api/v5/public/funding-rate-history?instId=${instId}&limit=100`).catch(() => []);
  // taker aggressor flow — docs: return array order is [ts, sellVol, buyVol]
  const takerRows = await okxGet(
    `/api/v5/rubik/stat/taker-volume?ccy=${symbol}&instType=CONTRACTS&period=1H`,
  ).catch(() => []);
  // retail positioning — [ts, longAccounts/shortAccounts]
  const lsRows = await okxGet(
    `/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${symbol}&period=1H`,
  ).catch(() => []);

  const oi = alignSeries(
    bars,
    oiRows.map((r: any) => ({ t: Number(r[0]), v: Number(r[1]) })).filter((p: any) => Number.isFinite(p.v)),
  );
  const funding = alignSeries(
    bars,
    fundRows
      .map((r: any) => ({ t: Number(r.fundingTime), v: Number(r.fundingRate) * 100 }))
      .filter((p: any) => Number.isFinite(p.v)),
  );
  const takerSell = alignSeries(
    bars,
    takerRows.map((r: any) => ({ t: Number(r[0]), v: Number(r[1]) })).filter((p: any) => Number.isFinite(p.v)),
  );
  const takerBuy = alignSeries(
    bars,
    takerRows.map((r: any) => ({ t: Number(r[0]), v: Number(r[2]) })).filter((p: any) => Number.isFinite(p.v)),
  );
  const lsRatio = alignSeries(
    bars,
    lsRows.map((r: any) => ({ t: Number(r[0]), v: Number(r[1]) })).filter((p: any) => Number.isFinite(p.v)),
  );
  return {
    version: DATA_VERSION,
    symbol,
    instId,
    vol24hUsd,
    bars,
    oi,
    funding,
    takerBuy,
    takerSell,
    lsRatio,
    fetchedAt: Date.now(),
  };
}

async function loadUniverse(args: Args): Promise<CoinData[]> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const bn = await getBinancePerpBases(BNV);
  const tickers = await okxGet('/api/v5/market/tickers?instType=SWAP');
  const list: Array<{ symbol: string; instId: string; vol: number }> = [];
  for (const r of tickers) {
    const instId: string = r.instId;
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const b = instId.slice(0, -'-USDT-SWAP'.length);
    if (!bn.has(b)) continue;
    const vol = Number(r.last) * Number(r.volCcy24h);
    if (!Number.isFinite(vol) || vol < args.minVol || vol > args.maxVol) continue;
    list.push({ symbol: b, instId, vol });
  }
  list.sort((a, b) => b.vol - a.vol);
  const capped = args.maxCoins > 0 ? list.slice(0, args.maxCoins) : list;
  console.error(`universe: ${capped.length} coins (24h vol $${(args.minVol / 1e6).toFixed(0)}M-$${(args.maxVol / 1e6).toFixed(0)}M, binance-listed)`);

  const out: CoinData[] = [];
  let fetched = 0;
  for (const item of capped) {
    const file = path.join(DATA_DIR, `${item.symbol}.json`);
    let data: CoinData | null = null;
    if (!args.refresh && fs.existsSync(file)) {
      try {
        const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as CoinData;
        // version gate: cache entries from before the taker/ls fields refetch
        if (cached.version === DATA_VERSION && Date.now() - cached.fetchedAt < args.cacheHours * 3600_000) {
          data = cached;
        }
      } catch {
        data = null;
      }
    }
    if (!data) {
      data = await fetchCoin(item.symbol, item.instId, item.vol).catch(() => null);
      if (data) fs.writeFileSync(file, JSON.stringify(data));
      await sleep(450); // rubik OI is strictly rate-limited
      fetched++;
      if (fetched % 20 === 0) console.error(`  fetched ${fetched}...`);
    }
    if (data) {
      data.vol24hUsd = item.vol;
      out.push(data);
    }
  }
  console.error(`loaded ${out.length} coins (${fetched} fetched fresh, rest from cache)`);
  return out;
}

// ---------------------------------------------------------------- signal
function volZAt(bars: Bar[], i: number): number {
  const s = Math.max(0, i - 24);
  const win = bars.slice(s, i).map((b) => b.v);
  if (win.length < 8) return 0;
  const m = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
  return sd > 0 ? (bars[i].v - m) / sd : 0;
}

function signalAt(d: CoinData, i: number, a: Args, btcClose: Map<number, number>): boolean {
  const { bars, oi, funding } = d;
  // OI flush: current OI well below its recent lookback high
  let oiMax = 0;
  for (let j = i - a.flushHours; j <= i; j++) oiMax = Math.max(oiMax, oi[j]);
  if (!(oiMax > 0) || oi[i] > oiMax * (1 - a.flushPct / 100)) return false;
  // OI inflection: rising off the low over the last N hours
  if (a.inflectHours > 0 && !(oi[i] > oi[i - a.inflectHours] * 1.005)) return false;
  // basing: close-to-close range of the base window is tight
  let cMax = -Infinity;
  let cMin = Infinity;
  for (let j = i - a.baseHours; j < i; j++) {
    cMax = Math.max(cMax, bars[j].c);
    cMin = Math.min(cMin, bars[j].c);
  }
  if (!(cMin > 0) || (cMax / cMin - 1) * 100 > a.baseRange) return false;
  // funding neutral
  if (a.fundingAsym ? funding[i] > a.neutralFunding : Math.abs(funding[i]) > a.neutralFunding) return false;

  // ---- ablation filters (each independently optional) ----
  // absorption: aggressive buying dominates during the base yet price is flat
  if (a.takerShare > 0) {
    let buy = 0;
    let sell = 0;
    for (let j = i - a.baseHours; j < i; j++) {
      buy += d.takerBuy[j] ?? 0;
      sell += d.takerSell[j] ?? 0;
    }
    const tot = buy + sell;
    if (!(tot > 0) || buy / tot < a.takerShare) return false;
  }
  // retail capitulation: long/short account ratio fell over the base window
  if (a.lsDrop > 0) {
    const then = d.lsRatio[i - a.baseHours] ?? 0;
    const now = d.lsRatio[i] ?? 0;
    if (!(then > 0) || !(now > 0) || now > then * (1 - a.lsDrop / 100)) return false;
  }
  // relative strength: coin outperformed BTC over the base window
  if (a.rsMin !== null) {
    const bNow = btcClose.get(bars[i].t);
    const bThen = btcClose.get(bars[i - a.baseHours].t);
    if (!bNow || !bThen) return false;
    const rs = (bars[i].c / bars[i - a.baseHours].c - bNow / bThen) * 100;
    if (rs < a.rsMin) return false;
  }

  // breakout trigger (confirmed mode)
  if (a.mode === 'breakout') {
    if (!(bars[i].c > cMax)) return false;
    if (volZAt(d.bars, i) < a.volz) return false;
  }
  return true;
}

// ---------------------------------------------------------------- metrics
interface Outcome {
  symbol: string;
  t: number;
  entry: number;
  mfe: number; // max favorable (high-based), fraction
  mae: number; // max adverse (low-based), fraction
  retH: number; // close-to-close at horizon
  hit: boolean;
}

function outcomeAt(d: CoinData, i: number, a: Args): Outcome {
  const entry = d.bars[i].c;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i + 1; j <= i + a.horizon; j++) {
    hi = Math.max(hi, d.bars[j].h);
    lo = Math.min(lo, d.bars[j].l);
  }
  const mfe = hi / entry - 1;
  const mae = lo / entry - 1;
  const retH = d.bars[i + a.horizon].c / entry - 1;
  return { symbol: d.symbol, t: d.bars[i].t, entry, mfe, mae, retH, hit: mfe >= a.target / 100 };
}

function summarize(list: Outcome[]) {
  const n = list.length;
  if (!n) return { n: 0, hitRate: 0, meanMfe: 0, medMfe: 0, meanMae: 0, meanRetH: 0, medRetH: 0 };
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const med = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n,
    hitRate: list.filter((o) => o.hit).length / n,
    meanMfe: mean(list.map((o) => o.mfe)),
    medMfe: med(list.map((o) => o.mfe)),
    meanMae: mean(list.map((o) => o.mae)),
    meanRetH: mean(list.map((o) => o.retH)),
    medRetH: med(list.map((o) => o.retH)),
  };
}

// ---------------------------------------------------------------- main
const args = parseArgs();
const coins = await loadUniverse(args);

// BTC benchmark for the relative-strength filter (cached like coin data)
let btcClose = new Map<number, number>();
if (args.rsMin !== null) {
  const btcFile = path.join(DATA_DIR, '_BTC-benchmark.json');
  let btcBars: Bar[] | null = null;
  if (!args.refresh && fs.existsSync(btcFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(btcFile, 'utf8'));
      if (cached.version === DATA_VERSION && Date.now() - cached.fetchedAt < args.cacheHours * 3600_000) {
        btcBars = cached.bars;
      }
    } catch {
      btcBars = null;
    }
  }
  if (!btcBars) {
    btcBars = await fetch1hCandles('BTC-USDT-SWAP');
    fs.writeFileSync(btcFile, JSON.stringify({ version: DATA_VERSION, fetchedAt: Date.now(), bars: btcBars }));
  }
  btcClose = new Map(btcBars.map((b) => [b.t, b.c]));
  console.error(`btc benchmark: ${btcBars.length} bars`);
}

const warmup = Math.max(args.flushHours, args.baseHours) + 2;
const signals: Outcome[] = [];
const baseline: Outcome[] = [];
const perCoin = new Map<string, number>();
let barsEvaluated = 0;

for (const d of coins) {
  const lastEval = d.bars.length - args.horizon - 1;
  let cooldownUntil = -1;
  for (let i = warmup; i <= lastEval; i++) {
    barsEvaluated++;
    baseline.push(outcomeAt(d, i, args));
    if (i < cooldownUntil) continue;
    if (signalAt(d, i, args, btcClose)) {
      signals.push(outcomeAt(d, i, args));
      perCoin.set(d.symbol, (perCoin.get(d.symbol) ?? 0) + 1);
      cooldownUntil = i + args.cooldown;
    }
  }
}

const sig = summarize(signals);
const base = summarize(baseline);
const lift = base.hitRate > 0 ? sig.hitRate / base.hitRate : 0;
const spanDays =
  coins.length > 0
    ? Math.round((coins[0].bars[coins[0].bars.length - 1].t - coins[0].bars[0].t) / 86_400_000)
    : 0;

const result = {
  params: args,
  universe: coins.length,
  spanDays,
  barsEvaluated,
  signal: sig,
  baseline: base,
  lift,
  coinsWithSignals: perCoin.size,
  topSignals: [...signals]
    .sort((a, b) => b.mfe - a.mfe)
    .slice(0, 10)
    .map((o) => ({
      symbol: o.symbol,
      time: new Date(o.t).toISOString().slice(0, 13),
      mfePct: +(o.mfe * 100).toFixed(1),
      maePct: +(o.mae * 100).toFixed(1),
    })),
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log('');
  console.log(`=== OI-flush+basing backtest — mode=${args.mode} ===`);
  console.log(
    `universe ${coins.length} coins ($${(args.minVol / 1e6).toFixed(0)}M-$${(args.maxVol / 1e6).toFixed(0)}M) · ~${spanDays}d @1H · ${barsEvaluated.toLocaleString()} bars`,
  );
  console.log(
    `signal: flush≥${args.flushPct}%/${args.flushHours}h, base≤${args.baseRange}%/${args.baseHours}h, |funding|≤${args.neutralFunding}%` +
      (args.inflectHours ? `, OI↑${args.inflectHours}h` : '') +
      (args.mode === 'breakout' ? `, breakout+volZ≥${args.volz}` : ''),
  );
  console.log(`outcome: MFE ≥ +${args.target}% within ${args.horizon}h`);
  const extras: string[] = [];
  if (args.takerShare > 0) extras.push(`takerBuyShare≥${args.takerShare}`);
  if (args.lsDrop > 0) extras.push(`lsRatioDrop≥${args.lsDrop}%`);
  if (args.rsMin !== null) extras.push(`rsVsBTC≥${args.rsMin}%`);
  if (extras.length) console.log(`ablation filters: ${extras.join(', ')}`);
  console.log('');
  console.log(`               signals    baseline(all bars)`);
  console.log(`count          ${String(sig.n).padEnd(10)} ${base.n.toLocaleString()}`);
  console.log(`hit rate       ${pct(sig.hitRate).padEnd(10)} ${pct(base.hitRate)}    lift ×${lift.toFixed(2)}`);
  console.log(`mean MFE       ${pct(sig.meanMfe).padEnd(10)} ${pct(base.meanMfe)}`);
  console.log(`median MFE     ${pct(sig.medMfe).padEnd(10)} ${pct(base.medMfe)}`);
  console.log(`mean MAE       ${pct(sig.meanMae).padEnd(10)} ${pct(base.meanMae)}`);
  console.log(`mean ret@${args.horizon}h   ${pct(sig.meanRetH).padEnd(10)} ${pct(base.meanRetH)}`);
  console.log(`median ret@${args.horizon}h ${pct(sig.medRetH).padEnd(10)} ${pct(base.medRetH)}`);
  console.log(`coins firing   ${perCoin.size}/${coins.length}`);
  console.log('');
  if (result.topSignals.length) {
    console.log('top signals by MFE:');
    for (const s of result.topSignals) console.log(`  ${s.symbol.padEnd(8)} ${s.time}  MFE +${s.mfePct}%  MAE ${s.maePct}%`);
    console.log('');
  }
  console.log('caveats: single ~30d window (one market regime); signals cluster by');
  console.log('coin; MFE uses intra-bar highs (optimistic vs real fills, no fees).');
}
