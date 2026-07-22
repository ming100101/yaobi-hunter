# S6 — BB squeeze 蓄勢偵測(backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1(bbPctile 已在 v2 recordings),P1 建議先行(squeeze+OI 組合要食真 OI)

## zh-HK TL;DR
ARX 2026-07-05 突破前 15m BB 明顯收窄,老詹 app 喺 13:56 出「蓄力加倉」訊號(強度 81 @0.2121),我哋 44 分鐘後 14:40 先由量Z 7.37 追認突破。BB squeeze 係有 hint 價值。但**實測落閘**:現有 `volatility-squeeze` 讀數(interpret.ts:589-598,gate `bbPctile ≤ 0.1`)喺 ARX 成日**一次都唔會開** — 佢全日 bbPctile 最低得 0.566,13:47-14:19 徘徊 0.75-0.88。原因係 48h percentile 窗包埋 06:30 插水嘅大帶寬,靜市窄 bar 又攤薄排名。肉眼見到嘅 squeeze 係「波動事件後急速收斂」,唔係「48h 最窄」。所以呢個 spec 唔係調參,係 pre-register 一族 squeeze 定義去 backtest sweep,邊個過 gate 邊個先出街。

## Context (verified facts)
- 現有讀數:`volatility-squeeze`(interpret.ts:589-598)`bbPctile≤0.1 ∧ volZ≤-0.3 ∧ |change1h|<0.8`,info tone p6,無 gate 無 badge。
- bbPctile 定義:48h 窗內當前 BB(20,2) 帶寬嘅百分位(interpret.ts buildCtx ~162-174;featureVector 同式 analyze.ts:172-183),v2 recording idx15(recording.ts:15-16),即係**歷史數據已經儲緊**,eval-rec 可以直接翻舊帳。
- ARX 落閘數據(recordings 2026-07-05):bbPctile 全日 min 0.566(10:20 短暫),13:47=0.838、14:19=0.751,突破 bar 14:40=0.954;同期 funding 錄得 -0.0119 → -0.04(12:01 起,空方畀錢),OI 由 48h 高 1.038M 縮到 927k(-11%)再 V 型重建。
- ⚡ 嘅結構盲點(同一 case):⚡ 要求觸發時 OI 仍然 flush ≥8% 兼 24h base range ≤6%(analyze.ts:31-36),ARX 突破前 range 6.8%,OI 又喺觸發後 2 個鐘內反彈穿返 48h 高 — 「插水→築底→OI V 型重建突破」呢個形態 ⚡ 結構上捉唔到。S6 就係去填呢個窿。
- Backtest harness 接位:mode parse `backtest.ts:109-112`,per-bar 訊號 dispatch `:393`,breakout predicate `:440`,spot-pump `:468`,summary `:650-662`。1H 歷史 series,cache `backtest-data/`。
- Gate 先例:⚡ ×2.04 shipped;spot-pump ×1.79 shipped;spot-accum ×0.54 recording-only;taker-share ×0.67 否決(README:53-57)。

## Design (decided)
**Pre-registered squeeze 定義族**(全部喺 backtest 1H series 上實現,sweep 揀勝者,唔准睇完結果加新定義):
- **D1**(baseline,即現有讀數):48h 帶寬 percentile ≤ 0.10。
- **D2 收斂比**:bwNow / max(bw, 近 8h) ≤ 0.35 — 捕捉「事件後急收」,ARX 型。
- **D3 TTM 式**:BB(20,2) 完全喺 Keltner(20, 1.5×ATR) 之內。
- **D4 短窗 percentile**:近 8h 窗內帶寬 percentile ≤ 0.15。

**兩段式**(squeeze 本身無方向,唔准淨 squeeze 出訊號):
1. `squeeze-setup`(watchlist tone,同 蓄 同級):D? ∧ 方向前置條件(`funding ≤ 0` 或 `oi4h ≥ 0`〔P1 之後係真數〕∧ `buyShare4h ≥ 0.5`)。
2. `squeeze-breakout`(trigger):setup 喺近 6 個 1H bar 內成立過 ∧ close 破 setup 期間高位 ∧ volZ ≥ 1.5(同 ⚡ 觸發哲學一致 — S2 教訓:quiet setup alone ×0.77,trigger 先有料)。

**Ship gate**(同 S2):lift ≥ ×1.3 ∧ ±25% robustness > ×1.15,fail 就 recording-only。setup 同 breakout 分開報數 — 預期 setup 單獨過唔到,breakout 先係主菜。

