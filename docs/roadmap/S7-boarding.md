# S7 — 上車準備逆向工程(boarding,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: E4(樣本來源)· supersede 07-05「唔起 S7」決定(當時 2 樣本 + schema 缺欄;而家 6 樣本 + R3 落地 + S6 證明 gate 管線唔靠 recordings)

## zh-HK TL;DR
逆向工程老詹【上車準備】。E4 logbook 7 條種子提取(1H 狀態 + recordings 15m 對照)顯示佢贏嘅單全部由**非伸展位置**開火:ARX(93h 喺 EMA50 下,壓縮,負費率)、TRUTH(-11.6%/24h 恐慌後首彈,26% 波幅)、RPL(深跌 −13.5%/24h,EMA 收復後仍 pos24 0.17、未拉 — 實 ts 09:03 修正版;初版提取用咗錯 8h 嘅 provisional ts,撞啱影到 01:00 收復嗰刻)、ALLO(squeeze 突破 = S6 已覆蓋形狀);佢唯一可見 miss(ADA)就係喺 pos 0.95 追入。ts 確認後(04:29/04:32/08:50/09:03)px-match 方法對 ALLO/TRUTH 誤差僅 1-2 分鐘,圖表估算對 AIGENSYN/RPL 錯 8h — **provisional ts 嘅特徵提取必須當可疑**,呢單就係示範。**用戶核心要求:拉升前出訊號,拉完先出冇用** — 所以反追價前置係每個定義嘅結構性部分,且 harness 直接量 lead-time。真.盲區:TRUTH 型大波幅恐慌反轉,⚡(要 tight base ≤6%)同 S6(要窄帶)都結構上捉唔到。

## 反 overfit 協議(執行前已生效)
1. 7 個老詹樣本**只做假說生成**,唔准調參、唔准當 validation;gate 由 114 幣 ~37d 全宇宙判。
2. 本 spec 嘅定義族同閾值喺**跑任何 backtest 之前**凍結(同 S6 一樣;佢 robustness 殺咗 D2 證明呢招有用)。
3. Ship gate:lift ≥ ×1.3 ∧ 每個 ±25% robustness cell > ×1.15 ∧ 跨 target 合理;全部 cell 照登包括落敗。
4. 重疊檢查:報每個定義同 ⚡(breakout mode)/ S6-D3 squeeze-breakout 嘅同 bar 重疊率;**>50% 重疊 = 翻版,唔准當新訊號 ship**。
5. Lead-time:報命中訊號 fire→掂 +10% 嘅中位小時數。
6. 污染申報:樣本時刻喺 backtest 窗內(≤7 訊號 vs ~9 萬 bar);「3 揀 1」selection 偏差令勝者 headline 偏樂觀(S6 同款申報)。
7. 提取 caveat:1H containing-bar 收盤含訊號後數據(TRUTH ret1h +8.9% 大部分事後)— 觸發閾值嚟自 family 概念,唔係 fit 落樣本數字。

## Pre-registered 定義族(凍結於 2026-07-06,gate 未跑)
全部喺 1H series 實現;**反追價前置(全族共用):`ret4h ≤ +6%` ∧ `pos24 ≤ 0.7`**(pos24 = close 喺 24h high-low 區間位置)。觸發 bar 一律要 `volZ ≥ 1.5`(同 ⚡/S6 觸發哲學一致)。

- **B1 深跌首彈(capitulation first-impulse)**:`ret24h ≤ −8%` ∧ `pos24 ≤ 0.45` ∧ 本 bar `ret1h ≥ +2%`。捕捉 TRUTH/RPL 型 — 恐慌後第一支放量陽燭。留意佢**特登唔要求** tight base(⚡)或窄帶(S6)。
- **B2 EMA 收復(reclaim)**:連續 ≥48 支 1H bar 收喺 EMA50 之下 ∧ 本 bar 收上 EMA20(fresh cross,上支 bar 仲喺下面)。捕捉 ARX/RPL 型「長期被壓後首次企返上均線」。
- **B3 核心線 composite(佢文案嘅直譯)**:`ret1h ∈ (0.2%, 3.2%]`(mildRise @1H)∧ `oi4h ∈ (0.8%, 14%)`(oiHealthy)∧ taker buyShare4h > 0.55(buyHealthy)∧ `funding ≤ 0.02`(費率未過熱)。07-05 個 workflow 判過佢喺 recordings 回測唔到;harness 1H 上全部輸入齊,今次正式測。
- 閾值 provenance:B1/B2 數字係 round-number 慣例值(−8%/0.45/+2%/48h),B3 直接搬 analyze.ts:392-397 現成 gate — 冇一個係 fit 樣本得出。robustness sweep 各 ±25%。

