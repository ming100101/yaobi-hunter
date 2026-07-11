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

## Re-sequenced 2026-07-08 — validate on Vision aggTrades BEFORE building the live WS

**Do NOT build the WS whale-collector yet.** S4c's recording-first half (collect whale prints so a future eval can ask "does whale activity predict pumps") is superseded by the **Binance Vision aggTrades dump** — verified live this session:

```
data.binance.vision/data/futures/um/daily/aggTrades/<SYM>/<SYM>-aggTrades-<date>.zip
header: agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker
3340289279,65702.1,0.004,…,1781481600006,true   (BTCUSDT: 1.35M trades that day)
```

- **Same data, retroactive + full universe.** notional = `price×quantity`; aggressor side = `!is_buyer_maker`. A rolling-window notional z-score reproduces the spec's whale-print definition (z≥4, ≥$50k) — over MONTHS, EVERY coin, without running a 24/7 WS. So the whale-print → pump hypothesis is testable NOW on free historical data, no self-collection.
- **The live WS is only worth building IF the hypothesis passes.** The spec's own IRON-RULE discipline ("recording-first; no notification until eval shows lift") means the WS ping feature is premature — validate first. This is UNLIKE S4a/S4b (fully closed): S4c's *live-serving* layer is genuine future work, just gated behind eval.
- **Also stale:** the spec targets OKX WS (pre-Binance-migration). If the live WS is ever built, use Binance `wss://fmstream.binance.com/ws/<sym>@aggTrade` (matches the recordings' venue since 2026-07-07), not OKX.

**Correct sequence:** (1) add an aggTrades loader to a harness (streaming — 1.35M rows/coin-day, process one coin at a time) + a whale-print → forward-return backtest against a **state-matched baseline** (per the 2026-07-08 baseline-audit lesson — don't measure against an unconditional baseline); (2) ONLY if whale prints show real incremental lift → build the live Binance WS collector (this spec's Steps) + gated notification. Not built now — the hypothesis is unvalidated and the 陷阱 (大單≠莊家) makes it a coin-flip a priori.

### Case study 2026-07-08 — TRIA +50% pump — 兩個紅旗(suggestive,一個 case)

Quick probe:TRIA 06-16 +50% pump,aggTrades 06-15/16,coin-relative z≥4 whale prints,hourly。

1. **$50k floor 對妖幣 miscalibrated。** TRIA 成日**最大單一成交先 $27k**(< $50k floor)。妖幣 small-cap 冇 $50k 單 → spec 個固定 $ floor 只會喺 majors fire,而 majors 唔係妖幣。要用一定要 coin-relative(z),唔可以固定 $。
2. **Whale prints 同 pump 同步,唔領先(同 ⚡ 一樣遲)。** Pump 前幾個鐘(00:00-11:00)whale 活動低 + **偏賣**(09:00 $41k 賣 vs $5k 買);price 12:00 先破($183k buy-whale 同步爆,之前冇領先買盤)。markup 中段(14-15:00)**賣鯨 > 買鯨**($376k vs $304k)= 鯨魚出貨,「大買 = 莊家吸」唔可靠。

**3-coin 複盤(TRIA/ASTER/AVNT,2026-06 pumps,hourly,suggestive):**
- **TRIA**(+50%,最大單 $27k):pump 前偏賣,12:00 破先爆買。無領先。
- **AVNT**(+17%,最大單 $54k):pump 前偏賣($99k 賣 vs $63k 買),pump hour 買≈賣。無領先。
- **ASTER**(+23%,最大單 $380k):mixed — pump 前 2 鐘有一次爆買($435k)但中間又轉賣,pump hour 買≈賣($1039k≈$1023k)。曖昧,唔算清楚領先。
- 三個 pump hour **買鯨 ≈ 賣鯨**(鯨魚兩邊都有,唔係「買鯨推動」)。$50k floor 喺宇宙唔一致(ASTER fire、AVNT 勉強、TRIA 永唔 fire)。

### Systematic N=11 study 2026-07-08 — 定案:whale 唔領先 pump

擴大到 **11 個 pump 事件**(2026-06 cached 宇宙 ≥+20%/24h：ALLO/BICO/AGLD/BEAT/BSB/ACT/HMSTR/EDGE/JTO/BASED/MEGA;每個攞 aggTrades、coin-relative z≥4 whale prints、計 pump hour 前 3h 嘅 whale net-buy flow):

- **Pump 前 3h whale net-buy 為正(accumulation 領先):得 2/11。**
- **9/11 pump 前 whale 係淨賣**(distribution / 無領先),有啲好誇:EDGE(+85%)pump 前 −$2.4M、BEAT(+13%)pump 前 −$1.1M。
- Whale **買盤只喺 pump hour 先爆**(coincident,同 ⚡ 一樣遲)。

**定案(N=11,rigorous):whale accumulation 唔領先 pump — 9/11 事件 pump 前係淨賣,鯨魚買盤同突破同步唔領先。** 夾埋固定 $50k floor 對妖幣 miscalibrated → **S4c 徹底否決 recording-first + WS(除非將來有全新 hypothesis)**。呢個係今晚主結論「偵測更早冇 free lunch」嘅第 5 條獨立證據(baseline audit / metrics-early / breakout geometry / whale 3-case / whale N=11)。Caveat:hourly、pump-hour=最大時漲(粗)、一日 aggTrades、只計 whale-print net(唔係總流)— 但 9/11 淨賣訊號夠強,穩健。
