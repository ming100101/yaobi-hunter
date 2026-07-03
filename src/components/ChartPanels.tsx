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
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { STRENGTH_THRESHOLD, TIMEFRAMES, type Coin, type SeriesPoint, type Timeframe } from '../types';
import { cssVar } from '../lib/cssVar';
import { ChartSync } from '../lib/chartSync';
import { bollinger, ema } from '../lib/indicators';
import { fmtCompact, fmtPct, fmtPrice, pctSign, priceMinMove } from '../lib/format';
import TimeframeSelector from './TimeframeSelector';

const FONT = "'Inter','Segoe UI','Noto Sans TC','Microsoft JhengHei',sans-serif";
const VISIBLE_BARS = 110;

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

function initialRange(chart: IChartApi, bars: number) {
  // clamp so a coarse timeframe with few bars isn't crushed against the edge
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, bars - VISIBLE_BARS), to: bars + 3 });
}

// Tracks whether the timeframe changed since the last data update, so the
// visible range is reset on a genuine timeframe switch (bar count changes
// completely) but left untouched on a background live-data refresh (same
// timeframe, just newer numbers) — that's what keeps the user's pan/zoom
// stable across the periodic re-fetch of an open coin.
function useTfChanged(tf: Timeframe): () => boolean {
  const last = useRef<Timeframe | null>(null);
  return () => {
    const changed = last.current !== tf;
    last.current = tf;
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
}: PanelProps & { tf: Timeframe; onTf: (t: Timeframe) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const state = useRef<PriceState | null>(null);
  const tfChanged = useTfChanged(tf);

  // create the chart/series ONCE per mount (per open coin) — data is (re)set
  // by the effect below, which also runs on live-data refreshes without
  // tearing this down, so pan/zoom and the crosshair sync survive a poll
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, baseOptions(false));

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
    const last = coin.candles[coin.candles.length - 1];
    st.lastBar = { open: last.open, high: last.high, low: last.low, close: last.close };
    renderOhlcLegend(st.legendEl, st.lastBar);
    if (tfChanged()) initialRange(st.chart, coin.candles.length);
  }, [coin, tfChanged]);

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
  const tfChanged = useTfChanged(tf);

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
    if (tfChanged()) initialRange(st.chart, coin.oi.length);
  }, [coin, tfChanged]);

  const dirCls = pctSign(coin.oi4h, 1) >= 0 ? 'up-badge' : 'down-badge';
  return (
    <PanelCard
      title="未平倉量 OI"
      height={120}
      chartRef={ref}
      badge={<span className={`panel-badge ${dirCls}`}>OI 4h {fmtPct(coin.oi4h, 1)}</span>}
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
  const tfChanged = useTfChanged(tf);

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
    if (tfChanged()) initialRange(st.chart, coin.fundingHist.length);
  }, [coin, tfChanged]);

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
  const tfChanged = useTfChanged(tf);

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
    if (tfChanged()) initialRange(st.chart, coin.strengthHist.length);
  }, [coin, tfChanged]);

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
