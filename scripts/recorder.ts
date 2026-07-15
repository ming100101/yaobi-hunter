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
import fs from 'node:fs';
import path from 'node:path';
import { BN_LIVE, fetchClosedPerpCandles, fetchClosedPerpOhlcv, getBtcRegime, mapPool, runRollingScan, toLite } from '../src/data/binance';
import { fetchLiquidations } from '../src/data/okx';
import { backfillFromRecords } from '../src/data/oiStore';
import { buildLiqRecord, buildScanRecord, buildSweepMeta } from '../src/lib/recording';
import { distTopSignals, interpret, rebuildSignals, spotSignals, squeezeSignals, virginSignals, wbottomSignals } from '../src/lib/interpret';
import { runMicroCycle } from '../src/lib/microScan';
import { appendRecordLine, recordingsDir } from './recordFile';
import { readKvFile, writeKvKey, isKilled } from './kvFile';
import { buildSignalCard, CLASS_REBUILD, CLASS_VIRGIN, notifyClassEdges, notifyFlushBreakouts, sendTelegram, sendTelegramPhoto, sendToast } from './notifyHeadless';
import type { NotifyRich } from './notifyHeadless';
import { renderCandlePng } from './chartPng';
import { mulberry32, makeRandn } from '../src/lib/prng';
import { drivePaper, risingFbEdges, createPaperState } from '../src/lib/paper';
import type { PaperState } from '../src/lib/paper';
import {
  activeEntryWatches,
  applyEntryWatchTransition,
  createEntryWatchCandidate,
  deriveEntryWatchAnchor,
  ENTRY_WATCH_PROMOTED,
  markEntryWatchDelivered,
  markEntryWatchSendFailed,
  markEntryWatchSending,
  observeEntryWatch,
  supersedeEntryWatch,
} from '../src/lib/entryWatch';
import { readEntryWatchState, writeEntryWatchState } from './entryWatchFile';
import type { Candle, Coin, CoinLite, DeliveredPush, EntryWatchCandidate, EntryWatchEvent, EntryWatchState, NotifyCfg } from '../src/types';
import {
  collectDeepReclaimPriceCandidate,
  monitorDeepReclaims,
  processDeepReclaimSweep,
  reconcileAmbiguousDeepReclaimSends,
  type DeepReclaimSweepCandidate,
} from './deepReclaimRuntime';
import { HourlyMarketStore } from './hourlyMarketFile';
import { collectB2ShadowCandidates, collectExistingSignalShadowCandidates, collectSpotShadowCandidates, runStrategyShadowCycle } from './strategyShadowFile';

// Market data comes from Binance (BN_LIVE); OKX remains ONLY for the S4e
// liquidation poll — Binance has no public REST force-order endpoint.
const OKX = 'https://www.okx.com';
const SLOT_MS = 15 * 60 * 1000;
const MICRO_MS = 75_000; // S3 micro-scan cadence between sweeps
const PAPER_DRIVER_TTL = 5 * 60 * 1000;
const once = process.argv.includes('--once');
const testNotify = process.argv.includes('--test-notify');
const recorderLockPath = path.join(path.dirname(recordingsDir()), 'recorder.lock');
let recorderLockFd: number | null = null;

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireRecorderLock(): boolean {
  fs.mkdirSync(path.dirname(recorderLockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      recorderLockFd = fs.openSync(recorderLockPath, 'wx');
      fs.writeFileSync(recorderLockFd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      try {
        const cur = JSON.parse(fs.readFileSync(recorderLockPath, 'utf8'));
        if (processAlive(Number(cur.pid))) {
          console.error(`recorder already running (pid ${cur.pid}) — exiting`);
          return false;
        }
        fs.unlinkSync(recorderLockPath); // stale crash residue
      } catch {
        try { fs.unlinkSync(recorderLockPath); } catch { /* another starter won */ }
      }
    }
  }
  return false;
}

function releaseRecorderLock(): void {
  if (recorderLockFd != null) {
    try { fs.closeSync(recorderLockFd); } catch { /* already closed */ }
    recorderLockFd = null;
  }
  try {
    const cur = JSON.parse(fs.readFileSync(recorderLockPath, 'utf8'));
    if (Number(cur.pid) === process.pid) fs.unlinkSync(recorderLockPath);
  } catch { /* best effort */ }
}

// ⚡ symbols from the previous sweep, so notifications fire on the rising edge
let prevFb = new Set<string>();
// S9: same rising-edge tracking for 增倉突破 (its own set + cooldown key, so the
// two classes never suppress each other)
let prevRb = new Set<string>();
// S13: 處女增倉 rising-edge set (own class, own cooldown key)
let prevVg = new Set<string>();
let entryWatchState: EntryWatchState = readEntryWatchState();
const hourlyMarketStore = new HourlyMarketStore();

// Historical promotion seam. These stay false until scripts/backtest-entry-
// watch.ts passes every pre-registered gate for that class. Runtime plumbing is
// still shipped and tested; a failed/inconclusive study cannot silently turn
// into an actionable Telegram alert.
const ENTRY_WATCH_GATE: Record<'rb' | 'vg', boolean> = ENTRY_WATCH_PROMOTED;
// S4e: last recorded liquidation-event ts per coin, so consecutive sweeps don't
// re-record the same events. Restart fallback = one slot back (no backfilling
// old events — the endpoint's history depth is not something we lean on).
const lastLiqTs = new Map<string, number>();

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

const CLASS_LABEL: Record<'rb' | 'vg', string> = { rb: '📈 增倉突破', vg: '🚀 處女增倉' };
const ENTRY_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];

