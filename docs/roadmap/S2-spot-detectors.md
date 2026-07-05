# S2 — 莊家現貨拉盤三劍:spot-led pump / 現貨暗中吸籌 / 基差異動 (backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M(可拆兩個 session:數據→detector) · **依賴**: S1

## zh-HK TL;DR
莊家用現貨拉盤嘅特徵:價升但 perp OI 冇增加(唔係槓桿推)、現貨成交量爆升、現貨價領先(基差轉負)。而家 app 得個「靠估」版(`spot-led-breakout` 淨係睇 OI 冇升反推)。呢個 spec 為候選幣攞真現貨 K 線 + 現貨主動買賣量,寫三個新 detector。**紀律:全部要過 backtest 先可以喺 UI 出 badge**(呢個 project 一路都係咁,×0.67 嘅 taker-share idea 就係咁被否決)。

## Context (verified facts)
- Inference-only detector today: `spot-led-breakout` at `src/lib/interpret.ts:378-383` — fires on `ret4h≥2% + |oi4h|<1.5% + buyShare>55% + volZ>1`, no spot data.
- Candidate fetch pattern to copy: EA confirmations only fetch for pre-filtered candidates (`okx.ts:337-369`, `getLsDrop24h` etc.), never the whole universe.
- Fetch infra: `okxGet` retry (okx.ts:32-52), `mapPool(items, conc, fn, spacing)` (55-73), `resample` (77-89). Candle fetching pattern: `getCandles` paginates `/api/v5/market/candles` (okx.ts:203-240).
- Spot endpoints (all free, public): spot 5m klines `/api/v5/market/candles?instId=BASE-USDT&bar=5m&limit=300`; spot taker flow `/api/v5/rubik/stat/taker-volume?ccy=BASE&instType=SPOT&period=1H` (rubik family: 5 req/2s shared per IP — same budget as OI cold path, so candidates only, paced).
- Backtest harness: `scripts/backtest.ts` with ablation-filter flags (`--taker-share`, `--ls-drop`, `--rs-min`, lines ~60); data cached under `backtest-data/` per coin. Gate precedent: ⚡ shipped at lift ×2.04; EA shipped watchlist-tier at ×1.03-1.24; taker-share ×0.67 NOT shipped (README:53-57).
- `Coin` type: `src/types.ts:42-66`; detail data assembled in `fetchLiveCoin` (okx.ts:157+) and `fetchFullCoin` (scan.ts:99).