## Steps
1. `backtest.ts`:加 `--mode squeeze`,flags `--sq-def D1|D2|D3|D4`、`--sq-thresh`(各定義主閾值)、`--sq-confirm funding|oi|both`。1H series 上實現四個定義(D3 要 ATR — 由已 cache 嘅 1H OHLC 計,唔使新 fetch)。
2. 跑 gate(結果貼落呢份 spec 底部):
```sh
npm run backtest -- --mode squeeze --sq-def D1 --target 10 --horizon 24
npm run backtest -- --mode squeeze --sq-def D2 --target 10 --horizon 24
npm run backtest -- --mode squeeze --sq-def D3 --target 10 --horizon 24
npm run backtest -- --mode squeeze --sq-def D4 --target 10 --horizon 24
# 勝者 → setup-only vs setup+breakout ablation → ±25% robustness → target 15 / horizon 48 交叉
```
3. 順手用同一 predicate 覆核 ARX 2026-07-05:勝出定義應該喺 10:00-14:30 HKT 之間亮 setup(如果連 ARX 都唔亮,寫低,唔好屈個定義去遷就單一 case — 佢係 motivating example,唔係 fitting target)。
4. 過 gate 先做 live 端:`interpret.ts` 加 `squeeze-setup`/`squeeze-breakout` 讀數(照 DETECTORS 現有 object shape),`SQUEEZE_SHIPPED` const gate UI;現有 `volatility-squeeze` 讀數若被 D? 取代就退役(留 code,gate false)。
5. Recording:唔加 RecCoin 欄(schema 紀律)— bbPctile idx15 已夠 eval-rec 離線重算 D1/D4;D2/D3 需要帶寬 series,喺 sweep-meta 加 `squeeze01` flag(照 spotSignals 模式,recording.ts:64)。

## Verification
- typecheck;backtest 四個定義 lift 表 + robustness 表貼底。
- ARX 案例覆核結果寫低(亮/唔亮 + 邊個時段)。
- Live:forced-positive harness(臨時降閾值)確認讀數渲染 + 唔影響 demo mode。

## Acceptance checklist
- [ ] 四定義 backtest 齊數,勝者 robustness 過關先 ship。
- [ ] setup 單獨 vs +breakout ablation 有報數。
- [ ] 唔過 gate → recording-only,UI 零改動。
- [ ] 結果 block 附 ARX 覆核。

## Results — 2026-07-06(gate 完成,D3 shipped)

**Gate(114 幣 $2M-$150M Binance-listed,~37d @1H,+10%/24h MFE,cooldown 24h,confirm=either)**

| def × stage | n | hit | base | lift | coins |
|---|---|---|---|---|---|
| D1 breakout | 319 | 17.2% | 12.4% | ×1.39 | 105 |
| **D2 breakout** | 42 | 21.4% | 12.4% | **×1.73** | 31 |
| **D3 breakout** | 539 | 17.6% | 12.4% | **×1.42** | 113 |
| D4 breakout | 562 | 16.2% | 12.4% | ×1.31 | 115 |
| D1-D4 setup(單獨) | 276-2290 | — | — | **×0.81-0.97 全部 ≤ baseline** | — |

Setup 單獨落敗完全符合 pre-registration 預期(⚡ 先例 quiet-setup ×0.77)— **squeeze-setup 唔出任何讀數,recording-only**。

**Robustness ±25%**

| 變體 | D2 | D3 |
|---|---|---|
| def-thresh −25% | **×0.58(n=14)— FAIL** | ×1.29 ✓ |
| def-thresh +25% | ×1.53 | ×1.33 ✓ |
| volZ −25% / +25% | ×1.70 / ×1.64 | ×1.36 / ×1.39 ✓ |
| recent 4h / 8h | ×1.30 / ×1.50 | —(未跑,headline 定義非此參數敏感) |

**D2 判死**:headline ×1.73 企喺 42 個訊號嘅刀鋒上,thresh −25% 崩到 ×0.58 — 正正係 ×1.61 selection-noise 嘅款,照 pre-registered 規則 **recording-only,唔准 ship**。D1 robust(×1.25-1.34)但每欄都輸 D3;D4 headline 貼地(×1.31)全面被 D3 壓制,略過。

**D3 跨窗**:t15/h24 ×1.31 ✓ · t10/h48 ×1.23 · t15/h48 ×1.21(48h 窗轉弱但正)。P&L framing(t10/h24,n=532):long winRate 55.1%,mean +1.24%/signal vs baseline −0.09%。

**Confirm ablation(報數,唔改型)**:conf-none 兩個 def 都好過 either(D2 ×1.85、D3 ×1.54);**funding≤0 leg 今個窗口係負貢獻**(D2 conf-funding ×0.93);conf-oi 最強(D2 ×2.10 但 n=27)。照 S2「pre-registered 唔准睇完結果拆 leg」先例,ship 型態維持 canonical(either),拆 leg 問題交 E1 用新窗數據重驗。

