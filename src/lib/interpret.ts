import type { Coin } from '../types';
import { aggregateCandles, aggregateLast, aggregateVolume } from './aggregate';
import { detectFlushBreakout } from './analyze';
import { ema } from './indicators';
import { fmtPct } from './format';

// ---------------------------------------------------------------------------
// Pattern interpretation library (型態解讀).
// Detects notable changes in funding / OI / price / volume structure and
// explains their market meaning. Detection rules and thresholds distilled from
// perp-microstructure research; all series are read at the scanner's native
// 15m resolution so insights don't shift with the display timeframe.
// Educational heuristics — not investment advice.
// ---------------------------------------------------------------------------

export type InsightTone = 'bull' | 'bear' | 'warn' | 'info';

export interface Insight {
  id: string;
  title: string; // short zh-TW tag
  detail: string; // interpretation with live numbers baked in
  tone: InsightTone;
  priority: number; // 1-10, higher = shown first
  atTime?: number; // anchor candle time (unix seconds) — the bar this read marks
  next?: string; // conditional watch-point:「若後續 A → 行動 B;若 A' → 失效」(heuristic, not advice)
}

interface Ctx {
  last: number;
  change1h: number; // %
  ret4h: number; // fraction
  ret24h: number; // fraction
  fNow: number; // funding % per 8h
  f8h: number;
  f24h: number;
  oi4h: number; // %
  volZ: number;
  pos: number; // 0..1 in 24h range
  buyShare4h: number; // 0..1
  greenShare24h: number;
  maxPullback24h: number; // fraction, <= 0
  priceNewHigh24h: boolean;
  brokeHigh24h: boolean;
  emaAbove20: boolean;
  emaAbove50: boolean;
  crossRecent: -1 | 0 | 1; // EMA20 x EMA50 within last 8 bars
  recentBelowEma20: boolean;
  devEma20: number; // fraction distance from EMA20
  bbPctile: number; // 0..1 rank of current BB bandwidth in 48h window
  upperWick4: number; // max upper-wick ratio, last 4 bars
  lowerWick4: number;
  upthrustBarRed: boolean; // the max-upper-wick bar closed at/below its open
  capBarStrongClose: boolean; // the max-lower-wick bar closed in its upper half
  rangeLast: number;
  avgRange24h: number;
  // anchor times (unix seconds) for marking the corresponding candle on the chart
  lastTime: number; // latest analyzed bar — the detection moment for state reads
  crossTime: number; // the EMA20×EMA50 cross bar (0 if none)
  upWickTime: number; // the max-upper-wick bar in the last 4
  lowWickTime: number; // the max-lower-wick bar in the last 4
  // ---- S2 spot cross-source metrics; null unless a candidate spot series is attached ----
  spotVolZ: number | null; // z of 15m spot volume vs its prior 24h
  spotVolRatio: number | null; // spot vol last-8h mean / prior-40h mean
  basisPct: number | null; // perp/spot basis % (from Coin.basisPct)
  spotBuyShare: number | null; // spot taker buy share over 24h (from Coin.spotTakerBuyShare24h)
}

// funding formatted at 3 decimals, percents at sensible precision
const fp = (x: number) => fmtPct(x, 3);
const p1 = (x: number) => fmtPct(x, 1);
const r1 = (x: number) => fmtPct(x * 100, 1); // fraction -> %

