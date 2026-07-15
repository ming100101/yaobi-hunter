import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CoinLite, ExitPlan } from '../src/types';
import { readKvFile, writeKvKey } from './kvFile';
import {
  buildSignalCard,
  CLASS_FB,
  CLASS_REBUILD,
  notifyClassEdges,
  sendTelegram,
  type NotifyRich,
} from './notifyHeadless';

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(e);
  }
}

const coin: CoinLite = {
  symbol: 'TEST',
  regime: 'pump',
  strength: 81,
  change1h: 2.1,
  change24h: 7.2,
  oi4h: 4.5,
  oiTrusted: true,
  funding: 0.01,
  volZ: 2.2,
  vol24h: 10_000_000,
  lastPrice: 110,
  oiUsd: 25_000_000,
  flushBreakout: false,
  earlyAccum: false,
  rebuildBreakout: true,
  virginBreakout: false,
  riskFlags: [],
  signals: { fundsFirst: true, mildRise: true, oiHealthy: true, buyHealthy: true },
};

const plan: ExitPlan = {
  entry: 100,
  kind: 'breakout',
  tp1: 104,
  tp2: 108,
  tp3: 115,
  sl: 97,
  runnerPct: 5,
};

const rich: NotifyRich = {
  candles: [
    { time: 1_700_000_000, open: 100, high: 101, low: 99, close: 100 },
    { time: 1_700_000_300, open: 100, high: 111, low: 100, close: 110 },
  ],
  plan,
  insights: [],
  entryWatch: { support: 100, atr: 10 },
};

function tempLocal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaobi-notify-entry-'));
  process.env.LOCALAPPDATA = dir;
  writeKvKey('notify', {
    telegramToken: 'token',
    telegramChatId: 'chat',
    toast: false,
    cooldownH: 6,
    entryWatchEnabled: true,
  });
  return dir;
}

function telegramResponse(ok: boolean, messageId = 321, sentAtSeconds = Math.floor(Date.now() / 1000)): Response {
  return new Response(
    JSON.stringify(ok ? { ok: true, result: { message_id: messageId, date: sentAtSeconds } } : { ok: false, description: 'known failure' }),
    { status: ok ? 200 : 400, headers: { 'content-type': 'application/json' } },
  );
}

await test('Telegram reply threading uses reply_parameters and returns message_id', async () => {
  let body: Record<string, any> | undefined;
  const prior = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return telegramResponse(true, 987, 1_784_000_000);
  }) as typeof fetch;
  try {
    const out = await sendTelegram('token', 'chat', 'hello', { replyToMessageId: 42 });
    assert.deepEqual(out, { ok: true, messageId: 987, deliveredAt: 1_784_000_000_000 });
    assert.deepEqual(body?.reply_parameters, { message_id: 42, allow_sending_without_reply: true });
  } finally {
    globalThis.fetch = prior;
  }
});

await test('Telegram success without message id/date is not accepted as delivery', async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })) as typeof fetch;
  try {
    const out = await sendTelegram('token', 'chat', 'hello');
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /message proof/);
  } finally {
    globalThis.fetch = prior;
  }
});

await test('disabled/unpromoted card never claims the 24h watcher is active', () => {
  const card = buildSignalCard(coin, rich, CLASS_REBUILD, false);
  assert.doesNotMatch(card, /已開啟24h監察/);
  assert.doesNotMatch(card, /結構入場區/);
  assert.match(card, /原計劃參考位/);
});

