import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const futuresDir = path.join(root, 'scripts', 'backtest-data', '5m');
const spotDir = path.join(root, 'scripts', 'backtest-data', 'spot5m');
const months = (process.argv.find((x) => x.startsWith('--months='))?.split('=')[1] ?? '2026-04,2026-05,2026-06').split(',');
const maxCoins = Number(process.argv.find((x) => x.startsWith('--max-coins='))?.split('=')[1] ?? 150);
const mapFile = path.join(spotDir, 'symbol-map.json');

interface SpotMapRow { symbol: string; mult: number }

function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
  throw new Error(`unsupported zip method ${method}`);
}

function candidates(futuresBase: string): SpotMapRow[] {
  const out: SpotMapRow[] = [{ symbol: `${futuresBase}USDT`, mult: 1 }];
  for (const mult of [1_000_000, 10_000, 1_000]) {
    const prefix = String(mult);
    if (futuresBase.startsWith(prefix) && futuresBase.length > prefix.length) {
      out.push({ symbol: `${futuresBase.slice(prefix.length)}USDT`, mult });
    }
  }
  return out;
}

async function fetchMonth(symbol: string, month: string): Promise<string | null> {
  const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/5m/${symbol}-5m-${month}.zip`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${symbol} ${month}: HTTP ${res.status}`);
  return unzipSingle(Buffer.from(await res.arrayBuffer()));
}

async function main(): Promise<void> {
  fs.mkdirSync(spotDir, { recursive: true });
  let map: Record<string, SpotMapRow> = {};
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { /* first run */ }
  const counts = new Map<string, number>();
  for (const file of fs.readdirSync(futuresDir)) {
    const m = file.match(/^(.+)-(\d{4}-\d{2})\.csv$/);
    if (!m || m[1].endsWith('-metrics') || !months.includes(m[2])) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const symbols = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxCoins).map((x) => x[0]);
  let next = 0;
  let saved = 0;
  let unavailable = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= symbols.length) return;
      const base = symbols[i];
      let resolved = map[base];
      let foundAny = false;
      for (const month of months) {
        const dest = path.join(spotDir, `${base}-${month}.csv`);
        if (fs.existsSync(dest)) { foundAny = true; continue; }
        const options = resolved ? [resolved] : candidates(base);
        for (const option of options) {
          const csv = await fetchMonth(option.symbol, month);
          if (csv == null) continue;
          resolved = option;
          map[base] = option;
          fs.writeFileSync(dest, csv);
          saved++;
          foundAny = true;
          break;
        }
      }
      if (!foundAny) unavailable++;
      if ((i + 1) % 10 === 0) console.log(`spot cache ${i + 1}/${symbols.length}, files +${saved}, unavailable ${unavailable}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  console.log(`spot cache complete: ${Object.keys(map).length}/${symbols.length} symbols, ${saved} new files, ${unavailable} unavailable`);
}

void main();
