// Headless long-runner: one full sweep per 15-min slot, appending a compact
// JSONL snapshot each time. This is how you accumulate the months of data the
// event-library lift analysis needs, without keeping the UI open.
//
//   npm run recorder          # loop forever, one sweep per 15-min slot
//   npm run recorder -- --once # single sweep then exit (for testing)
//
// The in-memory OI store warms over the first ~48h of continuous running, after
// which each sweep drops from ~4.5min to ~1.5min. A restart loses that warmup
// (Node has no IndexedDB) and re-warms — acceptable for a background collector.
import { runRollingScan, toLite } from '../src/data/okx';
import { getBinancePerpBases } from '../src/data/binanceUniverse';
import { buildScanRecord, buildSweepMeta } from '../src/lib/recording';
import { spotSignals } from '../src/lib/interpret';
import { appendRecordLine, recordingsDir } from './recordFile';
import { readKvFile, writeKvKey, isKilled } from './kvFile';
import { notifyFlushBreakouts, sendTelegram, sendToast } from './notifyHeadless';
import { drivePaper, risingFbEdges, createPaperState } from '../src/lib/paper';
import type { PaperState } from '../src/lib/paper';
import type { CoinLite, NotifyCfg } from '../src/types';

const OKX = 'https://www.okx.com';
const BNV = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const SLOT_MS = 15 * 60 * 1000;
const PAPER_DRIVER_TTL = 5 * 60 * 1000;
const once = process.argv.includes('--once');
const testNotify = process.argv.includes('--test-notify');

// universe changes rarely — fetch once at startup, a restart refreshes it
let bnBases: Set<string> | null = null;
// ⚡ symbols from the previous sweep, so notifications fire on the rising edge
let prevFb = new Set<string>();

// Advance the shared paper book by this sweep. Best-effort and self-contained:
// reads the current state from kv.json (fresh every call), honours the M1
// single-driver rule (defer to the app if it drove within the TTL), and writes
// back. fbEdges = rising ⚡ edge vs the previous sweep, computed by the caller
// before prevFb is reassigned.
function drivePaperFromSweep(coins: CoinLite[], nowMs: number, fbEdges: Set<string>): void {
  const state = (readKvFile()['paper-state'] as PaperState | undefined) ?? createPaperState();
  const wall = Date.now();
  if (wall - state.lastDriverTs < PAPER_DRIVER_TTL && state.driver === 'app') return; // app alive
  const marks = new Map(coins.map((c) => [c.symbol, c.lastPrice] as [string, number]));
  const next = drivePaper(state, marks, fbEdges, nowMs);
  next.lastDriverTs = wall;
  next.driver = 'recorder';
  writeKvKey('paper-state', next);
}

async function sweepAndRecord(): Promise<void> {
  const now = Date.now();
  if (!bnBases) bnBases = await getBinancePerpBases(BNV);
  const coins: CoinLite[] = [];
  // S2: per-candidate spot cross-source reads, computed from the FULL Coin (with
  // .spotCandles) before toLite strips it — recording-only, gated off the UI.
  const sweepSpot: Record<string, [0 | 1, 0 | 1, 0 | 1]> = {};
  await runRollingScan(OKX, now, bnBases, [], (batch) => {
    for (const c of batch) {
      const sig = spotSignals(c); // null unless the coin was a spot-fetch candidate
      if (sig) sweepSpot[c.symbol] = sig;
      coins.push(toLite(c));
    }
    return true;
  });
  if (!coins.length) throw new Error('no coins assembled');
  const file = appendRecordLine(JSON.stringify(buildScanRecord(coins, now, 'okx')));
  appendRecordLine(JSON.stringify(buildSweepMeta(coins.length, now, Date.now() - now, sweepSpot)));
  const warm = coins.filter((c) => c.oiUsd != null).length;
  console.log(`${new Date(now).toISOString()}  recorded ${coins.length} coins (${warm} with OI) -> ${file}`);
  // paper trading (best-effort — never let it break the loop). Compute the rising
  // ⚡ edge against the PREVIOUS sweep's set before notify reassigns prevFb below.
  try {
    drivePaperFromSweep(coins, now, risingFbEdges(coins, prevFb));
  } catch (e) {
    console.error(`  paper drive failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // notify on newly-fired ⚡ (best-effort — never let it break the loop)
  try {
    prevFb = await notifyFlushBreakouts(coins, prevFb);
  } catch (e) {
    console.error(`  notify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// --test-notify: fire one fake notification through both channels and exit, so
// setup can be verified without waiting for a real (rare) ⚡.
async function testNotifyAndExit(): Promise<void> {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  const tg = await sendTelegram(
    cfg.telegramToken,
    cfg.telegramChatId,
    '⚡ 縮倉突破 — <b>TEST</b>/USDT\n測試通知,設定成功。',
  );
  const toast = cfg.toast !== false ? await sendToast('⚡ 縮倉突破 — 測試', '測試通知,設定成功。') : { ok: true };
  console.log('telegram:', tg, '| toast:', toast);
  process.exit(tg.ok || toast.ok ? 0 : 1);
}

async function main(): Promise<void> {
  console.log(`recorder -> ${recordingsDir()}`);
  console.log(once ? 'single sweep (--once)' : 'looping every 15-min slot (Ctrl-C to stop; warms up over ~48h)');
  for (;;) {
    // master off-switch: stop cleanly if the kill switch has been thrown
    if (isKilled()) {
      console.log('KILL file present — recorder stopping');
      return;
    }
    const t0 = Date.now();
    try {
      await sweepAndRecord();
      console.log(`  sweep took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.error(`  sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (once) return;
    const nowMs = Date.now();
    const next = Math.ceil((nowMs + 1) / SLOT_MS) * SLOT_MS + 5000; // next slot + 5s
    await new Promise((r) => setTimeout(r, next - nowMs));
  }
}

if (testNotify) void testNotifyAndExit();
else void main();
