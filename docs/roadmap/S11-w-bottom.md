# S11 — 雙底接人(W-bottom pullback entry,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1 · Motivating case: YFI/USDT 2026-07-06(老詹 09:27 @2006 call;10:50 / 13:20 兩個雙底係理想入場位,~3 支 1H bar 相隔)

## zh-HK TL;DR
老詹 method map「接人 補倉 小倉」(E4/refSignals KIND_SIZING)嘅機械版:拉升中嘅幣回調,做出雙底/假跌破回收,收復頸線 = 入場 hint。**防接刀前置係結構性部分**(S7 B1 深跌首彈 meanRet −3.4% 死咗嘅教訓:冇 trend context 嘅低位反彈係接刀)— W 底必須發生喺拉升 context 入面。過 gate 先有 badge/Telegram(用戶拍板);唔入 A/B/C paper book(⚡-only,T1 時鐘可比性),入 book 係 post-gate 另議。

## 反 overfit 協議(執行前已生效)
1. YFI 一個樣本只做假說生成;gate 由全宇宙判。
2. 定義族閾值跑前凍結(下表)。兩個凍結決定預先聲明(可計性/確定性,唔係調參):(a) trigger 距第二底 ≤6 bar(mirror S6 sqRecentH=6);(b) W2 volZ 凍結 1.25 = 概念範圍 1.0-1.5 中點,±25%(0.94/1.56)啱好掃晒成個範圍。
3. Ship gate:+10%/24h lift ≥ ×1.3 ∧ 全 ±25% cells > ×1.15 ∧ cross-target > ×1.15 ∧ meanRet@24h > 0 ∧ n ≥ 20。
4. 重疊 vs ⚡ / S6-D3 / S7-B2(佢都係 reclaim 類!)>50% = 翻版唔 ship。
5. below-baseline def 冇 flags;全 cells 照登。

## Pre-registered 定義族(凍結於 2026-07-06,gate 未跑)
全部 1H series。共同防接刀前置:`ret24h ≥ +10%` **或** `close > EMA50(1H)`(拉升 context — pullback-in-pump,唔係下跌趨勢執平貨)。local-min 定義:low[j] ≤ low[j±1]。

- **W1 經典雙底**:兩個 local-min j1<j2,相隔 ∈ [2,12] bar;`|low[j2]/low[j1] − 1| ≤ 1%`;頸線 = j1..j2 之間(嚴格)max high;trigger bar i(`i − j2 ≤ 6`):`close > 頸線` ∧ `volZ ≥ 1.5`。
- **W2 假跌破回收(spring)**:spring bar s:∃ local-min j1 ∈ [s−12, s−2],`low[s] < low[j1]` ∧ `close[s] > low[j1]`(插穿舊底但收返上面);trigger i = s+1:陽燭 ∧ `volZ ≥ 1.25`。mirror 現有 failed-breakdown-reclaim 讀數。
- **W3**:W1 ∧ `oi4h ≥ 0`(復測期間 OI 冇走)。
- YFI sanity:兩底 10:00/13:00 bar,相隔 3 ∈ [2,12] ✓。閾值 provenance:tol 1% 同 T1 雙頂對稱;sep 2-12 係「一日內嘅 W」慣例;冇 fit 落 YFI。

## Gate 計劃
1. `backtest.ts`:`--mode wbottom`、`--wb-def W1|W2|W3`、`--wb-tol 1`、`--wb-sep-max 12`、`--wb-recent 6`、`--wb-volz 0`(0 = per-def default);warmup 70 bar(EMA50 + W 窗)。
2. W1/W2/W3 × t10/h24 → 勝者:tol ±25%(0.75/1.25)、sep-max ±25%(9/15)、recent ±25%(4/8)、volZ ±25%、t15/h24、t10/h48。
3. 零調參 cross-check:YFI 07-06 10:50/13:20 時刻邊個 def 亮(唔亮照登 — 樣本係假說唔係評分表)。
4. 過 gate → `computeWBottom` mirror +「雙底接人」bull 讀數(文案掛老詹「接人 補倉 小倉」)+ flags + Telegram;唔過 → 非 below-baseline 記 flags 等 E1。