function appendEntryWatchEvents(events: EntryWatchEvent[]): void {
  for (const event of events) {
    try {
      appendRecordLine(JSON.stringify(event));
    } catch (e) {
      console.error(`  entry-watch audit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function persistEntryWatch(): void {
  writeEntryWatchState(entryWatchState);
}

function armDeliveredEntryWatches(pushes: DeliveredPush[]): void {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  if (cfg.entryWatchEnabled === false) return;
  let changed = false;
  for (const push of pushes) {
    try {
      const candidate = createEntryWatchCandidate(push);
      const change = supersedeEntryWatch(entryWatchState, candidate, push.ts);
      if (!change.events.length) continue;
      entryWatchState = change.state;
      appendEntryWatchEvents(change.events);
      changed = true;
      console.log(
        `  [entry-watch] armed ${candidate.sym} ${candidate.cls} ` +
        `${candidate.bandLow.toPrecision(5)}–${candidate.bandHigh.toPrecision(5)}`,
      );
    } catch (e) {
      console.error(`  entry-watch arm failed ${push.sym}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (changed) persistEntryWatch();
}

function buildEntryReadyCard(c: EntryWatchCandidate): string {
  const waitedMs = Math.max(0, (c.readyAt ?? Date.now()) - c.sourceTs);
  const mins = Math.round(waitedMs / 60_000);
  const waited = mins >= 60 ? `${Math.floor(mins / 60)}小時${mins % 60 ? `${mins % 60}分` : ''}` : `${mins}分`;
  const fromPush = c.readyPx && c.sourcePx > 0 ? ((c.readyPx / c.sourcePx - 1) * 100) : 0;
  return (
    `🟢 <b>入場區到價</b> — <b>${c.sym}</b>/USDT\n` +
    `原推送:${CLASS_LABEL[c.cls as 'rb' | 'vg']} · 價 ${c.sourcePx}\n` +
    `確認價:${c.readyPx} · 結構入場區:${c.bandLow.toPrecision(6)}–${c.bandHigh.toPrecision(6)}\n` +
    `等待:${waited} · 相對推送:${fromPush >= 0 ? '+' : ''}${fromPush.toFixed(2)}%\n` +
    `失效參考:${c.invalidBelow.toPrecision(6)}\n` +
    `到價只代表原先結構價位已到，請重新評估風險，並非買入指令。`
  );
}

function ambiguousSendingEvent(c: EntryWatchCandidate, ts: number): EntryWatchEvent {
  return {
    type: 'entry-watch',
    v: 1,
    id: `${c.id}:delivery-failed:${ts}`,
    watchId: c.id,
    sourceId: c.sourceId,
    event: 'delivery-failed',
    status: 'ready',
    ts,
    sym: c.sym,
    cls: c.cls,
    px: c.readyPx ?? c.lastPx ?? c.support,
    support: c.support,
    atr: c.atr,
    bandLow: c.bandLow,
    bandHigh: c.bandHigh,
    followupEnabled: c.followupEnabled,
    reason: 'recorder restarted during Telegram send; outcome unknown, not resent',
  };
}

// At-most-once restart policy: a persisted `sending` row may already have been
// accepted by Telegram. Remove it from the retry queue and expose the ambiguous
// outcome in Push/History instead of risking a duplicate actionable alert.
function reconcileAmbiguousEntrySends(): void {
  const events: EntryWatchEvent[] = [];
  const active = { ...entryWatchState.active };
  for (const [sym, c] of Object.entries(active)) {
    if (c.status !== 'sending') continue;
    events.push(ambiguousSendingEvent(c, Date.now()));
    delete active[sym];
  }
  if (!events.length) return;
  entryWatchState = { v: 1, updatedAt: Date.now(), active };
  appendEntryWatchEvents(events);
  persistEntryWatch();
}

async function deliverReadyEntryWatches(cfg: Partial<NotifyCfg>): Promise<void> {
  // Absent follows the gate-controlled deployment default. An explicit user
  // off still pauses delivery without rewriting the frozen candidate.
  if (cfg.entryWatchEnabled === false) return;
  for (const c0 of activeEntryWatches(entryWatchState)) {
    if (
      c0.status !== 'ready' ||
      !c0.followupEnabled ||
      (c0.cls !== 'rb' && c0.cls !== 'vg') ||
      !ENTRY_WATCH_GATE[c0.cls] ||
      (c0.nextAttemptAt != null && Date.now() < c0.nextAttemptAt)
    ) continue;
    const sending = markEntryWatchSending(c0, Date.now());
    entryWatchState = applyEntryWatchTransition(entryWatchState, { candidate: sending }, Date.now());
    persistEntryWatch(); // durable `sending` before external side effect

    const out = await sendTelegram(
      cfg.telegramToken,
      cfg.telegramChatId,
      buildEntryReadyCard(sending),
      { replyToMessageId: sending.telegramMessageId },
    );
    if (out.ok) {
      const done = markEntryWatchDelivered(sending, Date.now());
      if (done.event) appendEntryWatchEvents([done.event]);
      entryWatchState = applyEntryWatchTransition(entryWatchState, done, Date.now());
      persistEntryWatch();
      if (cfg.toast !== false) {
        await sendToast(`🟢 入場區到價 — ${sending.sym}/USDT`, '15m回踩企穩 · 請重新評估風險');
      }
      console.log(`  [entry-watch] delivered ${sending.sym}`);
      continue;
    }

    const attempt = Math.max(1, sending.attemptCount);
    const retry = Date.now() + ENTRY_RETRY_MS[Math.min(attempt - 1, ENTRY_RETRY_MS.length - 1)];
    const failed = markEntryWatchSendFailed(sending, Date.now(), retry, out.error);
    if (failed.event) appendEntryWatchEvents([failed.event]);
    if (attempt >= ENTRY_RETRY_MS.length) {
      const active = { ...entryWatchState.active };
      delete active[sending.sym];
      entryWatchState = { v: 1, updatedAt: Date.now(), active };
      console.error(`  [entry-watch] ${sending.sym} TG failed after ${attempt} attempts`);
    } else {
      entryWatchState = applyEntryWatchTransition(entryWatchState, failed, Date.now());
    }
    persistEntryWatch();
  }
}

async function monitorEntryWatches(): Promise<void> {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  const watches = activeEntryWatches(entryWatchState).filter((c) => c.status === 'watching');
  if (watches.length) {
    await mapPool(
      watches,
      4,
      async (snapshot) => {
        try {
          const bars = await fetchClosedPerpCandles(BN_LIVE, snapshot.sym, '15m', 128);
          let current = entryWatchState.active[snapshot.sym];
          if (!current || current.sourceId !== snapshot.sourceId) return;
          for (const bar of bars) {
            const closeTs = bar.time * 1000 + SLOT_MS;
            const transition = observeEntryWatch(current, {
              ts: closeTs,
              high: bar.high,
              low: bar.low,
              close: bar.close,
            });
            current = transition.candidate;
            if (transition.event) appendEntryWatchEvents([transition.event]);
            entryWatchState = applyEntryWatchTransition(entryWatchState, transition, closeTs);
            // Unpromoted/disabled classes still produce a complete audit trail
            // for future gate reviews, but a ready shadow row is terminal and
            // must never enter the Telegram delivery queue.
            if (current.status === 'ready' && !current.followupEnabled) {
              const active = { ...entryWatchState.active };
              if (active[current.sym]?.sourceId === current.sourceId) delete active[current.sym];
              entryWatchState = { v: 1, updatedAt: closeTs, active };
            }
            if (current.status !== 'watching') break;
          }
        } catch (e) {
          // Missing/stale market data keeps the watch alive; never invalidates.
          console.error(`  [entry-watch] ${snapshot.sym} data skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
      120,
    );
    persistEntryWatch();
  }
  await deliverReadyEntryWatches(cfg);
}

async function sweepAndRecord(): Promise<CoinLite[]> {
  const now = Date.now();
  const coins: CoinLite[] = [];
  const deepReclaimCandidates: DeepReclaimSweepCandidate[] = [];
  // Active confirmations are execution-timing work: check them immediately
  // after the native 15m close, before the slower full-market sweep.
  try {
    await monitorDeepReclaims();
  } catch (e) {
    console.error(`  deep-reclaim monitor failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // S2: per-candidate spot cross-source reads, computed from the FULL Coin (with
  // .spotCandles) before toLite strips it — recording-only, gated off the UI.
  const sweepSpot: Record<string, [0 | 1, 0 | 1, 0 | 1]> = {};
  // S6: squeeze flags per coin, sparse (only non-zero) — setup stage is
  // recording-only, so this is its entire evidence stream for E1.
  const sweepSqueeze: Record<string, [0 | 1, 0 | 1]> = {};
  // S9/S10/S11: per-def evidence streams (sparse), E1 revalidation fuel. Only
  // R1 is shipped; the rest record regardless (gate results in the specs).
  const sweepRebuild: Record<string, [0 | 1, 0 | 1, 0 | 1]> = {};
  const sweepTop: Record<string, [0 | 1, 0 | 1, 0 | 1, 0 | 1]> = {};
  const sweepWb: Record<string, [0 | 1, 0 | 1, 0 | 1]> = {};
  const sweepVg: Record<string, [0 | 1, 0 | 1, 0 | 1]> = {};
  // R4: card material for ⚡/增倉突破 coins, grabbed from the full Coin before
  // toLite strips candles/plan. insights = interpret(c), same objects the detail
  // page shows, so the card can never quote different numbers.
  const rich = new Map<string, NotifyRich>();
  await runRollingScan(BN_LIVE, now, [], (batch) => {
    for (const c of batch) {
      // Recorder-owned, completed 1H evidence store. The rolling scan carries
      // enough 5m bars to append newly completed clock hours without another
      // request; sparse/partial hours fail closed inside the store.
      hourlyMarketStore.ingestCoin(c, now);
      const sig = spotSignals(c); // null unless the coin was a spot-fetch candidate
      if (sig) sweepSpot[c.symbol] = sig;
      const sq = squeezeSignals(c);
      if (sq && (sq[0] || sq[1])) sweepSqueeze[c.symbol] = sq;
      const rb = rebuildSignals(c);
      if (rb && (rb[0] || rb[1] || rb[2])) sweepRebuild[c.symbol] = rb;
      const tp = distTopSignals(c);
      if (tp && (tp[0] || tp[1] || tp[2] || tp[3])) sweepTop[c.symbol] = tp;
      const wb = wbottomSignals(c);
      if (wb && (wb[0] || wb[1] || wb[2])) sweepWb[c.symbol] = wb;
      const vg = virginSignals(c);
      if (vg && (vg[0] || vg[1] || vg[2])) sweepVg[c.symbol] = vg;
      const lite = toLite(c);
      const deep = collectDeepReclaimPriceCandidate(c, lite, now);
      if (deep) deepReclaimCandidates.push(deep);
      if (lite.flushBreakout || lite.rebuildBreakout || lite.virginBreakout) {
      const watchCandidate =
        lite.flushBreakout || lite.rebuildBreakout === true || lite.virginBreakout === true;
        rich.set(c.symbol, {
          candles: c.candles,
          plan: c.plan,
          insights: interpret(c),
          entryWatch: watchCandidate ? deriveEntryWatchAnchor(c.candles) ?? undefined : undefined,
        });
      }
      coins.push(lite);
    }
    return true;
  });
  if (!coins.length) throw new Error('no coins assembled');

  // Seed a bounded batch each sweep until every live universe member has the
  // 100+ completed 1H bars required by boarding-b2-v1. This state lives in its
  // own atomic file rather than growing kv.json.
  let seededHourly = 0;
  const seedSymbols = coins.filter((c) => hourlyMarketStore.needsSeed(c.symbol)).slice(0, 40);
  await mapPool(
    seedSymbols,
    4,
    async (coin) => {
      try {
        hourlyMarketStore.seed(coin.symbol, await fetchClosedPerpOhlcv(BN_LIVE, coin.symbol, '1h', 120));
        seededHourly++;
      } catch (e) {
        console.error(`  [market-1h] ${coin.symbol} seed skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    120,
  );
  hourlyMarketStore.flush(now, seededHourly > 0);

  // Forward-only shadow collection. B2, ordinary EMA20 reclaim control and the
  // quantity-OI challenger share the same frozen decision bar and evaluator.
  // No branch below is connected to Telegram or the legacy paper engine.
  try {
    const shadow = [
      ...collectB2ShadowCandidates(hourlyMarketStore, coins, Date.now()),
      ...collectSpotShadowCandidates(coins, now),
      ...collectExistingSignalShadowCandidates(coins, now),
    ];
    const result = await runStrategyShadowCycle(shadow, Date.now());
    if (result.armed || result.outcomes) {
      console.log(`  [strategy-shadow] +${result.armed} candidates, +${result.outcomes} outcomes, ${result.active} active`);
    }
  } catch (e) {
    console.error(`  strategy-shadow failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const file = appendRecordLine(JSON.stringify(buildScanRecord(coins, now, 'binance')));
  const regime = await getBtcRegime(BN_LIVE).catch(() => null); // E3: BTC regime tag (cached 15min)
  appendRecordLine(
    JSON.stringify(
      buildSweepMeta(coins.length, now, Date.now() - now, sweepSpot, sweepSqueeze, {
        rebuild: sweepRebuild,
        top: sweepTop,
        wbottom: sweepWb,
        virgin: sweepVg,
        regime,
      }),
    ),
  );
  const warm = coins.filter((c) => c.oiUsd != null).length;
  console.log(`${new Date(now).toISOString()}  recorded ${coins.length} coins (${warm} with OI) -> ${file}`);
  // S4e phase 1: poll real liquidation events for this sweep's candidates
  // (strength top-25 ∪ ⚡ coins — endpoint requires per-coin uly, so candidate-
  // tier like S2). Collection only; best-effort, never breaks the sweep.
  try {
    const t1 = Date.now();
    const cands = [...coins]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 25)
      .map((c) => c.symbol);
    for (const c of coins) if (c.flushBreakout && !cands.includes(c.symbol)) cands.push(c.symbol);
    const ev: Record<string, Array<[number, number, number, 0 | 1]>> = {};
    await mapPool(
      cands,
      4,
      async (sym) => {
        try {
          const evs = await fetchLiquidations(OKX, sym, lastLiqTs.get(sym) ?? now - SLOT_MS);
          if (evs.length) {
            ev[sym] = evs.map((e) => [e.ts, e.px, e.usd, e.dir]);
            lastLiqTs.set(sym, evs[evs.length - 1].ts); // evs sorted ascending
          }
        } catch {
          // per-coin best effort — a missing coin this sweep is just a gap
        }
      },
      150,
    );
    appendRecordLine(JSON.stringify(buildLiqRecord(now, cands, ev)));
    const nEv = Object.values(ev).reduce((a, b) => a + b.length, 0);
    console.log(`  [liq] ${cands.length} cands, ${Object.keys(ev).length} coins with ${nEv} events (${Date.now() - t1}ms)`);
  } catch (e) {
    console.error(`  liq record failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // paper trading (best-effort — never let it break the loop). Compute the rising
  // ⚡ edge against the PREVIOUS sweep's set before notify reassigns prevFb below.
  try {
    drivePaperFromSweep(coins, now, risingFbEdges(coins, prevFb));
  } catch (e) {
    console.error(`  paper drive failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // notify on newly-fired ⚡ (best-effort — never let it break the loop)
  try {
    const result = await notifyFlushBreakouts(coins, prevFb, rich);
    prevFb = result.current;
    armDeliveredEntryWatches(result.watchable);
  } catch (e) {
    console.error(`  notify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // S9: 增倉突破 rising edges — own class, own cooldown key (sweep-tier only;
  // the 75s micro-scan stays ⚡-exclusive, declared in the S9 spec)
  try {
    const result = await notifyClassEdges(coins, prevRb, rich, CLASS_REBUILD);
    prevRb = result.current;
    armDeliveredEntryWatches(result.watchable);
  } catch (e) {
    console.error(`  rebuild notify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // S13: 處女增倉 rising edges — same tier and caveats as 增
  try {
    const result = await notifyClassEdges(coins, prevVg, rich, CLASS_VIRGIN);
    prevVg = result.current;
    armDeliveredEntryWatches(result.watchable);
  } catch (e) {
    console.error(`  virgin notify failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await processDeepReclaimSweep(deepReclaimCandidates);
  } catch (e) {
    console.error(`  deep-reclaim sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await monitorEntryWatches();
  } catch (e) {
    console.error(`  entry-watch monitor failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return coins;
}

// S3 headless micro-scan: between sweeps, warm-only re-check the sweep's strength
// top-25 every ~75s until 60s before the next slot; rising-edge ⚡ → Telegram/toast
// via R2's notifyFlushBreakouts. Warm-only ⇒ zero rubik added. Pauses on the kill
// switch and never overruns the next sweep; then sleeps out the rest of the slot.
async function microScanUntilNextSlot(sweepCoins: CoinLite[]): Promise<void> {
  const stopAt = Math.ceil((Date.now() + 1) / SLOT_MS) * SLOT_MS - 60_000; // 60s before next slot
  const cands = [...sweepCoins]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 25)
    .map((c) => c.symbol);
  let curFb = new Set(sweepCoins.filter((c) => c.flushBreakout).map((c) => c.symbol));
  while (cands.length && Date.now() < stopAt) {
    await new Promise((r) => setTimeout(r, Math.min(MICRO_MS, stopAt - Date.now())));
    if (isKilled() || Date.now() >= stopAt) break;
    try {
      const fired: Coin[] = [];
      const res = await runMicroCycle(BN_LIVE, cands, curFb, (c) => fired.push(c), Date.now());
      curFb = res.nextFb;
      if (res.checked) console.log(`  [micro] checked ${res.checked} cold ${res.skippedCold} fired ${res.fired}`);
      if (fired.length) {
        const rich = new Map<string, NotifyRich>(
          fired.map((c) => [
            c.symbol,
            {
              candles: c.candles,
              plan: c.plan,
              insights: interpret(c),
              entryWatch: deriveEntryWatchAnchor(c.candles) ?? undefined,
            },
          ] as [string, NotifyRich]),
        );
        const returned = await notifyFlushBreakouts(fired.map(toLite), prevFb, rich);
        returned.current.forEach((s) => prevFb.add(s)); // merge, don't shrink prevFb to the fired subset
        armDeliveredEntryWatches(returned.watchable);
      }
    } catch (e) {
      console.error(`  micro failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // sleep the remaining time to the next slot + 5s (matches the pre-S3 cadence)
  const nowMs = Date.now();
  const next = Math.ceil((nowMs + 1) / SLOT_MS) * SLOT_MS + 5000;
  if (next > nowMs) await new Promise((r) => setTimeout(r, next - nowMs));
}

// --test-notify: fire one fake notification through both channels and exit, so
// setup can be verified without waiting for a real (rare) ⚡. R4: goes through
// the REAL photo path — synthetic 48h candles rendered to PNG + card caption
// via multipart sendPhoto, text fallback if the photo leg fails. The PNG is
// also written next to the bundle for local eyeballing.
function synthCandles(): Candle[] {
  // 576 5m bars ≈ 48h: quiet drift, then a breakout over the last 8h so the
  // chart shows candles both sides of the entry line. Deterministic seed.
  const rand = mulberry32(20260706);
  const randn = makeRandn(rand);
  const t0 = Math.floor(Date.now() / 300_000) * 300 - 576 * 300;
  const out: Candle[] = [];
  let px = 0.2;
  for (let i = 0; i < 576; i++) {
    const open = px;
    px = px * (1 + (i > 480 ? 0.0015 : 0.0001) + randn() * 0.003);
    const close = px;
    out.push({
      time: t0 + i * 300,
      open,
      high: Math.max(open, close) * (1 + rand() * 0.002),
      low: Math.min(open, close) * (1 - rand() * 0.002),
      close,
    });
  }
  return out;
}

async function testNotifyAndExit(): Promise<void> {
  const cfg = (readKvFile()['notify'] ?? {}) as Partial<NotifyCfg>;
  const candles = synthCandles();
  const last = candles[candles.length - 1].close;
  const entry = last * 0.985;
  // ladder proportions mirror analyze()'s A plan (+4/+8/+15, SL −3, runner 20%)
  const plan = {
    entry,
    kind: 'breakout' as const,
    tp1: entry * 1.04,
    tp2: entry * 1.08,
    tp3: entry * 1.15,
    sl: entry * 0.97,
    runnerPct: 20,
  };
  const lite: CoinLite = {
    symbol: 'TEST',
    regime: 'pump',
    strength: 78,
    change1h: 2.4,
    change24h: 9.8,
    oi4h: 2.1,
    oiTrusted: true,
    funding: 0.012,
    volZ: 3.2,
    vol24h: 12_345_678,
    lastPrice: last,
    oiUsd: null,
    flushBreakout: true,
    earlyAccum: false,
    riskFlags: ['測試風險 flag'],
    signals: { fundsFirst: true, mildRise: true, oiHealthy: true, buyHealthy: true },
  };
  const caption = buildSignalCard(lite, { candles, plan, insights: [] }) + '\n(測試通知,設定成功)';
  const png = renderCandlePng(candles, { entry: plan.entry });
  const pngPath = path.join('scripts', '.build', 'test-chart.png');
  try {
    fs.writeFileSync(pngPath, png);
    console.log(`chart png: ${(png.length / 1024).toFixed(1)}KB -> ${pngPath}`);
  } catch {
    /* eyeball copy is best-effort */
  }
  let tg = await sendTelegramPhoto(cfg.telegramToken, cfg.telegramChatId, png, caption);
  if (!tg.ok) {
    console.log(`photo failed (${tg.error}) — falling back to text`);
    tg = await sendTelegram(cfg.telegramToken, cfg.telegramChatId, caption);
  }
  const toast = cfg.toast !== false ? await sendToast('⚡ 縮倉突破 — 測試', '測試通知,設定成功。') : { ok: true };
  console.log('telegram:', tg, '| toast:', toast);
  process.exit(tg.ok || toast.ok ? 0 : 1);
}

// P1: warm the in-memory OI store from the recordings this process (and the
// browser writer) already persisted, so oi4h is trustworthy from the FIRST
// sweep after a restart instead of re-warming ~48h. The browser does the same
// via GET /recordings; here we read the daily files directly.
function backfillOiFromDisk(): void {
  try {
    const dir = recordingsDir();
    const days = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .slice(-3);
    if (!days.length) return;
    const jsonl = days.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const n = backfillFromRecords(jsonl);
    console.log(`[oi] backfilled ${n} recorded sweeps from ${days.join(', ')}`);
  } catch (e) {
    console.error(`[oi] backfill skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  if (!acquireRecorderLock()) return;
  process.once('exit', releaseRecorderLock);
  process.once('SIGINT', () => { releaseRecorderLock(); process.exit(130); });
  process.once('SIGTERM', () => { releaseRecorderLock(); process.exit(143); });
  console.log(`recorder -> ${recordingsDir()}`);
  console.log(once ? 'single sweep (--once)' : 'looping every 15-min slot (Ctrl-C to stop; warms up over ~48h)');
  backfillOiFromDisk();
  reconcileAmbiguousEntrySends();
  reconcileAmbiguousDeepReclaimSends();
  for (;;) {
    // master off-switch: stop cleanly if the kill switch has been thrown
    if (isKilled()) {
      console.log('KILL file present — recorder stopping');
      return;
    }
    const t0 = Date.now();
    let sweepCoins: CoinLite[] = [];
    try {
      sweepCoins = await sweepAndRecord();
      console.log(`  sweep took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.error(`  sweep failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (once) return;
    // S3: fast ⚡ re-check between sweeps, then sleep out the rest of the slot
    await microScanUntilNextSlot(sweepCoins);
  }
}

if (testNotify) void testNotifyAndExit();
else void main();
