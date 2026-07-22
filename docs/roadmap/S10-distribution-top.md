# S10 — 派貨/頂部拒絕(distribution-top,SHORT,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1 + P1 · 用戶 2026-07-06 要求:偵測「拉盤到差不多、派貨緊」嘅短方向 fire signal(做空準備 alert,唔係自動落單)

## zh-HK TL;DR
project 首個 SHORT 方向 detector family。目標:妖幣拉完之後嘅頂部結構(雙頂 reject、新高背離、量能高潮反轉、過熱滯漲)。共同前置限「拉過 + 喺頂區」嘅幣 — 妖幣獵手用例係摸妖幣個頂,唔係全市場亂空。**Harness 空隙**:outcomeAt 嘅 hit 一直只計向上 MFE;但 `mae = lo/entry−1` 已存在(backtest.ts:756)— top mode 只需將 hit 改為 `mae ≤ −target/100` + hoursToHit mirror 睇 low,其他 mode 行原 code path 零漂移。過 gate:badge + Telegram 短卡(🔻 做空準備)+ **paper S 臂**(鏡 A 短梯,用戶拍板)。

## 反 overfit 協議(執行前已生效)
1. 定義族同閾值跑前凍結(下表),唔准事後調參。
2. Ship gate:**−10%/24h(mae)lift ≥ ×1.3** ∧ 全部 ±25% cells > ×1.15 ∧ cross-target(−15%/24h、−10%/48h)> ×1.15 ∧ **meanRet@24h < 0**(短方向期望值)∧ n ≥ 20。
3. T1-T4 pairwise 同 bar 重疊照報;below-baseline def 冇 flags(S7 先例)。
4. 全 cells 照登包括落敗。S10 全死 → 唔起 S 臂、唔起短卡,如實報告。

## Pre-registered 定義族(凍結於 2026-07-06,gate 未跑)
全部 1H series。共同前置:`ret24h ≥ +15%` ∧ `pos24 ≥ 0.8` ∧ 觸發 bar `volZ ≥ 1.5`。

- **T1 雙頂拒絕**:hPrev = max(high[i−24..i−3]);`|high[i]/hPrev − 1| ≤ 1%` ∧ `close ≤ high×0.99` ∧ 陰燭(close ≤ open)。重試前高失敗。
- **T2 新高背離拒絕**:`high[i] > max(high[i−24..i−1])`(新 24h 高)∧ 上影 ≥ 50% of range ∧ `oi4h ≤ −1.5`(價新高、OI 走緊 — mirror 現有 oi-divergence-high + upthrust 兩讀數)。
- **T3 量能高潮反轉**:climax bar i−1:`volZ ≥ 2.5` ∧ `pos24 ≥ 0.85`;trigger bar i:`close < low[i−1]`(收穿 climax bar 低)。
- **T4 過熱滯漲**:`funding ≥ 0.015` ∧ `funding[i] > funding[i−8]`(升緊)∧ `ret4h ≤ +1%`(推唔郁)。mirror 現有 funding-overheat + absorption-stall。
- 閾值 provenance:全部搬自 interpret.ts 現成 generic reads 嘅慣例值(upthrust 0.55 影線 round 到 0.5、climax 2.5、funding-overheat 0.015、oi-divergence −1.5)— 冇一個 fit 落任何樣本。

## Gate 計劃
1. `backtest.ts`:`--mode top`、`--top-def T1..T4`、`--top-ret24 15`、`--top-pos 0.8`、`--top-thresh`(0 = per-def default:T1 1.0% / T2 0.5 / T3 2.5 / T4 0.015);hit/hoursToHit 短方向化(上述);warmup 34 bar。
2. T1-T4 × t(−)10/h24 → 勝者:ret24 ±25%(11.25/18.75)、pos ±25%(0.6/0.95,上限 clip 預先聲明)、def-thresh ±25%、volZ ±25%、cross −15%/24h、−10%/48h。
3. 過 gate → interpret mirror(`computeDistributionTop`)+「派貨頂部」bear 讀數(next 文案寫明做空準備)+ flags + 短卡通知 + paper S 臂(`LADDERS.S = tp[0.96,0.92,0.85] sl 1.03`,鏡 A 可比);唔過 → 非 below-baseline 記 flags 等 E1。

## Results — 2026-07-06(gate 完成,全族 recording-only)