**ARX 2026-07-05 覆核(Step 3,零調參)**:D3 setup 喺 13:00 HKT 亮(老詹 13:56 蓄力加倉之前一個鐘),**D3 breakout 14:00 開火**(1H 收 0.2186,量Z 2.9;15m 實錄突破 14:40 @0.2221),到頂 0.2395 = +9.6%。D1/D2/D4 喺 pre-breakout 盤整全部唔亮 — 順帶證實咗「percentile 定義被 flush 大帶寬污染」嘅假說。誠實一筆:我原先估 D2 係「ARX 型」,錯 — D2 喺 ARX 一次都冇開,真 ARX 型係 D3。

**判決**:**squeeze-breakout(D3,kt=1.5,confirm=either,recent 6h,volZ≥1.5)SHIPPED** — `SQUEEZE_BREAKOUT_SHIPPED=true`,detail 帶「回測 lift ×1.42,排序參考,非進場訊號」caveat,bull p7,無 screener badge(insight-only,照 spec Step 4)。**舊 volatility-squeeze 讀數退役**(`VOL_SQUEEZE_RETIRED=true`,佢個 metric = D1-setup ×0.85 反預測,ARX 案例又零命中)。

**Implemented(live 端)**
- `interpret.ts` `computeSqueeze`:1H aggregation 上鏡像 backtest bar-for-bar(BB20/Keltner/ATR、confirm either、recent-6、volZ≥1.5);Ctx 加 `sqzSetup`/`sqzBreakout`;`squeezeSignals(coin)` export(唔理 ship flags 照計)。
- eval≠live 差異(照 ⚡/S2 caveat class):oi-confirm leg 用 coin oi series(P1 後 warm 幣 = store-fresh)+ 上升燭量佔比代替 rubik taker share。
- `recording.ts` SweepMeta 加 `squeezeSignals?`(**sparse** — 只記非零幣,353 個全零 entry 會谷爆檔案);`buildSweepMeta` 第 5 參數。
- `recorder.ts` 每 sweep 全幣計 squeeze flags 入 sweep-meta — setup 段嘅全部證據流,供 E1 重驗。
- 驗證:typecheck;合成 harness 6/6 PASS(breakout 亮+讀數渲染、coil→[1,0]、setup 讀數唔出街、肥帶→[0,0]、舊讀數已退役;仲確認咗突破 bar 上 setup 自然熄 = 設計行為)。recorder 已用 S6 build 重啟。
- **首個 live sweep(07-06 09:37 HKT)**:sweep-meta 正常錄入 sparse squeezeSignals — 75/353 幣 setup、10 幣 breakout(LUNA/PIEVERSE 齊亮 [1,1])。設定密度注意:21% setup 遠高於 backtest 平均 bar-rate,合理解釋係星期日清晨全市場低波動(成個市場都壓緊),但要用之後幾日 recordings 覆核密度分佈 — 若持續咁高,D3 喺靜市 regime 嘅選擇性會打折(E1 檢查項)。

**Caveats(誠實聲明)**:單一 ~37d 窗 = 一個 regime;MFE 用 bar 高位屬樂觀;universe 逐 run 由 live 24h vol 重篩(±1 幣漂移);confirm-funding leg 本窗負貢獻(E1 必檢);t≥48h 窗 lift 轉弱(×1.21-1.23)— 呢個係 24h 級數嘅訊號。

## 陷阱 / Do-NOT
- **唔准**用 ARX 單一 case 調閾值 — 佢只負責提出假說,gate 由全 universe backtest 判。
- bbPctile 喺突破後會即刻彈上 ~1.0(帶寬爆開)— squeeze-breakout 條件要用「setup 曾經成立」而唔係「當刻仍 squeeze」,唔然永遠捉唔到觸發 bar。
- D3 嘅 ATR 用 1H bar 計就好,唔好額外 fetch 5m 歷史(backtest-data cache 冇)。
- 免費 API 約束照舊:全部指標由已有 K 線衍生,零新 endpoint。
- 強度公式唔郁(E5 嘅事);squeeze 讀數 tone 最多 info/bull p6-7,唔准僭越 ⚡。

## 2026-07-21 H1 evidence update

D3 用完整逐月 archive universe 重跑 19,213 events / 682 coins / 181 days：10%×24h matched lift ×0.87、net −0.21%、1/6 positive folds、bootstrap L95 −0.56%，分類 `historical-fail`。舊單窗 ship 結論保留作歷史紀錄；唔再以等待 recordings 描述 D3，但今次冇自動改 live badge／通知。D2 原有 robustness failure 不由本輪結果改寫。

用戶其後拍板：D3 detail insight OFF；`squeezeSignals` setup／breakout flags 繼續 recording，公式同 schema 不變。