function buildCtx(coin: Coin): Ctx | null {
  const c15 = aggregateCandles(coin.candles, 3);
  const v15 = aggregateVolume(coin.volume, c15, 3);
  const oi15 = aggregateLast(coin.oi, 3);
  const f15 = aggregateLast(coin.fundingHist, 3);
  const M = c15.length;
  if (M < 60) return null;
  const at = (k: number) => Math.max(0, M - k);

  const last = c15[M - 1].close;
  const change1h = (last / c15[at(5)].close - 1) * 100;
  const ret4h = last / c15[at(17)].close - 1;
  const ret24h = last / c15[at(97)].close - 1;

  const fNow = f15[M - 1].value;
  const f8h = f15[at(33)].value;
  const f24h = f15[at(97)].value;

  const oiRef = oi15[at(17)].value;
  const oi4h = oiRef > 0 ? (oi15[M - 1].value / oiRef - 1) * 100 : 0;

  const vols = v15.map((v) => v.value);
  const prior = vols.slice(at(97), M - 1);
  const mean = prior.reduce((a, b) => a + b, 0) / Math.max(1, prior.length);
  const sd = Math.sqrt(
    prior.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, prior.length),
  );
  const volZ = sd > 0 ? (vols[M - 1] - mean) / sd : 0;

  const win = c15.slice(at(97));
  const lo = Math.min(...win.map((c) => c.low));
  const hi = Math.max(...win.map((c) => c.high));
  const pos = hi > lo ? (last - lo) / (hi - lo) : 0.5;

  const last16 = v15.slice(at(17), M - 1 + 1).slice(-16);
  const tot16 = last16.reduce((a, v) => a + v.value, 0);
  const buyShare4h =
    tot16 > 0 ? last16.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / tot16 : 0.5;

  const last96 = v15.slice(at(97));
  const tot96 = last96.reduce((a, v) => a + v.value, 0);
  const greenShare24h =
    tot96 > 0 ? last96.filter((v) => v.up).reduce((a, v) => a + v.value, 0) / tot96 : 0.5;

  let peak = -Infinity;
  let maxPullback24h = 0;
  for (const c of win) {
    peak = Math.max(peak, c.close);
    maxPullback24h = Math.min(maxPullback24h, c.close / peak - 1);
  }

  const prevHighs = c15.slice(at(97), M - 2).map((c) => c.high);
  const priorMax = prevHighs.length ? Math.max(...prevHighs) : hi;
  const priceNewHigh24h = last >= priorMax * 0.999;

  const before4 = c15.slice(at(101), M - 4).map((c) => c.high);
  const priorMax4 = before4.length ? Math.max(...before4) : hi;
  const maxClose4 = Math.max(...c15.slice(M - 4).map((c) => c.close));
  const brokeHigh24h = maxClose4 >= priorMax4 * 0.997;

  // EMA structure — series start at their period offset
  const e20 = ema(c15, 20);
  const e50 = ema(c15, 50);
  const e20At = (i: number) => e20[i - 19]?.value;
  const e50At = (i: number) => e50[i - 49]?.value;
  const e20Last = e20At(M - 1);
  const e50Last = e50At(M - 1);
  if (e20Last == null || e50Last == null) return null;
  const emaAbove20 = last > e20Last;
  const emaAbove50 = last > e50Last;
  let crossRecent: -1 | 0 | 1 = 0;
  let crossTime = 0;
  for (let j = M - 8; j < M; j++) {
    const dPrev = (e20At(j - 1) ?? 0) - (e50At(j - 1) ?? 0);
    const dCur = (e20At(j) ?? 0) - (e50At(j) ?? 0);
    if (dPrev <= 0 && dCur > 0) {
      crossRecent = 1;
      crossTime = c15[j].time;
    } else if (dPrev >= 0 && dCur < 0) {
      crossRecent = -1;
      crossTime = c15[j].time;
    }
  }
  let recentBelowEma20 = false;
  for (let j = Math.max(19, M - 8); j < M - 1; j++) {
    const e = e20At(j);
    if (e != null && c15[j].close < e) recentBelowEma20 = true;
  }
  const devEma20 = (last - e20Last) / e20Last;

  // Bollinger bandwidth percentile across the window
  const widths: number[] = [];
  for (let i = 19; i < M; i++) {
    let m = 0;
    for (let j = i - 19; j <= i; j++) m += c15[j].close;
    m /= 20;
    let v = 0;
    for (let j = i - 19; j <= i; j++) v += (c15[j].close - m) ** 2;
    widths.push(m > 0 ? (4 * Math.sqrt(v / 20)) / m : 0);
  }
  const bwNow = widths[widths.length - 1];
  const bbPctile = widths.filter((w) => w <= bwNow).length / widths.length;

  // wick anatomy over the last 4 bars
  let upperWick4 = 0;
  let lowerWick4 = 0;
  let upthrustBarRed = false;
  let capBarStrongClose = false;
  let upWickTime = 0;
  let lowWickTime = 0;
  for (const c of c15.slice(M - 4)) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    const uw = (c.high - Math.max(c.open, c.close)) / range;
    const lw = (Math.min(c.open, c.close) - c.low) / range;
    if (uw > upperWick4) {
      upperWick4 = uw;
      upthrustBarRed = c.close <= c.open;
      upWickTime = c.time;
    }
    if (lw > lowerWick4) {
      lowerWick4 = lw;
      capBarStrongClose = c.close > c.low + 0.5 * range;
      lowWickTime = c.time;
    }
  }
  const lastBar = c15[M - 1];
  const rangeLast = lastBar.high - lastBar.low;
  const avgRange24h =
    win.reduce((a, c) => a + (c.high - c.low), 0) / Math.max(1, win.length);

  // S2 spot cross-source metrics — computed only when a candidate spot series is
  // attached (spotCandles/spotVolume from okx.ts). null on demo/older coins and
  // pure-perp listings, so the spot detectors no-op there. Aggregated to 15m to
  // match the perp volZ math above (same window: prior 24h / last-8h vs 40h).
  let spotVolZ: number | null = null;
  let spotVolRatio: number | null = null;
  if (coin.spotCandles && coin.spotVolume && coin.spotCandles.length >= 60) {
    const sc15 = aggregateCandles(coin.spotCandles, 3);
    const sv15 = aggregateVolume(coin.spotVolume, sc15, 3);
    const sVols = sv15.map((v) => v.value);
    const sm = sVols.length;
    if (sm >= 96) {
      const sPrior = sVols.slice(sm - 97, sm - 1);
      const sMean = sPrior.reduce((a, b) => a + b, 0) / Math.max(1, sPrior.length);
      const sSd = Math.sqrt(
        sPrior.reduce((a, b) => a + (b - sMean) ** 2, 0) / Math.max(1, sPrior.length),
      );
      spotVolZ = sSd > 0 ? (sVols[sm - 1] - sMean) / sSd : 0;
    }
    if (sm >= 192) {
      const recent8h = sVols.slice(sm - 32);
      const prior40h = sVols.slice(sm - 192, sm - 32);
      const rMean = recent8h.reduce((a, b) => a + b, 0) / 32;
      const pMean = prior40h.reduce((a, b) => a + b, 0) / 160;
      spotVolRatio = pMean > 0 ? rMean / pMean : null;
    }
  }
  const basisPct = coin.basisPct ?? null;
  const spotBuyShare = coin.spotTakerBuyShare24h ?? null;

  return {
    last,
    change1h,
    ret4h,
    ret24h,
    fNow,
    f8h,
    f24h,
    oi4h,
    volZ,
    pos,
    buyShare4h,
    greenShare24h,
    maxPullback24h,
    priceNewHigh24h,
    brokeHigh24h,
    emaAbove20,
    emaAbove50,
    crossRecent,
    recentBelowEma20,
    devEma20,
    bbPctile,
    upperWick4,
    lowerWick4,
    upthrustBarRed,
    capBarStrongClose,
    rangeLast,
    avgRange24h,
    lastTime: lastBar.time,
    crossTime,
    upWickTime,
    lowWickTime,
    spotVolZ,
    spotVolRatio,
    basisPct,
    spotBuyShare,
  };
}

