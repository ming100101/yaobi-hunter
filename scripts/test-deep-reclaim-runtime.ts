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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaobi-deep-runtime-'));
process.env.LOCALAPPDATA = dir;
const appDir = path.join(dir, 'YaobiHunter');
fs.mkdirSync(appDir, { recursive: true });
fs.writeFileSync(
  path.join(appDir, 'kv.json'),
  JSON.stringify({ notify: { telegramToken: 'token', telegramChatId: 'chat', toast: false, deepReclaimTestEnabled: true } }),
);

const realNow = Date.now;
const slot = 15 * 60_000;
let fakeNow = Math.floor(realNow() / slot) * slot + 5_000;
Date.now = () => fakeNow;
const setupTs = Math.floor(fakeNow / slot) * slot;
const telegramPayloads: any[] = [];

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
    for (const symbol of ['TESTUSDT', 'TEST2USDT', 'TEST3USDT', 'TEST4USDT']) {
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
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    telegramPayloads.push(body);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: telegramPayloads.length === 1 ? 111 : 222 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

const dd = 10;
const peakHigh = 1.1;
const troughLow = 0.99;
const setupClose = 1.02;
const high24 = peakHigh;
const low24 = troughLow;
const ema20 = 1.01;
const ema20Prev = 1.009;
const ema50 = 1.03;
const atr14 = 0.01;
const l0 = 1.03;
const troughAgeBars = 8;
const base: DeepReclaimPriceCandidate = {
  strategy: 'deep-reclaim-v0',
  rulesetId: DEEP_RECLAIM_RULESET_ID,
  sym: 'TEST',
  setupTs,
  setupClose,
  barCount: 100,
  peakTs: setupTs - 20 * slot,
  peakHigh,
  troughTs: setupTs - troughAgeBars * slot,
  troughLow,
  troughAgeBars,
  ddPct: dd,
  high24,
  low24,
  pos24: (setupClose - low24) / (high24 - low24),
  ret4hPct: 2,
  ema20,
  ema20Prev,
  ema50,
  emaSlopePct: (ema20 / ema20Prev - 1) * 100,
  atr14,
  l0,
  bandLow: l0,
  bandHigh: l0 + 0.5 * atr14,
  invalidBelow: troughLow,
  missedAbove: l0 + 2 * atr14,
  setupDistanceToL0Pct: (setupClose / l0 - 1) * 100,
  setupDistanceToL0Atr: (setupClose - l0) / atr14,
  expiresAt: setupTs + 24 * 3600_000,
  rankVersion: 1,
  rankScore: 70,
};

const runtime = await import('./deepReclaimRuntime');
const at = (sym: string, ts: number): DeepReclaimPriceCandidate => ({
  ...base,
  sym,
  setupTs: ts,
  peakTs: ts - 20 * slot,
  troughTs: ts - troughAgeBars * slot,
  expiresAt: ts + 24 * 3600_000,
});
await runtime.processDeepReclaimSweep([
  { price: at('TEST', setupTs), buyShare4h: 0.7, candles: [] },
  { price: at('TEST2', setupTs), buyShare4h: 0.56, candles: [] },
]);
let current = runtime.getDeepReclaimRuntimeState();
assert.equal(Object.keys(current.active).length, 2, 'all qualified setups are armed for evidence');
assert.equal(current.active.TEST.delivery, 'delivered', 'successful early Telegram is persisted');
assert.equal(current.active.TEST2.delivery, 'shadow', 'non-Top candidate remains shadow-only');
assert.equal(current.active.TEST.telegramMessageId, 111, 'first message id is frozen for threading');
assert.equal(current.active.TEST.rankScore, 70, 'operational Top-1 ranking never mutates the frozen detector score');
assert.notEqual(current.active.TEST.operationalScore, current.active.TEST.rankScore, 'operational score is stored separately');
assert.equal(current.active.TEST.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID, 'selection policy is frozen on the watch');
assert.equal(telegramPayloads.length, 1, 'one Top-1 early message in the sweep');
assert.match(telegramPayloads[0].text, /TEST<\/b>\/USDT/, 'higher operational score wins Top-1');
const diskState = (await import('./deepReclaimFile')).readDeepReclaimState();
assert.equal(Object.keys(diskState.active).length, 2, 'atomic state survives strict restart sanitization');

fakeNow = setupTs + slot + 5_000;
await runtime.monitorDeepReclaims();
current = runtime.getDeepReclaimRuntimeState();
assert.equal(Object.keys(current.active).length, 0, 'confirmed watch becomes terminal');
assert.equal(Object.keys(current.deliveries).length, 0, 'successful follow-up queue is cleared');
assert.equal(telegramPayloads.length, 2, 'one threaded confirmation message is sent');
assert.equal(telegramPayloads[1].reply_parameters?.message_id, 111, 'confirmation replies to the early Telegram');

const kv = JSON.parse(fs.readFileSync(path.join(appDir, 'kv.json'), 'utf8'));
assert.equal(kv['deep-reclaim-notify-quota-v1'].sent, 1, 'daily cap is consumed only after early success');
assert.ok(kv['deep-reclaim-notify-quota-v1'].cooldowns.TEST, '24h symbol cooldown is committed');

const recordings = path.join(appDir, 'recordings');
const audit = fs.readdirSync(recordings).map((f) => fs.readFileSync(path.join(recordings, f), 'utf8')).join('\n');
for (const name of ['price-candidate', 'armed', 'early-delivered', 'confirmed', 'confirmation-delivered']) {
  assert.ok(audit.includes(`"event":"${name}"`), `audit contains ${name}`);
}
const auditRows = audit.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const selectionRound = auditRows.find((event) => event.event === 'selection-round');
assert.ok(selectionRound, 'every candidate-bearing sweep records an exact Top-1 decision round');
assert.equal(selectionRound.selectedWatchId, current.active?.TEST?.id ?? `deep-reclaim-v0:TEST:${setupTs}`, 'selection audit freezes the delivered watch');
assert.deepEqual(selectionRound.candidates.map((candidate: any) => candidate.sym), ['TEST', 'TEST2'], 'selection candidates retain exact operational order');
assert.ok(selectionRound.candidates.every((candidate: any) => candidate.eligible === true && candidate.reason == null), 'selection audit freezes eligibility decisions');
for (const event of auditRows) {
  assert.equal(event.rulesetId, DEEP_RECLAIM_RULESET_ID, 'new audit rows freeze detector ruleset');
  assert.equal(event.gateProtocolId, DEEP_RECLAIM_GATE_PROTOCOL.id, 'new audit rows freeze gate protocol');
  assert.equal(event.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID, 'new audit rows freeze Top-1 selection policy');
  assert.equal(event.cohortMonth, new Date(event.setupTs).toISOString().slice(0, 7), 'UTC cohort is causal setup month');
}
for (const event of auditRows.filter((row) => row.sym === 'TEST' && ['price-candidate', 'armed'].includes(row.event))) {
  assert.equal(event.rankScore, 70, 'source and arm audit retain the pure detector score');
  assert.notEqual(event.operationalScore, event.rankScore, 'audit stores the operational score in its own field');
}
assert.ok(auditRows.some((event) => event.evidenceRole === 'source' && event.evidenceEligible === true), 'source evidence is explicitly eligible');
assert.ok(auditRows.some((event) => event.evidenceRole === 'lifecycle' && event.evidenceEligible === true), 'lifecycle evidence is explicitly eligible');
assert.ok(auditRows.some((event) => event.evidenceRole === 'delivery' && event.evidenceEligible === false), 'delivery telemetry cannot enter the research denominator');
assert.equal(selectionRound.evidenceRole, 'operational');
assert.equal(selectionRound.evidenceEligible, false, 'selection telemetry cannot enter detector evidence');

// A later fresh setup for the same symbol is collected but the success-based
// 24h cooldown prevents another early Telegram.
const nextSetup = Math.floor(fakeNow / slot) * slot;
await runtime.processDeepReclaimSweep([{ price: at('TEST', nextSetup), buyShare4h: 0.7, candles: [] }]);
current = runtime.getDeepReclaimRuntimeState();
assert.equal(telegramPayloads.length, 2, '24h success cooldown suppresses a repeat early message');
assert.equal(current.active.TEST.delivery, 'shadow', 'cooldown setup still collects shadow evidence');

// Persisted sending is ambiguous after a crash and must never auto-resend.
const uncertainId = current.active.TEST.id;
current.active.TEST.delivery = 'sending';
current.deliveries[uncertainId].earlyStatus = 'sending';
runtime.reconcileAmbiguousDeepReclaimSends();
assert.equal(runtime.getDeepReclaimRuntimeState().active.TEST.delivery, 'uncertain');
assert.equal(telegramPayloads.length, 2, 'ambiguous restart does not resend');

// A full HKT-day cap suppresses a different symbol without stopping shadow
// collection. Confirmation replies never consume this counter.
const capped = JSON.parse(fs.readFileSync(path.join(appDir, 'kv.json'), 'utf8'));
capped['deep-reclaim-notify-quota-v1'].sent = 10;
fs.writeFileSync(path.join(appDir, 'kv.json'), JSON.stringify(capped));
fakeNow += slot;
const cappedSetup = Math.floor(fakeNow / slot) * slot;
await runtime.processDeepReclaimSweep([{ price: at('TEST3', cappedSetup), buyShare4h: 0.8, candles: [] }]);
assert.equal(telegramPayloads.length, 2, 'daily cap ten suppresses the eleventh early message');
assert.equal(runtime.getDeepReclaimRuntimeState().active.TEST3.delivery, 'shadow');

// Turning the test feed off keeps exact hypothetical selection evidence while
// making every newly armed candidate shadow-only.
const disabled = JSON.parse(fs.readFileSync(path.join(appDir, 'kv.json'), 'utf8'));
disabled.notify.deepReclaimTestEnabled = false;
disabled['deep-reclaim-notify-quota-v1'].sent = 0;
fs.writeFileSync(path.join(appDir, 'kv.json'), JSON.stringify(disabled));
fakeNow += slot;
const disabledSetup = Math.floor(fakeNow / slot) * slot;
await runtime.processDeepReclaimSweep([{ price: at('TEST4', disabledSetup), buyShare4h: 0.8, candles: [] }]);
assert.equal(telegramPayloads.length, 2, 'disabled feed sends no Telegram');
assert.equal(runtime.getDeepReclaimRuntimeState().active.TEST4.delivery, 'shadow');

const finalAudit = fs.readdirSync(recordings).map((f) => fs.readFileSync(path.join(recordings, f), 'utf8')).join('\n');
const finalRows = finalAudit.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const rounds = finalRows.filter((event) => event.event === 'selection-round');
assert.ok(rounds.some((round) => round.candidates.some((candidate: any) => candidate.sym === 'TEST' && candidate.reason === 'symbol-cooldown')),
  'selection audit explains success cooldown suppression');
assert.ok(rounds.some((round) => round.candidates.some((candidate: any) => candidate.sym === 'TEST3' && candidate.reason === 'daily-cap')),
  'selection audit explains daily-cap suppression');
assert.ok(rounds.some((round) => round.candidates.some((candidate: any) => candidate.sym === 'TEST4' && candidate.reason === 'notifications-disabled')),
  'selection audit preserves shadow-mode exclusion reason');

Date.now = realNow;
fs.rmSync(dir, { recursive: true, force: true });
console.log('deep-reclaim runtime: Top-1, success quota, durable thread, confirmation audit PASS');