await test('successful first Telegram writes v3 provenance, consumes cooldown, and separates delivered/watchable', async () => {
  const dir = tempLocal();
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return telegramResponse(true, 654);
  }) as typeof fetch;
  try {
    const result = await notifyClassEdges(
      [coin],
      new Set(),
      new Map([[coin.symbol, rich]]),
      CLASS_REBUILD,
    );
    assert.deepEqual([...result.current], ['TEST']);
    assert.equal(result.delivered.length, 1);
    assert.equal(result.delivered[0].telegramMessageId, 654);
    assert.equal(result.watchable.length, 1);
    assert.equal(result.watchable[0].followupEnabled, false, 'failed historical gate must force record-only mode');
    assert.equal(result.delivered[0].deliveredAt, result.delivered[0].ts);
    assert.ok(result.delivered[0].attemptedAt < result.delivered[0].deliveredAt + 1000);
    const id = result.delivered[0].id;
    assert.ok((readKvFile()['rb-notified-headless'] as Record<string, number>).TEST > 0);

    const recordDir = path.join(dir, 'YaobiHunter', 'recordings');
    const file = path.join(recordDir, fs.readdirSync(recordDir)[0]);
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.equal(line.v, 3);
    assert.equal(line.id, id);
    assert.equal(line.deliveredAt, line.ts);
    assert.ok(line.attemptedAt < line.deliveredAt + 1000);
    assert.equal(line.watchId, `entry:${id}`);
    assert.equal(line.watch.mode, 'shadow');
    assert.equal(line.messageId, 654);

    const before = calls;
    const second = await notifyClassEdges(
      [coin],
      result.current,
      new Map([[coin.symbol, rich]]),
      CLASS_REBUILD,
    );
    assert.equal(calls, before, 'successful persistent signal is cooldown-suppressed');
    assert.equal(second.delivered.length, 0);
    assert.equal(second.watchable.length, 0);
  } finally {
    globalThis.fetch = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('known Telegram failure consumes no cooldown and retries despite a persistent detector state', async () => {
  const dir = tempLocal();
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return telegramResponse(false);
  }) as typeof fetch;
  try {
    const first = await notifyClassEdges(
      [coin],
      new Set(),
      new Map([[coin.symbol, rich]]),
      CLASS_REBUILD,
    );
    assert.equal(first.delivered.length, 0);
    assert.equal(first.watchable.length, 0);
    assert.equal((readKvFile()['rb-notified-headless'] as Record<string, number> | undefined)?.TEST, undefined);
    const afterFirst = calls;
    await notifyClassEdges([coin], first.current, new Map([[coin.symbol, rich]]), CLASS_REBUILD);
    assert.ok(calls > afterFirst, 'persistent detector must retry when the prior delivery failed');
  } finally {
    globalThis.fetch = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('confirmed delivery still yields the watch when the audit directory is unwritable', async () => {
  const dir = tempLocal();
  const recordPath = path.join(dir, 'YaobiHunter', 'recordings');
  fs.writeFileSync(recordPath, 'blocks mkdir');
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => telegramResponse(true, 777)) as typeof fetch;
  try {
    const result = await notifyClassEdges(
      [coin],
      new Set(),
      new Map([[coin.symbol, rich]]),
      CLASS_REBUILD,
    );
    assert.equal(result.delivered.length, 1);
    assert.equal(result.watchable.length, 1);
    assert.equal(result.delivered[0].telegramMessageId, 777);
  } finally {
    globalThis.fetch = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('successful ⚡ card creates an anchored App-only shadow watch', async () => {
  const dir = tempLocal();
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => telegramResponse(true, 691)) as typeof fetch;
  const fbCoin: CoinLite = { ...coin, flushBreakout: true, rebuildBreakout: false };
  try {
    const result = await notifyClassEdges(
      [fbCoin],
      new Set(),
      new Map([[fbCoin.symbol, rich]]),
      CLASS_FB,
    );
    assert.equal(result.delivered.length, 1);
    assert.equal(result.delivered[0].cls, 'fb');
    assert.equal(result.watchable.length, 1);
    assert.equal(result.watchable[0].cls, 'fb');
    assert.equal(result.watchable[0].followupEnabled, false);
    const recordDir = path.join(dir, 'YaobiHunter', 'recordings');
    const file = path.join(recordDir, fs.readdirSync(recordDir)[0]);
    const line = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.equal(line.watch.mode, 'shadow');
    assert.equal(line.messageId, 691);
  } finally {
    globalThis.fetch = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

delete process.env.LOCALAPPDATA;
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ENTRY NOTIFY TESTS PASS');
process.exit(failures ? 1 : 0);
