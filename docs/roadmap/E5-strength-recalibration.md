# E5 — 強度重校準(setup 導向,對齊參考訊號)

**層級**: 第5層 自我進化 · **工作量**: M · **依賴**: **E4 ≥15 條 logged signals** + P1(OI 數據可信先好郁 OI 權重)+ R3(change1h/f24h 入 schema,setup 成份先 backtest 得到)

## zh-HK TL;DR
ARX 2026-07-05 攤開咗個問題:我哋強度係**反應式**(郁完先高分),老詹係**前瞻式**(蓄勢期已經 81)。時間線:13:47 我方 52 / 老詹 13:56 出 81;我方要到突破後 17:06 先摸到 66 頂。用戶講得啱 — 強度需要重諗,而老詹訊號正好做校準基準。但校準唔等於抄:老詹分數本身都要先過 E4 嘅 forward-return 檢驗,證明佢 81 係有 alpha 先值得追。改公式一律過 gate,唔准憑感覺調權重。

## Context (verified facts)
- 現行公式(analyze.ts:265-272):`50 + 24·squash(oi4h/5%) + 16·squash(ret4h/6%) + 14·buyShare項 + 10·(0.5-pos)·2 + 8·squash(volZ/2) - 14·funding懲罰`。
- 點解 ARX 蓄勢期得 52:oi4h 項凍結喺 0(P1 問題;真數係 -6.8%,用真數仲會**再扣分** — 公式獎「OI 升」,但妖幣起動前段往往係「OI flush 完喺低位回穩」);ret4h/volZ 蓄勢期天然接近 0;唯一加分係 buyShare 0.796 同中性 pos。即係話:**呢個公式結構上唔可能喺蓄勢期俾高分**,唔係參數問題,係成份問題。
- 老詹 81 嗰刻嘅客觀特徵(recordings):funding -0.04(空方付費)、OI 縮 -11% 後回穩、buyShare 0.796、價格喺 8h 底部區間、BB 收斂中(見 S6)。呢啲全部係 setup 特徵,現行公式一項都冇獎。
- 強度嘅現有下游:`>70` 係 M3 策略對照 tier(ROADMAP #6)、screener 排序、S2 候選幣揀選(okx.ts,strength≥70 proxy)— 改分數會扯動呢三度,gate 要包埋。
- README 承諾:「強度與階段為示範性評分」(ROADMAP 尾行免責句)— 重校準後照樣保留呢個 framing。

## Design (decided)
- **目標重定義**:強度 = 「setup 質素 + 確認程度」兩節棍,而唔係純動能。候選新成份(全部由已有數據衍生,零新 fetch):
  1. OI 位置項:獎「OI 由 48h 高回落 ≥X% 後、近 6h 回穩/回升」(⚡ 嘅 flush 邏輯泛化,配 P1 真數);懲罰「OI 4h 暴增 >20%」(而家淨係 riskFlag,analyze.ts:401)。
  2. funding 項雙向化:而家只罰過熱(>0.03);加「funding ≤ 0 且價穩」獎勵(軋空燃料,同 interpret.ts:352 funding-flip-negative 同源)。
  3. squeeze 項:S6 勝出定義做一個 0-1 成份(S6 未 ship 就 placeholder 0)。
  4. 保留 ret4h/volZ/buyShare 確認項,但權重下調,令「未郁但 setup 齊」都上到 65-75 帶。
  5. 散戶多頭過擠懲罰:老詹【上車準備】ADA 卡自報風險「散戶多頭過擠」,我方無對應項(analyze.ts:399-404 只有過熱/追高/滯漲/枯竭)。pre-register 呢個成份,但**明講 blocked on S4a(LS-ratio 收集)** — 有 LS 數據先實現,冇就 placeholder 0,唔准偷步。
- **老詹「上車準備」映射即係本公式嘅理據**:成份 1(OI flush 回穩)+ 成份 2(funding≤0 獎)其實就係老詹「核心」線嗰四段可回測嘅 leg(OI健康增加、負費率、主動買盤),我方 `Signals` booleans(analyze.ts:392-397)一路有計,只係從來冇入強度公式。E4 收到嘅老詹 boarding 訊號就係校準呢幾個成份權重嘅彈藥。**注意可回測性受 R3 gate**:mildRise 個 change1h 未入 recording schema 前,呢類 setup 過唔到 backtest(見 R3),所以本公式嘅 backtest 關(下面第 1 關)實際依賴 R3 先做得。
- **校準方法**(唔係 curve-fit):E4 logbook 對半分 train/holdout。目標函數係排序性,唔係逐點追 81:(a) train 組老詹訊號時刻,我方新強度分佈要顯著右移(中位數 ≥65);(b) 同 sweep 隨機幣 baseline 分佈保持中位 ~50 不變(唔准通脹);(c) holdout 組重現 (a)(b)。
- **Ship gate(三關全過先換公式)**:
  1. Backtest:`strength>70` 事件喺 ~37d 1H harness 嘅 +10%/24h lift,新公式 ≥ 舊公式,且 ≥ ×1.2。
  2. Holdout 校準達標(上段)。
  3. Shadow 對照:新舊公式並行寫入 recordings(臨時欄或 sweep-meta)行 2 星期,M3 式對照 `>70` tier 正反手 P&L,新 ≥ 舊。
- 三關任何一關落敗 → 記錄數字,公式唔換,最多將個別成份降級做 interpret 讀數。

## Steps
1. `analyze.ts`:新公式做 `computeStrengthV2`,flag 切換,舊公式唔刪(shadow 期兩條都計)。
2. recordings:sweep-meta 加 `strengthV2` map(照 spotSignals 模式)供 shadow 對照,唔郁 RecCoin schema。
3. `scripts/ref-eval.ts`(E4)加 `--strength-v2` 欄,對 logbook 重跑出 train/holdout 報告。
4. `backtest.ts` 加 `--mode strength --formula v1|v2`(1H series 上重算兩版強度,報 `>70` lift)。
5. 三關數據齊 → owner 拍板換唔換;結果貼底。

## Verification
- typecheck;ref-eval train/holdout 報告 + backtest lift 表 + 2 週 shadow P&L 表齊備。
- ARX 案例 sanity:新公式喺 13:47 嘅分數(期望 65-75 帶)同 17:06 嘅分數都要合理 — 蓄勢高分**唔可以**以突破後失分做代價(兩節棍要接得上)。

## Acceptance checklist
- [ ] V2 成份全部 pre-register 喺呢份 spec(改成份 = 改 spec 先)。
- [ ] train/holdout 分割誠實(按訊號時間先後分,唔准隨機抽 — 避免同一隻幣訊號洩漏)。
- [ ] 三關 gate 數字貼底,落敗照貼。
- [ ] 換公式時 README「示範性評分」句 + M3/S2 下游行為同步覆核。

## 陷阱 / Do-NOT
- **樣本少(15-30 條)**:只做權重層面校準,唔准加超過 4 個新成份,唔准逐條訊號調參。
- 老詹強度唔係 ground truth — E4 先驗佢 forward return;佢自己都唔準嘅話,校準目標降級做「我方強度要喺佢訊號時刻 ≥ 中位」就算,唔好硬追 81。
- squeeze 成份等 S6 gate 結果,唔准偷步。
- 唔准為咗蓄勢加分而拆走 funding 過熱懲罰 — 過熱懲罰係防追高,兩樣嘢唔衝突。
- Shadow 期間 UI 繼續顯示 V1 — 用戶見到嘅數唔准中途轉軚。