// S2 spot cross-source detectors. Gated PER detector by the backtest gate
// (scripts/backtest.ts --mode spot-*): spot-led-pump PASSED and is live;
// stealth-spot-accum FAILED and stays recording-only. Both are still computed
// for recording (spotSignals) regardless of these ship flags. basis-anomaly (the
// 3rd read) needs basis history and lands with the recording-eval work — not here.
const SPOT_PUMP_SHIPPED = true; // gate: +10%/24h lift ×1.79 — spotVolZ the causal driver (momentum-only ×1.27), robust ±25% (×1.70-1.90), 76/114 coins, look-ahead clean
const SPOT_ACCUM_SHIPPED = false; // gate: ×0.54 (worse than baseline) — recording-only

// 現貨帶動拉升 — real spot buying leads the perp breakout: price up, OI flat,
// spot volume spikes, spot not lagging (basis ≤ +0.05%).
function spotLedPump(c: Ctx): boolean {
  return (
    c.spotVolZ != null &&
    c.basisPct != null &&
    c.ret4h >= 0.02 &&
    Math.abs(c.oi4h) < 1.5 &&
    c.spotVolZ >= 2 &&
    c.basisPct <= 0.05
  );
}

// 現貨暗中吸籌 — sustained spot volume + buy-share while price is flat and
// leverage is quiet: the earlier-than-蓄 accumulation candidate.
function stealthSpotAccum(c: Ctx): boolean {
  return (
    c.spotVolRatio != null &&
    c.spotBuyShare != null &&
    Math.abs(c.ret4h) < 0.01 &&
    c.spotVolRatio >= 1.5 &&
    c.spotBuyShare >= 0.55 &&
    Math.abs(c.oi4h) < 2
  );
}

// S2: the spot cross-source reads as 0/1 flags for a candidate coin's recorded
// sweep-meta (spotSignals map: [pump, accum, basis]). Computes regardless of the
// ship flags — recording-only is the point. basis (idx 2) needs basis history,
// so it stays 0 until the recording-eval work.
export function spotSignals(coin: Coin): [0 | 1, 0 | 1, 0 | 1] | null {
  if (coin.spotCandles == null) return null;
  const ctx = buildCtx(coin);
  if (!ctx) return null;
  return [spotLedPump(ctx) ? 1 : 0, stealthSpotAccum(ctx) ? 1 : 0, 0];
}

// S2: does spot-led-pump fire AND is it shipped? Used by toLite to set the
// screener-row badge flag, so the badge honours the per-detector gate above.
export function spotPumpFires(coin: Coin): boolean {
  if (!SPOT_PUMP_SHIPPED || coin.spotCandles == null) return false;
  const ctx = buildCtx(coin);
  return ctx ? spotLedPump(ctx) : false;
}

// Which candle a given read marks: event reads point at their event bar; every
// other (state) read points at the latest analyzed bar — the moment it fired.
function anchorTime(id: string, ctx: Ctx): number {
  if (id === 'ema-golden-cross' || id === 'ema-death-cross') return ctx.crossTime || ctx.lastTime;
  if (id === 'upthrust-rejection') return ctx.upWickTime || ctx.lastTime;
  if (id === 'capitulation-wick') return ctx.lowWickTime || ctx.lastTime;
  return ctx.lastTime;
}

