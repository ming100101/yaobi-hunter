# T2 — 實盤全自動:opt-in、硬性風控、隨時一鍵熄

**層級**: 第4層 實盤 · **工作量**: M · **依賴**: T1 跑順 ≥1 個月
**解鎖條件(硬性):T1 半自動實單(或 simulated)≥1 個月無事故;M1 模擬盤持續正 P&L;用戶明確表示要開全自動。三樣缺一不可。**

## zh-HK TL;DR
T1 嘅 `/confirm` 步驟由機器代答 — 但只喺用戶明確開咗 `autoTrade: true` 之下,而且風控係硬性:最多 2 倉、每筆 ≤1% risk、日虧 3% 即停到聽日、kill file 秒停、每單 Telegram 通知(改為事後通知)。

## Context
- 全部基建嚟自 T1 (`scripts/liveTrade.ts`, `okxPrivate.ts`, guards, mirror-to-paper)。呢個 spec 主要係一個 config flag + reconciliation loop。

## Design (decided)
- Config: secrets.json gains `"autoTrade": false` (default). kv `live-state.halted` respected as before.
- Auto path: offer step → guards → place immediately → Telegram 事後通知 (「已自動落單 DOGE …」+ `/close DOGE` quick command).
- **Reconciliation loop** (the actual new work): every 5 min, `GET /api/v5/account/positions` and diff against `live-state.positions`:
  - Exchange has a position we don't know → alert 「發現未知倉位,自動交易已暫停」+ halt.
  - We think a position exists but exchange says closed (TP/SL fired) → fetch fills, realize P&L into live-state + paper mirror, notify.
  - Daily realized loss ≤ −3% → halt + notify. Halt clears at UTC midnight ONLY if `autoTrade` still true and no kill file.
- Additional hard limits (constants, not config): max 4 orders/day; min 2h between opens on the same coin; order notional cap = 10% equity regardless of risk math.

## Steps
1. liveTrade.ts: branch `autoTrade` — skip confirm window; everything else identical to T1's place path.
2. `reconcile()` on a 5-min interval in the recorder; implement the three diff cases above.
3. `/close SYM` Telegram command → market-close the position (reduce-only), any mode.
4. Notify wording: every auto action gets a Telegram line; silence is never success (include daily summary message at UTC midnight: trades, P&L, equity).

## Verification
1. Simulated env: force two edges → both auto-place; third blocked by position cap with a Telegram reason.
2. Manually close one position on the OKX demo UI → reconcile detects within 5 min, realizes P&L, notifies.
3. KILL file mid-loop → no orders, notify 「已停」.
4. Daily-loss halt: simulate by setting live-state dailyPnl below threshold → next edge refused.

## Acceptance
- [ ] Auto only when `autoTrade: true` AND unlock conditions pasted (dated) into PR.
- [ ] Reconciliation handles unknown-position / closed-behind-our-back / daily-halt.
- [ ] Hard limits (4/day, 2h/coin, 10% notional) enforced in code, not config.
- [ ] Daily summary + per-action Telegram messages.

## 陷阱 / Do-NOT
- Reconcile before trusting local state — the exchange is the source of truth; local mirror is a cache.
- Do NOT widen limits in config — hard limits stay constants; changing them = editing code deliberately.
- Do NOT auto-resume after ANY anomaly (unknown position, repeated 401/5xx, clock skew) — halt + notify + wait for human `/resume`.
- 全自動唔等於唔使睇 — README 明言用戶仍需每日檢查 daily summary。
