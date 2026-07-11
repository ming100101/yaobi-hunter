import { useEffect, useRef, type ReactNode } from 'react';
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type ChartOptions,
  type DeepPartial,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { STRENGTH_THRESHOLD, TIMEFRAMES, type Candle, type Coin, type SeriesPoint, type Timeframe } from '../types';
import type { PaperAction, PaperLedgerRow } from '../lib/paper';
import type { Insight } from '../lib/interpret';
import { signalColor } from '../lib/signalColors';
import { cssVar } from '../lib/cssVar';
import { ChartSync } from '../lib/chartSync';
import { bollinger, ema } from '../lib/indicators';
import { fmtCompact, fmtPct, fmtPrice, pctSign, priceMinMove } from '../lib/format';
import TimeframeSelector from './TimeframeSelector';

const FONT = "'Inter','Segoe UI','Noto Sans TC','Microsoft JhengHei',sans-serif";
const VISIBLE_BARS = 110;
// default K-line window: the past 14 days on 1h/4h (long series, ~25d). 5m/15m
// keep the readable 110-bar default — their data now also reaches ~14d (the
// deep series), but thousands of visible 5m bars would be mush; pan/zoom back
// for the depth instead.
const WINDOW_DAYS = 14;
const BARS_PER_DAY: Record<Timeframe, number> = { '5m': 288, '15m': 96, '1h': 24, '4h': 6 };

function baseOptions(showTime: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: cssVar('--text-3'),
      fontSize: 11,
      fontFamily: FONT,
      attributionLogo: false,
    },
    grid: {
      horzLines: { color: cssVar('--grid') },
      vertLines: { visible: false },
    },
    rightPriceScale: { borderVisible: false, minimumWidth: 78 },
    timeScale: {
      visible: showTime,
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 3,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: cssVar('--accent'),
        width: 1 as LineWidth,
        style: LineStyle.Dashed,
        labelBackgroundColor: cssVar('--accent-deep'),
      },
      horzLine: {
        color: cssVar('--accent'),
        style: LineStyle.Dashed,
        labelBackgroundColor: cssVar('--accent-deep'),
      },
    },
  };
}

function toLine(points: SeriesPoint[]) {
  return points.map((d) => ({ time: d.time as UTCTimestamp, value: d.value }));
}

// zh-TW label for the sell (close) side of a paper fill; open is 買.
const SELL_LABEL: Record<Exclude<PaperAction, 'open'>, string> = {
  tp1: 'TP1',
  tp2: 'TP2',
  tp3: 'TP3',
  sl: '止損',
  timeout: '逾時',
};

// Turn this coin's paper fills into candle markers: 開倉 = green up-triangle
// below the bar (buy), every close (TP/SL/timeout) = red down-triangle above the
// bar (sell). Each fill's ms timestamp is snapped to the bar it falls in (bars
// are labeled by bucket-open time in unix seconds); fills before the loaded
// window have no bar and are dropped ("if applicable"). Markers must be sorted
// ascending by time for lightweight-charts.
function paperMarkers(candles: Candle[], fills: PaperLedgerRow[]): SeriesMarker<UTCTimestamp>[] {
  if (candles.length === 0 || fills.length === 0) return [];
  const times = candles.map((c) => c.time); // ascending, unix seconds
  const first = times[0];
  const barFor = (tsSec: number): number | null => {
    if (tsSec < first) return null; // older than the visible window
    let lo = 0;
    let hi = times.length - 1;
    let res = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= tsSec) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return times[res];
  };
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const f of fills) {
    const bar = barFor(Math.floor(f.ts / 1000));
    if (bar == null) continue;
    if (f.action === 'open') {
      markers.push({ time: bar as UTCTimestamp, position: 'belowBar', color: cssVar('--up'), shape: 'arrowUp', text: `買 ${fmtPrice(f.px)}`, size: 1 });
    } else {
      markers.push({ time: bar as UTCTimestamp, position: 'aboveBar', color: cssVar('--down'), shape: 'arrowDown', text: SELL_LABEL[f.action], size: 1 });
    }
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

// Signal Read markers: one coloured circle above the anchor candle per insight,
// colour = its display-order index (same colour as the Signal Read list dot), so
// a read and its candle are visually tied. Text = the read's short tag.
function insightMarkers(candles: Candle[], insights: Insight[]): SeriesMarker<UTCTimestamp>[] {
  if (candles.length === 0 || insights.length === 0) return [];
  const times = candles.map((c) => c.time);
  const first = times[0];
  const barFor = (tsSec: number): number | null => {
    if (tsSec < first) return null; // older than the loaded window
    let lo = 0;
    let hi = times.length - 1;
    let res = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= tsSec) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return times[res];
  };
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  insights.forEach((ins, i) => {
    if (ins.atTime == null) return;
    const bar = barFor(ins.atTime);
    if (bar == null) return;
    markers.push({ time: bar as UTCTimestamp, position: 'aboveBar', color: signalColor(i), shape: 'circle', text: ins.title, size: 1 });
  });
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

function initialRange(chart: IChartApi, bars: number, tf: Timeframe) {
  // 1h/4h: default to the past 14 days (or everything, for young listings).
  // 5m/15m: default to the 110-bar readable window; the ~14d deep history
  // stays pannable to the left.
  const want = tf === '1h' || tf === '4h' ? BARS_PER_DAY[tf] * WINDOW_DAYS : VISIBLE_BARS;
  const visible = Math.min(bars, want);
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, bars - visible), to: bars + 3 });
}

