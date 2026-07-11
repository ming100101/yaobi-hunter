# S9 — 增倉突破(OI-rebuild breakout,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1 + P1(OI 可信度)· Motivating case: CAP 2026-07-05(見 [S4d](S4d-latency-eval.md) case study)

## zh-HK TL;DR
CAP 覆盤證實嘅訊號集空隙:「flush → OI 重建 → 先突破」。⚡ 縮倉突破照定義唔 fire(analyze.ts:83-102 要求突破嗰刻 OI 仲喺縮倉狀態),但 CAP 喺 07-05 23:30 突破時 oi4h 已 +13~+25%(OI 重建晒)、volZ 4.96 — 之後 +14%。S9 = ⚡ 嘅互補 pattern:同樣係帶量突破 24h 高,但 OI 條件反轉(要求擴張中,而唔係縮緊)。過 gate 先有 badge/Telegram(用戶 2026-07-06 拍板:過 gate 就入通知);模擬盤 A/B/C book 照舊 ⚡-only(T1 時鐘可比性),S9 長倉入 book 係 post-gate 另議。

## 反 overfit 協議(執行前已生效)
1. CAP 一個樣本**只做假說生成**,唔准調參;gate 由全宇宙(~114 幣、~37d @1H)判。
2. 定義族同閾值喺跑任何 backtest **之前**凍結(下表);唔准事後調參。
3. Ship gate:+10%/24h lift ≥ ×1.3 ∧ 全部 ±25% robustness cells > ×1.15 ∧ cross-target(t15/h24、t10/h48)> ×1.15 ∧ meanRet@24h > 0 ∧ n ≥ 20。
4. 重疊檢查:vs ⚡(breakout mode)/ S6-D3 同 bar 重疊 >50% = 翻版,唔准 ship。
5. 全部 cells 照登包括落敗;below-baseline 嘅 def 連 recording flags 都唔要(S7 B1/B3 先例)。

## Pre-registered 定義族(凍結於 2026-07-06,gate 未跑)
全部 1H series。共同 trigger:`close[i] > max(high[i−24..i−1])`(突破 24h 高)∧ 觸發 bar `volZ ≥ 1.5`。oi4h = (oi[i]/oi[i−4]−1)×100。

- **R1 flush→rebuild**:過去 48 bar 內出現過 OI flush ≥8%(oi 高點先於低點、低 ≤ 高×0.92)∧ 而家 `oi4h ≥ +3`(重建中)。CAP 型全結構。
- **R2 淨增倉突破**:唔要求 flush — `oi4h ≥ +3` ∧ `ret4h ∈ [0, +6%]`(防直上追價)。
- **R3 R1 + 費率cap**:R1 ∧ `funding ≤ 0.02`(未過熱先算)。
- 閾值 provenance:flush 8% 直接搬 ⚡ 嘅 FB_FLUSH_PCT(analyze.ts:31);oi4h +3 係 interpret 現成 oi-up-price-up gate(≥2)加半級 round;ret4h cap 6% 搬 S7 反追價;冇一個 fit 落 CAP 數字。

## Gate 計劃
1. `backtest.ts` 加 `--mode rebuild`、`--rb-def R1|R2|R3`、`--rb-flush 8`、`--rb-oi4h 3`、`--rb-ret4h-cap 6`、`--rb-fund-cap 0.02`;warmup 54 bar;⚡/S6-D3 重疊率照 S7 pattern。
2. R1/R2/R3 × t10/h24 → 勝者:flush ±25%(6/10)、oi4h ±25%(2.25/3.75)、volZ ±25%、(R2:ret4h cap ±25%;R3:fund cap ±25%)、t15/h24、t10/h48。
3. 零調參 cross-check:CAP 07-05 23:00-00:00 時段邊個 def 亮(預期 R1/R3 亮;唔亮照登)。
4. 過 gate → interpret 1H mirror(`computeRebuildBreakout`)+「增倉突破」讀數 + sweep-meta sparse flags + Telegram;唔過 → 非 below-baseline def 記 flags 等 E1。

## Results — 2026-07-06(gate 完成,R1 SHIPPED)

