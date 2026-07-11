# M4 — 老詹式出場梯對照臂(TP 階梯 + 硬 SL + 夢想倉)

**層級**: 第3層 錢的語言 · **工作量**: S/M · **依賴**: M1(paper engine),E4(梯形參數來源)

## zh-HK TL;DR
老詹方法入面最容易搬字過紙又最有價值嘅部分唔係入場,係**出場紀律**:TP1 +10% 出 30%、TP2 +25% 出 30%、TP3 +50% 出 35%、留 5% 夢想倉、硬 SL -15%。我哋而家 paper 用 +4/+8/+15%、SL -3%(paper.ts:17-24)— 兩套哲學完全唔同(我哋:淺利快走窄止蝕;老詹:闊目標深止蝕食大魚)。邊套喺⚡/我方訊號上真係賺多啲?唔使拗,開多一本虛擬帳同場對照,一個月後數字講嘢。呢個係 M3「正反手對照」精神嘅出場版。

## Context (verified facts)
- 現行 paper 梯(paper.ts:17-24):TP 1.04/1.08/1.15,SL 0.97,出貨 frac 0.5/0.3/尾數,mirror analyze() ExitPlan(analyze.ts:431-439,types.ts:25-33)。
- drivePaper 每 sweep 行一次,app/recorder 共用一本帳(paper.ts:3-13);marks 係 15-min sweep close,SL-first 保守規則。
- 老詹梯(E4 解剖,ARX 2026-07-05 樣本):+10%/+25%/+50%,出 30/30/35,留 5%,硬 SL -15%。同我哋一樣有 runner 概念(我哋 runnerPct 5,types.ts:32)。
- M3 已建立「同一訊號源、多策略並行對照」嘅先例同 UI 位(strategyReport.ts)。

## Design (decided)
- **B 臂**:`PaperState` 加第二本虛擬帳(同 startEquity、同入場訊號、同 mark 規則),唯一分別係梯形參數 `LADDER_B = {tp:[1.10,1.25,1.50], frac:[0.30,0.30,0.35], sl:0.85, runnerPct:5}`。A 臂(現行)一切不變。
- 兩臂食**完全相同**嘅開倉事件(⚡ 或現行 paper 入場邏輯)— 對照嘅係出場,唔准俾 B 臂偷入場優勢。
- timeout 規則:A 臂照舊;B 臂 timeout 拉長(闊目標要時間,建議 ×2)— 呢個係梯形哲學一部分,寫死喺 B config,唔係逐單調。
- UI:策略對照 tab 加一行 B 臂 equity/winrate/maxDD/avgR;detail 頁 ExitPlan 卡可切換顯示兩套梯(顯示用,唔影響帳)。
- **判定(一個月後)**:淨回報之外必睇 maxDD 同 R 分佈(B 臂 SL -15% 深,連環止蝕好傷;夢想倉長尾靠一兩單大魚 — 樣本少時中位數好睇過平均)。勝者成為 default 梯,敗者臂照跑(對照永續)。

## Steps
1. `paper.ts`:梯形參數由 const 抽做 `Ladder` config object;`PaperPosition` 加 `arm: 'A'|'B'`;drivePaper 開倉時兩臂各開一單(B 臂 size 同樣按 riskPct,獨立 equity)。
2. `types.ts`/kv:PaperState schema 版本升級,舊 state 遷移(B 臂由零開始,A 臂歷史保留)。
3. 策略對照 tab 加 B 臂行;CLI 歷史 P&L(M3)加 `--ladder B` 重放模式,用已有 recordings 對過去一個月先行回放兩臂(即刻有初步對照,唔使乾等 30 日)。
4. detail ExitPlan 卡:加「老詹梯」切換(顯示 +10/+25/+50/-15 絕對價,照 analyze entry 錨點計)。

## Verification
- typecheck;dev run 一個 sweep 後 kv 入面兩臂 state 並存,A 臂數字同升級前連續。
- CLI 回放:近 30 日 recordings 兩臂對照表輸出(equity 曲線、winrate、maxDD、avgR、樣本數),貼底。
- 邊界:B 臂 SL -15% 喺 15-min marks 嘅 gap-through 情況照 SL-first 保守規則(paper.ts:9-13)。