// Tracks whether the visible range needs resetting on this data update: a
// genuine timeframe switch, OR the bar count jumping massively at the same
// timeframe — which happens when a scan-cached coin's 48h fallback is
// replaced by the freshly-fetched 25d long series (without the reset the old
// logical range would leave the user staring at the OLDEST slice of the new
// series). A background live-data refresh (same timeframe, ±a bar) leaves the
// user's pan/zoom untouched, exactly as before.
function useRangeReset(tf: Timeframe): (bars: number) => boolean {
  const last = useRef<{ tf: Timeframe | null; bars: number }>({ tf: null, bars: 0 });
  return (bars: number) => {
    const changed = last.current.tf !== tf || bars > last.current.bars * 2 || bars * 2 < last.current.bars;
    last.current = { tf, bars };
    return changed;
  };
}

interface PanelProps {
  coin: Coin;
  sync: ChartSync;
  tf: Timeframe;
}

function PanelCard({
  title,
  controls,
  legend,
  badge,
  height,
  chartRef,
  overlay,
}: {
  title: string;
  controls?: ReactNode;
  legend?: ReactNode;
  badge?: ReactNode;
  height: number;
  chartRef: React.RefObject<HTMLDivElement>;
  overlay?: ReactNode; // floating content positioned over the chart canvas (e.g. OHLC legend)
}) {
  return (
    <section className="card panel">
      <div className="panel-head">
        <div className="panel-title-wrap">
          <span className="panel-title">{title}</span>
          {controls}
          {legend}
        </div>
        {badge}
      </div>
      <div className="chart-wrap">
        {overlay}
        <div className="chart-box" style={{ height }} ref={chartRef} />
      </div>
    </section>
  );
}

/* ---------------- Panel 1: price ---------------- */

interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceState {
  chart: IChartApi;
  candle: ISeriesApi<'Candlestick'>;
  volOverlay: ISeriesApi<'Histogram'>;
  ema20: ISeriesApi<'Line'>;
  ema50: ISeriesApi<'Line'>;
  bbUpper: ISeriesApi<'Line'>;
  bbLower: ISeriesApi<'Line'>;
  entryLine: IPriceLine;
  markers: ISeriesMarkersPluginApi<Time>;
  insightMarkers: ISeriesMarkersPluginApi<Time>;
  legendEl: HTMLDivElement | null;
  lastBar: OhlcBar | null;
  unregister: () => void;
}

const PRICE_HEIGHT = 520; // tall single-pane chart, TradingView-style