## Results — 2026-07-06(gate 完成,W2 死於 cross-target,全族 recording-only)

**Gate(150 幣,~37d @1H,+10%/24h MFE,cooldown 24h)**

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| W2 假跌破回收 | 707 | 14.3% | **×1.41** | +0.4% | **主 gate 過,但 t10/h48 ×1.14 < ×1.15 → 死於 cross-target**(S6-D2 同款) |
| W3 W1+OI | 1064 | 12.3% | ×1.22 | +0.3% | 唔過主 gate(×1.3) |
| W1 經典雙底 | 1364 | 12.2% | ×1.21 | +0.3% | 唔過主 gate |

**W2 robustness 全表(誠實照登)**:volZ ±25% → ×1.40/×1.44 ✓ · sepMax 9/15 → ×1.34/×1.37 ✓ · t15/h24 ×1.20 ✓(薄)· **t10/h48 ×1.14 ✗**。一格唔過就係唔過 — 邊界唔企硬,gate 就冇意義。

**解讀**:W2 嘅 edge 喺 24h horizon 真確(×1.34-1.44 穩),但去到 48h 幾乎消失(×1.14)— 反彈唔持久,同「接人 = 短線補倉」嘅概念一致,但凍結準則要求 48h 都企得住。E1 新窗重驗;如果新窗 t10/h48 企返 >×1.15,照準則可 ship。YFI 零調參 cross-check 未行(YFI 頂 150 universe 之外)— E1 補。

**Implemented(recording-only)**:`backtest.ts --mode wbottom`(W1-W3 + ⚡/sqD3/S7-B2 重疊);`interpret.ts` `wbottomSignals` flags(1H mirror;scan tier 只行 ret24h≥10% 分支 — EMA50 要 long series,B2 同款申報);recorder sweep-meta `wbottomSignals` sparse。Synthetic mirror 驗證 PASS(W1 fire + W3 = W1∧OI + flat 靜默)。

## 陷阱 / Do-NOT
- EMA50(1H) 分支要 ≥52 bar — live scan tier 得 48 支 1H(48h 5m 聚合),所以 scan/recorder tier 只行 `ret24h ≥ +10%` 分支(嚴格子集,申報);detail view(有 coin.long)先行齊兩分支。B2 同款限制,照樣申報。
- 防接刀前置唔准放寬去遷就任何樣本。
- W 底喺 15m 圖更精細,但 gate 喺 1H 行(harness 一致性);15m 版本係 E1 之後嘅另一實驗,唔准偷步。

## 2026-07-21 H1 evidence update

W1／W2／W3 六個月重跑全部 `historical-fail`。10%×24h matched lift ×1.09／×1.27／×1.09，net −0.38%／−0.22%／−0.31%，bootstrap 下界全負；W2 唔再標作等待 E1 recordings。任何新 15m 定義仍要另行預註冊，唔可用今次結果事後調參。

## 2026-07-22 remediation v2

舊 W1–W3 規則同失敗結論不變。Jan–Mar discovery 鎖定 `W2 + uncrowded-trend`，Apr–Jun 單次 validation 得 73 events／65 coins／41 days，10%×24h matched lift ×1.69，after-cost/funding +2.23%，3/3 正月份；四個 robustness cells 最低 lift ×1.52。confirmation 只讀完成 1H/as-of data：4h 回報 >0 且 ≤6%、BTC 24h 不跌、quantity OI 4h 介乎 0–10%、funding ≤0.01%。只加入 `wbottom-w2-uncrowded-v2` forward shadow；badge、Telegram、paper 同 tier map 仍關閉。

## 2026-07-22 frozen July holdout

凍結上述 `uncrowded-trend` 規則後，以 2026-07-01..20 daily archive 做獨立 post-selection holdout。結果 22 events／21 coins／12 UTC days，10%×24h matched lift ×0.48、after-cost/funding −3.68%、worst cross-cell lift ×0.48、bootstrap L95 −6.35%，固定 gate 明確失敗，分類為 `holdout-fail`。停止任何升班建議；badge／Telegram／paper／tier map 維持關閉，現有 shadow runtime 不由歷史報告自動改動。
