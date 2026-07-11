# S8 — 錨定 VWAP 收復確認(backtest-gated,重點係 ablation)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: —(用現有 K 線;A1/A2 疊 ⚡ 嘅 flush context,analyze.ts:47-77)

## zh-HK TL;DR
VWAP 完全食得起免費約束(由已有 K 線衍生,零新 API),而且有一個 EMA 俾唔到嘅維度:**量權重**。最有價值嘅版本唔係 rolling 24h VWAP(嗰個同 EMA 高度共線,幫唔到手),而係**錨定 VWAP(AVWAP)由 flush 低位起錨** —— 量度「接返呢轉反彈嘅人平均成本」,價 > AVWAP 即係中位接貨者有錢賺、上方浮籌少、突破乾淨。用法係 ⚡ / boarding 嘅**確認 filter,唔係獨立 trigger**(同 ⚡ quiet-setup-alone ×0.77、spot-pump momentum-only ×1.27 一樣嘅教訓)。**呢份 spec 個成敗關鍵唔係「VWAP 有冇 lift」,係「VWAP 喺 EMA20/pos 之上有冇增量 lift」—— 冇增量就係共線廢 feature,recording-only。** 出唔出 badge 由 backtest ablation 判,唔係由呢段邏輯判(taker-share ×0.67 就係憑感覺出嘢嘅反面教材,README:53-57)。

## Context (verified facts)
- **數據夠但要補一格**:OKX candle row 有 base 量(`r[6]` volCcy)同 quote 量(`r[7]` volCcyQuote),但 `getCandles` 而家淨係留 quote(okx.ts:325 `quoteVol = Number(r[7])`,push 落 `VolumeBar.value`,okx.ts:328),**base 量冇留**。精確 VWAP 要 base 量做權重(見 Design 數學)。
- **錨點現成**:`flushBaseContext`(analyze.ts:47-77)已經搵到 OI flush + 24h base(oiMax/oiNow/cMax/cMin),flush 低位/base 低位就喺呢個 context window 入面,AVWAP 直接由佢起錨,唔使另計。
- **indicators 有位擺**:indicators.ts 得 `ema`(:3-13)同 `bollinger`(:15-33),**冇 VWAP**,新增一個 `vwap`/`anchoredVwap` 放呢度。
- **可回測路徑 = harness,唔係 recordings**:recordings 冇存 VWAP,而且 AVWAP 要錨點 + 成條 K 線 series,單 sweep 快照回算唔到。但 `backtest.ts` 每幣攞齊歷史 K 線入 `backtest-data/`(同 bbPctile/ATR/S6 同一條路),所以 S8 喺 harness 上做得,唔使等 recordings。
- **Mode 接位**:backtest.ts:109-113 `--mode` enum(而家 setup/breakout/spot-pump/spot-accum);per-bar dispatch ~:393;⚡ breakout predicate ~:440;summary ~:650-662。
- **共線對手**:我哋已經有 EMA20/50、`pos`(8h 區間位置)、`devEma20`、bbPctile。VWAP 要證明佢**唔係**呢啲嘢嘅換皮先有價值。

## Design (decided)
**VWAP 數學**(俾 executor 用啱條式):
- 主式(精確、簡單)**AVWAP = Σ(volCcyQuote_i) / Σ(volCcy_i)** 由錨點到當前 = 全窗總 USDT ÷ 總幣量 = 真.成交量加權均價。**要留 base 量**:`getCandles`(okx.ts:316-328)加留 `r[6]`,`VolumeBar` 加 `base?: number`(或平行 array);backtest harness 個 candle 讀取同樣補。
- 副式(古典,如果想 per-bar typical-price 權重):`Σ(TP_i·V_i)/Σ(V_i)`,TP=(H+L+C)/3,V=base 量。兩條都要 base 量,主式先行。

**Pre-registered 候選(全部喺 backtest 1H series 實現,sweep 揀勝者,唔准睇完結果加定義):**
- **A1 — ⚡ + AVWAP filter**:喺 ⚡ 觸發(analyze.ts detectFlushBreakout)之上,**加要求** close > AVWAP(flush 低位)。測「加咗呢個 filter,⚡ 嘅 lift/precision 有冇改善」(少啲訊號但靚啲)。
- **A2 — 獨立 AVWAP 收復**:喺 flush-base context 內,close 由下穿上 AVWAP(flush)兼 volZ≥1.5。呢個比 ⚡ 嚴格嘅「破 base high」更**軟、更早**,有機會捉到 ⚡ 結構上捉唔到嘅 **V 型 OI 重建突破**(ARX 2026-07-05 個盲區,見 case-study;⚡ 要觸發時 OI 仍 flush,V-rebuild 過唔到)。
- **A3 — rolling 24h VWAP 收復(對照組)**:預期同 EMA 共線,**特登放埋去做 baseline**(似 S6 個 D1),用嚟證 AVWAP-from-anchor 先係有 edge 嗰個版本。

