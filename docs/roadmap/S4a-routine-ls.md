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
