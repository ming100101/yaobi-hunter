# T1 — 實盤半自動:Telegram 收訊號連計好嘅單,`/confirm` 先落單

**層級**: 第4層 實盤 · **工作量**: M · **依賴**: R2, M1
**解鎖條件(硬性):M1 模擬盤連續 ≥1 個月 P&L 為正、profit factor > 1.2、⚡ 事件樣本 ≥ 20。未達標唔准開始呢個 spec。**

## ⚠️ 安全前提 (execution model MUST enforce all of these)
1. OKX API key 只開 **Trade** 權限 — 絕對唔開 Withdraw。Spec 完成後喺 README 提醒用戶檢查。
2. Key/secret/passphrase 存放喺 `%LOCALAPPDATA%\YaobiHunter\secrets.json` — **絕對唔准**放入 repo、唔准 log、唔准寫入 kv.json(kv 有 export 風險)。
3. 全域 kill switch:`%LOCALAPPDATA%\YaobiHunter\KILL` 檔案存在 → 一切下單邏輯直接 return。
4. 每筆 risk 上限 1% equity;同時最多 2 個實倉;首兩週用交易所最小 size 落單(`minSz`)。
5. 錢係用戶嘅 — 任何 ambiguity 一律揀唔落單嗰邊。

## zh-HK TL;DR
唔係全自動 — recorder 見到 ⚡ 就喺 Telegram 度發一條連埋計好晒嘅單(size、entry、TP/SL),用戶覆 `/confirm DOGE` 先真係落單。人做最後把關,機器做晒計算。

## Context (verified facts)
- Telegram send path exists (R2 `scripts/notifyHeadless.ts`); receiving needs long-poll `getUpdates`.
- Position sizing math = M1's paper rule (`equity × riskPct / (entry − sl)`); TP/SL multipliers from `analyze.ts:381-389`.
- OKX private REST: sign = `Base64(HMAC-SHA256(timestamp + method + requestPath + body, secretKey))`; headers `OK-ACCESS-KEY / OK-ACCESS-SIGN / OK-ACCESS-TIMESTAMP / OK-ACCESS-PASSPHRASE`; timestamp = ISO8601 ms. Order endpoint `POST /api/v5/trade/order`.
- Contract sizing: order `sz` is in CONTRACTS; `ctVal` (coin per contract) from `GET /api/v5/public/instruments?instType=SWAP` — S4c may already cache this; reuse.
- TP/SL attach: `attachAlgoOrds: [{tpTriggerPx, tpOrdPx: '-1', slTriggerPx, slOrdPx: '-1'}]` (market TP/SL) on the order body.

## Design (decided)
- New module `scripts/liveTrade.ts`, driven from recorder loop. State: kv key `live-state` (positions mirror, daily P&L, halted flag). Secrets loaded once from secrets.json; missing file → module inert (log one line).
- Signal → offer: on ⚡ rising edge (same edge R2 notifies), compute order: `equity` = live equity fetched from `GET /api/v5/account/balance` (USDT eq); entry = market; `sz = floor((equity × riskPct/100 / (last − sl)) / ctVal)` contracts, min `minSz`; TP1 only as the attached TP (partial-tier exits stay a manual/T2 concern — keep T1 simple: attached TP = tp2 (+8%), SL = −3%).
- Telegram offer message includes ALL numbers + expiry: 「30 分鐘內覆 `/confirm DOGE` 落單」。
- Confirm loop: `getUpdates` long-poll (timeout=50) in the recorder process; on `/confirm SYM` within 30 min of the offer AND all guards pass → place order; reply with fill result. `/cancel SYM`, `/status`, `/halt`, `/resume` commands too. Only accept messages from the configured `telegramChatId`.
- Guards checked at BOTH offer and confirm time: kill file absent; open live positions < 2; daily realized loss > −3% equity → auto-halt until next UTC day; secrets valid.
- Every placed order also mirrored into the paper ledger (M1) with action tag `live-mirror` for later slippage comparison.

## Steps
1. `scripts/okxPrivate.ts`: `sign()`, `privateGet/privatePost` with the header scheme above (Node `crypto.createHmac('sha256')`). Never log bodies containing keys; log order responses minus headers.
2. `scripts/liveTrade.ts`: state machine {offer → confirm window → place → track}. Track fills via `GET /api/v5/trade/order?instId=&ordId=`.
3. Recorder wiring: start the getUpdates loop at boot (skip if no secrets); call `offerFromSignal()` next to the R2 notify call.
4. `--dry-live` flag: full flow, Telegram messages real, but `place` step replies 「DRY RUN — 冇落單」. Ship default = dry until user removes the flag from their task registration. First real run: verify on OKX demo-trading env first (`x-simulated-trading: 1` header + demo keys) — document both modes.
5. README section: key creation walkthrough (Trade-only, IP allowlist recommended), secrets.json shape:
```json
{ "okx": { "apiKey": "...", "secretKey": "...", "passphrase": "...", "simulated": true } }
```

## Verification
1. `--dry-live`: force an edge (scratch threshold) → Telegram offer appears with sane numbers; `/confirm` in window → 「DRY RUN」 reply; after window → 「已過期」.
2. Simulated env (`simulated: true` + demo keys): place a real demo order end-to-end; verify TP/SL attached on OKX web UI.
3. Guards: create KILL file → offers stop; delete → resume. Two open demo positions → third offer refused with reason.
4. grep the repo for the API key string → zero hits; grep logs → zero hits.

## Acceptance checklist
- [ ] Unlock condition documented as CHECKED with M1 stats pasted into the PR (date-stamped).
- [ ] Trade-only key, secrets outside repo, kill switch, ≤2 positions, daily-loss halt, chat-id allowlist.
- [ ] Dry-run → simulated → (user's own decision) real, in that order.
- [ ] Live orders mirrored to paper ledger for slippage tracking.

## 陷阱 / Do-NOT
- NEVER default to real trading: `simulated: true` is the shipped default; going real is a manual user edit.
- OKX `sz` rounding: floor to the instrument's `lotSz` multiple or the order rejects — fetch `lotSz`/`minSz` with `ctVal` and validate before sending.
- getUpdates offset must be persisted (kv `tg-offset`) or restarts replay old commands — dedup by update_id.
- Clock skew breaks signing — use server time from `GET /api/v5/public/time` if local signing gets 401s.
- Do NOT auto-retry a failed order placement (could double-fill); report and wait for human.
