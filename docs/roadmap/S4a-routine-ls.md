# S4a — 常規 LS ratio 收集:top-30 每 sweep 記錄 long/short 比率

**層級**: 第2層 訊號擴張(實驗) · **工作量**: S · **依賴**: R1

## zh-HK TL;DR
Retail long/short ratio 係 蓄 訊號唯一有效嘅確認之一(跌 ≥5% = 散戶投降),但而家只為 EA 候選幣先 fetch,冇累積歷史。呢個 spec 每 sweep 為 strength top-30 收埋 LS ratio 落 recordings,俾將來嘅 detector 實驗有數據用。

## Context (verified facts)
- `getLsDrop24h(base, ccy)` exists at `src/data/okx.ts:355-369` — rubik `long-short-account-ratio` endpoint, returns 24h drop %, called ONLY for EA candidates today.
- Rubik budget: 5 req/2s per IP shared with OI cold path + S2 spot-taker pool (okx.ts:426-433). OI warm store means a warm sweep uses ~0 rubik → headroom exists, but must be sequenced.
- R1 RecCoin idx 16 = `lsDropPct` (currently only populated when 蓄 fired).

## Steps
1. In `runRollingScan` (okx.ts:436+), after the sweep's batches complete and BEFORE returning: take strength top-30 of assembled coins (plus existing EA candidates already fetched — dedup), fetch `getLsDrop24h` via `mapPool(syms, 2, fn, 500)` — run strictly AFTER the OI cold pool and S2 spot pool (sequential `await`s, never interleaved).
2. Attach to `CoinLite.feat.lsDropPct` (R1's field) for those coins → flows into recordings idx 16 automatically.
3. Config guard: skip the whole pool if the sweep already saw 429s (reuse S3's backoff counter if present, else a simple module flag set by okxGet warnings).
4. No UI change. No detector change. This is data collection only.

## Verification
- `npm run recorder -- --once` → today's JSONL: top-strength coins now have non-null idx 16; console shows no 429 storm; sweep time increase ≤ ~35s ((30 coins / 2 workers) × 0.5s pacing + latency ≈ 30×0.5/... ≈ 15-25s — measure and note actual).

## Acceptance
- [ ] ≤30+EA LS fetches per sweep, sequenced after other rubik pools, paced 500ms/conc 2.
- [ ] idx 16 populated in recordings for those coins; others stay null.
- [ ] Sweep-time cost measured and written into this spec's results block.

## 陷阱 / Do-NOT
- rubik budget is the scarcest resource in the app — NEVER run this pool concurrently with OI cold or spot-taker pools.
- Do NOT gate 蓄 on this data (its EA fetch path stays as-is); this is passive collection.
- If sweep time regresses past +45s, halve to top-15 and note it (log dropped count — no silent caps).

## Results / closure

**✖ SUPERSEDED 2026-07-07 — not built (goal achieved by other means, not by shipping this pool).**

The whole point of S4a was passive collection so *future detector experiments* would have LS history. That data now exists retroactively at higher fidelity, and the harnesses that would consume it are already wired — so self-recording adds negative value:

- **Same series, richer, free.** S4a's `getLsDrop24h` reads `/futures/data/globalLongShortAccountRatio`. The Binance Vision daily-metrics dump carries that exact series as `count_long_short_ratio` (verified in cached `scripts/backtest-data/5m/*-metrics-*.csv`) at **5-minute** resolution, months deep, **full universe** — vs S4a's 15-min / top-30 / forward-only-from-now.
- **Already consumed.** `backtest5m.ts:347-350` aligns OI/top-LS/**global-LS**/taker onto the 5m grid via `--metrics` (comment names "S4a/S4b-grade inputs"); `backtest.ts` (:429, `--ls-drop` gate :1020-1023) already tests LS-drop hypotheses on the live series. Any LS detector idea is testable today with zero dependency on self-recorded idx16.
- **Zero consumer for what it would write.** Recorded idx16 (`lsDropPct`) is populated only from `coin.earlyAccum?.lsDropPct` (binance.ts:868) and read live only by the EA path (analyze.ts / interpret.ts). No eval/backtest/report reads `recCoinField(row, 16)`, so collecting it for top-30 fills a field nothing analyzes.
- **Cost vs benefit.** Building it spends the scarcest resource (futures/data budget) every sweep, forever, for a strictly-inferior redundant stream. Against this project's honest-stats discipline.

If a LS-based detector ever passes a backtest gate and needs LS at **live** decision time, its live-serving fetch is added *with that detector* (as `getLsDrop24h` already is for EA) — a future task, not S4a. Closed with user ratification (2026-07-07).
