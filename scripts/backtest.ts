/* ---------------------------------------------------------------------------
 * Backtest harness — reconstructed from scripts/.build/backtest.mjs after an
 * accidental `git checkout` clobbered the uncommitted working source.
 * Logic is byte-faithful to the last-built bundle (ignition/boarding/etc.).
 * TypeScript type annotations were stripped by esbuild and are not restored;
 * the file still type-checks-and-runs because esbuild strips types at build.
 * ------------------------------------------------------------------------- */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseUmSymbol } from "../src/data/binance";

// scripts/backtest.ts
var FAPI = "https://fapi.binance.com";
var SPOT = "https://api.binance.com";
var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var DATA_DIR = path.join(ROOT, "backtest-data");
function parseArgs() {
  const a = {
    mode: "setup",
    refresh: false,
    json: false,
    dumpSignals: false,
    pnl: false,
    matched: false,
    matchedClose: false,
    maxCoins: 0,
    // 0 = no cap
    minVol: 2e6,
    maxVol: 15e7,
    flushPct: 8,
    flushHours: 48,
    inflectHours: 6,
    baseHours: 24,
    baseRange: 6,
    neutralFunding: 0.01,
    fundingAsym: false,
    volz: 1.5,
    ignRet: 5,
    ignOi6: 0,
    target: 15,
    horizon: 24,
    cooldown: 24,
    cacheHours: 12,
    takerShare: 0,
    lsDrop: 0,
    rsMin: null,
    spotVolz: 2,
    spotBasis: 0.05,
    spotBuyshare: 0.55,
    spotRatio: 1.5,
    sqDef: "D2",
    sqThresh: 0,
    sqConfirm: "either",
    // spec canonical: squeeze ∧ (funding≤0 ∨ oi-confirm)
    sqStage: "breakout",
    // 主菜 — S2 教訓: quiet setup alone tests weak
    sqRecentH: 6,
    bdDef: "B1",
    bdRet4hCap: 6,
    bdPosCap: 0.7,
    bdThresh: 0,
    bdScan: false,
    rbDef: "R1",
    rbFlush: 8,
    rbOi4h: 3,
    rbRet4hCap: 6,
    rbFundCap: 0.02,
    vgDef: "V1",
    vgOi4h: 3,
    vgOi24h: 8,
    vgFundCap: 0.02,
    topDef: "T1",
    topRet24: 15,
    topPos: 0.8,
    topThresh: 0,
    wbDef: "W1",
    wbTol: 1,
    wbSepMax: 12,
    wbRecent: 6,
    wbVolz: 0,
    fwDef: "F1",
    fwWick: 0.6,
    fwLookback: 24,
    fwClosePos: 0.5,
    vwapVariant: "A1",
    vwapAnchor: "flush",
    vwapVolz: 1.5,
    vwapAbl: false
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const num = () => {
      i++;
      return Number(v);
    };
    if (k === "--mode") {
      i++;
      if (v !== "setup" && v !== "breakout" && v !== "spot-pump" && v !== "spot-accum" && v !== "squeeze" && v !== "boarding" && v !== "rebuild" && v !== "top" && v !== "wbottom" && v !== "flushwick" && v !== "virgin" && v !== "ignition" && v !== "vwap-reclaim")
        throw new Error(`bad --mode ${v}`);
      a.mode = v;
    } else if (k === "--fw-def") {
      i++;
      if (v !== "F1" && v !== "F2" && v !== "F3") throw new Error(`bad --fw-def ${v}`);
      a.fwDef = v;
    } else if (k === "--fw-wick") a.fwWick = num();
    else if (k === "--fw-lookback") a.fwLookback = num();
    else if (k === "--fw-close-pos") a.fwClosePos = num();
    else if (k === "--vwap-variant") {
      i++;
      if (v !== "A1" && v !== "A2" && v !== "A3") throw new Error(`bad --vwap-variant ${v}`);
      a.vwapVariant = v;
    } else if (k === "--vwap-anchor") {
      i++;
      if (v !== "flush" && v !== "base-low") throw new Error(`bad --vwap-anchor ${v}`);
      a.vwapAnchor = v;
    } else if (k === "--vwap-volz") a.vwapVolz = num();
    else if (k === "--vwap-abl") a.vwapAbl = true;
    else if (k === "--rb-def") {
      i++;
      if (v !== "R1" && v !== "R2" && v !== "R3") throw new Error(`bad --rb-def ${v}`);
      a.rbDef = v;
    } else if (k === "--rb-flush") a.rbFlush = num();
    else if (k === "--rb-oi4h") a.rbOi4h = num();
    else if (k === "--rb-ret4h-cap") a.rbRet4hCap = num();
    else if (k === "--rb-fund-cap") a.rbFundCap = num();
    else if (k === "--vg-def") {
      i++;
      if (v !== "V1" && v !== "V2" && v !== "V3") throw new Error(`bad --vg-def ${v}`);
      a.vgDef = v;
    } else if (k === "--vg-oi4h") a.vgOi4h = num();
    else if (k === "--vg-oi24h") a.vgOi24h = num();
    else if (k === "--vg-fund-cap") a.vgFundCap = num();
    else if (k === "--top-def") {
      i++;
      if (v !== "T1" && v !== "T2" && v !== "T3" && v !== "T4") throw new Error(`bad --top-def ${v}`);
      a.topDef = v;
    } else if (k === "--top-ret24") a.topRet24 = num();
    else if (k === "--top-pos") a.topPos = num();
    else if (k === "--top-thresh") a.topThresh = num();
    else if (k === "--wb-def") {
      i++;
      if (v !== "W1" && v !== "W2" && v !== "W3") throw new Error(`bad --wb-def ${v}`);
      a.wbDef = v;
    } else if (k === "--wb-tol") a.wbTol = num();
    else if (k === "--wb-sep-max") a.wbSepMax = num();
    else if (k === "--wb-recent") a.wbRecent = num();
    else if (k === "--wb-volz") a.wbVolz = num();
    else if (k === "--sq-def") {
      i++;
      if (v !== "D1" && v !== "D2" && v !== "D3" && v !== "D4") throw new Error(`bad --sq-def ${v}`);
      a.sqDef = v;
    } else if (k === "--sq-thresh") a.sqThresh = num();
    else if (k === "--sq-confirm") {
      i++;
      if (v !== "either" && v !== "funding" && v !== "oi" && v !== "both" && v !== "none")
        throw new Error(`bad --sq-confirm ${v}`);
      a.sqConfirm = v;
    } else if (k === "--sq-stage") {
      i++;
      if (v !== "setup" && v !== "breakout") throw new Error(`bad --sq-stage ${v}`);
      a.sqStage = v;
    } else if (k === "--sq-recent") a.sqRecentH = num();
    else if (k === "--bd-def") {
      i++;
      if (v !== "B1" && v !== "B2" && v !== "B3") throw new Error(`bad --bd-def ${v}`);
      a.bdDef = v;
    } else if (k === "--bd-ret4h-cap") a.bdRet4hCap = num();
    else if (k === "--bd-pos-cap") a.bdPosCap = num();
    else if (k === "--bd-thresh") a.bdThresh = num();
    else if (k === "--bd-scan") a.bdScan = true;
    else if (k === "--refresh") a.refresh = true;
    else if (k === "--json") a.json = true;
    else if (k === "--dump-signals") a.dumpSignals = true;
    else if (k === "--pnl") a.pnl = true;
    else if (k === "--matched") a.matched = true;
    else if (k === "--matched-close") {
      a.matched = true;
      a.matchedClose = true;
    } else if (k === "--max-coins") a.maxCoins = num();
    else if (k === "--min-vol") a.minVol = num();
    else if (k === "--max-vol") a.maxVol = num();
    else if (k === "--flush-pct") a.flushPct = num();
    else if (k === "--flush-hours") a.flushHours = num();
    else if (k === "--inflect-hours") a.inflectHours = num();
    else if (k === "--base-hours") a.baseHours = num();
    else if (k === "--base-range") a.baseRange = num();
    else if (k === "--neutral-funding") a.neutralFunding = num();
    else if (k === "--ign-ret") a.ignRet = num();
    else if (k === "--ign-oi6") a.ignOi6 = num();
    else if (k === "--funding-asym") a.fundingAsym = true;
    else if (k === "--volz") a.volz = num();
    else if (k === "--target") a.target = num();
    else if (k === "--horizon") a.horizon = num();
    else if (k === "--cooldown") a.cooldown = num();
    else if (k === "--cache-hours") a.cacheHours = num();
    else if (k === "--taker-share") a.takerShare = num();
    else if (k === "--ls-drop") a.lsDrop = num();
    else if (k === "--rs-min") a.rsMin = num();
    else if (k === "--spot-volz") a.spotVolz = num();
    else if (k === "--spot-basis") a.spotBasis = num();
    else if (k === "--spot-buyshare") a.spotBuyshare = num();
    else if (k === "--spot-ratio") a.spotRatio = num();
    else throw new Error(`unknown arg ${k}`);
  }
  return a;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function bnGet(host, pathname, tries = 3) {
  let lastErr;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(host + pathname);
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 90) * 1e3 : 800 * (k + 1));
        continue;
      }
      const j = await res.json();
      if (j && !Array.isArray(j) && typeof j.code === "number" && j.code < 0)
        throw new Error(`binance ${j.code} ${j.msg ?? ""}`);
      if (!res.ok) throw new Error(`binance http ${res.status}: ${pathname}`);
      return j;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (k + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`binance failed: ${pathname}`);
}
async function futuresDataRows(endpoint, symbol) {
  const q = (extra) => `/futures/data/${endpoint}?symbol=${symbol}&period=1h&limit=500${extra}`;
  const page1 = await bnGet(FAPI, q("")).catch(() => []);
  if (page1.length < 500) return page1;
  const oldest = Number(page1[0].timestamp);
  const page2 = await bnGet(FAPI, q(`&endTime=${oldest - 1}`)).catch(() => []);
  return page2.concat(page1);
}
var DATA_VERSION = 5;
async function fetch1hCandles(host, path2, symbol, mult) {
  const rows = await bnGet(host, `${path2}?symbol=${symbol}&interval=1h&limit=900`);
  return rows.map((r) => ({
    t: Number(r[0]),
    o: Number(r[1]) / mult,
    h: Number(r[2]) / mult,
    l: Number(r[3]) / mult,
    c: Number(r[4]) / mult,
    v: Number(r[7]),
    bv: (Number(r[5]) || 0) * mult,
    tb: Number(r[10]) || 0
  }));
}
function alignSeries(bars, src) {
  const s = [...src].sort((a, b) => a.t - b.t);
  const out = [];
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
var spotMapCache = null;
async function getSpotMap() {
  if (spotMapCache) return spotMapCache;
  const rows = await bnGet(SPOT, "/api/v3/ticker/24hr");
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const p = parseUmSymbol(r.symbol);
    if (!p) continue;
    const vol = Number(r.quoteVolume);
    if (!(vol > 0)) continue;
    const prev = map.get(p.base);
    if (prev && prev.vol >= vol) continue;
    map.set(p.base, { symbol: r.symbol, mult: p.mult, vol });
  }
  spotMapCache = new Map([...map].map(([b, s]) => [b, { symbol: s.symbol, mult: s.mult }]));
  return spotMapCache;
}
async function fetchCoin(symbol, instId, mult, vol24hUsd, spotMode2) {
  const bars = await fetch1hCandles(FAPI, "/fapi/v1/klines", instId, mult);
  if (bars.length < 200) return null;
  const oiRows = await futuresDataRows("openInterestHist", instId);
  if (!oiRows.length) return null;
  const fundRows = await bnGet(FAPI, `/fapi/v1/fundingRate?symbol=${instId}&limit=100`).catch(() => []);
  const takerRows = await futuresDataRows("takerlongshortRatio", instId);
  const lsRows = await futuresDataRows("globalLongShortAccountRatio", instId);
  const oi = alignSeries(
    bars,
    oiRows.map((r) => ({ t: Number(r.timestamp), v: Number(r.sumOpenInterestValue) })).filter((p) => Number.isFinite(p.v))
  );
  const funding = alignSeries(
    bars,
    fundRows.map((r) => ({ t: Number(r.fundingTime), v: Number(r.fundingRate) * 100 })).filter((p) => Number.isFinite(p.v))
  );
  const takerSell = alignSeries(
    bars,
    takerRows.map((r) => ({ t: Number(r.timestamp), v: Number(r.sellVol) })).filter((p) => Number.isFinite(p.v))
  );
  const takerBuy = alignSeries(
    bars,
    takerRows.map((r) => ({ t: Number(r.timestamp), v: Number(r.buyVol) })).filter((p) => Number.isFinite(p.v))
  );
  const lsRatio = alignSeries(
    bars,
    lsRows.map((r) => ({ t: Number(r.timestamp), v: Number(r.longShortRatio) })).filter((p) => Number.isFinite(p.v))
  );
  let spotClose;
  let spotVol;
  let spotTakerBuy;
  let spotTakerSell;
  if (spotMode2) {
    const s = (await getSpotMap().catch(() => null))?.get(symbol);
    const spotBars = s ? await fetch1hCandles(SPOT, "/api/v3/klines", s.symbol, s.mult).catch(() => []) : [];
    if (spotBars.length) {
      spotClose = alignSeries(bars, spotBars.map((b) => ({ t: b.t, v: b.c })));
      spotVol = alignSeries(bars, spotBars.map((b) => ({ t: b.t, v: b.v })));
      spotTakerBuy = alignSeries(bars, spotBars.map((b) => ({ t: b.t, v: b.tb ?? 0 })));
      spotTakerSell = alignSeries(bars, spotBars.map((b) => ({ t: b.t, v: Math.max(0, b.v - (b.tb ?? 0)) })));
    }
  }
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
    spotClose,
    spotVol,
    spotTakerBuy,
    spotTakerSell,
    fetchedAt: Date.now()
  };
}
async function loadUniverse(args2) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const spotMode2 = args2.mode === "spot-pump" || args2.mode === "spot-accum";
  const info = await bnGet(FAPI, "/fapi/v1/exchangeInfo");
  const perps = /* @__PURE__ */ new Map();
  for (const s of info.symbols ?? []) {
    if (s.contractType !== "PERPETUAL" || s.status !== "TRADING" || s.quoteAsset !== "USDT") continue;
    if (s.underlyingType && s.underlyingType !== "COIN") continue;
    const p = parseUmSymbol(s.symbol);
    if (p) perps.set(s.symbol, p);
  }
  const tickers = await bnGet(FAPI, "/fapi/v1/ticker/24hr");
  const list = [];
  for (const r of tickers) {
    const p = perps.get(r.symbol);
    if (!p) continue;
    const vol = Number(r.quoteVolume);
    if (!Number.isFinite(vol) || vol < args2.minVol || vol > args2.maxVol) continue;
    list.push({ symbol: p.base, instId: r.symbol, mult: p.mult, vol });
  }
  list.sort((a, b) => b.vol - a.vol);
  const capped = args2.maxCoins > 0 ? list.slice(0, args2.maxCoins) : list;
  console.error(`universe: ${capped.length} coins (24h vol $${(args2.minVol / 1e6).toFixed(0)}M-$${(args2.maxVol / 1e6).toFixed(0)}M, binance USDT perps)`);
  const out = [];
  let fetched = 0;
  for (const item of capped) {
    const file = path.join(DATA_DIR, `${item.symbol}.json`);
    let data = null;
    if (!args2.refresh && fs.existsSync(file)) {
      try {
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        if (cached.version === DATA_VERSION && Date.now() - cached.fetchedAt < args2.cacheHours * 36e5 && (!spotMode2 || cached.spotClose != null)) {
          data = cached;
        }
      } catch {
        data = null;
      }
    }
    if (!data) {
      data = await fetchCoin(item.symbol, item.instId, item.mult, item.vol, spotMode2).catch(() => null);
      if (data) fs.writeFileSync(file, JSON.stringify(data));
      await sleep(600);
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
function volZAt(bars, i) {
  const s = Math.max(0, i - 24);
  const win = bars.slice(s, i).map((b) => b.v);
  if (win.length < 8) return 0;
  const m = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
  return sd > 0 ? (bars[i].v - m) / sd : 0;
}
function brokeHigh24OnVol(d, i, a) {
  if (i < 25) return false;
  let hi24 = -Infinity;
  for (let j = i - 24; j < i; j++) hi24 = Math.max(hi24, d.bars[j].h);
  if (!(hi24 > 0) || !(d.bars[i].c > hi24)) return false;
  return volZAt(d.bars, i) >= a.volz;
}
function brokeHighCloseOnVol(d, i, a) {
  if (i < 25) return false;
  let cMax = -Infinity;
  for (let j = i - 24; j < i; j++) cMax = Math.max(cMax, d.bars[j].c);
  if (!(cMax > 0) || !(d.bars[i].c > cMax)) return false;
  return volZAt(d.bars, i) >= a.volz;
}
function emaReclaimOnVol(d, i, a) {
  if (i < 52) return false;
  const px = d.bars[i].c;
  if (!((px / d.bars[i - 4].c - 1) * 100 <= a.bdRet4hCap)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, d.bars[j].l);
    hi = Math.max(hi, d.bars[j].h);
  }
  const pos24 = hi > lo ? (px - lo) / (hi - lo) : 0.5;
  if (!(pos24 <= a.bdPosCap)) return false;
  if (volZAt(d.bars, i) < a.volz) return false;
  const { e20 } = emaSeries(d);
  return px > e20[i] && d.bars[i - 1].c <= e20[i - 1];
}
function spotUpEnvelope(d, i, a) {
  if (!d.spotClose || i < 4 || !(d.bars[i - 4].c > 0)) return false;
  return d.bars[i].c / d.bars[i - 4].c - 1 >= 0.02;
}
function ignitionSignalAt(d, i, a) {
  if (i < 25 || !(d.bars[i - 1].c > 0)) return false;
  if ((d.bars[i].c / d.bars[i - 1].c - 1) * 100 < a.ignRet) return false;
  if (volZAt(d.bars, i) < a.volz) return false;
  if (a.ignOi6 > 0) {
    const oiNow = d.oi[i];
    const oiPrev = d.oi[i - 6];
    if (!(Number.isFinite(oiNow) && Number.isFinite(oiPrev) && oiPrev > 0)) return false;
    if ((oiNow / oiPrev - 1) * 100 < a.ignOi6) return false;
  }
  return true;
}
function ignitionEnvelope(d, i, a) {
  if (i < 25 || !(d.bars[i - 1].c > 0)) return false;
  if ((d.bars[i].c / d.bars[i - 1].c - 1) * 100 < a.ignRet) return false;
  if (a.ignOi6 > 0) return volZAt(d.bars, i) >= a.volz;
  return true;
}
function matchedEnvelope(d, i, a) {
  if (a.mode === "boarding") return emaReclaimOnVol(d, i, a);
  if (a.mode === "spot-pump") return spotUpEnvelope(d, i, a);
  if (a.mode === "ignition") return ignitionEnvelope(d, i, a);
  return (a.matchedClose ? brokeHighCloseOnVol : brokeHigh24OnVol)(d, i, a);
}
var BB_P = 20;
var sqCache = /* @__PURE__ */ new WeakMap();
function sqSeries(d) {
  const hit = sqCache.get(d);
  if (hit) return hit;
  const n = d.bars.length;
  const bw = new Array(n).fill(NaN);
  const atrN = new Array(n).fill(NaN);
  for (let i = BB_P - 1; i < n; i++) {
    let m = 0;
    for (let j = i - BB_P + 1; j <= i; j++) m += d.bars[j].c;
    m /= BB_P;
    if (!(m > 0)) continue;
    let v = 0;
    let tr = 0;
    for (let j = i - BB_P + 1; j <= i; j++) {
      v += (d.bars[j].c - m) ** 2;
      const pc = j > 0 ? d.bars[j - 1].c : d.bars[j].o;
      tr += Math.max(d.bars[j].h - d.bars[j].l, Math.abs(d.bars[j].h - pc), Math.abs(d.bars[j].l - pc));
    }
    bw[i] = 4 * Math.sqrt(v / BB_P) / m;
    atrN[i] = tr / BB_P / m;
  }
  const out = { bw, atrN };
  sqCache.set(d, out);
  return out;
}
function sqSetupAt(d, i, a) {
  const { bw, atrN } = sqSeries(d);
  const cur = bw[i];
  if (!Number.isFinite(cur)) return false;
  let squeezed = false;
  if (a.sqDef === "D1") {
    const win = [];
    for (let j = i - 47; j <= i; j++) if (Number.isFinite(bw[j])) win.push(bw[j]);
    if (win.length < 24) return false;
    squeezed = win.filter((x) => x <= cur).length / win.length <= (a.sqThresh || 0.1);
  } else if (a.sqDef === "D2") {
    let mx = 0;
    for (let j = i - 8; j <= i; j++) if (Number.isFinite(bw[j])) mx = Math.max(mx, bw[j]);
    squeezed = mx > 0 && cur / mx <= (a.sqThresh || 0.35);
  } else if (a.sqDef === "D3") {
    squeezed = Number.isFinite(atrN[i]) && atrN[i] > 0 && cur <= 2 * (a.sqThresh || 1.5) * atrN[i];
  } else {
    const win = [];
    for (let j = i - 7; j <= i; j++) if (Number.isFinite(bw[j])) win.push(bw[j]);
    if (win.length < 8) return false;
    squeezed = win.filter((x) => x <= cur).length / win.length <= (a.sqThresh || 0.15);
  }
  if (!squeezed) return false;
  if (a.sqConfirm === "none") return true;
  const fundOk = d.funding[i] <= 0;
  let oiOk = false;
  if (i >= 4 && d.oi[i - 4] > 0) {
    const oi4h = (d.oi[i] / d.oi[i - 4] - 1) * 100;
    let buy = 0;
    let sell = 0;
    for (let j = i - 3; j <= i; j++) {
      buy += d.takerBuy[j] ?? 0;
      sell += d.takerSell[j] ?? 0;
    }
    const tot = buy + sell;
    oiOk = oi4h >= 0 && tot > 0 && buy / tot >= 0.5;
  }
  if (a.sqConfirm === "funding") return fundOk;
  if (a.sqConfirm === "oi") return oiOk;
  if (a.sqConfirm === "both") return fundOk && oiOk;
  return fundOk || oiOk;
}
function squeezeSignalAt(d, i, a) {
  if (a.sqStage === "setup") return sqSetupAt(d, i, a);
  let first = -1;
  for (let j = Math.max(0, i - a.sqRecentH); j < i; j++) {
    if (sqSetupAt(d, j, a)) {
      first = j;
      break;
    }
  }
  if (first < 0) return false;
  let hi = -Infinity;
  for (let j = first; j < i; j++) hi = Math.max(hi, d.bars[j].h);
  if (!(d.bars[i].c > hi)) return false;
  return volZAt(d.bars, i) >= a.volz;
}
var emaCache = /* @__PURE__ */ new WeakMap();
function emaSeries(d) {
  const hit = emaCache.get(d);
  if (hit) return hit;
  const n = d.bars.length;
  const mk = (p) => {
    const out2 = new Array(n).fill(NaN);
    if (n >= p) {
      const k = 2 / (p + 1);
      let e = 0;
      for (let j = 0; j < p; j++) e += d.bars[j].c;
      e /= p;
      out2[p - 1] = e;
      for (let j = p; j < n; j++) {
        e = d.bars[j].c * k + e * (1 - k);
        out2[j] = e;
      }
    }
    return out2;
  };
  const out = { e20: mk(20), e50: mk(50) };
  emaCache.set(d, out);
  return out;
}
function boardingSignalAt(d, i, a) {
  const { bars, oi, funding } = d;
  if (i < 52) return false;
  const px = bars[i].c;
  const ret4h = (px / bars[i - 4].c - 1) * 100;
  if (!(ret4h <= a.bdRet4hCap)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, bars[j].l);
    hi = Math.max(hi, bars[j].h);
  }
  const pos24 = hi > lo ? (px - lo) / (hi - lo) : 0.5;
  if (!(pos24 <= a.bdPosCap)) return false;
  if (volZAt(bars, i) < a.volz) return false;
  if (a.bdDef === "B1") {
    const ret24 = (px / bars[i - 24].c - 1) * 100;
    const ret12 = (px / bars[i - 1].c - 1) * 100;
    return ret24 <= -(a.bdThresh || 8) && pos24 <= 0.45 && ret12 >= 2;
  }
  if (a.bdDef === "B2") {
    const { e20, e50 } = emaSeries(d);
    if (a.bdScan) {
      const need2 = a.bdThresh || 24;
      if (i - need2 < 20) return false;
      if (!(px > e20[i]) || !(bars[i - 1].c <= e20[i - 1])) return false;
      for (let j = i - need2; j < i; j++) if (!(bars[j].c < e20[j])) return false;
      return true;
    }
    const need = a.bdThresh || 48;
    if (i - need < 50) return false;
    if (!(px > e20[i]) || !(bars[i - 1].c <= e20[i - 1])) return false;
    for (let j = i - need; j < i; j++) {
      if (!(bars[j].c < e50[j])) return false;
    }
    return true;
  }
  const ret1 = (px / bars[i - 1].c - 1) * 100;
  if (!(ret1 > 0.2 && ret1 <= 3.2)) return false;
  if (!(oi[i - 4] > 0)) return false;
  const oi4h = (oi[i] / oi[i - 4] - 1) * 100;
  if (!(oi4h > 0.8 && oi4h < 14)) return false;
  let buy = 0;
  let sell = 0;
  for (let j = i - 3; j <= i; j++) {
    buy += d.takerBuy[j] ?? 0;
    sell += d.takerSell[j] ?? 0;
  }
  if (!(buy + sell > 0) || !(buy / (buy + sell) > 0.55)) return false;
  return funding[i] <= 0.02;
}
function rebuildSignalAt(d, i, a) {
  const { bars, oi, funding } = d;
  if (i < 52) return false;
  let hi24 = -Infinity;
  for (let j = i - 24; j < i; j++) hi24 = Math.max(hi24, bars[j].h);
  if (!(bars[i].c > hi24)) return false;
  if (volZAt(bars, i) < a.volz) return false;
  if (!(oi[i - 4] > 0)) return false;
  const oi4h = (oi[i] / oi[i - 4] - 1) * 100;
  if (!(oi4h >= a.rbOi4h)) return false;
  if (a.rbDef === "R2") {
    const ret4h = (bars[i].c / bars[i - 4].c - 1) * 100;
    return ret4h >= 0 && ret4h <= a.rbRet4hCap;
  }
  let mxV = 0;
  let mxJ = -1;
  for (let j = i - 48; j <= i; j++) {
    if (oi[j] > mxV) {
      mxV = oi[j];
      mxJ = j;
    }
  }
  if (!(mxV > 0)) return false;
  let mnV = Infinity;
  for (let j = mxJ; j <= i; j++) if (oi[j] > 0) mnV = Math.min(mnV, oi[j]);
  if (!Number.isFinite(mnV) || !(mnV <= mxV * (1 - a.rbFlush / 100))) return false;
  if (a.rbDef === "R3") return funding[i] <= a.rbFundCap;
  return true;
}
function virginSignalAt(d, i, a) {
  const { bars, oi, funding } = d;
  if (i < 52) return false;
  let hi24 = -Infinity;
  for (let j = i - 24; j < i; j++) hi24 = Math.max(hi24, bars[j].h);
  if (!(bars[i].c > hi24)) return false;
  if (volZAt(bars, i) < a.volz) return false;
  if (!(oi[i - 4] > 0)) return false;
  const oi4h = (oi[i] / oi[i - 4] - 1) * 100;
  if (!(oi4h >= a.vgOi4h)) return false;
  let mxV = 0;
  let mxJ = -1;
  for (let j = i - 48; j <= i; j++) {
    if (oi[j] > mxV) {
      mxV = oi[j];
      mxJ = j;
    }
  }
  if (!(mxV > 0)) return false;
  let mnV = Infinity;
  for (let j = mxJ; j <= i; j++) if (oi[j] > 0) mnV = Math.min(mnV, oi[j]);
  if (Number.isFinite(mnV) && mnV <= mxV * (1 - a.rbFlush / 100)) return false;
  if (a.vgDef === "V2") {
    if (!(oi[i - 24] > 0)) return false;
    const oi24h = (oi[i] / oi[i - 24] - 1) * 100;
    return oi24h >= a.vgOi24h;
  }
  if (a.vgDef === "V3") return funding[i] <= a.vgFundCap;
  return true;
}
function topSignalAt(d, i, a) {
  const { bars, oi, funding } = d;
  if (i < 32) return false;
  const b = bars[i];
  const px = b.c;
  if (!(bars[i - 24].c > 0)) return false;
  const ret24 = (px / bars[i - 24].c - 1) * 100;
  if (!(ret24 >= a.topRet24)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = i - 23; j <= i; j++) {
    lo = Math.min(lo, bars[j].l);
    hi = Math.max(hi, bars[j].h);
  }
  const pos24 = hi > lo ? (px - lo) / (hi - lo) : 0.5;
  if (!(pos24 >= a.topPos)) return false;
  if (volZAt(bars, i) < a.volz) return false;
  if (a.topDef === "T1") {
    const tol = (a.topThresh || 1) / 100;
    let hPrev = -Infinity;
    for (let j = i - 24; j <= i - 3; j++) hPrev = Math.max(hPrev, bars[j].h);
    if (!(hPrev > 0)) return false;
    return Math.abs(b.h / hPrev - 1) <= tol && b.c <= b.h * 0.99 && b.c <= b.o;
  }
  if (a.topDef === "T2") {
    const wickMin = a.topThresh || 0.5;
    let hiPrev = -Infinity;
    for (let j = i - 24; j < i; j++) hiPrev = Math.max(hiPrev, bars[j].h);
    if (!(b.h > hiPrev)) return false;
    const range = b.h - b.l;
    if (!(range > 0)) return false;
    if ((b.h - Math.max(b.o, b.c)) / range < wickMin) return false;
    if (!(oi[i - 4] > 0)) return false;
    return (oi[i] / oi[i - 4] - 1) * 100 <= -1.5;
  }
  if (a.topDef === "T3") {
    const climaxZ = a.topThresh || 2.5;
    const p = bars[i - 1];
    if (volZAt(bars, i - 1) < climaxZ) return false;
    let lo2 = Infinity;
    let hi2 = -Infinity;
    for (let j = i - 24; j <= i - 1; j++) {
      lo2 = Math.min(lo2, bars[j].l);
      hi2 = Math.max(hi2, bars[j].h);
    }
    const posC = hi2 > lo2 ? (p.c - lo2) / (hi2 - lo2) : 0.5;
    if (!(posC >= 0.85)) return false;
    return b.c < p.l;
  }
  const fMin = a.topThresh || 0.015;
  if (!(funding[i] >= fMin)) return false;
  if (!(funding[i] > funding[i - 8])) return false;
  return (px / bars[i - 4].c - 1) * 100 <= 1;
}
function wbottomSignalAt(d, i, a) {
  const { bars, oi } = d;
  if (i < 70) return false;
  const px = bars[i].c;
  const ret24 = bars[i - 24].c > 0 ? (px / bars[i - 24].c - 1) * 100 : 0;
  const { e50 } = emaSeries(d);
  if (!(ret24 >= 10 || Number.isFinite(e50[i]) && px > e50[i])) return false;
  const isLocalMin = (j) => j >= 1 && bars[j].l <= bars[j - 1].l && bars[j].l <= bars[j + 1].l;
  if (a.wbDef === "W2") {
    if (volZAt(bars, i) < (a.wbVolz || 1.25)) return false;
    const b = bars[i];
    if (!(b.c > b.o)) return false;
    const s = i - 1;
    for (let j1 = s - a.wbSepMax; j1 <= s - 2; j1++) {
      if (!isLocalMin(j1)) continue;
      if (bars[s].l < bars[j1].l && bars[s].c > bars[j1].l) return true;
    }
    return false;
  }
  if (volZAt(bars, i) < (a.wbVolz || 1.5)) return false;
  if (a.wbDef === "W3") {
    if (!(oi[i - 4] > 0)) return false;
    if ((oi[i] / oi[i - 4] - 1) * 100 < 0) return false;
  }
  const tol = a.wbTol / 100;
  for (let j2 = i - 1; j2 >= i - a.wbRecent; j2--) {
    if (j2 < 3) break;
    if (!isLocalMin(j2)) continue;
    for (let sep = 2; sep <= a.wbSepMax; sep++) {
      const j1 = j2 - sep;
      if (j1 < 1) break;
      if (!isLocalMin(j1)) continue;
      if (Math.abs(bars[j2].l / bars[j1].l - 1) > tol) continue;
      let neck = -Infinity;
      for (let j = j1 + 1; j < j2; j++) neck = Math.max(neck, bars[j].h);
      if (neck > 0 && px > neck) return true;
    }
  }
  return false;
}
function flushwickSignalAt(d, i, a) {
  const { bars } = d;
  if (i < a.fwLookback + 2 || i < 52) return false;
  const s = i - 1;
  const w = bars[s];
  const range = w.h - w.l;
  if (!(range > 0)) return false;
  let loPrev = Infinity;
  for (let j = s - a.fwLookback; j < s; j++) loPrev = Math.min(loPrev, bars[j].l);
  if (!(w.l < loPrev)) return false;
  if ((Math.min(w.o, w.c) - w.l) / range < a.fwWick) return false;
  if (!(w.c >= w.l + a.fwClosePos * range)) return false;
  if (!(bars[i].c > w.h)) return false;
  if (Math.max(volZAt(bars, s), volZAt(bars, i)) < a.volz) return false;
  if (a.fwDef === "F2") {
    const { e20, e50 } = emaSeries(d);
    return Number.isFinite(e20[i]) && Number.isFinite(e50[i]) && e20[i] > e50[i];
  }
  if (a.fwDef === "F3") {
    for (let j = Math.max(0, s - 6); j <= s; j++) {
      if (sqSetupAt(d, j, { ...a, sqDef: "D3", sqThresh: 0, sqConfirm: "none" })) return true;
    }
    return false;
  }
  return true;
}
function vwapFrom(bars, anchor, i) {
  let q = 0;
  let b = 0;
  for (let j = anchor; j <= i; j++) {
    q += bars[j].v;
    b += bars[j].bv ?? 0;
  }
  return b > 0 ? q / b : null;
}
function rollingVwapAt(bars, i, win) {
  let q = 0;
  let b = 0;
  for (let j = Math.max(0, i - win + 1); j <= i; j++) {
    q += bars[j].v;
    b += bars[j].bv ?? 0;
  }
  return b > 0 ? q / b : null;
}
function vwapCtxAt(d, i, a) {
  const { bars, oi, funding } = d;
  let oiMax = 0;
  for (let j = i - a.flushHours; j <= i; j++) oiMax = Math.max(oiMax, oi[j]);
  if (!(oiMax > 0) || oi[i] > oiMax * (1 - a.flushPct / 100)) return null;
  if (a.inflectHours > 0 && !(oi[i] > oi[i - a.inflectHours] * 1.005)) return null;
  let cMax = -Infinity;
  let cMin = Infinity;
  for (let j = i - a.baseHours; j < i; j++) {
    cMax = Math.max(cMax, bars[j].c);
    cMin = Math.min(cMin, bars[j].c);
  }
  if (!(cMin > 0) || (cMax / cMin - 1) * 100 > a.baseRange) return null;
  if (a.fundingAsym ? funding[i] > a.neutralFunding : Math.abs(funding[i]) > a.neutralFunding) return null;
  let flushLow = i - 1;
  let fv = Infinity;
  for (let j = i - a.flushHours; j < i; j++) if (bars[j].l < fv) {
    fv = bars[j].l;
    flushLow = j;
  }
  let baseLow = i - 1;
  let bl = Infinity;
  for (let j = i - a.baseHours; j < i; j++) if (bars[j].l < bl) {
    bl = bars[j].l;
    baseLow = j;
  }
  return { flushLow, baseLow };
}
function vwapReclaimSignalAt(d, i, a, btcClose2) {
  const { bars } = d;
  if (i < Math.max(a.flushHours, a.baseHours, 24) + 1) return false;
  const ctx = vwapCtxAt(d, i, a);
  if (!ctx) return false;
  const { e20 } = emaSeries(d);
  const anchor = a.vwapAnchor === "base-low" ? ctx.baseLow : ctx.flushLow;
  const lineAt = (bar) => {
    if (a.vwapAbl) return Number.isFinite(e20[bar]) ? e20[bar] : null;
    if (a.vwapVariant === "A3") return rollingVwapAt(bars, bar, 24);
    return vwapFrom(bars, anchor, bar);
  };
  const Li = lineAt(i);
  if (Li == null) return false;
  if (a.vwapVariant === "A1") {
    if (!signalAt(d, i, { ...a, mode: "breakout" }, btcClose2)) return false;
    return bars[i].c > Li;
  }
  const Lp = lineAt(i - 1);
  if (Lp == null) return false;
  if (!(bars[i].c > Li && bars[i - 1].c <= Lp)) return false;
  return volZAt(bars, i) >= a.vwapVolz;
}
function signalAt(d, i, a, btcClose2) {
  if (a.mode === "spot-pump" || a.mode === "spot-accum") return spotSignalAt(d, i, a);
  if (a.mode === "vwap-reclaim") return vwapReclaimSignalAt(d, i, a, btcClose2);
  if (a.mode === "squeeze") return squeezeSignalAt(d, i, a);
  if (a.mode === "boarding") return boardingSignalAt(d, i, a);
  if (a.mode === "rebuild") return rebuildSignalAt(d, i, a);
  if (a.mode === "virgin") return virginSignalAt(d, i, a);
  if (a.mode === "top") return topSignalAt(d, i, a);
  if (a.mode === "wbottom") return wbottomSignalAt(d, i, a);
  if (a.mode === "flushwick") return flushwickSignalAt(d, i, a);
  if (a.mode === "ignition") return ignitionSignalAt(d, i, a);
  const { bars, oi, funding } = d;
  let oiMax = 0;
  for (let j = i - a.flushHours; j <= i; j++) oiMax = Math.max(oiMax, oi[j]);
  if (!(oiMax > 0) || oi[i] > oiMax * (1 - a.flushPct / 100)) return false;
  if (a.inflectHours > 0 && !(oi[i] > oi[i - a.inflectHours] * 1.005)) return false;
  let cMax = -Infinity;
  let cMin = Infinity;
  for (let j = i - a.baseHours; j < i; j++) {
    cMax = Math.max(cMax, bars[j].c);
    cMin = Math.min(cMin, bars[j].c);
  }
  if (!(cMin > 0) || (cMax / cMin - 1) * 100 > a.baseRange) return false;
  if (a.fundingAsym ? funding[i] > a.neutralFunding : Math.abs(funding[i]) > a.neutralFunding) return false;
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
  if (a.lsDrop > 0) {
    const then = d.lsRatio[i - a.baseHours] ?? 0;
    const now = d.lsRatio[i] ?? 0;
    if (!(then > 0) || !(now > 0) || now > then * (1 - a.lsDrop / 100)) return false;
  }
  if (a.rsMin !== null) {
    const bNow = btcClose2.get(bars[i].t);
    const bThen = btcClose2.get(bars[i - a.baseHours].t);
    if (!bNow || !bThen) return false;
    const rs = (bars[i].c / bars[i - a.baseHours].c - bNow / bThen) * 100;
    if (rs < a.rsMin) return false;
  }
  if (a.mode === "breakout") {
    if (!(bars[i].c > cMax)) return false;
    if (volZAt(d.bars, i) < a.volz) return false;
  }
  return true;
}
function spotVolZAt(sv, i) {
  const win = sv.slice(Math.max(0, i - 24), i);
  if (win.length < 8) return null;
  const m = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
  return sd > 0 ? (sv[i] - m) / sd : 0;
}
function spotSignalAt(d, i, a) {
  const { bars, oi } = d;
  if (!d.spotClose || !d.spotVol) return false;
  if (i < 4 || !(bars[i - 4].c > 0) || !(oi[i - 4] > 0)) return false;
  const ret4h = bars[i].c / bars[i - 4].c - 1;
  const oi4h = (oi[i] / oi[i - 4] - 1) * 100;
  const sc = d.spotClose[i];
  if (!(sc > 0) || !(bars[i].c > 0)) return false;
  const basisPct = (bars[i].c / sc - 1) * 100;
  if (a.mode === "spot-pump") {
    const z = spotVolZAt(d.spotVol, i);
    if (z == null) return false;
    return ret4h >= 0.02 && Math.abs(oi4h) < 1.5 && z >= a.spotVolz && basisPct <= a.spotBasis;
  }
  if (i < 48) return false;
  const sv = d.spotVol;
  const recent8 = sv.slice(i - 8, i);
  const prior40 = sv.slice(i - 48, i - 8);
  const rMean = recent8.reduce((a2, b) => a2 + b, 0) / recent8.length;
  const pMean = prior40.reduce((a2, b) => a2 + b, 0) / prior40.length;
  if (!(pMean > 0)) return false;
  const ratio = rMean / pMean;
  let buy = 0;
  let sell = 0;
  for (let j = i - 24; j < i; j++) {
    buy += d.spotTakerBuy?.[j] ?? 0;
    sell += d.spotTakerSell?.[j] ?? 0;
  }
  const tot = buy + sell;
  if (!(tot > 0)) return false;
  const buyShare = buy / tot;
  return Math.abs(ret4h) < 0.01 && ratio >= a.spotRatio && buyShare >= a.spotBuyshare && Math.abs(oi4h) < 2;
}
function outcomeAt(d, i, a) {
  const entry = d.bars[i].c;
  let hi = -Infinity;
  let lo = Infinity;
  let hoursToHit = null;
  let lo24 = Infinity;
  for (let j = Math.max(0, i - 24); j < i; j++) lo24 = Math.min(lo24, d.bars[j].l);
  const runup = lo24 > 0 && Number.isFinite(lo24) ? entry / lo24 - 1 : 0;
  const down = a.mode === "top";
  const tgt = down ? entry * (1 - a.target / 100) : entry * (1 + a.target / 100);
  for (let j = i + 1; j <= i + a.horizon; j++) {
    hi = Math.max(hi, d.bars[j].h);
    lo = Math.min(lo, d.bars[j].l);
    if (hoursToHit == null && (down ? d.bars[j].l <= tgt : d.bars[j].h >= tgt)) hoursToHit = j - i;
  }
  const mfe = hi / entry - 1;
  const mae = lo / entry - 1;
  const retH = d.bars[i + a.horizon].c / entry - 1;
  return {
    symbol: d.symbol,
    t: d.bars[i].t,
    entry,
    mfe,
    mae,
    retH,
    hit: down ? mae <= -a.target / 100 : mfe >= a.target / 100,
    hoursToHit,
    runup
  };
}
function summarize(list) {
  const n = list.length;
  if (!n) return { n: 0, hitRate: 0, meanMfe: 0, medMfe: 0, meanMae: 0, meanRetH: 0, medRetH: 0, medRunup: 0 };
  const sorted = (xs) => [...xs].sort((a, b) => a - b);
  const med = (xs) => {
    const s = sorted(xs);
    const k = s.length;
    return k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2;
  };
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n,
    hitRate: list.filter((o) => o.hit).length / n,
    meanMfe: mean(list.map((o) => o.mfe)),
    medMfe: med(list.map((o) => o.mfe)),
    meanMae: mean(list.map((o) => o.mae)),
    meanRetH: mean(list.map((o) => o.retH)),
    medRetH: med(list.map((o) => o.retH)),
    medRunup: med(list.map((o) => o.runup))
  };
}
var args = parseArgs();
var coins = await loadUniverse(args);
var btcClose = /* @__PURE__ */ new Map();
if (args.rsMin !== null) {
  const btcFile = path.join(DATA_DIR, "_BTC-benchmark.json");
  let btcBars = null;
  if (!args.refresh && fs.existsSync(btcFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(btcFile, "utf8"));
      if (cached.version === DATA_VERSION && Date.now() - cached.fetchedAt < args.cacheHours * 36e5) {
        btcBars = cached.bars;
      }
    } catch {
      btcBars = null;
    }
  }
  if (!btcBars) {
    btcBars = await fetch1hCandles(FAPI, "/fapi/v1/klines", "BTCUSDT", 1);
    fs.writeFileSync(btcFile, JSON.stringify({ version: DATA_VERSION, fetchedAt: Date.now(), bars: btcBars }));
  }
  btcClose = new Map(btcBars.map((b) => [b.t, b.c]));
  console.error(`btc benchmark: ${btcBars.length} bars`);
}
var warmup = args.mode === "squeeze" ? BB_P + 48 + 4 : args.mode === "boarding" ? 102 : args.mode === "rebuild" || args.mode === "virgin" ? 54 : args.mode === "top" ? 34 : args.mode === "wbottom" ? 70 : args.mode === "flushwick" ? 72 : args.mode === "vwap-reclaim" ? Math.max(args.flushHours, args.baseHours, 24) + 2 : args.mode === "ignition" ? 26 : Math.max(args.flushHours, args.baseHours) + 2;
var spotMode = args.mode === "spot-pump" || args.mode === "spot-accum";
// --dump-signals fire-time features (iter24): per-signal candidate human-proxy
// 2nd-filter reads, computed at the fire bar. Enables testing whether fresh-high /
// turnover / spot-lead (現貨帶動) can lift the ignition watchlist big-mover base rate.
function ignFeatures(d, i, o) {
  const bars = d.bars;
  const px = bars[i].c;
  let freshHighH = 0;
  for (let j = i - 1; j >= 0 && i - j <= 240; j--) {
    if (bars[j].h >= px) break;
    freshHighH = i - j;
  }
  let turn = 0;
  for (let j = Math.max(0, i - 23); j <= i; j++) turn += (bars[j].bv ?? 0) * bars[j].c;
  const { e20 } = emaSeries(d);
  const distE20 = e20[i] > 0 ? (px / e20[i] - 1) * 100 : null;
  let spotLead = null;
  if (d.spotClose && i >= 4 && d.spotClose[i] > 0 && d.spotClose[i - 4] > 0 && bars[i - 4].c > 0) {
    spotLead = ((d.spotClose[i] / d.spotClose[i - 4] - 1) - (px / bars[i - 4].c - 1)) * 100;
  }
  return {
    sym: d.symbol,
    t: bars[i].t,
    runup: +(o.runup * 100).toFixed(2),
    mfe: +(o.mfe * 100).toFixed(2),
    freshHighH,
    turnoverUsdM: +(turn / 1e6).toFixed(1),
    distE20: distE20 == null ? null : +distE20.toFixed(1),
    spotLead: spotLead == null ? null : +spotLead.toFixed(2)
  };
}
var signals = [];
var signalMeta = [];
var baseline = [];
var perCoin = /* @__PURE__ */ new Map();
var barsEvaluated = 0;
var fbOverlap = 0;
var sqOverlap = 0;
var b2Overlap = 0;
var r1Overlap = 0;
var r2Overlap = 0;
var OVERLAP_MODES = /* @__PURE__ */ new Set(["boarding", "rebuild", "top", "wbottom", "flushwick", "virgin", "vwap-reclaim"]);
var topPair = { T1: 0, T2: 0, T3: 0, T4: 0 };
for (const d of coins) {
  if (spotMode && !d.spotClose) continue;
  const lastEval = d.bars.length - args.horizon - 1;
  let cooldownUntil = -1;
  for (let i = warmup; i <= lastEval; i++) {
    barsEvaluated++;
    if (!args.matched || matchedEnvelope(d, i, args)) baseline.push(outcomeAt(d, i, args));
    if (i < cooldownUntil) continue;
    if (signalAt(d, i, args, btcClose)) {
      const o = outcomeAt(d, i, args);
      signals.push(o);
      if (args.dumpSignals) signalMeta.push(ignFeatures(d, i, o));
      perCoin.set(d.symbol, (perCoin.get(d.symbol) ?? 0) + 1);
      cooldownUntil = i + args.cooldown;
      if (OVERLAP_MODES.has(args.mode)) {
        if (signalAt(d, i, { ...args, mode: "breakout" }, btcClose)) fbOverlap++;
        if (squeezeSignalAt(d, i, { ...args, mode: "squeeze", sqDef: "D3", sqThresh: 0, sqStage: "breakout", sqConfirm: "either", sqRecentH: 6 })) sqOverlap++;
        if (args.mode === "virgin") {
          if (rebuildSignalAt(d, i, { ...args, mode: "rebuild", rbDef: "R1" })) r1Overlap++;
          if (rebuildSignalAt(d, i, { ...args, mode: "rebuild", rbDef: "R2" })) r2Overlap++;
        }
        if (args.mode === "top") {
          for (const td of ["T1", "T2", "T3", "T4"]) {
            if (td !== args.topDef && topSignalAt(d, i, { ...args, topDef: td, topThresh: 0 })) topPair[td]++;
          }
        }
        if (args.mode === "wbottom") {
          if (boardingSignalAt(d, i, { ...args, mode: "boarding", bdDef: "B2", bdThresh: 0, bdRet4hCap: 6, bdPosCap: 0.7 })) b2Overlap++;
        }
        if (args.mode === "flushwick") {
          if (wbottomSignalAt(d, i, { ...args, mode: "wbottom", wbDef: "W2", wbVolz: 0, wbSepMax: 12 })) b2Overlap++;
        }
      }
    }
  }
}
var sig = summarize(signals);
var base = summarize(baseline);
var lift = base.hitRate > 0 ? sig.hitRate / base.hitRate : 0;
var spanDays = coins.length > 0 ? Math.round((coins[0].bars[coins[0].bars.length - 1].t - coins[0].bars[0].t) / 864e5) : 0;
var pnl = args.pnl ? (() => {
  const rets = signals.map((o) => o.retH);
  const n = rets.length;
  const sum = rets.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const median = n ? [...rets].sort((a, b) => a - b)[Math.floor(n / 2)] : 0;
  return {
    long: { n, winRate: n ? rets.filter((r) => r > 0).length / n : 0, mean, median, sum },
    short: { n, winRate: n ? rets.filter((r) => r < 0).length / n : 0, mean: -mean, median: -median, sum: -sum },
    baselineMeanRet: base.meanRetH
  };
})() : null;
var tth = signals.filter((o) => o.hit && o.hoursToHit != null).map((o) => o.hoursToHit).sort((a, b) => a - b);
var medHoursToHit = tth.length ? tth[Math.floor(tth.length / 2)] : null;
var result = {
  params: args,
  universe: coins.length,
  spanDays,
  barsEvaluated,
  signal: sig,
  baseline: base,
  lift,
  medHoursToHit,
  ...OVERLAP_MODES.has(args.mode) ? {
    overlap: {
      fb: fbOverlap,
      squeezeD3: sqOverlap,
      ...args.mode === "wbottom" ? { boardingB2: b2Overlap } : {},
      ...args.mode === "flushwick" ? { wbottomW2: b2Overlap } : {},
      ...args.mode === "virgin" ? { rebuildR1: r1Overlap, rebuildR2: r2Overlap } : {},
      ...args.mode === "top" ? { pairwise: topPair } : {},
      ofSignals: sig.n
    }
  } : {},
  coinsWithSignals: perCoin.size,
  ...args.dumpSignals ? { allSignals: signalMeta } : {},
  // top (SHORT) mode ranks by deepest downside excursion instead of highest MFE
  topSignals: [...signals].sort((a, b) => args.mode === "top" ? a.mae - b.mae : b.mfe - a.mfe).slice(0, 10).map((o) => ({
    symbol: o.symbol,
    time: new Date(o.t).toISOString().slice(0, 13),
    mfePct: +(o.mfe * 100).toFixed(1),
    maePct: +(o.mae * 100).toFixed(1)
  })),
  ...pnl ? { pnl } : {}
};
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log("");
  const title = spotMode ? "S2 spot cross-source backtest" : args.mode === "squeeze" ? "S6 BB-squeeze backtest" : args.mode === "rebuild" ? "S9 OI-rebuild breakout backtest" : args.mode === "virgin" ? "S13 virgin-expansion breakout backtest" : args.mode === "top" ? "S10 distribution-top backtest (SHORT)" : args.mode === "wbottom" ? "S11 W-bottom backtest" : args.mode === "vwap-reclaim" ? "S8 anchored-VWAP reclaim backtest" : "OI-flush+basing backtest";
  console.log(`=== ${title} \u2014 mode=${args.mode} ===`);
  console.log(
    `universe ${coins.length} coins ($${(args.minVol / 1e6).toFixed(0)}M-$${(args.maxVol / 1e6).toFixed(0)}M) \xB7 ~${spanDays}d @1H \xB7 ${barsEvaluated.toLocaleString()} bars`
  );
  if (args.mode === "spot-pump") {
    console.log(
      `signal: spot-led-pump \u2014 ret4h\u22652%, |oi4h|<1.5%, spotVolZ\u2265${args.spotVolz}, basis\u2264${args.spotBasis}%`
    );
  } else if (args.mode === "spot-accum") {
    console.log(
      `signal: stealth-spot-accum \u2014 |ret4h|<1%, spotVol 8h/40h\u2265${args.spotRatio}, spotBuyShare\u2265${args.spotBuyshare}, |oi4h|<2%`
    );
  } else if (args.mode === "squeeze") {
    console.log(
      `signal: squeeze-${args.sqStage} \u2014 def=${args.sqDef}${args.sqThresh ? `(thresh ${args.sqThresh})` : "(default thresh)"}, confirm=${args.sqConfirm}` + (args.sqStage === "breakout" ? `, setup-within-${args.sqRecentH}h + break setup-high + volZ\u2265${args.volz}` : "")
    );
  } else if (args.mode === "boarding") {
    console.log(
      `signal: boarding-${args.bdDef}${args.bdThresh ? `(thresh ${args.bdThresh})` : ""} \u2014 anti-chase ret4h\u2264${args.bdRet4hCap}% \u2227 pos24\u2264${args.bdPosCap} \u2227 volZ\u2265${args.volz}`
    );
  } else if (args.mode === "rebuild") {
    console.log(
      `signal: rebuild-${args.rbDef} \u2014 break 24h-high \u2227 volZ\u2265${args.volz} \u2227 oi4h\u2265${args.rbOi4h}%` + (args.rbDef !== "R2" ? ` \u2227 flush\u2265${args.rbFlush}%/48h` : ` \u2227 ret4h\u2208[0,${args.rbRet4hCap}%]`) + (args.rbDef === "R3" ? ` \u2227 funding\u2264${args.rbFundCap}` : "")
    );
  } else if (args.mode === "virgin") {
    console.log(
      `signal: virgin-${args.vgDef} \u2014 break 24h-high \u2227 volZ\u2265${args.volz} \u2227 oi4h\u2265${args.vgOi4h}% \u2227 NO flush\u2265${args.rbFlush}%/48h` + (args.vgDef === "V2" ? ` \u2227 oi24h\u2265${args.vgOi24h}%` : "") + (args.vgDef === "V3" ? ` \u2227 funding\u2264${args.vgFundCap}` : "")
    );
  } else if (args.mode === "top") {
    console.log(
      `signal: top-${args.topDef}${args.topThresh ? `(thresh ${args.topThresh})` : "(default thresh)"} \u2014 SHORT \xB7 ret24h\u2265${args.topRet24}% \u2227 pos24\u2265${args.topPos} \u2227 volZ\u2265${args.volz}`
    );
  } else if (args.mode === "wbottom") {
    console.log(
      `signal: wbottom-${args.wbDef} \u2014 anti-knife(ret24h\u226510% \u2228 >EMA50) \xB7 tol\u2264${args.wbTol}% \xB7 sep 2-${args.wbSepMax} \xB7 trigger\u2264${args.wbRecent}bars \xB7 volZ\u2265${args.wbVolz || (args.wbDef === "W2" ? 1.25 : 1.5)}`
    );
  } else if (args.mode === "flushwick") {
    console.log(
      `signal: flushwick-${args.fwDef} \u2014 sweep ${args.fwLookback}h-low \u2227 wick\u2265${args.fwWick} \u2227 reclaim\u2265${args.fwClosePos} \u2227 next-bar close>wick-high \u2227 volZ\u2265${args.volz}` + (args.fwDef === "F2" ? " \u2227 EMA20>EMA50" : args.fwDef === "F3" ? " \u2227 D3-squeeze\u22646h" : "")
    );
  } else if (args.mode === "ignition") {
    console.log(
      `signal: ignition \u2014 raw 1H pop \u2265${args.ignRet}% \u2227 volZ\u2265${args.volz} (NO 24h-high break / NO OI flush / NO base) \u2014 earliest fireable candle`
    );
  } else if (args.mode === "vwap-reclaim") {
    const lineName = args.vwapAbl ? "EMA20" : args.vwapVariant === "A3" ? "rolling24-VWAP" : `AVWAP(${args.vwapAnchor})`;
    console.log(
      `signal: vwap-${args.vwapVariant}${args.vwapAbl ? " [EMA20-only ablation twin]" : ""} \u2014 ` + (args.vwapVariant === "A1" ? `\u26A1 breakout \u2227 close>${lineName}` : `flush+base ctx \u2227 fresh reclaim of ${lineName} (close crosses from below) \u2227 volZ\u2265${args.vwapVolz}`)
    );
  } else {
    console.log(
      `signal: flush\u2265${args.flushPct}%/${args.flushHours}h, base\u2264${args.baseRange}%/${args.baseHours}h, |funding|\u2264${args.neutralFunding}%` + (args.inflectHours ? `, OI\u2191${args.inflectHours}h` : "") + (args.mode === "breakout" ? `, breakout+volZ\u2265${args.volz}` : "")
    );
  }
  console.log(
    args.mode === "top" ? `outcome: downside MAE \u2264 \u2212${args.target}% within ${args.horizon}h (SHORT hit)` : `outcome: MFE \u2265 +${args.target}% within ${args.horizon}h`
  );
  const extras = [];
  if (args.takerShare > 0) extras.push(`takerBuyShare\u2265${args.takerShare}`);
  if (args.lsDrop > 0) extras.push(`lsRatioDrop\u2265${args.lsDrop}%`);
  if (args.rsMin !== null) extras.push(`rsVsBTC\u2265${args.rsMin}%`);
  if (extras.length) console.log(`ablation filters: ${extras.join(", ")}`);
  if (args.matched) {
    const env = args.mode === "boarding" ? `EMA20 reclaim on volZ\u2265${args.volz}, no deep-downtrend cond` : args.mode === "spot-pump" ? "spot coin ret4h\u22652%, no spot-vol/basis/oi" : `broke ${args.matchedClose ? "24h-close-high" : "24h-high"} on volZ\u2265${args.volz}`;
    console.log(`baseline: STATE-MATCHED \u2014 ${env} (isolates the detector's discriminating condition's incremental edge)`);
  }
  console.log("");
  console.log(`               signals    baseline(${args.matched ? "state-matched" : "all bars"})`);
  console.log(`count          ${String(sig.n).padEnd(10)} ${base.n.toLocaleString()}`);
  console.log(`hit rate       ${pct(sig.hitRate).padEnd(10)} ${pct(base.hitRate)}    lift \xD7${lift.toFixed(2)}`);
  console.log(`mean MFE       ${pct(sig.meanMfe).padEnd(10)} ${pct(base.meanMfe)}`);
  console.log(`median MFE     ${pct(sig.medMfe).padEnd(10)} ${pct(base.medMfe)}`);
  console.log(`mean MAE       ${pct(sig.meanMae).padEnd(10)} ${pct(base.meanMae)}`);
  console.log(`mean ret@${args.horizon}h   ${pct(sig.meanRetH).padEnd(10)} ${pct(base.meanRetH)}`);
  console.log(`median ret@${args.horizon}h ${pct(sig.medRetH).padEnd(10)} ${pct(base.medRetH)}`);
  {
    const denom = sig.medRunup + sig.medMfe;
    const captured = denom > 0 ? sig.medMfe / denom : 0;
    console.log(
      `lateness       run-up before ${pct(sig.medRunup)} \xB7 upside after ${pct(sig.medMfe)} \u2192 captures ${(captured * 100).toFixed(0)}% of the move (higher = earlier)`
    );
  }
  console.log(`coins firing   ${perCoin.size}/${coins.length}`);
  console.log("");
  if (pnl) {
    console.log(`=== \u5168\u8DDF P&L(\u7B49\u6B0A,close@${args.horizon}h \u51FA\u5834)===`);
    const row = (label, s) => `${label.padEnd(6)} n ${String(s.n).padEnd(5)} win ${pct(s.winRate).padStart(6)}  mean ${pct(s.mean).padStart(7)}  median ${pct(s.median).padStart(7)}  sum ${pct(s.sum).padStart(9)}`;
    console.log(row("LONG", pnl.long));
    console.log(row("SHORT", pnl.short));
    console.log(`baseline meanRet@${args.horizon}h  ${pct(pnl.baselineMeanRet)}`);
    console.log("caveat: short \u70BA\u50F9\u683C\u93E1\u50CF(\u672A\u8A08 funding/\u8CBB\u7528);\u26A1 \u70BA 1H \u8FD1\u4F3C\u91CD\u69CB(mode=breakout),\u975E live detector \u672C\u8EAB\u3002");
    console.log("");
  }
  if (result.topSignals.length) {
    console.log("top signals by MFE:");
    for (const s of result.topSignals) console.log(`  ${s.symbol.padEnd(8)} ${s.time}  MFE +${s.mfePct}%  MAE ${s.maePct}%`);
    console.log("");
  }
  console.log("caveats: single ~30d window (one market regime); signals cluster by");
  console.log("coin; MFE uses intra-bar highs (optimistic vs real fills, no fees).");
}
