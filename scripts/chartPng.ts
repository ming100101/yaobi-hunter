import { deflateSync } from 'node:zlib';
import { aggregateCandles } from '../src/lib/aggregate';
import { bollinger, ema } from '../src/lib/indicators';
import { fmtPrice } from '../src/lib/format';
import type { Candle } from '../src/types';

// Pure-JS Telegram chart card. It renders directly to a PNG Buffer: no temp
// file, native image dependency, external chart service, or persistent copy.

type Rgb = [number, number, number];

const BG: Rgb = [0x0b, 0x07, 0x16];
const HEADER: Rgb = [0x12, 0x0c, 0x21];
const PANEL: Rgb = [0x10, 0x0b, 0x1d];
const GRID: Rgb = [0x24, 0x1b, 0x3a];
const AXIS_TEXT: Rgb = [0x9a, 0x8f, 0xc0];
const TEXT: Rgb = [0xf2, 0xed, 0xff];
const UP: Rgb = [0x2b, 0xd9, 0xa0];
const DOWN: Rgb = [0xff, 0x5f, 0x87];
const EMA20: Rgb = [0xa7, 0x8b, 0xfa];
const EMA50: Rgb = [0x4d, 0xc9, 0xff];
const BB_LINE: Rgb = [0x70, 0x63, 0x91];
const BB_FILL: Rgb = [0x16, 0x10, 0x29];
const ENTRY: Rgb = [0xff, 0xc8, 0x57];
const TARGET: Rgb = [0x31, 0xb9, 0x88];
const RSI_LINE: Rgb = [0xf2, 0x8b, 0xd8];
const ACCENT: Rgb = [0xd9, 0x46, 0xef];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgb: Buffer, width: number, height: number): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

class Raster {
  buf: Buffer;

  constructor(
    public w: number,
    public h: number,
  ) {
    this.buf = Buffer.alloc(w * h * 3);
  }

  px(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const offset = (y * this.w + x) * 3;
    this.buf[offset] = color[0];
    this.buf[offset + 1] = color[1];
    this.buf[offset + 2] = color[2];
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgb): void {
    const x1 = Math.min(this.w, x + width);
    const y1 = Math.min(this.h, y + height);
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) this.px(xx, yy, color);
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, color: Rgb): void {
    this.hline(x, x + width - 1, y, color);
    this.hline(x, x + width - 1, y + height - 1, color);
    this.vline(x, y, y + height - 1, color);
    this.vline(x + width - 1, y, y + height - 1, color);
  }

  hline(x0: number, x1: number, y: number, color: Rgb, dash?: [number, number]): void {
    for (let x = x0; x <= x1; x++) {
      if (dash && (x - x0) % (dash[0] + dash[1]) >= dash[0]) continue;
      this.px(x, y, color);
    }
  }

  vline(x: number, y0: number, y1: number, color: Rgb): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.px(x, y, color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color);
      this.px(x0, y0 + 1, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  circle(cx: number, cy: number, radius: number, color: Rgb): void {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y <= radius * radius) this.px(cx + x, cy + y, color);
      }
    }
  }

  text(x: number, y: number, value: string, color: Rgb, scale = 2): void {
    let cx = x;
    for (const raw of value.toUpperCase()) {
      const glyph = FONT[raw];
      if (glyph) {
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 5; col++) {
            if (glyph[row] & (1 << (4 - col))) {
              this.fillRect(cx + col * scale, y + row * scale, scale, scale, color);
            }
          }
        }
      }
      cx += 6 * scale;
    }
  }
}

const FONT: Record<string, number[]> = {
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '%': [17, 2, 4, 8, 17, 0, 0],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '|': [4, 4, 4, 4, 4, 4, 4],
};

export interface ChartOpts {
  symbol?: string;
  signal?: string;
  entry?: number;
  stop?: number;
  targets?: number[];
  lastPrice?: number;
  change1hPct?: number;
  strength?: number;
  volZ?: number;
  oi4hPct?: number;
  emaPeriod?: number;
  width?: number;
  height?: number;
}

const BARS = 192;
const PAD_L = 44;
const PAD_R = 120;
const PAD_T = 132;
const PAD_B = 30;
const RSI_H = 88;
const PANEL_GAP = 16;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function signed(value: number, digits = 1): string {
  return (value >= 0 ? '+' : '') + value.toFixed(digits);
}

function hktClock(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000 + 8 * 3600_000);
  return String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0');
}

function textWidth(value: string, scale: number): number {
  return value.length * 6 * scale;
}

