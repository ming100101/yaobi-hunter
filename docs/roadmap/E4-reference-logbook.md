# E4 — 參考訊號 logbook(老詹訊號對照)

**層級**: 第5層 自我進化 · **工作量**: S/M · **依賴**: R1(對照靠 recordings)

## zh-HK TL;DR
用戶訂閱咗一個參考訊號源(下稱「老詹」,Telegram 頻道,protected)。2026-07-05 ARX 一役,老詹 13:56 出「蓄力加倉」強度 81 @0.2121,我哋同刻強度 52、regime A,要到 14:40 先確認突破。想學佢、想校準自己,第一步唔係抄公式(佢公式係黑盒),係**起一本 logbook**:每逢老詹出訊號,人手記低,自動 join 返我哋 recordings 嘅同刻特徵同事後回報。累積 ≥15 條之後,E5 先有校準彈藥,同時亦都量度到老詹本身準唔準(佢都要過我哋嘅誠實統計,唔係盲拜)。

## 老詹訊號方法解剖(2026-07-05 ARX 樣本,由 screenshot 錄入)
訊息格式(每欄照錄,logbook schema 由此而來):
- 類型:🔑 蓄力加倉(推斷仲有其他類型,見到就記)· 方向 LONG · **強度 81**
- 價格 0.2121;dashboard 另有「進場 0.2129」chip
- TP 梯:TP1 +10% / TP2 +25% / TP3 +50%(絕對價 0.23331 / 0.265125 / 0.31815)
- 硬 SL -15%(0.180285)
- 出場:TP1 出 30% · TP2 出 30% · TP3 出 35% · 留 5% 夢想倉
- 敘事欄:節奏「第一筆上車區,先照風控小心接」/ 盤面「盤面轉強中,還是要等價格確認」/ 風險「無明顯風險」
- Dashboard chips:強度 81 · 盤面轉強 · 只做多 · 風控優先 · 紀律執行
- 圖表 panels:價格(EMA20/50)· 成交量 · 合約持倉(OI 4h +6.5%)· 資金(Funding -0.0172%)· 綜合分數(強度線,歷史軌跡)

同刻我方 recordings 對照(佢出訊號時我哋見到啲乜):px 0.2124、強度 52、regime A、volZ -0.32、buyShare 0.796、bbPctile 0.838、funding -0.04(空方付費)、OI 由 48h 高縮 -11% 後開始回穩。**注意佢 OI 4h 報 +6.5% 而我哋原始 oiUsd 同窗係 -6.8%** — 佢數據源好可能係 Binance(唔同交易所 OI 唔同),對照時計"方向"好過計絕對值。

## 第二型解剖:【上車準備】(2026-07-05 HEI + ADA 樣本,已 multi-agent 驗證)
- **格式**同【蓄力加倉】一致(同一 TP 梯 10/25/50、硬 SL -15%、出場 30/30/35+5% 夢想倉),但「核心」線列咗四個條件:「1h 溫和抬升 / OI 健康增加 / 主動買盤健康 / 費率未過熱(或負費率軋空燃料)」。
- **關鍵驗證發現:呢四段 = 我哋 `analyze.ts` 已經計緊嘅 `Signals` booleans**。1h溫和抬升↔`mildRise`(analyze.ts:394)、OI健康增加↔`oiHealthy`(analyze.ts:395)、主動買盤↔`buyHealthy`(analyze.ts:396)、負費率↔interpret.ts `費率轉負`(interpret.ts:352)。ADA 風險線「散戶多頭過擠」我哋**冇對應 riskFlag**(analyze.ts:399-404 得過熱/追高/滯漲/枯竭),而且佢要 LS-ratio 數據 → blocked on S4a。
- **點解唔起 S7 composite detector**(對抗覆核判定):composite 靠 `mildRise` 而 `mildRise` 要 `change1h`,但 `change1h` **唔係 recording 欄**(schema 得 change24h idx10 / ret4h idx11)→ 過唔到 backtest gate → IRON RULE 之下唔可以 ship。兩條可回測嘅 leg(oiHealthy+buyHealthy)喺 ADA 兩日入面只有 07-05 12:46-17:22 之間 co-fire 過 10 次,其餘時段零次 — 樣本太細唔可以定 EV;flagship 負費率 leg 喺 ADA 樣本 fire 0 次(ADA 成個窗 funding 座喺 +0.01% 基準正費率,另有十幾 row 0.0094,fNow 從未轉負 — 唔係精度或 detector 問題,係呢個樣本根本冇負費率情境;真有情境嗰單係 HEI -0.1972%,但 HEI 冇 recordings)。所以呢個 insight 唔起 detector,拆返落 E4(收數)+ E5(setup 成份,gated)+ R3(補 change1h/f24h 令未來可 backtest)。
- **HEI 覆蓋窿**:HEI 零筆 recordings — `getUniverse` 硬性要 Binance USD-M 永續(okx.ts:285 `if (!bnBases.has(b)) continue;`),HEI 係 Binance Alpha/現貨類,冇 USD-M 永續。**老詹會叫一批我哋掃唔到嘅幣**。決定:唔准拆呢個 gate(佢 load-bearing,validated 訊號全靠 perp features);改為 E4 記低 HEI 類 signal(spot-class row,價格 forward-return 用 OKX 免費 spot OHLC 計),另喺 S1/S2 開 OKX 現貨層獨立 gate。