## Gate 計劃
1. `backtest.ts` 加 `--mode boarding`、`--bd-def B1|B2|B3`、`--bd-ret4h-cap`、`--bd-pos-cap` + time-to-target 指標 + ⚡/squeeze 同 bar 重疊率。
2. B1/B2/B3 × t10/h24 → 勝者:閾值 ±25%、volZ ±25%、anti-chase cap ±25%、t15/h24、t10/h48。
3. 零調參 cross-check:ARX/ADA/TRUTH/ALLO 訊號時刻邊個定義亮(ADA 預期唔亮 — 佢過唔到反追價前置,嗰單本身就係 miss)。
4. 過 gate → interpret 讀數(insight-only)+ sweep-meta sparse flags;唔過 → recording-only flags 照錄,E1 新窗重驗。

## Results — 2026-07-06(gate 完成,B2 shipped)

**Gate(114 幣 $2M-$150M,~37d @1H,+10%/24h MFE,cooldown 24h,反追價 cap ret4h≤6%/pos24≤0.7)**

| def | n | lift | meanRet@24h | 判決 |
|---|---|---|---|---|
| **B2 EMA收復** | 48 | **×2.04** | **+3.9%** | **SHIPPED** |
| B1 深跌首彈 | 56 | ×1.31 | **−3.4%** | 死 — 接刀:lift 邊緣但期望值負(nochase ×1.52 一樣 −3.7%) |
| B3 核心線 composite | 11 | ×0.74 | +0.7% | 死 — **老詹卡面四句係文案唔係引擎**;07-05 唔起 composite 嘅判斷追溯驗證正確 |

**B2 robustness(全部 > ×1.15 floor,最差 ×1.40)**:below-h 36/60 → ×1.46/×2.34 · volZ ±25% → ×1.71/×2.15 · ret4h cap ±25% → ×1.67/×2.13 · pos cap ±25% → ×2.04(n=8)/×1.51 · t15/h24 ×1.40 · t10/h48 ×1.49。

**反追價 ablation(用戶核心訴求嘅因果驗證)**:有 cap ×2.04/+3.9%,冇 cap ×1.48/+2.0% — **「拉升前」約束本身就係 alpha 主源**,唔係裝飾。

**新資訊驗證**:同 bar 重疊 ⚡ 0/48、S6-D3 squeeze 7/48(15%)— 唔係翻版。**Lead-time:命中訊號中位 11h 先掂 +10%** — 真.拉升前。

**零調參 cross-check(誠實照登)**:B2 喺四個老詹樣本時刻**全部唔亮** — ADA 被反追價 cap 正確擋住(佢嗰單本身係 miss,設計如此);ARX/TRUTH/ALLO 唔中(1H volZ 唔夠或非 fresh cross;ARX 14:00 pos 0.75>0.7 邊緣)。**結論:我哋冇複製到老詹個 trigger** — 佢時刻冇一個可用 4-6 樣本釘死嘅共通機械形狀(佢有 Binance/Alpha/GMGN 外部源)。但獵佢過程產出咗一個同款行為、全宇宙自證嘅新 detector,而 ARX/ALLO 型時刻已由 S6-D3 覆蓋(ARX 14:00 有開)。

**Implemented**:`backtest.ts --mode boarding`(B1-B3 + 反追價 flags + time-to-target + ⚡/squeeze 重疊率);`interpret.ts` `computeBoardingB2` + 「上車位」讀數(bull p7,caveat 全文)+ `BOARDING_B2_SHIPPED`。**限制(誠實)**:B2 要 ~100 支 1H bar,scan 48h base 唔夠 — live read 係 **detail-view-only**(用 coin.long ~25d 1H);sweep-meta recording flags 延後(要 long-series plumbing),E1 重驗直接用 harness,唔靠 recordings。B1/B3 死得徹底,連 flags 都唔錄。

**申報**:3 揀 1 selection 偏差 → B2 真 lift 大概率低過 ×2.04(但全 robustness ≥1.40,離 floor 好遠);單一 ~37d 窗;n=48 中等;樣本時刻喺窗內(≤7/9 萬 bar,微)。E1 新窗必檢:B2 lift、pos-cap 細 n cell、老詹新樣本再對照。

## 陷阱 / Do-NOT
- 唔准因為某定義喺老詹樣本亮得多而加分 — 樣本係假說,唔係評分表。
- B2 嘅 EMA 喺 1H series 頭段唔穩(warmup ≥ 50+48 bar)。
- 反追價 cap 唔准事後放寬去遷就任何一個樣本(ADA 亮唔到係 feature 唔係 bug)。
- 老詹眞實方法未知(佢有 Binance/Alpha/GMGN 外部訊號源)— 我哋做嘅係「佢嘅可觀察形狀」嘅本地重建,唔係抄佢公式。

## 2026-07-21 H1 evidence update

B2 EMA20 reclaim 全市場六個月重跑 1,570 events / 560 coins / 173 days：10%×24h matched lift ×1.09、net −0.07%、3/6 positive folds、bootstrap L95 −0.64%，分類 `historical-fail`。舊細窗 ×2.04 結論保留作歷史紀錄；今次只改 evidence 分類，detail view 同其他 live 行為冇自動改。

用戶其後拍板：B2 detail insight OFF；B2／B2+quantity-OI／EMA control 繼續 forward shadow，但 Strategy Lab 明標 `H1 歷史失敗 · 影子`。