type Detector = (c: Ctx) => Insight | null;

const DETECTORS: Detector[] = [
  // ---- funding ----
  // long leverage froth washing out while price holds — healthier structure
  (c) =>
    c.f8h >= 0.008 && c.fNow >= 0 && c.fNow <= 0.003 && c.fNow < c.f8h * 0.6 && c.ret4h > -0.01 && c.change1h > -1
      ? {
          id: 'funding-cooling',
          next: '若價續守穩、費率維持低位 → 回檔至 EMA20 係留意位；若費率急速回升而價滯漲 → 降溫失效，提防再過熱。',
          title: '資金降溫',
          tone: 'bull',
          priority: 7,
          detail: `資金費率由 ${fp(c.f8h)} 降至 ${fp(c.fNow)}，多頭槓桿降溫但價格守穩，行情轉為現貨買盤主導，上行結構更健康。`,
        }
      : null,
  // shorts now paying longs — squeeze fuel if price holds
  (c) =>
    c.f8h > 0 && c.fNow < -0.001 && c.ret4h > -0.005
      ? {
          id: 'funding-flip-negative',
          next: '若價格放量上攻 → 軋空啟動，可依出場計畫追蹤；若跌破近期低點 → 空方主導，訊號失效。',
          title: '費率轉負',
          tone: 'bull',
          priority: 8,
          detail: `資金費率由 ${fp(c.f8h)} 轉負至 ${fp(c.fNow)}，空頭開始付息給多頭，價格未破低，空單存在被軋出場的燃料。`,
        }
      : null,
  // crowded longs + rising OI — liquidation cascade risk
  (c) =>
    c.fNow >= 0.015 && c.fNow > c.f8h && c.f8h > c.f24h && c.oi4h > 3
      ? {
          id: 'funding-overheat',
          next: '若價格滯漲或轉跌 → 提防多殺多，宜先減倉、收緊停損；若費率回落且價守穩 → 風險解除。',
          title: '資金過熱',
          tone: 'warn',
          priority: 9,
          detail: `資金費率升至 ${fp(c.fNow)} 且持續走高，多單擁擠度極高，若價格轉弱恐引發連環多殺多。`,
        }
      : null,
  // disbelief rally — crowd still short and being proven wrong
  (c) =>
    c.fNow <= -0.005 && c.f8h <= -0.002 && c.ret4h >= 0.02 && c.ret24h > 0
      ? {
          id: 'disbelief-rally',
          next: '若費率仍負而價續創高 → 軋空未完，以持有為主；若費率轉正 → 軋空燃料耗盡，留意動能衰竭。',
          title: '軋空行情',
          tone: 'bull',
          priority: 8,
          detail: `資金費率持續為負（${fp(c.fNow)}）但價格逆勢走高 ${r1(c.ret4h)}（4h），市場仍普遍看空，軋空可能尚未結束。`,
        }
      : null,
  // longs paying to hold losing positions — latent liquidation supply below
  (c) =>
    c.fNow >= 0.006 && c.oi4h > -1 && c.ret4h <= -0.02 && c.change1h < -0.5
      ? {
          id: 'long-trap',
          next: '若跌破近期支撐 → 連環平倉風險，LONG ONLY 宜離場觀望；若放量收復失地且費率降溫 → 陷阱解除。',
          title: '多頭陷阱',
          tone: 'bear',
          priority: 7,
          detail: `價格 4h 已跌 ${r1(c.ret4h)} 但資金費率仍為正（${fp(c.fNow)}），套牢多單未離場，續破位恐觸發骨牌式平倉。`,
        }
      : null,
  // contrarian sentiment extreme — shorts pay a steep premium
  (c) =>
    c.fNow <= -0.02 && c.f24h > c.fNow && c.ret24h < 0.03
      ? {
          id: 'extreme-negative-funding',
          next: '若價止跌回升 → 軋空反轉啟動，可小注試探；若續破低 → 接刀風險，等企穩再講。',
          title: '極端負費率',
          tone: 'bull',
          priority: 6,
          detail: `資金費率跌至極端負值 ${fp(c.fNow)}，空頭付出高額成本維持部位，情緒極度悲觀，軋空反轉機率上升。`,
        }
      : null,

  // ---- open interest ----
  // healthy leveraged demand joining an uptrend, not yet overheated
  (c) =>
    c.fNow > 0 && c.fNow <= 0.008 && c.fNow >= c.f8h && c.oi4h >= 2 && c.ret4h >= 0.015 && c.pos > 0.6
      ? {
          id: 'double-confirmation',
          next: '若回檔至 EMA20 不破 → 分批進場機會；若 OI 掉頭下降或費率急升過熱 → 確認失效，收緊停損。',
          title: '雙重確認',
          tone: 'bull',
          priority: 9,
          detail: `資金費率溫和走升（${fp(c.fNow)}）、OI 4h +${c.oi4h.toFixed(1)}% 與價格同步上行，多頭趨勢獲資金面與籌碼面雙重確認。`,
        }
      : null,
  // new long money confirming the move (skipped when double-confirmation fires)
  (c) =>
    c.oi4h >= 2 && c.ret4h >= 0.015 && c.buyShare4h > 0.52 &&
    !(c.fNow > 0 && c.fNow <= 0.008 && c.fNow >= c.f8h && c.pos > 0.6)
      ? {
          id: 'oi-up-price-up',
          next: '若量能與 OI 同步續增 → 趨勢延續，回檔係機會；若價滯漲而 OI 續升 → 轉為擁擠，提防甩尾。',
          title: '增倉上漲',
          tone: 'bull',
          priority: 6,
          detail: `OI 4h +${c.oi4h.toFixed(1)}% 與價格同步上升，新資金積極做多推升行情，趨勢動能受到確認。`,
        }
      : null,
  // new shorts building or longs trapped
  (c) =>
    c.oi4h >= 2 && c.ret4h <= -0.015
      ? {
          id: 'oi-up-price-down',
          next: '若跌勢放緩且 OI 轉降 → 空頭回補反彈可期；若續增倉續跌 → 賣壓未完，勿接刀。',
          title: '增倉下跌',
          tone: 'bear',
          priority: 7,
          detail: `價格下跌但 OI 4h +${c.oi4h.toFixed(1)}%，新空單積極進場或多單被套牢，賣壓可能延續。`,
        }
      : null,
  // short-covering rally — weaker fuel
  (c) =>
    c.oi4h <= -2 && c.ret4h >= 0.015
      ? {
          id: 'oi-down-price-up',
          next: '若之後 OI 轉增且量能放大 → 升級為真趨勢，可再評估；若量縮價滯 → 回補近尾聲，勿追高。',
          title: '減倉上漲',
          tone: 'info',
          priority: 4,
          detail: `價格上漲但 OI 4h ${c.oi4h.toFixed(1)}%，上漲主因空頭回補而非新多進場，動能較弱，追高宜謹慎。`,
        }
      : null,
  // deleveraging flush — painful but cleans the book
  (c) =>
    c.oi4h <= -2 && c.ret4h <= -0.015
      ? {
          id: 'oi-down-price-down',
          next: '若 OI 止跌且低位出現長下影 → 出清近尾聲，留意築底型態；若續減倉續跌 → 繼續觀望。',
          title: '減倉下跌',
          tone: 'bear',
          priority: 5,
          detail: `OI 4h ${c.oi4h.toFixed(1)}% 與價格同步下降，多單停損去槓桿中，籌碼出清後才易見底。`,
        }
      : null,
  // the classic pre-move coil: positions accumulating under a flat price
  (c) =>
    c.oi4h >= 3 && c.oi4h < 8 && Math.abs(c.change1h) < 0.5 && Math.abs(c.ret4h) < 0.008 && c.pos > 0.3 && c.pos < 0.7
      ? {
          id: 'oi-coil',
          next: '若放量向上突破盤整區 → 順向跟進（留意 ⚡ 觸發）；若向下破位 → LONG ONLY 迴避。',
          title: '持倉盤整',
          tone: 'info',
          priority: 6,
          detail: `價格橫盤但 OI 4h +${c.oi4h.toFixed(1)}% 持續增加，籌碼正悄悄堆積，波動率可能即將放大。`,
        }
      : null,
  // leverage piling in faster than price can absorb
  (c) =>
    c.oi4h >= 8 && Math.abs(c.ret4h) < 0.025
      ? {
          id: 'oi-spike',
          next: '若價急拉後回落 → 提防雙向插針，勿追價；若價穩步消化增倉 → 風險下降，再觀察。',
          title: '持倉暴增',
          tone: 'warn',
          priority: 7,
          detail: `OI 4h 暴增 +${c.oi4h.toFixed(1)}% 遠快於價格變動，槓桿堆積過快，留意反向甩尾與雙向插針風險。`,
        }
      : null,
  // new price high without new participation
  (c) =>
    c.priceNewHigh24h && c.oi4h <= -1.5
      ? {
          id: 'oi-divergence-high',
          next: '若跌回前高之下 → 假突破確認，宜退出；若 OI 回升跟上價格 → 背離解除。',
          title: '新高背離',
          tone: 'warn',
          priority: 8,
          detail: `價格創 24h 新高但 OI 4h ${c.oi4h.toFixed(1)}% 走低，追價力道減弱，留意假突破與動能背離風險。`,
        }
      : null,
  // breakout without leverage — cleaner structure, less unwind risk
  (c) =>
    c.ret4h >= 0.02 && Math.abs(c.oi4h) < 1.5 && c.buyShare4h > 0.55 && c.volZ > 1
      ? {
          id: 'spot-led-breakout',
          next: '若回測突破位不破 → 進場機會（現貨主導結構較耐震）；若跌回突破位下 → 假突破，離場。',
          title: '現貨帶動',
          tone: 'bull',
          priority: 5,
          detail: `價格 4h ${r1(c.ret4h)} 但 OI 幾乎未變（${p1(c.oi4h)}），突破由現貨買盤帶動而非槓桿堆疊，籌碼結構較乾淨。`,
        }
      : null,
  // S2 現貨帶動拉升 — SHIPPED (gate PASSED, lift ×1.79); gated by SPOT_PUMP_SHIPPED.
  (c) =>
    SPOT_PUMP_SHIPPED && spotLedPump(c)
      ? {
          id: 'spot-led-pump',
          next: '若基差維持中性或轉負 → 現貨主導續航；若基差走正放闊 → 槓桿接手，結構轉弱。',
          title: '現貨帶動',
          tone: 'bull',
          priority: 8,
          detail:
            `價格 4h ${r1(c.ret4h)}、OI 幾乎未動（${p1(c.oi4h)}），但現貨量爆升（量Z ${c.spotVolZ!.toFixed(1)}）且現貨不落後（基差 ${c.basisPct!.toFixed(2)}%），升勢由真實現貨買盤扛住。` +
            `回測（114 幣、37 日）：+10%/24h 命中率 17.3% vs 基準 9.6%（lift ×1.79，現貨量Z 為驅動；純動能僅 ×1.27），僅供排序參考，非進場訊號。`,
        }
      : null,
  // S2 現貨暗中吸籌 — recording-only (gate FAILED ×0.54); gated by SPOT_ACCUM_SHIPPED.
  (c) =>
    SPOT_ACCUM_SHIPPED && stealthSpotAccum(c)
      ? {
          id: 'stealth-spot-accum',
          next: '若之後帶量突破盤整高點 → 升級關注；若現貨量回落至常態 → 吸籌結束。',
          title: '現貨吸籌',
          tone: 'info',
          priority: 6,
          detail: `價格橫盤（4h ${r1(c.ret4h)}）但現貨量持續放大（近8h 均量達前40h 的 ${c.spotVolRatio!.toFixed(1)}×）、主動買盤佔 ${(c.spotBuyShare! * 100).toFixed(0)}%，而槓桿靜止（OI ${p1(c.oi4h)}），疑似現貨暗中吸籌。`,
        }
      : null,

  // ---- price / volume / volatility ----
  // volume ignition from low in the range — early-stage move
  (c) =>
    c.volZ >= 2 && c.pos < 0.4 && c.change1h >= 1.5 && c.ret4h > 0
      ? {
          id: 'volume-ignition',
          next: '若下一根續放量收高 → 啟動確認，可依計畫評估進場；若量退價回 → 一次性脈衝，觀望。',
          title: '量能啟動',
          tone: 'bull',
          priority: 8,
          detail: `區間低位（${Math.round(c.pos * 100)}% 位置）出現異常放量（量Z ${c.volZ.toFixed(1)}）且 1h +${c.change1h.toFixed(1)}%，具早期啟動特徵。`,
        }
      : null,
  // climax at highs after an extended run
  (c) =>
    c.volZ >= 2.5 && c.pos > 0.85 && c.ret4h > 0.03 && c.rangeLast >= 1.5 * c.avgRange24h
      ? {
          id: 'volume-climax',
          next: '若隨後出現長上影或滯漲 → 行情尾段，分批止盈；若有量續強 → 可續持但停損要跟上。',
          title: '量能高潮',
          tone: 'warn',
          priority: 9,
          detail: `高位區爆量長 K（量Z ${c.volZ.toFixed(1)}，4h ${r1(c.ret4h)}），常見於行情末段，留意獲利了結賣壓。`,
        }
      : null,
  // heavy volume, no progress at highs — supply absorbing demand
  (c) =>
    c.pos > 0.75 && c.volZ >= 1.5 && Math.abs(c.change1h) < 0.5 && c.ret4h < 0.01 && c.upperWick4 > 0.3 &&
    !(c.volZ >= 2.5 && c.ret4h > 0.03)
      ? {
          id: 'absorption-stall',
          next: '若放量仍推唔郁 → 賣壓佔優，宜減倉；若吸收完成後放量上破 → 轉為突破訊號，再評估。',
          title: '高位滯漲',
          tone: 'warn',
          priority: 7,
          detail: `價格處高位（${Math.round(c.pos * 100)}% 位置）且放量（量Z ${c.volZ.toFixed(1)}）卻無漲幅，上方賣壓正吸收買盤，突破力道存疑。`,
        }
      : null,
  // compression before expansion
  (c) =>
    c.bbPctile <= 0.1 && c.volZ <= -0.3 && Math.abs(c.change1h) < 0.8
      ? {
          id: 'volatility-squeeze',
          next: '若放量向上突破 → 跟進突破方向（留意 ⚡）；若向下破位 → LONG ONLY 迴避，等回穩。',
          title: '波動壓縮',
          tone: 'info',
          priority: 6,
          detail: `布林帶寬處於 48h 最低 ${Math.round(c.bbPctile * 100)}% 分位且量能萎縮，市場正醞釀方向性突破，宜雙向設防。`,
        }
      : null,
  // EMA regime change
  (c) =>
    c.crossRecent === 1
      ? {
          id: 'ema-golden-cross',
          next: '若回踩 EMA20 不破 → 順勢佈局位；若跌回 EMA50 之下 → 假交叉，訊號失效。',
          title: '均線多排',
          tone: 'bull',
          priority: 7,
          detail: `15m EMA20 上穿 EMA50${c.emaAbove20 ? '，價格站穩 EMA20 之上' : ''}，短線趨勢結構轉多。`,
        }
      : null,
  (c) =>
    c.crossRecent === -1
      ? {
          id: 'ema-death-cross',
          next: 'LONG ONLY 宜觀望；若重新站回 EMA20/EMA50 之上 → 空排解除，再重新評估。',
          title: '均線空排',
          tone: 'bear',
          priority: 7,
          detail: `15m EMA20 下穿 EMA50${!c.emaAbove20 ? '，價格失守 EMA20' : ''}，短線趨勢結構轉空。`,
        }
      : null,
  // breakout quality — with vs without volume
  (c) =>
    c.brokeHigh24h && c.volZ >= 1.8 && c.buyShare4h > 0.55
      ? {
          id: 'breakout-confirmed',
          next: '若回測前高不破 → 屬加碼位；若跌回盤整區內 → 假突破，依停損紀律離場。',
          title: '放量突破',
          tone: 'bull',
          priority: 9,
          detail: `突破 24h 高點且量能同步放大（量Z ${c.volZ.toFixed(1)}、主動買盤 ${Math.round(c.buyShare4h * 100)}%），站穩機率較高。`,
        }
      : null,
  (c) =>
    c.brokeHigh24h && c.volZ < 0.8
      ? {
          id: 'breakout-thin',
          next: '若補量續漲 → 升級為有效突破；若無量滯漲 → 等回測確認先好講，勿追。',
          title: '縮量突破',
          tone: 'warn',
          priority: 6,
          detail: `價格突破 24h 高點但量能未跟上（量Z ${c.volZ.toFixed(1)}），假突破風險偏高，等回測確認再進場較穩。`,
        }
      : null,
  // rejection at highs
  (c) =>
    c.pos > 0.85 && c.upperWick4 >= 0.55 && c.volZ >= 1.5 && c.ret4h < 0.015 && c.upthrustBarRed
      ? {
          id: 'upthrust-rejection',
          next: '若再測高點無力（更低高點）→ 短線見頂訊號，宜先止盈；若放量收復影線高點 → 拒絕失效。',
          title: '上影拒絕',
          tone: 'bear',
          priority: 8,
          detail: `高位區出現放量長上影（影線占比 ${Math.round(c.upperWick4 * 100)}%），買盤遭強力賣壓打回，短線反轉風險升高。`,
        }
      : null,
  // seller exhaustion at lows
  (c) =>
    c.pos < 0.15 && c.lowerWick4 >= 0.55 && c.volZ >= 2 && c.capBarStrongClose
      ? {
          id: 'capitulation-wick',
          next: '若守住下影低點且賣壓量縮 → 築底訊號，可留意反轉進場位；若再破低 → 洗盤變趨勢，離場。',
          title: '恐慌洗盤',
          tone: 'bull',
          priority: 8,
          detail: `低位區爆量長下影（影線占比 ${Math.round(c.lowerWick4 * 100)}%），恐慌拋售遭承接，賣壓可能已近尾聲。`,
        }
      : null,
  // aggressive buying not moving price — stealth accumulation or hidden supply
  (c) =>
    c.buyShare4h > 0.6 && c.ret4h <= 0.005 && c.ret4h >= -0.01 && c.pos < 0.85
      ? {
          id: 'buy-pressure-divergence',
          next: '若價格向上脫離平台 → 吸籌確認，訊號轉強；若買壓退卻且價跌 → 隱性賣壓佔優，觀望。',
          title: '買壓背離',
          tone: 'info',
          priority: 6,
          detail: `近 4h 主動買盤占比 ${Math.round(c.buyShare4h * 100)}% 但價格持平，可能是吸籌蓄勢，也可能有隱性賣壓，觀察量價後續變化。`,
        }
      : null,
  // sustainable grind vs parabola
  (c) =>
    c.ret24h > 0.03 && c.greenShare24h >= 0.55 && c.maxPullback24h > -0.08 && c.emaAbove20 && c.emaAbove50
      ? {
          id: 'trend-health',
          next: '若回檔至 EMA20 附近且量縮 → 逢回布局位；若跌破 EMA50 → 趨勢轉弱，退出觀望。',
          title: '健康趨勢',
          tone: 'bull',
          priority: 7,
          detail: `24h ${r1(c.ret24h)}、綠量占比 ${Math.round(c.greenShare24h * 100)}%、最大回檔僅 ${r1(c.maxPullback24h)}，趨勢穩健，宜逢回布局而非追高。`,
        }
      : null,
  // failed breakdown reclaimed — bear trap
  (c) =>
    c.pos < 0.3 && c.recentBelowEma20 && c.emaAbove20 && c.change1h > 1 && c.volZ >= 1.2
      ? {
          id: 'failed-breakdown-reclaim',
          next: '若企穩於收復位之上 → 軋空延伸可期；若再度失守 EMA20 → 回收失敗，離場。',
          title: '假跌破回收',
          tone: 'bull',
          priority: 7,
          detail: `價格一度跌破支撐後迅速收復 EMA20（1h +${c.change1h.toFixed(1)}%），空頭陷阱特徵，留意軋空延伸。`,
        }
      : null,
  // parabolic extension losing fuel
  (c) =>
    c.ret4h > 0.08 && c.pos > 0.9 && c.bbPctile > 0.9 && c.devEma20 > 0.05 && c.volZ < 1
      ? {
          id: 'parabolic-overextension',
          next: '若出現首根放量陰 K → 動能透支確認，止盈離場；若橫盤消化乖離 → 可續觀察，唔追價。',
          title: '過熱乖離',
          tone: 'warn',
          priority: 8,
          detail: `4h 暴漲 ${r1(c.ret4h)}、乖離 EMA20 達 ${r1(c.devEma20)}，但量能未同步放大（量Z ${c.volZ.toFixed(1)}），追價動能可能已透支。`,
        }
      : null,
];

