import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEEP_RECLAIM_RULESET_ID,
  DEEP_RECLAIM_SELECTION_POLICY_ID,
  type DeepReclaimPriceCandidate,
} from '../src/lib/deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from '../src/lib/researchGate';
import { H1_EVIDENCE_DECISION } from '../src/lib/evidenceDecision';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaobi-deep-runtime-'));
process.env.LOCALAPPDATA = dir;
const appDir = path.join(dir, 'YaobiHunter');
fs.mkdirSync(appDir, { recursive: true });
// Prove a stale saved opt-in cannot override the central H1 decision.
fs.writeFileSync(
  path.join(appDir, 'kv.json'),
  JSON.stringify({ notify: { telegramToken: 'token', telegramChatId: 'chat', toast: false, deepReclaimTestEnabled: true } }),
);

const realNow = Date.now;
const slot = 15 * 60_000;
let fakeNow = Math.floor(realNow() / slot) * slot + 5_000;
Date.now = () => fakeNow;
const setupTs = Math.floor(fakeNow / slot) * slot;
const telegramPayloads: unknown[] = [];

function oiRows(asOf: number): any[] {
  const start = asOf - 42 * 3600_000;
  const out: any[] = [];
  for (let t = start; t <= asOf; t += 5 * 60_000) {
    const hours = (t - start) / 3600_000;
    out.push({ timestamp: t, sumOpenInterest: 1000 * Math.pow(1.01, hours), sumOpenInterestValue: 1000 });
  }
  return out;
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/fapi/v1/exchangeInfo')) {
    const symbols = Array.from({ length: 50 }, (_, i) => ({
      symbol: `X${i}USDT`, contractType: 'PERPETUAL', status: 'TRADING', quoteAsset: 'USDT', underlyingType: 'COIN',
    }));
    for (const symbol of ['TESTUSDT', 'TEST2USDT']) {
      symbols.push({ symbol, contractType: 'PERPETUAL', status: 'TRADING', quoteAsset: 'USDT', underlyingType: 'COIN' });
    }
    return new Response(JSON.stringify({ symbols }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/futures/data/openInterestHist')) {
    return new Response(JSON.stringify(oiRows(fakeNow)), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/fapi/v1/klines')) {
    const confirmClose = Math.floor(fakeNow / slot) * slot;
    const openTime = confirmClose - slot;
    const row = [openTime, '1.020', '1.040', '1.015', '1.032', '100', confirmClose - 1, '100', 1, '50', '50', '0'];
    return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('api.telegram.org')) {
    telegramPayloads.push(init?.body);
    throw new Error('H1-retired deep-reclaim feed must never call Telegram');
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

const peakHigh = 1.1;
const troughLow = 0.99;
const setupClose = 1.02;
const ema20 = 1.01;
const ema20Prev = 1.009;
const ema50 = 1.03;
const atr14 = 0.01;
const l0 = 1.03;
const troughAgeBars = 8;
const base: DeepReclaimPriceCandidate = {
  strategy: 'deep-reclaim-v0', rulesetId: DEEP_RECLAIM_RULESET_ID, sym: 'TEST', setupTs, setupClose, barCount: 100,
  peakTs: setupTs - 20 * slot, peakHigh, troughTs: setupTs - troughAgeBars * slot, troughLow, troughAgeBars,
  ddPct: 10, high24: peakHigh, low24: troughLow, pos24: (setupClose - troughLow) / (peakHigh - troughLow),
  ret4hPct: 2, ema20, ema20Prev, ema50, emaSlopePct: (ema20 / ema20Prev - 1) * 100, atr14, l0,
  bandLow: l0, bandHigh: l0 + 0.5 * atr14, invalidBelow: troughLow, missedAbove: l0 + 2 * atr14,
  setupDistanceToL0Pct: (setupClose / l0 - 1) * 100, setupDistanceToL0Atr: (setupClose - l0) / atr14,
  expiresAt: setupTs + 24 * 3600_000, rankVersion: 1, rankScore: 70,
};
const at = (sym: string): DeepReclaimPriceCandidate => ({ ...base, sym });

const runtime = await import('./deepReclaimRuntime');
assert.equal(H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed, false);
await runtime.processDeepReclaimSweep([
  { price: at('TEST'), buyShare4h: 0.7, candles: [] },
  { price: at('TEST2'), buyShare4h: 0.56, candles: [] },
]);

let current = runtime.getDeepReclaimRuntimeState();
assert.equal(Object.keys(current.active).length, 2, 'all qualified setups remain armed for shadow evidence');
assert.equal(current.active.TEST.delivery, 'shadow');
assert.equal(current.active.TEST2.delivery, 'shadow');
assert.equal(current.active.TEST.telegramMessageId, undefined);
assert.equal(current.active.TEST.rankScore, 70, 'detector score remains frozen');
assert.notEqual(current.active.TEST.operationalScore, current.active.TEST.rankScore, 'operational score is still recorded');
assert.equal(current.active.TEST.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID);
assert.equal(telegramPayloads.length, 0, 'stale saved opt-in cannot send an early Telegram');

const diskState = (await import('./deepReclaimFile')).readDeepReclaimState();
assert.equal(Object.keys(diskState.active).length, 2, 'shadow state remains durable');

const recordings = path.join(appDir, 'recordings');
let audit = fs.readdirSync(recordings).map((f) => fs.readFileSync(path.join(recordings, f), 'utf8')).join('\n');
let auditRows = audit.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const selectionRound = auditRows.find((event) => event.event === 'selection-round');
assert.ok(selectionRound, 'candidate-bearing sweep still records the exact selection round');
assert.equal(selectionRound.selectedWatchId, null, 'retired feed selects no delivery');
assert.ok(selectionRound.candidates.every((candidate: any) => candidate.eligible === false));
assert.ok(selectionRound.candidates.every((candidate: any) => candidate.reason === 'notifications-disabled'));
assert.equal(selectionRound.evidenceRole, 'operational');
assert.equal(selectionRound.evidenceEligible, false);
assert.ok(auditRows.some((event) => event.evidenceRole === 'source' && event.evidenceEligible === true));
assert.ok(auditRows.some((event) => event.evidenceRole === 'lifecycle' && event.evidenceEligible === true));
assert.ok(!audit.includes('early-delivered'));

fakeNow = setupTs + slot + 5_000;
await runtime.monitorDeepReclaims();
current = runtime.getDeepReclaimRuntimeState();
assert.equal(Object.keys(current.active).length, 0, 'shadow watches still complete their causal lifecycle');
assert.equal(Object.keys(current.deliveries).length, 0, 'terminal shadow delivery rows are cleared');
assert.equal(telegramPayloads.length, 0, 'confirmation Telegram is also fail-closed');

audit = fs.readdirSync(recordings).map((f) => fs.readFileSync(path.join(recordings, f), 'utf8')).join('\n');
auditRows = audit.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.ok(auditRows.some((event) => event.event === 'confirmed'), 'confirmed lifecycle evidence remains recorded');
assert.ok(!auditRows.some((event) => event.event === 'confirmation-delivered'));
for (const event of auditRows) {
  assert.equal(event.rulesetId, DEEP_RECLAIM_RULESET_ID);
  assert.equal(event.gateProtocolId, DEEP_RECLAIM_GATE_PROTOCOL.id);
  assert.equal(event.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID);
  assert.equal(event.cohortMonth, new Date(event.setupTs).toISOString().slice(0, 7));
}

const kv = JSON.parse(fs.readFileSync(path.join(appDir, 'kv.json'), 'utf8'));
assert.equal(kv['deep-reclaim-notify-quota-v1'], undefined, 'shadow-only collection never consumes delivery quota');

Date.now = realNow;
fs.rmSync(dir, { recursive: true, force: true });
console.log('deep-reclaim runtime: H1 retirement keeps shadow lifecycle and blocks all automatic TG PASS');