**Gate(150 幣 $2M-$150M,~37d @1H,+10%/24h MFE,cooldown 24h)**

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| **R1 flush→rebuild** | 86 | 26.7% | **×2.60** | +0.3% | **SHIPPED** |
| R3 R1+費率cap | 80 | 23.8% | ×2.31 | +0.5% | recording-only(R1 子集,唔另 ship) |
| R2 淨增倉 | 133 | 15.0% | ×1.46 | +0.3% | recording-only(過主 gate 但非 winner) |

**R1 robustness(全部 > ×1.15 floor,最差 ×1.83)**:flush 6/10 → ×2.78/×2.22 · oi4h 2.25/3.75 → ×2.27/×2.67 · volZ ±25% → ×2.47/×2.60 · t15/h24 ×3.64 · t10/h48 ×1.83。

**重疊**:⚡ 8/86(9%)· S6-D3 30/86(35%)— 唔係翻版。**medTTH 8h**(⚡ 型 lead-time)。

**申報(誠實)**:meanRet@24h 僅 +0.3% — lift 強但期望值薄,即係命中嗰啲升得勁、唔中嗰啲跌得都唔少;flush10 cell meanRet −1.5%(lift 照 ×2.22)。出場紀律比入場重要,insight 文案已寫明。單一 ~37d 窗;universe 150(vs S6/S7 gate 時 114 — loadUniverse 即時量篩,市場漂移所致,gate 自足唔受影響)。CAP 零調參 cross-check 未行(CAP 唔喺 backtest cache universe 頂 150 內)— E1 補。

**Implemented**:`backtest.ts --mode rebuild`(R1-R3 + knobs + ⚡/sqD3 重疊);`interpret.ts` `computeRebuildR1`(1H mirror,oi4h 用 store-corrected NaN fail-closed)+「增倉突破」insight(bull p8,lift + 期望值 caveat 入文案)+ `REBUILD_R1_SHIPPED` + `rebuildFires` + `rebuildSignals` flags;`toLite.rebuildBreakout` badge「增」;recorder sweep-meta `rebuildSignals` sparse + `CLASS_REBUILD` Telegram(rising edge,cd key `rb-notified-headless`,R4 photo card,header 📈 增倉突破)。Micro-scan 照舊 ⚡-only(75s 快掃唔 cover R1 — 申報)。**Synthetic mirror 驗證 9/9 PASS**(forced-positive fire、untrusted-OI fail-closed、flat 靜默)。真 rising-edge 卡要等首個真訊號(誠實 can't-verify)。

## Addendum — 2026-07-07 Binance 窗覆核(遷移後 out-of-sample)

定義凍結不變,喺 Binance 數據(296 幣 $2M-$150M、~37d @1H、基準 14.5%)重跑:

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| R1(shipped) | 385 | 33.8% | **×2.34** | +0.01% | **out-of-sample 企穩 ✓** 維持 shipped |
| R2 | 531 | 19.2% | ×1.33 | +0.01% | **升班覆核唔過**:oi4h-lo cell ×1.20 貼地、**t10/h48 ×1.07 < ×1.15 敗**(同 S11-W2 死法)→ 維持 recording-only |
| R3 | 360 | 34.2% | ×2.36 | +0.01% | R1 子集照舊唔另 ship |

申報:呢個窗 meanRet@24h 全家族 ≈ 0(基準命中率 14.5% 高、mean-revert 環境),R1 原 +0.3% 縮到 +0.01% — E1 要繼續睇。R2 覆核係應 EVAA 07-07 miss 而做(sanctioned 升班路徑),結果誠實:唔升。同日 S13-V2(處女增倉,EVAA 型)過晒全 gate 並 ship — 見 [S13](S13-virgin-expansion.md)。

## 陷阱 / Do-NOT
- 唔准因為 CAP 亮唔亮加減分 — 單一樣本係假說唔係評分表。
- oi4h 用 harness aligned rubik OI;live mirror 跟 interpret NaN fail-closed 規則(oiTrusted false ⇒ 全部 OI-gated 條件 false)。
- 突破 24h 高 = 必然喺區間頂,唔准加 pos24 cap(同 S7 相反 — 呢個 family 本質係突破追認,anti-vertical 由 ret4h cap 負責)。