const MAX_INSIGHTS = 6;

export function interpret(coin: Coin): Insight[] {
  const ctx = buildCtx(coin);
  if (!ctx) return [];
  const out: Insight[] = [];

  // 縮倉突破 — the one detector validated by backtest (scripts/backtest.ts):
  // flush-context breakout hit +15%/24h at 9.1% vs 4.5% base rate (lift ×2.04)
  // over 154 Binance-listed small caps, 37d @1H. The quiet setup alone tested
  // BELOW base rate, so this fires only on the confirmed trigger.
  const fb = detectFlushBreakout(coin.candles, coin.volume, coin.oi, coin.fundingHist);
  if (fb) {
    out.push({
      id: 'flush-breakout',
      title: '縮倉突破',
      tone: 'bull',
      priority: 10,
      detail:
        `未平倉量自 48h 高位縮 ${fb.oiDropPct.toFixed(1)}% 後，帶量突破 24h 盤整區（1H 量Z ${fb.volZ1h.toFixed(1)}）。` +
        `回測（154 幣、37 日）：+15%/24h 命中率 9.1% vs 基準 4.5%（lift ×2.0），僅供排序參考。`,
      next: '若回測突破位不破 → 依出場計畫（TP1/TP2/SL）分批執行；若收回盤整區內 → 假突破，訊號失效。',
    });
  }

  // 早期蓄力 — watchlist tier, backtested weaker than ⚡ and labeled as such:
  // consistently positive forward returns across specs, but lift only
  // ×1.0-1.24 (the flashy ×1.61 didn't survive robustness checks).
  if (coin.earlyAccum) {
    const ea = coin.earlyAccum;
    out.push({
      id: 'early-accum',
      title: '早期蓄力',
      tone: 'info',
      priority: 8,
      detail:
        `縮倉築底中，且散戶多空比 24h 降 ${ea.lsDropPct.toFixed(1)}%、相對 BTC 強 ${fmtPct(ea.rsPct, 1)}。` +
        `回測（154 幣、37 日）：後續 72-96h 平均回報 +1.1~1.3%（基準 -1%）、回撤淺 30%，但命中 lift 僅 ×1.0-1.2 — 觀察名單參考，非進場訊號。`,
      next: '若之後帶量突破盤整高點（升級為 ⚡）→ 先等訊號再談進場；若 OI 回升但價轉弱 → 移出觀察名單。',
    });
  }

  for (const d of DETECTORS) {
    const ins = d(ctx);
    if (ins) out.push(ins);
  }
  // stamp each read with the candle it marks (for the chart + the hh:mm label)
  for (const ins of out) ins.atTime = anchorTime(ins.id, ctx);
  // the backtested trigger supersedes the generic volume-confirmed breakout
  const deduped = fb ? out.filter((i) => i.id !== 'breakout-confirmed') : out;
  deduped.sort((a, b) => b.priority - a.priority);
  return deduped.slice(0, MAX_INSIGHTS);
}