## 2026-07-06 批次新情報(8 條,全部實 ts,logbook 已達 15 條 = E5 門檻)
- **新梯形規則:「TP1 後止損移至開倉價」**(breakeven)— 之前三條 message 冇呢句;已同步入 M4 B 臂(`beAfterTp1`,起錶第 0 日補正)。
- **試用版分層**:footer 明寫「試用版只給簡易訊號與基本節奏。更完整的進出場、加倉與撤退提醒會放在正式群」— 我哋見到嘅係閹割版訊號流,加倉/撤退時機喺正式群。對照時要記住呢個селection:試用版可能特登揀靚 case。
- **強度 81 叢集**:8 條入面 7 條係 81(另一條 72)。連同之前 ARX/ALLO 都係 81 — 佢個「強度」好可能係近乎常數嘅 marketing 數字,唔係連續評分。E5 校準前要先驗呢點(若強度無變異,就冇嘢可校準,E5 目標降級)。
- 覆蓋:LIT/YFI/SLX/FARTCOIN 喺我方 universe ✓;BAS/CLO/MAGMA/币安人生 ✗(後者 Alpha 類,symbol 待映射)。可量度樣本累計 8 個。
- 交叉引用:FARTCOIN 老詹 05:34 出【上車準備】;我方 S6 squeeze-breakout 喺 09:37 sweep 對 FARTCOIN 亮 [0,1] — 首個「佢早我哋幾個鐘」嘅雙邊記錄案例,S4d lead-time 分析嘅種子。

## 2026-07-06 第二批情報:試用群使用說明(倉位分級 + 風控框架)

老詹審核官 pinned message(screenshot 錄入),首次披露**訊號名稱 → 倉位 sizing 分級**:

| 訊號名稱 | 佢嘅描述 | 倉位 |
|---|---|---|
| 上車準備 | 發車預備,訊號更明確可正式看進場 | 小倉 |
| 接人 | 拉升後健康回踩,可補票 | 補倉 小倉 |
| 蓄力加倉 | 邊洗邊噴,數據越洗越強 | 加倉 |
| 跑車加倉 | 高信心加速段 | 正常倉 |
| 火箭加倉 | 最強級別,但波動也最大 | 正常倉 |

新 kind:**接人**(拉升後回踩補倉)、**跑車加倉**、**火箭加倉** — logbook `kind` 欄係自由字串,照記。分級語義入咗 `refSignals.ts` `KIND_SIZING`(UI/CLI 顯示用)。

**風控框架**(佢原邏輯,結構化轉述):
1. **止損一定遠** — 妖幣常要等啟動/埋伏/深洗,遇大盤(BTC/ETH)急跌會一齊踩;所以唔用緊停損。
2. **槓桿細 + 爆倉價=止損價** — 逐倉 3x/5x 開,爆倉價天然就係遠停損,倉位大小控制風險金額(3x ≈ −31%、5x ≈ −19%)。
3. **勝率論**:勝率保持五成以上就贏,因為妖幣行程 25-50%+(闊目標梯)。
4. **變體:全部設 8-10% 全止盈**,食第一段就走,勝率更高。
5. **大盤急跌警語**:BTC/ETH 或整體急跌時降低倉位、放慢進場,先等大盤止穩。

