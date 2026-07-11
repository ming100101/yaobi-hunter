# S4b — Orderbook depth imbalance:候選幣按需盤口失衡指標(實驗)

**層級**: 第2層 訊號擴張(實驗) · **工作量**: S/M · **依賴**: R1;建議喺 S2 之後

## zh-HK TL;DR
莊家掛牆/抽牆會喺盤口留痕。呢個 spec 為候選幣(pinned + top-20)每 sweep 攞一次 `books5`(頭5檔),計 bid/ask notional 失衡比,記錄落 sweep-meta,俾 eval 判斷有冇預測力。**唔起 detector、唔出 UI** — 純數據實驗,有 lift 先算。

## Context (verified facts)
- Endpoint: `GET /api/v5/market/books?instId=BASE-USDT-SWAP&sz=5` — public, rate limit 40 req/2s per IP (generous; NOT rubik family).
- Candidate-set convention: S3's `pinned ∪ top-20`, cap 25.
- sweep-meta line from R1: extendable JSON object per sweep.

## Design (decided)
- Metric per coin: `obImb = (Σ bid px×sz − Σ ask px×sz) / (Σ bid px×sz + Σ ask px×sz)` over the 5 levels → [-1, +1], fix 3.
- Storage: sweep-meta gains `"ob": {"SYM": 0.123, ...}` for candidates. NOT a RecCoin column (schema stability; candidates-only data belongs in meta).

## Steps
1. okx.ts: `getBooksImbalance(base, instId): Promise<number | null>` — one `okxGet` call, compute the formula, null on failure.
2. In `runRollingScan` end-phase (same place as S4a, but this pool may run CONCURRENTLY with the LS pool — different rate-limit family): `mapPool(candidates, 4, fn, 100)` ≈ 25 coins in ~1-2s.
3. Extend the sweep-meta writers (App.tsx recordSweep + recorder.ts) to include the `ob` map when present.
4. Eval hook (defer detailed analysis to E1): `evalCore` gets a helper to join meta.ob onto slot/sym for future stratification. Minimum now: `npm run eval-rec -- --json` unaffected.

## Verification
- Recording sweep-meta lines contain `ob` with ~25 entries, values in [-1,1]; no new 429s; sweep time +<3s.

## Acceptance
- [ ] Candidates-only, one books call each, ~concurrent-4 pool.
- [ ] `ob` in sweep-meta from both writers.
- [ ] Zero UI/detector changes.

## 陷阱 / Do-NOT
- books5 top-5 levels are thin and spoofable — this is exactly why it ships as recording-only until months of eval say otherwise. Do NOT promote to a badge in this spec.
- Do NOT bump to books-full (`sz=400`) — heavier payloads, same spoofability, no eval evidence yet.

## Results / closure

**✖ SUPERSEDED 2026-07-08 — not built (goal achieved by Binance Vision, same as S4a).**

S4b's purpose was recording orderbook imbalance for *future eval of predictive power*. That data exists retroactively, at higher fidelity, via the **Binance Vision bookDepth dump** — verified live this session:

```
data.binance.vision/data/futures/um/daily/bookDepth/<SYM>/<SYM>-bookDepth-<date>.zip
header: timestamp,percentage,depth,notional
2026-06-15 00:00:04,-5.00,6851.682,439751940.22   (BTCUSDT: bid band −5%, notional USD)
```

- **Same metric, richer, free.** `obImb = (Σ bid notional − Σ ask notional)/(Σ …)` over the percentage bands is computable directly from the dump — per **minute** (vs S4b's 15-min sweep), **full universe** (vs ~25 candidates), **months retroactive** (vs forward-only), and at a **±1-5% band that is LESS spoofable** than S4b's thin top-5 levels (the exact weakness the 陷阱 warns about).
- **Zero live-sweep cost.** Self-recording would spend a per-sweep `books5` pool to collect a strictly-inferior, spoofable, 15-min, forward-only stream. Against the honest-stats discipline (cf. S4a).
- **No consumer waiting.** S4b explicitly ships no detector/UI — it's collection for eval, and the eval can run on Vision. If a future *live* orderbook detector ever passes a gate, its live `books` fetch is added *with that detector* (as EA's LS fetch is) — a separate task, not S4b.

To actually TEST the orderbook-imbalance hypothesis later: add a `bookDepth` loader to `scripts/backtest5m.ts` (same shape as the `--metrics` daily-dump loader) and backtest `obImb` against a state-matched baseline (per the 2026-07-08 baseline-audit lesson). Not built now — the 陷阱's spoofability caveat + zero evidence make it low-priority speculation. Closed with the same reasoning as S4a.