function renderOhlcLegend(el: HTMLDivElement | null, bar: OhlcBar) {
  if (!el) return;
  const chg = bar.open > 0 ? (bar.close / bar.open - 1) * 100 : 0;
  const cls = bar.close >= bar.open ? 'up' : 'down';
  el.innerHTML =
    `<span>O <b class="num">${fmtPrice(bar.open)}</b></span>` +
    `<span>H <b class="num">${fmtPrice(bar.high)}</b></span>` +
    `<span>L <b class="num">${fmtPrice(bar.low)}</b></span>` +
    `<span>C <b class="num ${cls}">${fmtPrice(bar.close)}</b></span>` +
    `<span class="${cls}">${fmtPct(chg)}</span>`;
}

export function PricePanel({
  coin,
  sync,
  tf,
  onTf,
  fills = [],
  insights = [],
}: PanelProps & {
  tf: Timeframe;
  onTf: (t: Timeframe) => void;
  fills?: PaperLedgerRow[];
  insights?: Insight[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const state = useRef<PriceState | null>(null);
  const needsRangeReset = useRangeReset(tf);

  // create the chart/series ONCE per mount (per open coin) — data is (re)set
  // by the effect below, which also runs on live-data refreshes without
  // tearing this down, so pan/zoom and the crosshair sync survive a poll
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // price panel shows its OWN time axis (in addition to the bottom panel's):
    // it's the tallest panel and the one people actually read — without this
    // you had to scroll to the strength panel just to see what time a bar is
    const chart = createChart(el, baseOptions(true));

    // volume rendered as a quiet overlay at the bottom of the price pane
    // (TradingView's default layout) instead of a separate panel below
    const volOverlay = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol_overlay',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol_overlay').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: cssVar('--up'),
      downColor: cssVar('--down'),
      wickUpColor: cssVar('--up'),
      wickDownColor: cssVar('--down'),
      borderVisible: false,
      priceFormat: { type: 'custom', formatter: fmtPrice, minMove: 0.0001 },
    });
    const mkLine = (color: string, width: LineWidth) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    const ema20 = mkLine(cssVar('--ema20'), 2 as LineWidth);
    const ema50 = mkLine(cssVar('--ema50'), 2 as LineWidth);
    const bbUpper = mkLine(cssVar('--bb'), 1 as LineWidth);
    const bbLower = mkLine(cssVar('--bb'), 1 as LineWidth);
    const entryLine = candle.createPriceLine({
      price: 0,
      color: cssVar('--accent'),
      lineWidth: 1 as LineWidth,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '進場',
    });
    // paper-trade fills (arrows) and Signal Read markers (coloured circles) —
    // two independent marker layers, both populated by the data effect
    const markers = createSeriesMarkers(candle, []);
    const insightMarkers = createSeriesMarkers(candle, []);

    const unregister = sync.register({ chart, series: candle });
    state.current = {
      chart,
      candle,
      volOverlay,
      ema20,
      ema50,
      bbUpper,
      bbLower,
      entryLine,
      markers,
      insightMarkers,
      legendEl: legendRef.current,
      lastBar: null,
      unregister,
    };

    // TradingView-style OHLC readout: live while hovering, falls back to the
    // latest bar once the cursor leaves the chart
    chart.subscribeCrosshairMove((param) => {
      const st = state.current;
      if (!st) return;
      const hovered = param.time
        ? (param.seriesData.get(candle) as OhlcBar | undefined)
        : undefined;
      const bar = hovered ?? st.lastBar;
      if (bar) renderOhlcLegend(st.legendEl, bar);
    });

    return () => {
      state.current?.unregister();
      chart.remove();
      state.current = null;
    };
  }, [sync]);

  // (re)populate on every render — first mount AND every subsequent data or
  // timeframe change — via setData/applyOptions only, never chart.remove()
  useEffect(() => {
    const st = state.current;
    if (!st) return;
    st.candle.applyOptions({
      priceFormat: { type: 'custom', formatter: fmtPrice, minMove: priceMinMove(coin.plan.entry) },
    });
    st.candle.setData(coin.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    st.volOverlay.setData(
      coin.volume.map((v) => ({
        time: v.time as UTCTimestamp,
        value: v.value,
        color: v.up ? cssVar('--vol-up') : cssVar('--vol-down'),
      })),
    );
    st.ema20.setData(toLine(ema(coin.candles, 20)));
    st.ema50.setData(toLine(ema(coin.candles, 50)));
    const bb = bollinger(coin.candles, 20, 2);
    st.bbUpper.setData(toLine(bb.upper));
    st.bbLower.setData(toLine(bb.lower));
    st.entryLine.applyOptions({
      price: coin.plan.entry,
      title: coin.plan.kind === 'breakout' ? '突破' : coin.plan.kind === 'pullback' ? '回調' : '收復',
    });
    st.markers.setMarkers(paperMarkers(coin.candles, fills));
    st.insightMarkers.setMarkers(insightMarkers(coin.candles, insights));
    const last = coin.candles[coin.candles.length - 1];
    st.lastBar = { open: last.open, high: last.high, low: last.low, close: last.close };
    renderOhlcLegend(st.legendEl, st.lastBar);
    if (needsRangeReset(coin.candles.length)) initialRange(st.chart, coin.candles.length, tf);
  }, [coin, fills, insights, tf, needsRangeReset]);

  const last = coin.candles[coin.candles.length - 1].close;
  const dirCls = pctSign(coin.change1h) >= 0 ? 'up-badge' : 'down-badge';
  const tfLabel = TIMEFRAMES.find((t) => t.key === tf)?.label ?? tf;
  return (
    <PanelCard
      title={`價格 · ${tfLabel}`}
      height={PRICE_HEIGHT}
      chartRef={ref}
      controls={<TimeframeSelector tf={tf} onTf={onTf} />}
      legend={
        <div className="panel-legend">
          <span className="legend-key">
            <i className="legend-dot" style={{ background: 'var(--ema20)' }} />
            EMA20
          </span>
          <span className="legend-key">
            <i className="legend-dot" style={{ background: 'var(--ema50)' }} />
            EMA50
          </span>
          <span className="legend-key">
            <i className="legend-dot" style={{ background: 'var(--bb)' }} />
            BB(20,2)
          </span>
          <span className="legend-key">
            <i className="legend-dot dashed" />
            進場價
          </span>
        </div>
      }
      badge={
        <span className={`panel-badge ${dirCls}`}>
          {fmtPrice(last)} · 1h {fmtPct(coin.change1h)} · 量Z {coin.volZ.toFixed(1)}
        </span>
      }
      overlay={<div className="ohlc-legend" ref={legendRef} />}
    />
  );
}

