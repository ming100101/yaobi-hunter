import { deflateSync } from 'node:zlib';
import { aggregateCandles } from '../src/lib/aggregate';
import { ema } from '../src/lib/indicators';
import { fmtPrice } from '../src/lib/format';
import type { Candle } from '../src/types';

// R4: pure-JS candle-chart PNG for the Telegram signal card. Zero external
// dependencies by design — native image libs (canvas/sharp) break the Windows
// exe packaging, and third-party chart services would put signal data on the
// wire and add an uptime dependency to the notify chain. Node's zlib does the
// deflate; the PNG chunks (IHDR/IDAT/IEND + CRC32) are assembled by hand.
//
// Input is the coin's 5m base series; rendered at 15m (aggregateCandles ×3,
// last 192 bars = 48h) so the picture matches what interpret() analyzes.

// theme.css palette so the card matches the app
const BG: Rgb = [0x0b, 0x07, 0x16];
const GRID: Rgb = [0x24, 0x1b, 0x3a];
const AXIS_TEXT: Rgb = [0x9a, 0x8f, 0xc0];
const UP: Rgb = [0x2b, 0xd9, 0xa0];
const DOWN: Rgb = [0xff, 0x5f, 0x87];
const EMA_LINE: Rgb = [0xa7, 0x8b, 0xfa];
const ENTRY_LINE: Rgb = [0xff, 0xc8, 0x57];

type Rgb = [number, number, number];

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
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

// 8-bit RGB (color type 2), filter 0 on every scanline — the flat dark chart
// deflates far below the 100KB budget without smarter filters.
function encodePng(rgb: Buffer, w: number, h: number): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// raster drawing
// ---------------------------------------------------------------------------

class Raster {
  buf: Buffer;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.buf = Buffer.alloc(w * h * 3);
  }

  px(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.buf[o] = c[0];
    this.buf[o + 1] = c[1];
    this.buf[o + 2] = c[2];
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = Math.max(0, y); yy < y1; yy++)
      for (let xx = Math.max(0, x); xx < x1; xx++) this.px(xx, yy, c);
  }

  hline(x0: number, x1: number, y: number, c: Rgb, dash?: [number, number]): void {
    for (let x = x0; x <= x1; x++) {
      if (dash && (x - x0) % (dash[0] + dash[1]) >= dash[0]) continue;
      this.px(x, y, c);
    }
  }

  vline(x: number, y0: number, y1: number, c: Rgb): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.px(x, y, c);
  }

  // Bresenham, drawn 2px thick so the EMA reads at phone size
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      this.px(x0, y0 + 1, c);
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

  text(x: number, y: number, s: string, c: Rgb, scale = 2): void {
    let cx = x;
    for (const ch of s) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let row = 0; row < 7; row++)
          for (let col = 0; col < 5; col++)
            if (glyph[row] & (1 << (4 - col)))
              this.fillRect(cx + col * scale, y + row * scale, scale, scale, c);
      }
      cx += 6 * scale; // 5px glyph + 1px gap
    }
  }
}

// 5×7 bitmap digits — enough for fmtPrice output; no font library (native deps
// are a Windows-exe landmine, see the R4 spec's Do-NOT list).
const FONT: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
};

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------

export interface ChartOpts {
  entry?: number; // dashed horizontal line + amber axis label
  emaPeriod?: number; // default 20
  width?: number;
  height?: number;
}

const PAD_L = 10;
const PAD_R = 96; // room for a 7-char price label at scale 2
const PAD_T = 10;
const PAD_B = 10;
const BARS = 192; // 48h of 15m

export function renderCandlePng(candles5m: Candle[], opts: ChartOpts = {}): Buffer {
  const W = opts.width ?? 800;
  const H = opts.height ?? 400;
  const emaPeriod = opts.emaPeriod ?? 20;
  const bars = aggregateCandles(candles5m, 3).slice(-BARS);
  if (!bars.length) throw new Error('renderCandlePng: no candles');
  const emaPts = ema(bars, emaPeriod); // starts at bar index emaPeriod-1

  // y-range spans candles, EMA and the entry line so everything stays visible
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  for (const p of emaPts) {
    if (p.value < lo) lo = p.value;
    if (p.value > hi) hi = p.value;
  }
  if (opts.entry != null && Number.isFinite(opts.entry)) {
    lo = Math.min(lo, opts.entry);
    hi = Math.max(hi, opts.entry);
  }
  const pad = hi > lo ? (hi - lo) * 0.05 : Math.abs(hi) * 0.01 || 1e-9;
  lo -= pad;
  hi += pad;

  const img = new Raster(W, H);
  img.fillRect(0, 0, W, H, BG);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const toY = (p: number) => PAD_T + Math.round(((hi - p) / (hi - lo)) * plotH);

  // 5 horizontal gridlines with right-axis price labels (fmtPrice = same
  // formatting the app uses everywhere). Long sub-0.001 prices drop to scale 1
  // so they fit the 96px gutter instead of clipping at the image edge.
  const axisLabel = (y: number, p: number, c: Rgb) => {
    const s = fmtPrice(p);
    const scale = s.length > 7 ? 1 : 2;
    img.text(PAD_L + plotW + 8, y - Math.floor((7 * scale) / 2), s, c, scale);
  };
  for (let k = 0; k <= 4; k++) {
    const p = hi - ((hi - lo) * k) / 4;
    const y = toY(p);
    img.hline(PAD_L, PAD_L + plotW, y, GRID);
    axisLabel(y, p, AXIS_TEXT);
  }

  // candles — x slots sized off BARS (not bars.length) so a short series still
  // renders at 48h scale, right-aligned like a live chart
  const step = plotW / BARS;
  const bodyW = Math.max(1, Math.floor(step * 0.6));
  const offset = BARS - bars.length;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const cx = PAD_L + Math.round((offset + i) * step + step / 2);
    const col = b.close >= b.open ? UP : DOWN;
    img.vline(cx, toY(b.high), toY(b.low), col);
    const yO = toY(b.open);
    const yC = toY(b.close);
    img.fillRect(cx - Math.floor(bodyW / 2), Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)), col);
  }

  // EMA polyline over the candles
  for (let k = 1; k < emaPts.length; k++) {
    const i0 = offset + emaPeriod - 1 + (k - 1);
    const i1 = i0 + 1;
    img.line(
      PAD_L + Math.round(i0 * step + step / 2),
      toY(emaPts[k - 1].value),
      PAD_L + Math.round(i1 * step + step / 2),
      toY(emaPts[k].value),
      EMA_LINE,
    );
  }

  // entry: dashed line + amber label on the axis (drawn last, over gridlines)
  if (opts.entry != null && Number.isFinite(opts.entry)) {
    const y = toY(opts.entry);
    img.hline(PAD_L, PAD_L + plotW, y, ENTRY_LINE, [6, 4]);
    axisLabel(y, opts.entry, ENTRY_LINE);
  }

  return encodePng(img.buf, W, H);
}