**Ship gate(三關,缺一不可):**
1. **Lift**:候選喺 ~37d 1H harness 嘅 +10%/24h lift ≥ ×1.3。
2. **Robustness**:錨點 lookback、volZ 閾值各 ±25%,lift 仍 > ×1.15。
3. **增量 ablation(最關鍵)**:對比 `EMA-only`(close>EMA20 + pos + devEma20,唔用 VWAP)vs `+VWAP`。VWAP 版 lift 必須**顯著高過** EMA-only 版,證佢帶獨立資訊。若 VWAP lift ≈ EMA-only,判定共線 → recording-only,唔出 UI(同 spot-pump 個 full-vs-momentum-only ablation 同一個判法,S2 spec)。
- 任何一關唔過 → 記數字,recording-only,唔出 badge/insight。

## Steps
1. `indicators.ts`:加 `anchoredVwap(candles, baseVol, anchorIdx)` 同 `rollingVwap(candles, baseVol, win)`,回 `SeriesPoint[]`。純函數,同 ema/bollinger 同 shape。
2. `okx.ts` `getCandles`(316-328)+ `types.ts` `VolumeBar`:留 base 量(`r[6]`)。backtest harness 個 candle 讀取同樣補 base(v? cache bump — 舊 cache 冇 base 量,要 refresh)。
3. `backtest.ts`:`--mode vwap-reclaim`(enum 加,:111),flags `--vwap-anchor flush|base-low|rolling24`、`--vwap-volz 1.5`、`--vwap-variant A1|A2|A3`。per-bar predicate 實現三個候選(A1 疊現有 breakout predicate ~:440)。
4. 跑 gate + 增量 ablation(結果貼落本 spec 底):
```sh
npm run backtest -- --mode vwap-reclaim --vwap-variant A1 --target 10 --horizon 24
npm run backtest -- --mode vwap-reclaim --vwap-variant A2 --target 10 --horizon 24
npm run backtest -- --mode vwap-reclaim --vwap-variant A3 --target 10 --horizon 24
# 勝者 → 增量 ablation:EMA-only vs +VWAP(同一觸發集,唯一分別係加唔加 VWAP 條件)
# → ±25% robustness(anchor lookback / volz)→ target 15 / horizon 48 交叉
```
5. 順手用勝出候選覆核 ARX 2026-07-05:期望 A2 喺 14:40 突破前後亮(⚡ 冇亮嗰單)。亮/唔亮 + 時段寫低(若連 ARX 都唔亮就照實報,唔好屈定義遷就單一 case)。
6. 過三關先做 live:`interpret.ts` / `analyze.ts` 加確認讀數,`VWAP_SHIPPED` const gate UI;fail 就留 code、gate false、recording-only。

## Verification
- `npm run typecheck`。
- indicators 單元 sanity:一段人手砌嘅 K 線,`anchoredVwap` 對得返手計 Σquote/Σbase。
- backtest 三候選 lift 表 + **增量 ablation 表** + robustness 表貼底。
- ARX 覆核結果(亮/唔亮 + 時段)寫低。
- Live(若過 gate):forced-positive harness 確認讀數渲染 + 唔影響 demo mode。

## Acceptance checklist
- [ ] base 量(r[6])留返(scan + backtest 兩邊),VWAP 用精確 Σquote/Σbase。
- [ ] 三候選 backtest 齊數,勝者做增量 ablation。
- [ ] **VWAP 版 lift > EMA-only 版**先可以 ship;共線就 recording-only。
- [ ] robustness(anchor/volz ±25%)過 ×1.15 floor。
- [ ] ARX 2026-07-05 覆核 + 結果 block 貼底。
- [ ] 唔過 gate → recording-only,UI 零改動。

## 陷阱 / Do-NOT
- **唔准淨憑「VWAP 有 lift」出 badge** — 一定要過增量 ablation 證佢喺 EMA20/pos 之上有嘢加。呢個係全份 spec 嘅命門。
- **唔准用 rolling 24h VWAP 當主打** — 佢大概同 EMA 共線,佢喺度只係對照組(A3)。有 edge 嗰個係 AVWAP-from-flush。
- VWAP 精確式要 **base 量**(volCcy, r[6]),唔可以攞 quote 量當權重再乘 typical price(會 double-count 價格,退化成 harmonic-mean 怪物)。
- AVWAP 係**確認 filter 唔係 trigger** — 收復本身無方向擔保,要配 volZ + flush-base context,唔准淨 VWAP 穿越就出訊號。
- VWAP 喺趨勢市 vs 盤整市 edge 唔同,單一 ~37d 窗過到都要 caveat regime(同 spot-pump 一樣,final promotion 前想要 forward/live 交叉確認)。
- 免費約束照舊:全部由已有 K 線衍生,零新 endpoint。base 量本身已經喺 OKX candle response 度,只係之前冇留。
- 唔郁強度公式(嗰個係 E5);S8 讀數 tone 最多 info/bull,priority 唔好僭越 ⚡。

## Results / verdict — ✖ 3-gate FAIL → recording-only, no ship (2026-07-07)

Harness built + backtested on the Binance 37d window. **No candidate ships.** All three
ship gates fail, and every above-baseline variant has **negative expectancy** — a stronger
disqualifier than the lift miss alone.