## Acceptance checklist
- [ ] 兩臂同訊號同 mark,只差出場。
- [ ] 舊 paper state 無損遷移。
- [ ] 30 日 recordings 回放對照表貼底。
- [ ] README/tab 註明:對照期內 default 梯不變,一個月實盤(虛擬)數據後先拍板。

## Results — 2026-07-06(engine + 回放 shipped;UI 行待)

**Implemented**:`paper.ts` ladder 參數化(`LADDERS.A/B`)+ `driveBook` 抽取;`drivePaper` 內部驅動 `state.armB` 子帳(同 marks/同 ⚡ edges,獨立 equity/positions/ledger/curve,獨立 MAX_OPEN)— **兩個 caller(recorder/app)零改動**。B 臂:TP 1.10/1.25/1.50、SL 0.85、出 30/30/35、5% 夢想倉(tp3 改 partial + `tookTp3`,moonbag 靠 SL/timeout 收)、timeout ×2。`paperStats` 改用累計 frac ≥ 0.999 判倉位完結(tp3 唔再係無條件終結)。舊 state 遷移:`armB` 缺 → 首個 sweep 起新帳,A 史零觸碰。

**Verified**:typecheck;`npm run test-paper` **23/23 全 PASS**(A 臂行為連小數位不變)。Recorder 已用 M4 build 重啟(07-06)— **B 臂時鐘由今日起行**。

**回放對照(誠實聲明:recordings 得 2.5 日,唔係 spec 假想 30 日)**:27 個 ⚡ edge,A 臂 mean −1.41%/trade(7/27 勝,多數 SL),B 臂 −1.72%(**幾乎全 open@end — 闊梯 + 96h timeout 喺短窗根本未解決,left-censored,無裁決力**)。呢次回放係管線驗證 + 基線快照;真判決 = live 雙帳 ≥1 個月。副產品:⚡ 週末表現差 — paper 層開始講真話。

**2026-07-06 梯形修訂(起錶第 0 日)**:老詹當日批次 message 披露新規則「TP1 後止損移至開倉價」— B 臂加 `beAfterTp1: true`(TP1 成交後 SL 跳上開倉價,剩餘 70% 唔會再變 −15% 輸家)。test-paper 23/23 照過(A 臂唔受影響),recorder 已重啟。判定日照計 08-06。

**待做**:策略對照 tab B 臂行 + detail ExitPlan 卡切換(UI,下手 session 或跟 U1);判定日 = B 臂起錶一個月後,睇 netRet/maxDD/中位 R(B 臂 SL −15% 深,連環止蝕好傷,樣本少時中位數行先)。T1 時鐘照舊以 A 臂為準。

**2026-07-06 加 C 臂(老詹試用群全止盈變體)**:同日試用群使用說明披露兩條風控規則 —「全部設定8-10%就全止盈,吃第一段就跑,那你勝率更高」+「止損一定都很遠…逐倉五倍開,爆倉價就是止損價」。可量度形式:`LADDERS.C = {tp 三檔併 1.09(8-10% 取中,tp3 branch 一 fill 全平), sl 0.80(5x 逐倉爆倉 proxy), timeout ×2}`。同 marks 同 ⚡ edges,獨立子帳 `armC`(pattern 照抄 armB,舊 state 首 sweep 起新帳)。test-paper 加 9 個 C 臂 case → **36/36 全 PASS**(A/B 連小數位不變)。誠實數學:+9%/−20% 要勝率 >69% 先打和 — 佢個「勝率更高」主張由對照帳裁決,判定日同 B 臂一齊睇。倉位分級表(上車準備→小倉 等)入咗 E4 method map + StrategyView 參考卡,唔驅動任何自動 sizing。

## 陷阱 / Do-NOT
- 唔准將 B 臂勝負同「老詹勁唔勁」混為一談 — B 臂測嘅係**出場梯**喺**我方訊號**上嘅表現;老詹訊號本身嘅質素係 E4 度量。
- 15-min mark 粒度對 +50% TP3 影響細,但對 -15% SL 嘅 gap 影響大 — 保守規則要 SL 優先,唔准樂觀。
- 兩臂共用 MAX_OPEN 上限會互搶額度 — 各自獨立 MAX_OPEN,等式先公平。
- T1 解鎖條件(M1 一個月正 P&L)以 **A 臂(現行 default)**為準,唔准中途轉用靚仔嗰臂 — 換 default 之後先重新計鐘。
