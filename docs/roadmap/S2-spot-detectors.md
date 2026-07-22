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
- [x] Spot series fetched for ≤30 candidates/sweep, paced AFTER the OI pool. *(session 1)*
- [ ] Three detectors implemented, no-op without spot data, demo mode unaffected. *(session 2: 2/3 — spot-led-pump + stealth-spot-accum done; basis-anomaly needs basis history, deferred)*
- [x] Backtest gate run; UI badges ONLY for passing detectors; failing ones recording-only. *(session 3: spot-pump PASSES ×1.79 → SHIPPED (insight + 現 badge); spot-accum FAILS ×0.54 → recording-only.)*
- [x] Results block appended to this spec. *(sessions 1–3)*

## 陷阱 / Do-NOT
- rubik 5req/2s is SHARED with the OI cold path — never run the spot-taker pool concurrently with the OI pool (sequence them), and keep conc=2/500ms.
- Do NOT trust rubik units across coins (README:77 — the DOGE/PEPE unit inconsistency); taker-volume is only ever used as a RATIO (buy share), never absolute.
- Do NOT ship a badge on intuition — ×1.3 + robustness or it stays recording-only. Write the numbers down.
- Spot kline pagination: OKX returns newest-first (same as perp, okx.ts:203-240) — reuse the existing reversal logic, don't re-derive.
- Coins without spot listings must not enter the candidate spot fetch (filter by S1's spot ticker map).

## Results — Session 1 (數據層), 2026-07-05

Data layer only (spec 拆 session 1 = 數據). Steps 1–2 + candidate wiring done; detectors / recording-meta / backtest / gate / UI = session 2. typecheck 過。

**Implemented**
- `okx.ts` `getSpotCandles(base, ccy, tzShift)` — thin reuse of perp `getCandles` with `${ccy}-USDT` (same pagination + newest-first reversal); null on no-pair / fail.
- `okx.ts` `getSpotTakerBuyShare24h(base, ccy)` — rubik `taker-volume?instType=SPOT&period=1H`, rows `[ts, sellVol, buyVol]`, `buy/(buy+sell)` over last 24 rows; ratio-only, null on fail.
- `types.ts` `Coin`: `spotCandles?`, **`spotVolume?`** (spec gap: `Candle` carries no volume but spot-vol-z needs it), `spotTakerBuyShare24h?`.
- `okx.ts` `fetchLiveCoin` — detail view attaches all three when a spot pair exists.
- `okx.ts` `runRollingScan` — candidate spot pool AFTER the OI + LS rubik pools (taker shares the rubik budget), conc=2/500ms, cap `SPOT_CAND_BUDGET=30`/sweep. Candidates = 早期蓄力-flagged ∪ prioritized ∪ `strength≥70`, spot-listed only.

**Verified (live OKX, fetchLiveCoin end-to-end)**
- BTC: spotCandles/spotVolume 576/576, times ascending, OHLC sane, taker buy share 0.490, basis −0.046. 48h spot-vol sum $597M ⇒ ~$298M/24h vs ticker `spotVol24h` $258M — units cross-check ✓.
- SOL: 576/576, taker 0.493, basis −0.062. ~$53.5M/24h vs ticker $57.8M ✓.

**Honest notes / carried to session 2**
- "strength top-20 of sweep" is approximated by a per-batch `strength≥70` proxy — the streaming batch loop has no global sweep ranking mid-stream; a true top-20 needs a post-sweep pass (fold into the recording pass in session 2).
- Candidate spot data attached to the batch `Coin` is currently **dropped at `toLite`** (no consumer until the session-2 detector/recording pass) — the scan makes the fetches but nothing persists them yet. If session 2 is not imminent, consider gating the scan pool to avoid the per-sweep load.
- `pinned` proper isn't threaded into `runRollingScan`; `priority` (recently-viewed) is used as the pinned-ish seed.
- Detector 3 (basis-anomaly) needs basis **history** (z-score vs recorded/intra-session basis) → belongs with the R1 recording layer in session 2, not a single-sweep computation.

## Results — Session 2 (detectors + recording), 2026-07-05

Steps 3 (detectors, 2/3) + 4 (recording meta) done, **recording-only** (`SPOT_SHIPPED=false`). Backtest `--spot` mode + gate + UI = session 3. typecheck 過。3-lens 對抗式覆核全部 **CONFIRMED**（predicate 數學/單位、gating+null-safety+demo、recording 接線+backward-compat+scope；zero issues）。

**Detectors (`interpret.ts`)**
- `buildCtx` +4 spot 欄位: `spotVolZ` (15m spot 量 z vs 前 24h，同 perp volZ 數學), `spotVolRatio` (近8h 均量 / 前40h 均量), `basisPct`, `spotBuyShare` — 全部 null 除非候選帶 spotCandles/spotVolume（demo/純永續 no-op）。
- `spotLedPump`: `ret4h≥0.02 ∧ |oi4h|<1.5 ∧ spotVolZ≥2 ∧ basisPct≤0.05`。
- `stealthSpotAccum`: `|ret4h|<0.01 ∧ spotVolRatio≥1.5 ∧ spotBuyShare≥0.55 ∧ |oi4h|<2`。
- `SPOT_SHIPPED=false` gates 兩個 DETECTORS entry（過 gate 先出 UI；spot-led-breakout 舊估版暫時保留）。
- export `spotSignals(coin)` → `[pump01, accum01, basis01]`；basis01 恒為 0（需 basis history，留 session 3）。

**Recording (`recording.ts` + `recorder.ts`, App.tsx 唔使改)**
- `SweepMeta` 加 optional `spotSignals?: Record<sym, [0|1,0|1,0|1]>`；`buildSweepMeta` 加 optional 第4參數（backward-compatible）。
- `recorder.ts` onBatch: 由 full `Coin`（有 spotCandles）喺 `toLite` 之前算 `spotSignals`，per-sweep map 入 `buildSweepMeta`。App 只有 CoinLite → App 側 spotSignals 留 session 3（需 scan.ts 穿 full Coin；recorder 係 24/7 主來源已覆蓋）。

**Verified (live OKX)**
- `spotSignals(BTC/SOL/DOGE)` = `[0,0,0]`（平盤,冇 pump/accum;DOGE buyShare 0.442<0.55），無 throw、非 null（都有 576 spotCandles）。
- `buildSweepMeta` 正確 embed：`{"type":"sweep-meta",…,"spotSignals":{"BTC":[0,0,0],…}}`。
- `recorder --once` 撞到 `KILL file present`（24/7 recorder kill switch 開住）→ 未出到真 sweep line;上面 plumbing check 行同一條 code path。resume 先會錄到（yaobi-resume.cmd）。

**Carried to session 3**
- `backtest.ts --spot` mode (`spot-pump`/`spot-accum`) + `--spot-volz`/`--spot-basis`/`--spot-buyshare` flags + v3 cache bump + 跑 gate（×1.3 lift + ±25% robustness）。過 gate 先 flip `SPOT_SHIPPED` + 出 badge/insight。
- basis-anomaly（第3 detector）+ App 側 spotSignals。

## Results — Session 3 (backtest `--spot` mode + gate), 2026-07-05

`backtest.ts` 加 modes `spot-pump`/`spot-accum` + flags `--spot-volz`/`--spot-basis`/`--spot-buyshare`/`--spot-ratio` + v3 cache（optional spot 1H series: spotClose/spotVol/spotTaker）。喺 1H 歷史 series 重構讀法（eval ≠ live 15m,同窗以小時計,粗 bar）。typecheck 過。

**Gate（full universe, 114 spot-listed 幣, ~37d @1H）**
| mode | signals | hit | base | lift | coins firing |
|---|---|---|---|---|---|
| spot-pump (t10/h24) | 463 | 17.3% | 9.6% | **×1.79** | 76/114 |
| spot-accum (t10/h24) | 174 | 5.2% | 9.6% | ×0.54 | 58/114 |
| spot-accum (t15/h48) | 169 | 4.7% | 9.3% | ×0.51 | 58/114 |

**Robustness ±25%（spot-pump）**: volz1.5 ×1.70 · volz2.5 ×1.90 · basis0.0375 ×1.77 · basis0.0625 ×1.80 — 全部 > ×1.15 floor。✓

**Ablation（×1.61 教訓 — 係現貨定純動能?）**
| variant | lift | meanRet@24h |
|---|---|---|
| full (spotVolZ≥2 + basis≤0.05) | ×1.79 | +0.3% |
| momentum-only (ret4h+oi4h) | ×1.27 | −0.7% |
| +spotVolZ≥2 only | ×1.83 | +0.4% |
| +basis≤0.05 only | ×1.24 | −0.7% |

→ **spotVolZ 係因果驅動**（純動能過唔到 gate 且負期望）;basis inert 但 pre-registered → 保留（唔准睇完結果先落）。

**判定**
- **spot-pump 過 gate**：×1.79 ≥ ×1.3,±25% robust（×1.70–1.90),現貨數據驅動（非動能/selection-noise),廣度 76/114,正期望。比被否嘅 ×1.61 更強更穩。
- **spot-accum 唔過**（×0.54,差過 baseline）→ 維持 recording-only。
- 3-lens 對抗式 skeptic:零 blocker。look-ahead 乾淨（無未來洩漏,baseline apples-to-apples);非 outlier/clustering;保留 pre-registered basis;誠實「排序參考」framing（hit-rate lift 非利潤,meanRet@24h 得 +0.3%);單一 ~37d 窗 = 一個 regime（caveat,final promotion 前想要 forward/live 交叉確認）。