/* ---------------- Panel 2: open interest ---------------- */

interface OIState {
  chart: IChartApi;
  oi: ISeriesApi<'Area'>;
  unregister: () => void;
}

export function OIPanel({ coin, sync, tf }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef<OIState | null>(null);
  const needsRangeReset = useRangeReset(tf);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, baseOptions(false));
    const oi = chart.addSeries(AreaSeries, {
      lineColor: cssVar('--accent'),
      topColor: cssVar('--accent-fill'),
      bottomColor: cssVar('--accent-fill-0'),
      lineWidth: 2 as LineWidth,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: fmtCompact, minMove: 1 },
    });
    const unregister = sync.register({ chart, series: oi });
    state.current = { chart, oi, unregister };
    return () => {
      state.current?.unregister();
      chart.remove();
      state.current = null;
    };
  }, [sync]);

  useEffect(() => {
    const st = state.current;
    if (!st) return;
    st.oi.setData(toLine(coin.oi));
    if (needsRangeReset(coin.oi.length)) initialRange(st.chart, coin.oi.length, tf);
  }, [coin, tf, needsRangeReset]);

  const oiStale = coin.oiTrusted === false; // P1: value is from the laggy cold-path series
  const dirCls = oiStale ? '' : pctSign(coin.oi4h, 1) >= 0 ? 'up-badge' : 'down-badge';
  return (
    <PanelCard
      title="未平倉量 OI"
      height={120}
      chartRef={ref}
      badge={
        <span className={`panel-badge ${dirCls}`} title={oiStale ? 'OI 資料滯後（冷路徑），僅供參考；OI 訊號已停用' : undefined}>
          OI 4h {fmtPct(coin.oi4h, 1)}
          {oiStale ? '·滯後' : ''}
        </span>
      }
    />
  );
}