## Design (decided)
- **Candidates** = union of: pinned symbols, strength top-20 of the current sweep, EA-flagged coins. Cap 30/sweep.
- New per-candidate data: `spotCandles?: Candle[]` (48h of 5m, 2 paginated calls) and `spotTakerBuyShare24h?: number | null` (from rubik taker-volume, buy/(buy+sell) over last 24h) attached to the full `Coin`.
- Three detectors (initial thresholds; the backtest sweeps them):
  1. **spot-led-pump (現貨帶動拉升)** — upgrade of interpret.ts:378: `ret4h ≥ 2%` AND `|oi4h| < 1.5%` AND `spotVolZ ≥ 2` (z of the coin's own spot 5m volume, 24h window, same meanStd math as analyze.ts:148-152) AND `basisPct ≤ 0.05` (spot not lagging). Tone bull, priority 8.
  2. **stealth-spot-accum (現貨暗中吸籌)** — the real「更早蓄力」candidate: `|ret4h| < 1%` AND spot volume elevated for a sustained window (spot vol 8h-mean ≥ 1.5× its prior 40h mean) AND `spotTakerBuyShare24h ≥ 0.55` AND `|oi4h| < 2%` (leverage quiet). Tone info, priority 6, watchlist-tier like 蓄.
  3. **basis-anomaly (基差異動)** — z-score of current `basisPct` against the coin's recorded basis history (needs R1 recordings accumulating; fallback: intra-session history) `|z| ≥ 2.5`. Tone warn/info by sign.
- **Ship gate**: each detector goes UI-visible (badge/insight) only if backtest lift ≥ ×1.3 AND survives the robustness sweep (vary each threshold ±25%, lift stays > ×1.15). Otherwise it ships as recording-only (compute + record, no UI) so eval-rec can keep judging it on live data.

## Steps
1. **okx.ts**: `getSpotCandles(base, ccy)` — copy `getCandles` pagination with `instId = ccy + '-USDT'`; `getSpotTakerBuyShare24h(base, ccy)` — rubik call, sum last 24 hourly buy/sell rows → share, null on failure. Fetch both via `mapPool(candidates, 2, fn, 500)` — same pacing as the OI pool since rubik budget is SHARED (okx.ts:426-433); run AFTER the sweep's OI pool finishes, not concurrently.
2. **types.ts**: add `spotCandles?: Candle[]`, `spotTakerBuyShare24h?: number | null` to `Coin` (42-66).
3. **Detectors**: implement in `src/lib/interpret.ts` as three new entries following the existing detector object shape (id/title/tone/priority/when — copy a neighbour like lines 378-383). Compute `spotVolZ` inside `buildCtx` ONLY when `coin.spotCandles` exists; all three no-op on missing spot data.
4. **Recording**: add rising-edge flags for the three detectors… NOT as new RecCoin columns (schema stability) — instead a per-sweep meta extension: append to the sweep-meta line `spotSignals: {[sym]: [pump01, accum01, basis01]}` for candidates only. eval-rec reads it in S4d/E1 work.
5. **backtest.ts**: add `--spot` mode — for each universe coin fetch spot 5m klines alongside perp data into `backtest-data/` (v3 cache bump), implement the three predicates over the historical series, report lift exactly like existing modes. Flags: `--spot-volz 2 --spot-basis 0.05 --spot-buyshare 0.55` etc.
6. **Run the gate** (execution model must actually run these and paste results into the PR/summary):
```sh
npm run backtest -- --mode spot-pump --target 10 --horizon 24
npm run backtest -- --mode spot-accum --target 10 --horizon 24
npm run backtest -- --mode spot-accum --target 15 --horizon 48
# robustness: repeat best spec with each threshold ±25%
```
7. **UI (only for detectors that pass)**: badge on screener row (visual weight ≤ 蓄's `ea-badge`, theme.css:464-477) + insight entry. Failed detectors: leave code in, `SHIPPED = false` const gates the UI.

## Verification
- `npm run typecheck`; dev run shows spot insights on a candidate coin (or silent if none qualify — force-check by temporarily logging detector inputs for one symbol).
- Rubik budget: with the app open + recorder running, console shows no sustained 429 storm (a few absorbed retries OK, okx.ts:39).
- Backtest commands above produce lift tables; results recorded in this file's PR description AND appended to the bottom of this spec as a dated results block.

## Acceptance checklist
- [ ] Spot series fetched for ≤30 candidates/sweep, paced AFTER the OI pool.
- [ ] Three detectors implemented, no-op without spot data, demo mode unaffected.
- [ ] Backtest gate run; UI badges ONLY for passing detectors; failing ones recording-only.
- [ ] Results block appended to this spec.

## 陷阱 / Do-NOT
- rubik 5req/2s is SHARED with the OI cold path — never run the spot-taker pool concurrently with the OI pool (sequence them), and keep conc=2/500ms.
- Do NOT trust rubik units across coins (README:77 — the DOGE/PEPE unit inconsistency); taker-volume is only ever used as a RATIO (buy share), never absolute.
- Do NOT ship a badge on intuition — ×1.3 + robustness or it stays recording-only. Write the numbers down.
- Spot kline pagination: OKX returns newest-first (same as perp, okx.ts:203-240) — reuse the existing reversal logic, don't re-derive.
- Coins without spot listings must not enter the candidate spot fetch (filter by S1's spot ticker map).