function rsi14(candles: Candle[]): number[] {
  const out = Array(candles.length).fill(Number.NaN);
  if (candles.length < 15) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= 14; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    gain += Math.max(0, delta);
    loss += Math.max(0, -delta);
  }
  gain /= 14;
  loss /= 14;
  out[14] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = 15; i < candles.length; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    gain = (gain * 13 + Math.max(0, delta)) / 14;
    loss = (loss * 13 + Math.max(0, -delta)) / 14;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function renderCandlePng(candles5m: Candle[], opts: ChartOpts = {}): Buffer {
  const width = opts.width ?? 1000;
  const height = opts.height ?? 640;
  const emaPeriod = opts.emaPeriod ?? 20;
  const bars = aggregateCandles(candles5m, 3).slice(-BARS);
  if (!bars.length) throw new Error('renderCandlePng: no candles');

  const ema20 = ema(bars, emaPeriod);
  const ema50 = ema(bars, 50);
  const bands = bollinger(bars, 20, 2);
  const rsi = rsi14(bars);
  const last = opts.lastPrice ?? bars[bars.length - 1].close;

  let low = Infinity;
  let high = -Infinity;
  for (const bar of bars) {
    low = Math.min(low, bar.low);
    high = Math.max(high, bar.high);
  }
  for (const point of [...ema20, ...ema50, ...bands.upper, ...bands.lower]) {
    low = Math.min(low, point.value);
    high = Math.max(high, point.value);
  }
  for (const level of [opts.entry, opts.stop, last]) {
    if (finite(level)) {
      low = Math.min(low, level);
      high = Math.max(high, level);
    }
  }
  const pricePad = high > low ? (high - low) * 0.06 : Math.abs(high) * 0.01 || 1e-9;
  low -= pricePad;
  high += pricePad;

  const image = new Raster(width, height);
  image.fillRect(0, 0, width, height, BG);
  image.fillRect(0, 0, width, 100, HEADER);
  image.fillRect(0, 0, 7, 100, ACCENT);
  image.hline(0, width - 1, 99, GRID);

  const symbol = (opts.symbol || 'MARKET').toUpperCase() + '/USDT';
  const signal = (opts.signal || 'SIGNAL').toUpperCase();
  image.text(24, 16, symbol, TEXT, 3);
  image.text(26, 54, signal + ' | 15M | 48H | HKT', AXIS_TEXT, 1);

  const priceText = fmtPrice(last);
  const priceScale = priceText.length > 9 ? 2 : 3;
  image.text(width - 24 - textWidth(priceText, priceScale), 14, priceText, TEXT, priceScale);
  if (finite(opts.change1hPct)) {
    const change = signed(opts.change1hPct) + '% 1H';
    const color = opts.change1hPct >= 0 ? UP : DOWN;
    image.text(width - 24 - textWidth(change, 1), 52, change, color, 1);
  }

  const metrics: string[] = [];
  if (finite(opts.strength)) metrics.push('STR ' + Math.round(opts.strength));
  if (finite(opts.oi4hPct)) metrics.push('OI4H ' + signed(opts.oi4hPct) + '%');
  if (finite(opts.volZ)) metrics.push('VOLZ ' + opts.volZ.toFixed(1));
  if (metrics.length) image.text(Math.max(350, width - 24 - textWidth(metrics.join(' | '), 1)), 72, metrics.join(' | '), AXIS_TEXT, 1);

  const plan: string[] = [];
  if (finite(opts.entry)) plan.push('E ' + fmtPrice(opts.entry));
  for (let i = 0; i < (opts.targets?.length ?? 0); i++) {
    const target = opts.targets?.[i];
    if (finite(target)) plan.push('T' + (i + 1) + ' ' + fmtPrice(target));
  }
  if (finite(opts.stop)) plan.push('SL ' + fmtPrice(opts.stop));
  if (plan.length) image.text(26, 76, plan.join(' | '), ENTRY, 1);

  const plotRight = width - PAD_R;
  const priceBottom = height - PAD_B - RSI_H - PANEL_GAP;
  const plotWidth = plotRight - PAD_L;
  const plotHeight = priceBottom - PAD_T;
  const rsiTop = priceBottom + PANEL_GAP;
  const step = plotWidth / BARS;
  const offset = BARS - bars.length;
  const toX = (index: number) => PAD_L + Math.round(index * step + step / 2);
  const toY = (price: number) => PAD_T + Math.round(((high - price) / (high - low)) * plotHeight);
  const toRsiY = (value: number) => rsiTop + Math.round(((100 - value) / 100) * RSI_H);

  image.fillRect(PAD_L, PAD_T, plotWidth, plotHeight, PANEL);
  image.fillRect(PAD_L, rsiTop, plotWidth, RSI_H, PANEL);
  image.strokeRect(PAD_L, PAD_T, plotWidth, plotHeight, GRID);
  image.strokeRect(PAD_L, rsiTop, plotWidth, RSI_H, GRID);

  const axisLabel = (y: number, price: number, color: Rgb) => {
    const label = fmtPrice(price);
    const scale = label.length > 8 ? 1 : 2;
    image.text(plotRight + 10, y - Math.floor((7 * scale) / 2), label, color, scale);
  };

  for (let k = 0; k <= 4; k++) {
    const price = high - ((high - low) * k) / 4;
    const y = toY(price);
    image.hline(PAD_L, plotRight, y, GRID);
    axisLabel(y, price, AXIS_TEXT);
  }

  const timeIndexes = [0, 48, 96, 144, 191];
  for (const index of timeIndexes) {
    const x = toX(index);
    image.vline(x, PAD_T, priceBottom, GRID);
    const barIndex = index - offset;
    if (bars[barIndex]) {
      const label = hktClock(bars[barIndex].time);
      image.text(Math.max(PAD_L, x - Math.floor(textWidth(label, 1) / 2)), height - 17, label, AXIS_TEXT, 1);
    }
  }

  for (let k = 1; k < bands.upper.length; k++) {
    const index0 = offset + 19 + k - 1;
    const index1 = index0 + 1;
    const x0 = toX(index0);
    const x1 = toX(index1);
    for (let x = x0; x <= x1; x++) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      const upper = bands.upper[k - 1].value + (bands.upper[k].value - bands.upper[k - 1].value) * t;
      const lower = bands.lower[k - 1].value + (bands.lower[k].value - bands.lower[k - 1].value) * t;
      image.vline(x, toY(upper), toY(lower), BB_FILL);
    }
    image.line(x0, toY(bands.upper[k - 1].value), x1, toY(bands.upper[k].value), BB_LINE);
    image.line(x0, toY(bands.lower[k - 1].value), x1, toY(bands.lower[k].value), BB_LINE);
  }

  const level = (label: string, price: number | undefined, color: Rgb, dash: [number, number]) => {
    if (!finite(price)) return;
    const y = toY(price);
    if (y < PAD_T || y > priceBottom) return;
    image.hline(PAD_L, plotRight, y, color, dash);
    const tagWidth = textWidth(label, 1) + 8;
    image.fillRect(PAD_L + 5, y - 7, tagWidth, 15, color);
    image.text(PAD_L + 9, y - 3, label, BG, 1);
    axisLabel(y, price, color);
  };

  level('ENTRY', opts.entry, ENTRY, [8, 5]);
  level('SL', opts.stop, DOWN, [4, 5]);
  (opts.targets ?? []).forEach((target, index) => level('TP' + (index + 1), target, TARGET, [3, 6]));

  const candleWidth = Math.max(2, Math.floor(step * 0.62));
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const x = toX(offset + i);
    const color = bar.close >= bar.open ? UP : DOWN;
    image.vline(x, toY(bar.high), toY(bar.low), color);
    const openY = toY(bar.open);
    const closeY = toY(bar.close);
    image.fillRect(x - Math.floor(candleWidth / 2), Math.min(openY, closeY), candleWidth, Math.max(2, Math.abs(closeY - openY)), color);
  }

  const series = (points: Array<{ value: number }>, startIndex: number, color: Rgb) => {
    for (let i = 1; i < points.length; i++) {
      image.line(toX(offset + startIndex + i - 1), toY(points[i - 1].value), toX(offset + startIndex + i), toY(points[i].value), color);
    }
  };
  series(ema20, emaPeriod - 1, EMA20);
  series(ema50, 49, EMA50);

  const lastX = toX(BARS - 1);
  const lastY = toY(last);
  image.hline(PAD_L, plotRight, lastY, last >= bars[0].open ? UP : DOWN, [2, 5]);
  image.circle(lastX, lastY, 6, ACCENT);
  image.circle(lastX, lastY, 3, TEXT);
  axisLabel(lastY, last, TEXT);

  for (const threshold of [30, 50, 70]) {
    const y = toRsiY(threshold);
    image.hline(PAD_L, plotRight, y, threshold === 50 ? GRID : BB_LINE, [4, 5]);
    image.text(plotRight + 10, y - 3, String(threshold), AXIS_TEXT, 1);
  }
  let previousRsi = -1;
  for (let i = 0; i < rsi.length; i++) {
    if (!finite(rsi[i])) continue;
    if (previousRsi >= 0) {
      image.line(toX(offset + previousRsi), toRsiY(rsi[previousRsi]), toX(offset + i), toRsiY(rsi[i]), RSI_LINE);
    }
    previousRsi = i;
  }
  const currentRsi = previousRsi >= 0 ? rsi[previousRsi] : Number.NaN;
  image.text(PAD_L + 8, rsiTop + 7, 'RSI 14' + (finite(currentRsi) ? '  ' + currentRsi.toFixed(1) : ''), RSI_LINE, 1);

  let legendX = PAD_L;
  const legend = (label: string, color: Rgb) => {
    image.hline(legendX, legendX + 18, 113, color);
    image.text(legendX + 24, 109, label, AXIS_TEXT, 1);
    legendX += 24 + textWidth(label, 1) + 22;
  };
  legend('EMA20', EMA20);
  legend('EMA50', EMA50);
  legend('BB20', BB_LINE);
  legend('RSI14', RSI_LINE);

  return encodePng(image.buf, width, height);
}