**點樣落地(本 project 處理)**:
- 分級表 = 參考資訊 → StrategyView 參考卡(標明出處,個人研究用)+ `KIND_SIZING`。
- 風控第 4 點係可量度主張 → **M4 C 臂**(TP +9% 全出、SL −20% = 5x 逐倉爆倉 proxy、timeout ×2),2026-07-06 起錶,同 A/B 同場對照 — 佢話「勝率更高」,一個月後數字答。
- 數學註記(誠實對照用):C 臂 TP +9% / SL −20% 要勝率 >69% 先打和(未計費用/timeout)— 佢「勝率更高」嘅主張要贏到呢個門檻先算成立。
- 第 5 點(大盤 regime)→ E3 BTC regime 標記嘅另一個動機,唔喺呢度做。
- 佢啲 sizing 分級**唔准**直接綁去我方訊號度做自動倉位 — 我方對應訊號(上車位↔上車準備)只係粗略映射,sizing 自動化係 T1 之後嘅事。

## Context (verified facts)
- kv 通道現成:GET/POST `/kv`(vite.config.ts:46 dev / server.cjs exe,kvFile.ts),`kvGet/kvSet` 由 signalLog.ts:2 同款用法,server-backed,過到 reload/exe 重啟。
- Recordings join 料:RecCoin 有 price/strength/regime/volZ/buyShare/bbPctile/funding/oiUsd 全套(recording.ts:13-17),15-min slot key。事後回報直接由後續 sweeps 嘅 price 計,唔使新 fetch。
- M3 已有 evalCore/歷史 P&L CLI 先例(strategyReport.ts, ROADMAP #6)— E4 嘅 CLI 照抄佢嘅讀 recordings 模式。

## Design (decided)
- **儲存**:kv key `ref-signals`,array of `{ts, src:'laodie', sym, side, kind, refStrength, px, tps:[...], sl, exits:[...], refHitRate?:{alerts, wins, bestPct, windowDays}, notes?}`。`refHitRate` 抄佢每張卡底嘅「30天內曾提醒N次·盈利M次·最佳+X%」footer — 佢自報嘅往績變成可審核數據,唔係擺設(見下 kill-criterion)。人手錄入(Telegram protected,冇 API 可自動化,免費約束照舊)。
- **錄入 UI**:設定 tab 加一個小 form(sym/側/強度/價/時間 必填,貼原文可選)。錄入即 kvSet。冇就 CLI fallback:`npm run ref-log -- --sym ARX --ts "2026-07-05 13:56" --strength 81 --px 0.2121 ...`。
- **對照 CLI**:`npm run ref-eval` — 每條 log:(1) 揀最近 slot 嘅 recordings row,dump 我方全套特徵 + 我方同刻強度 vs 佢強度;(2) forward returns +1h/+4h/+24h(**由 message ts 個 slot px 起計,唔准由附近靚位起錨** — 見陷阱);(3) 佢嘅 TP/SL 梯喺 15-min marks 上模擬(same 保守規則 as paper.ts:9-13,SL-first)→ 佢單訊號嘅名義 R;(4) **lead-time 欄**:老詹 fire 時間 vs 我方 live proxy(str≥60+regime-A,或 mapped booleans mildRise∧oiHealthy∧buyHealthy)喺同一幣第一次 fire 之間差幾多條 bar — 立刻睇到佢個「早」係真訊號定係早咗嘅 noise(實算例,def=str≥60∧regime A、HKT 日界:ADA 兩日 fire 17 次 — 07-04 嗰 11 次全屬同一晚 pump 嘅自相關樣本,07-05 嗰 6 次〔03:30/03:45/08:30/09:29/17:22/17:31〕全失敗,peak ≤+0.8%)。系統化版本係 S4d。輸出一張表,底行 aggregate:**老詹自報 hit-rate vs 我方實測 forward-return hit-rate**(同一批可見幣)、平均 forward return、我方同刻強度分佈、中位 lead-time。
- **種子數據**:兩條即刻入庫 —— ARX 2026-07-05 13:56【蓄力加倉】81 @0.2121(數字喺上面解剖段);ADA【上車準備】72 @**0.1852**(真 call price,mid-pump P-regime,風險線自報「散戶多頭過擠」)。ADA 呢條由佢真叫價 0.1852 計,post-call 高位只 +7.8%,**冇掂 TP1(+10%)** — logbook 第一條非 ARX row 就係一單老實嘅 miss,正好係 E4 要守嘅紀律。HEI【上車準備】77 @0.10991 作 `kind:'spot-class'` row 入庫(見覆蓋窿),feature 只有價(**先確認 OKX 有冇 HEI 現貨對** — 有就用 OKX spot OHLC,冇就人手 px-only 記),冇 OI/funding。**種子 ts 注意**:三條入面只有 ARX 有實 message ts(13:56)。HEI 卡面顯示下午 02:10 但日期未確認;ADA 條 message 根本冇帶 ts,0.1852 係由 recordings 價格反推(對應 07-04 ~23:00 HKT)。入庫時要問返用戶攞實際發佈時間,ts 未確認前 forward-return 欄標 provisional — 呢個正正係 anchor-provenance 規則嘅第一個實戰應用。

## Steps
1. `types.ts` 加 `RefSignal` interface;`src/lib/refSignals.ts` — load/save(kv)、`joinToRecordings(sig, lines)`(slot 對齊 + 特徵抽取,用 recCoinField)。
2. 設定 tab form(U1 未做嘅話就淨 CLI,唔好為 E4 起成個 settings tab — scope 紀律)。
3. `scripts/ref-eval.ts` + package.json script:讀 kv file + recordings dir(recordFile.ts:10-19),出對照表。
4. 錄入 ARX 種子條目,跑一次 ref-eval,結果貼底。

## Verification
- typecheck;ref-eval 對 ARX 種子條目輸出:我方同刻特徵同本 spec「解剖」段一致(即 join 邏輯啱)。
- 亂入一條假訊號(unknown sym / recordings 冇覆蓋時段)→ 報「無對照數據」而唔係 crash。

## E5 kill-criterion(E4 產出去 gate E5)
E5(強度重校準)嘅前提係「老詹有 alpha 值得校準」。但驗證發現佢**實際** ADA 叫價 0.1852 係追價、冇中自己個 TP1。所以立硬規:**ref-eval 累積 ≥15 條之後,若老詹由佢真叫價起計嘅 forward return 打唔贏同期 sweep-random baseline,E5 維持鎖住,老詹強度只當「描述性參考」,唔做校準目標**。呢條 operationalize 咗 E5 spec 入面「佢自己都唔準嘅話就降級」嗰句。

## Acceptance checklist
- [ ] kv schema(含 `refHitRate`)+ 錄入通道(UI 或 CLI)任一可用。
- [ ] ref-eval 出齊:同刻對照、forward returns、TP/SL 模擬 R、**lead-time**、**老詹自報 vs 實測 hit-rate**。
- [ ] 兩條種子入庫(ARX 蓄力加倉、ADA 上車準備)並驗證;ADA row 個 anchor px = message ts 個 slot px(=0.1852),人手核對過。
- [ ] HEI spot-class row 入庫(價格-only feature),ref-eval 唔會因為佢冇 perp 特徵而 crash。
- [ ] E5 kill-criterion 寫入本 spec + E5 交叉引用。
- [ ] README 加一句:logbook 係人手紀律,見訊號就記,樣本 ≥15 條先開 E5。

## 陷阱 / Do-NOT
- **Anchor 價 = message ts 個 slot px,永遠唔准由附近靚位起錨。** 教訓案例:ADA 由真叫價 0.1852 計係 miss(+7.8% 冇中 TP1);但若貪方便由早 8-9 個鐘嘅 base 0.1766 起錨就會「+13% 中 TP1」— 嗰個係事後揀嘅位,唔係佢叫嘅位。每條 row 都會遺傳呢個 bug,所以 acceptance 要人手核 anchor。
- 老詹訊號係**版權/私域內容** — logbook 只儲結構化欄位供個人研究,唔准原文轉發/公開。
- 唔准因為佢強度 81 就直接調自己公式 — E4 只收數,校準係 E5 過 gate 嘅事(仲要先過上面 kill-criterion)。
- OI 對照記住交易所差異(上面 +6.5% vs -6.8% 教訓),cross-exchange 只比方向。
- 時區:老詹 timestamp 係 HKT 顯示,入庫一律轉 epoch ms(convert 錯一個鐘,join 就廢)。
- 佢嘅 TP/SL 模擬同 paper.ts 一樣只有 15-min marks — 名義 R 係保守下限,表入面要註明。

## 2026-07-21 historical-evidence classification

`manual-external`: the protected Telegram reference source cannot be recreated
from Binance archives. Exchange prices can evaluate a manually supplied,
timestamped reference after the fact, but they cannot prove the original
message, publication time, deletion/edit history or delivery. E4 therefore
stays a manual provenance log and is never counted as archive-backfilled.
