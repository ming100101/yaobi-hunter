// Headless check of the Binance rolling scan: run through ALL batches (or a
// --max cap) timing progress + 429 count, so throttle-tuning claims are backed
// by a real end-to-end run, not just an isolated burst probe. Bundle with esbuild.
import { BN_LIVE, runRollingScan, toLite } from '../src/data/binance';

const MAX_BATCHES = Number(process.argv[2] ?? Infinity);

let warn429 = 0;
const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('429')) warn429++;
  origWarn(...args);
};

const t0 = Date.now();
let batches = 0;
let lastProgress = { done: 0, total: 0 };
await runRollingScan(BN_LIVE, Date.now(), [], (batch, progress) => {
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