**Ship 決定（owner 拍板:出）**：spot-pump 已 **SHIPPED** — `SPOT_PUMP_SHIPPED=true`,詳情頁 `spot-led-pump` insight（帶「回測 lift ×1.79,排序參考,非進場訊號」caveat）+ screener 「現」badge（`.sp-badge`,綠 bull tint,`toLite.spotPump` 經 `spotPumpFires` gated,只候選幣有現貨數據先會著)。stealth-spot-accum `SPOT_ACCUM_SHIPPED=false` 維持 recording-only。驗證:typecheck + forced-positive harness（spotPumpFires/toLite.spotPump=true、interpret 出 spot-led-pump bull p8)、平盤 6 幣 negative path 乾淨。browser render 未做（另一 session 佔住 5173,唔郁 shared config)。

**仲未做**：basis-anomaly（第3 detector,需 history);App 側 spotSignals;screener-badge scan 接線（若出）;regime/forward 交叉確認。

## 2026-07-21 H1 evidence update

統一逐月 archive-universe audit 將 Spot pump（6,552 events，matched lift ×1.20，net −0.51%）同 Spot accumulation（2,900，×0.95，net −0.31%）列為 `historical-fail`，唔再屬等待 recordings。Organic spot proxy / True spot-led 係同一個細 cohort（27 events / 16 coins，×1.65，net +0.77%）並列 `historical-pass` 候選；只可交 forward holdout 覆核，唔自動改 badge／通知。完整數字見根目錄 H1 audit。

用戶其後拍板：現貨 badge 維持 OFF；Strategy Lab 產品面只顯示真實語義 `spot-led-v1` 候選，`organic-spot-v0` 留做內部 proxy control。兩者只收 shadow，唔入 paper／通知。
