// Headless check of the Binance-universe rolling scan: list the universe,
// then run through ALL batches (or a --max cap) timing progress + 429 count,
// so throttle-tuning claims are backed by a real end-to-end run, not just an
// isolated burst probe. Bundle with esbuild.
import { getBinancePerpBases } from '../src/data/binanceUniverse';
import { runRollingScan, toLite } from '../src/data/okx';

const BNV = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const OKX = 'https://www.okx.com';
const MAX_BATCHES = Number(process.argv[2] ?? Infinity);

let warn429 = 0;
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('429')) warn429++;
  origWarn(...args);
};

const bases = await getBinancePerpBases(BNV);
console.log(`binance UM perp bases: ${bases.size}`);

const t0 = Date.now();
let batches = 0;
let lastProgress = { done: 0, total: 0 };
await runRollingScan(OKX, Date.now(), bases, [], (batch, progress) => {
  batches += 1;
  lastProgress = progress;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const rate = (progress.done / ((Date.now() - t0) / 1000)).toFixed(2);
  console.log(
    `t=${elapsed}s batch ${batches}: +${batch.length} (${progress.done}/${progress.total}) ` +
      `avgRate=${rate} coins/s 429s-so-far=${warn429}`,
  );
  return batches < MAX_BATCHES;
});
const totalSec = (Date.now() - t0) / 1000;
console.log('');
console.log(
  `DONE: ${lastProgress.done}/${lastProgress.total} coins in ${totalSec.toFixed(1)}s ` +
    `(${(lastProgress.done / totalSec).toFixed(2)} coins/s) — total 429s hit: ${warn429}`,
);