**Setup:** 149 small caps ($2M-$150M), ~37d @1H, 120,697 bars. Outcome +10%/24h. Baseline
hit rate **18.1%** (high — this window/target is pumpy, so lift is compressed for *everything*:
plain ⚡ breakout is only **×0.99** here, vs its OKX-era shipped ×2.04 at +15%/24h. Read all
lifts against that ⚡≈baseline reference, not against 1.0 in the abstract).

**Candidates — target 10 / horizon 24:**

| variant | n | hit | lift | meanRet@24h | overlap vs ⚡ |
|---|---|---|---|---|---|
| ref ⚡ breakout | 56 | 17.9% | ×0.99 | **+1.22%** | — |
| **A1** ⚡+AVWAP(flush) | 55 | 16.4% | **×0.89** | +0.96% | 55/55 (⊂ ⚡) |
| A1 twin ⚡+EMA20 | 56 | 17.9% | ×0.99 | +1.22% | 56/56 |
| **A2** AVWAP(flush) | 18 | 22.2% | ×1.23 | **−0.50%** | 7/18 |
| A2 AVWAP(base-low) | 11 | 18.2% | ×1.00 | −1.46% | 2/11 |
| A2 twin EMA20 | 26 | 19.2% | ×1.06 | −0.26% | 7/26 |
| **A3** rolling24-VWAP | 22 | 22.7% | ×1.26 | **−0.35%** | 5/22 |
| A3 twin EMA20 | 26 | 19.2% | ×1.06 | −0.26% | 7/26 |

**Gate 1 (lift ≥ ×1.3): FAIL.** Best central estimates A3 ×1.26 / A2-flush ×1.23 fall short;
A1 ×0.89 is below ⚡ itself.

**Gate 2 (robustness > ×1.15 across anchor/volz ±25%): FAIL.** A2-flush at t10/h24:
flush-hours 36→×1.84 (n=6), 60→×1.10 (n=20, meanRet −0.70%); volz 1.125→×1.16, 1.875→×1.58 (n=14).
Lift swings **×1.10–×1.84** on ±25% nudges and drops under the ×1.15 floor — the "did-not-survive-
robustness = selection noise" pattern the spec pre-registered against. High cells are n=6/14.

**Gate 3 (incremental ablation, +VWAP ≫ EMA-only): FAIL.** A1: AVWAP ×0.89 **< EMA20 ×0.99** —
VWAP is strictly worse than a plain EMA line. A2/A3 nominally beat their EMA twins (×1.23/×1.26 vs
×1.06) but on n≤22 with negative expectancy — and A3, the *control* expected to be EMA-collinear,
beating its own twin is itself evidence the gap is noise, not VWAP-specific information.

**Target-15 / horizon-48 cross:** ref ⚡ ×0.96 (meanRet +1.09%); A2-flush ×1.06 (meanRet −0.05%);
A3 ×0.84 (below baseline). The t10/h24 edge does not persist to another target → target-specific.

**ARX 2026-07-05 cross-check:** ARX is not a top-MFE signal for A1/A2/A3 — A2 did **not** cleanly
light up the ⚡-miss the spec hoped for. (No winner to promote anyway; check is moot for shipping.)

**Conclusion:** recording-only, UI zero change, no badge/insight/notify. Consistent with the honest-
stats IRON RULE and the taker-share ×0.67 precedent. The harness (`--mode vwap-reclaim`) is retained
so E1 can re-test on more data / other regimes — this is one 37d window, not a two-source confirmation
like S12. If a future window ever clears all three gates, Step 6 (live `anchoredVwap` wiring +
`VWAP_SHIPPED` gate) is ready to execute.

### Implementation notes / spec corrections (for future executors)
- **base vol index is `r[5]` on Binance, NOT the spec's OKX `r[6]`** (r[6] is closeTime). Stored as
  `Bar.bv = r[5] × mult` so `Σv/Σbv` lands in the ÷mult per-coin price space. `getCandles`/`VolumeBar`
  in the live scan were **left untouched** (ship-gated; only wire on a future pass).
- `DATA_VERSION` bumped **4 → 5** (base vol is a new cached field) → forces a one-time refetch of the
  backtest-data cache on the next run in ANY mode. Expected; the v4 Binance-migration bump did the same.
- `indicators.ts` `anchoredVwap`/`rollingVwap` take `(volume: VolumeBar[], baseVol: number[], …)` — the
  exact Σquote/Σbase needs quote volume, which lives on `VolumeBar`, not `Candle` (spec sketched
  `(candles, baseVol, …)`). Unit-verified via `npm run test-vwap` (exact Σq/Σb, not mean-of-ratios).
- Live wiring would also need `analyze.ts flushBaseContext` to expose the anchor bar (it currently
  returns `cMax` only, not the flush/base-low index); the harness computes its own anchor.

Files touched (gate phase, all ship-gated off the live UI): `scripts/backtest.ts` (mode + predicates),
`src/lib/indicators.ts` (pure fns), `scripts/test-vwap.ts` + `package.json` (unit sanity).