/* ---------------- Panel 4: funding ---------------- */

interface FundingState {
  chart: IChartApi;
  funding: ISeriesApi<'Baseline'>;
  unregister: () => void;
}

export function FundingPanel({ coin, sync, tf }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef<FundingState | null>(null);
  const needsRangeReset = useRangeReset(tf);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, baseOptions(false));
    // positive funding = longs overheating (rose), negative = fuel (green)
    const funding = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: cssVar('--down'),
      topFillColor1: cssVar('--down-fill'),
      topFillColor2: 'rgba(0,0,0,0)',
      bottomLineColor: cssVar('--up'),
      bottomFillColor1: 'rgba(0,0,0,0)',
      bottomFillColor2: cssVar('--up-fill'),
      lineWidth: 2 as LineWidth,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(3)}%`, minMove: 0.001 },
    });
    funding.createPriceLine({
      price: 0,
      color: cssVar('--text-3'),
      lineWidth: 1 as LineWidth,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: '',
    });
    const unregister = sync.register({ chart, series: funding });
    state.current = { chart, funding, unregister };
    return () => {
      state.current?.unregister();
      chart.remove();
      state.current = null;
    };
  }, [sync]);

  useEffect(() => {
    const st = state.current;
    if (!st) return;
    st.funding.setData(toLine(coin.fundingHist));
    if (needsRangeReset(coin.fundingHist.length)) initialRange(st.chart, coin.fundingHist.length, tf);
  }, [coin, tf, needsRangeReset]);

  const hot = coin.funding > 0.03;
  const cls = hot ? 'warn-badge' : coin.funding < 0 ? 'up-badge' : '';
  return (
    <PanelCard
      title="資金費率 Funding"
      height={120}
      chartRef={ref}
      badge={<span className={`panel-badge ${cls}`}>Funding {fmtPct(coin.funding, 3)}</span>}
    />
  );
}

/* ---------------- Panel 5: strength over time ---------------- */

interface StrengthState {
  chart: IChartApi;
  strength: ISeriesApi<'Area'>;
  markers: ISeriesMarkersPluginApi<Time>;
  unregister: () => void;
}

export function StrengthPanel({ coin, sync, tf }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef<StrengthState | null>(null);
  const needsRangeReset = useRangeReset(tf);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, baseOptions(true));
    const strength = chart.addSeries(AreaSeries, {
      lineColor: cssVar('--accent'),
      topColor: cssVar('--accent-fill'),
      bottomColor: cssVar('--accent-fill-0'),
      lineWidth: 2 as LineWidth,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${Math.round(v)}`, minMove: 1 },
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    strength.createPriceLine({
      price: STRENGTH_THRESHOLD,
      color: cssVar('--warn'),
      lineWidth: 1 as LineWidth,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '門檻',
    });
    const markers = createSeriesMarkers(strength, []);
    const unregister = sync.register({ chart, series: strength });
    state.current = { chart, strength, markers, unregister };
    return () => {
      state.current?.unregister();
      chart.remove();
      state.current = null;
    };
  }, [sync]);

  useEffect(() => {
    const st = state.current;
    if (!st) return;
    st.strength.setData(toLine(coin.strengthHist));
    const lastPoint = coin.strengthHist[coin.strengthHist.length - 1];
    st.markers.setMarkers([
      {
        time: lastPoint.time as UTCTimestamp,
        position: 'inBar',
        color: cssVar('--accent-deep'),
        shape: 'circle',
        size: 1,
      },
    ]);
    if (needsRangeReset(coin.strengthHist.length)) initialRange(st.chart, coin.strengthHist.length, tf);
  }, [coin, tf, needsRangeReset]);

  return (
    <PanelCard
      title="綜合強度"
      height={150}
      chartRef={ref}
      badge={
        <span className="panel-badge">
          強度 {coin.strength} · 門檻 {STRENGTH_THRESHOLD}
        </span>
      }
    />
  );
}
