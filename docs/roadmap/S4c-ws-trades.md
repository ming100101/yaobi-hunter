# S4c — WebSocket 大單監察:pinned 幣即時鯨魚成交 print(實驗)

**層級**: 第2層 訊號擴張(實驗) · **工作量**: M · **依賴**: R2(通知)、S3(候選概念)

## zh-HK TL;DR
OKX 公共 WebSocket 免費、即時。呢個 spec 喺 headless recorder 開一條 WS,訂閱 pinned 幣嘅 `trades` channel,滾動統計成交大小分佈,見到異常大單(z-score 高)就記錄 + 可選通知。係「莊家異動」最直接嘅原始訊號,但預期噪音大,所以實驗 tier。

## Context (verified facts)
- OKX public WS: `wss://ws.okx.com:8443/ws/v5/public`, subscribe frame: `{"op":"subscribe","args":[{"channel":"trades","instId":"DOGE-USDT-SWAP"}]}`. Free, no key. Ping/pong: server expects activity; send `'ping'` string every 25s, expect `'pong'`.
- Runs in the RECORDER only (browser WS would die with the tab; recorder is the 24/7 process — recorder.ts:39-57 loop).
- Node 18+ has global `WebSocket`?— NO in node <22 stable; use a tiny dependency-free approach: Node ≥21 has experimental global WebSocket; else `npm i ws` (one small dep — acceptable, dev-only… it's runtime for recorder; fine, document it).
- Notification path: R2 `sendTelegram`/`sendToast`; kv config key `notify`.

## Design (decided)
- Scope: pinned symbols only (from kv `pinned`), max 10 subscriptions.
- Per symbol keep a rolling window of the last 500 trade notionals (px×sz×ctVal — fetch ctVal once from `/api/v5/public/instruments?instType=SWAP`, cache in-module). Whale print = notional z-score ≥ 4 vs the window AND notional ≥ $50k (hard floor kills illiquid-coin noise).
- On whale print: append JSONL line to `recordings/whales-YYYY-MM-DD.jsonl`: `{"ts":ms,"sym":"DOGE","side":"buy|sell","notional":N,"z":N}`. Optional Telegram notify if kv `notify.whalePings === true` (default OFF — noisy), 30-min per-coin cooldown.
- Reconnect with exponential backoff (1s→60s cap); resubscribe on reconnect; pin-list changes picked up by re-reading kv every 5 min.

## Steps
1. `scripts/whaleWatch.ts`: connect/subscribe/window/z-score/append/notify logic as above; start from `recorder.ts` main() unless `--no-ws` flag.
2. ctVal cache + notional math (OKX trades push `px`, `sz` in contracts).
3. Verify eval path: whale files are separate from scan recordings — future E1 analysis joins by ts/sym. No RecCoin/meta change.

## Verification
- Run recorder with ≥1 pinned major (BTC) → whales file gains entries within hours; z/notional sane; WS survives overnight (check reconnect log lines).

## Acceptance
- [ ] Pinned-only, ≤10 subs, ping/pong + backoff reconnect.
- [ ] Whale JSONL lines with the exact shape above.
- [ ] Telegram whale pings OFF by default, cooldown 30min.

## 陷阱 / Do-NOT
- 大單 ≠ 莊家 — could be liquidation or one whale exiting. That's WHY this is recording-first; no badge, no strategy change until eval shows lift.
- Do NOT subscribe to the whole universe (~350 × trades = firehose) — pinned only.
- Do NOT let WS failures affect the sweep loop — separate module, fire-and-forget start, own try/catch world.
- If adding the `ws` package: pin the version, note it in package.json comment; the exe/SEA does NOT bundle the recorder, so no SEA impact.