**Gate(150 幣,~37d @1H,−10%/24h 向下 MAE,cooldown 24h)**

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| T1 雙頂拒絕 | 6 | 66.7% | ×6.31 | **+2.0%** | n<20 → recording-only |
| T2 新高背離拒絕 | 3 | 33.3% | ×3.15 | +16.6% | n<20 → recording-only |
| T3 量能高潮反轉 | 0 | — | — | — | 零 fire(前置太窄 or 呢個窗冇呢種頂) |
| T4 過熱滯漲 | 0 | — | — | — | 零 fire |

**判決:唔 ship、唔起 Telegram 短卡、唔開 paper S 臂** — n floor 6/3/0/0 冇統計。前置(ret24≥15 ∧ pos24≥0.8 ∧ volZ≥1.5)喺 37d 窗入面得 9 個時刻成立 — 妖幣頂部呢種形態本身就少。

**重要觀察(n=6,只係 hypothesis 級)**:T1 六單有四單 24h 內插穿 −10%(hit 66.7% vs 基準 10.6%),**但 meanRet@24h 係 +2.0% 正數** — 即係插完會彈返:短倉掂到 −10% 唔走、揸到 24h close 出反而蝕。如果將來過 gate,呢個 pattern 支持「短倉 TP 要快落袋」嘅出場設計(鏡 A 快梯,唔係 hold)。T2 meanRet +16.6% 更極端(3 單入面有單反手爆上)— **摸頂做空喺妖幣度係接火棒遊戲**,呢個就係點解要 gate。

**Implemented(recording-only)**:`backtest.ts --mode top`(T1-T4 + 向下 MAE hit/hoursToHit,舊 mode 零漂移)+ pairwise overlap;`interpret.ts` `distTopSignals` flags(1H mirror);recorder sweep-meta `topSignals` sparse。E1 逐月重驗,n 夠 20 + 準則全過先解鎖短卡/S 臂(spec 準則不變)。Synthetic mirror 驗證 PASS。

## 陷阱 / Do-NOT
- **短方向讀數唔係落單指令** — UI/通知一律寫「做空準備」,T1/T2 落地必須申報 paper 短倉未計 funding 成本(妖幣負費率時空倉收費率,正費率時空倉賺 — 兩邊都唔計,申報偏差方向不定)。
- pos ±25% 上限 clip 0.95(1.0 冇意義)— 預先聲明,唔算調參。
- 觸發 bar volZ ≥ 1.5 對 T3 係 confirm bar(i)嘅要求,唔係 climax bar — 凍結如此。
- M1 長 book(A/B/C)嘅數學一個 bit 都唔准變 — S 臂係獨立 driveBook 方向分支。

## 2026-07-21 H1 evidence update

T1–T4 已有六個月完整歷史，全部分類 `historical-fail`，不再係「n<20／等 E1」。Events 為 111／69／24／47；10%×24h matched lift ×0.88／×1.24／×0.97／×1.09。雖然個別 net 或 fold 為正，冇一項通過整套固定 gate；short card／paper S 臂仍保持關閉。

## 2026-07-22 remediation v2

舊 T1–T4 規則同失敗結論不變。新研究先用 Jan–Mar discovery 喺五個預先固定 broad filters 中揀出 `T1 + reversal-confirmed`，再鎖死規則驗 Apr–Jun：48 events／42 coins／38 days，10%×24h matched lift ×1.63，after-cost/funding +2.90%，2/3 正月份；四個 robustness cells 最低 lift ×1.47。規則要求完成 1H 已由 24h 上升轉為 1h 回落、位於 24h range 上 35%，quantity OI 4h 不跌。只加入 `top-t1-reversal-v2` forward shadow；短卡、paper S 臂、badge、Telegram 全部仍關閉。

## 2026-07-22 frozen July holdout

凍結上述 `reversal-confirmed` 規則後，以 2026-07-01..20 daily archive 做獨立 post-selection holdout。完整結果只有 7 events／7 coins／7 UTC days，10%×24h matched lift ×0.96、after-cost/funding +2.53%、worst cross-cell lift ×0.00、bootstrap L95 −3.21%。因未達預註冊 10 events／10 coins floor，分類為 `insufficient-sample`；不可宣稱 pass 或 fail，保持 forward shadow，短卡／paper／badge／Telegram 仍然關閉。
