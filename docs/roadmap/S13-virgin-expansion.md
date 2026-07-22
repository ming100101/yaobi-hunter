# S13 — 處女增倉突破(virgin OI-expansion breakout,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1(recordings)+ P1(OI 可信度)· Motivating case: EVAA 2026-07-07(見下,只做假說生成)

## zh-HK TL;DR
EVAA 07-07 複盤證實嘅訊號集空隙:「零 flush 嘅純增倉擴張 + 帶量破 24h 高」。S9-R1 唔 fire 係定義正確 — 佢要求 48h 窗內「OI 高點先、之後 ≥8% 低點」(CAP 型冚倉重建),但 EVAA 嘅 OI 全日創新高(窗內 max 永遠係當下),flush shape 條件恆為 FALSE。S9-R2(唔要 flush)shape 啱但 gate 非 winner → recording-only,而且佢嘅 `ret4h ≤6%` 防追價 cap 將垂直延續段全部排除。S13 = 呢個空隙嘅 pre-registered 定義族:處女擴張(窗內冇 flush shape)+ 增倉中 + 帶量破高,anti-chase 由 oi24h/funding 變體試,唔用 ret cap。過 gate 先有 badge/Telegram(沿用 S9 用戶拍板先例:過 gate 就入通知)。

## 反 overfit 協議(執行前已生效,沿用 S9)
1. EVAA 一個樣本**只做假說生成**,唔准調參;gate 由全宇宙 backtest 判。
2. 定義族同閾值喺跑任何 backtest **之前**凍結(下表,凍結於 2026-07-07);唔准事後調參。
3. Ship gate(同 S9):+10%/24h lift ≥ ×1.3 ∧ 全部 ±25% robustness cells > ×1.15 ∧ cross-target(t15/h24、t10/h48)> ×1.15 ∧ meanRet@24h > 0 ∧ n ≥ 20。
4. 重疊檢查:vs ⚡ / S6-D3 / S9-R1 / S9-R2 同 bar 重疊 >50% = 翻版,唔准 ship。R1 重疊應為 0(定義互斥 — 有 flush 係 R1 前提、冇 flush 係 V 前提),≠0 即 code bug。
5. 全部 cells 照登包括落敗;below-baseline 嘅 def 連 recording flags 都唔要(S7 B1/B3 先例)。

## Pre-registered 定義族(凍結於 2026-07-07,gate 未跑)
全部 1H series。共同 trigger(S9 原文搬字過紙):`close[i] > max(high[i−24..i−1])`(突破 24h 高)∧ 觸發 bar `volZ ≥ 1.5`。oi4h = (oi[i]/oi[i−4]−1)×100;oi24h = (oi[i]/oi[i−24]−1)×100。

- **V1 處女增倉**:過去 48 bar 內 R1-flush shape **不存在**(冇「OI 高點先於 ≥8% 低點」— 即 R1 前提嘅補集,V∩R1=∅ by construction)∧ `oi4h ≥ +3`。
- **V2 V1+日級增倉**:V1 ∧ `oi24h ≥ +8`(過去 24h OI 淨增 ≥8% — 「有意義 OI 變動」幅度沿用 FB_FLUSH_PCT=8 嘅家族常數,冇新數字)。
- **V3 V1+費率cap**:V1 ∧ `funding ≤ 0.02`(R3 原封 provenance,未過熱先算)。
- 閾值 provenance:volZ 1.5 / oi4h 3 / flush-shape 8% / funding 0.02 全部係 S9 凍結常數;oi24h 8 重用 flush 幅度常數。**冇一個 fit 落 EVAA 數字。**
- 申報:V1 冇 anti-chase 條款(S9-R2 個 ret4h cap 正正係殺 EVAA 型延續段嘅嘢)— 追價風險由 gate 嘅 meanRet 同 MAE 判,唔預先加 cap。

## Gate 計劃
1. `backtest.ts` 加 `--mode virgin`、`--vg-def V1|V2|V3`、`--vg-oi4h 3`、`--vg-oi24h 8`、`--vg-fund-cap 0.02`;warmup 54 bar;⚡/S6-D3/R1/R2 重疊率照 S9 pattern。
2. V1/V2/V3 × t10/h24 → 勝者:oi4h ±25%(2.25/3.75)、volZ ±25%、(V2:oi24h ±25% 6/10;V3:fund cap ±25%)、t15/h24、t10/h48。
3. 零調參 cross-check:EVAA 07-07 09:00/12:00/17:00 HKT 三支 bar 邊個 def 亮(預期 V1 亮;唔亮照登)。
4. 過 gate → interpret 1H mirror + 「處女增倉」讀數 + sweep-meta sparse flags + badge + Telegram(獨立 class/cooldown);唔過 → 非 below-baseline def 記 flags 等 E1。

## Results — 2026-07-07(gate 完成,V2 SHIPPED)

**Gate(296 幣 $2M-$150M,~37d @1H Binance 數據,+10%/24h MFE,cooldown 24h,基準 14.5%)**

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| V1 處女增倉 | 754 | 32.8% | ×2.27 | +0.01% | recording-only(過 gate 但非 winner) |
| **V2 V1+oi24h≥8** | 516 | 39.9% | **×2.76** | +0.01% | **SHIPPED** |
| V3 V1+費率cap | 690 | 31.6% | ×2.19 | +0.01% | recording-only |

**V2 robustness(全部 > ×1.15 floor,最差 ×1.85)**:oi4h 2.25/3.75 → ×2.78/×2.83 · oi24h 6/10 → ×2.59/×2.98 · volZ ±25% → ×2.73/×2.80 · t15/h24 ×3.71 · t10/h48 ×1.85。

**重疊**:⚡ 0/516(0%)· **R1 0/516(0%,定義互斥 assert ✓)**· R2 166/516(32%)· sqD3 150/516(29%)— 唔係翻版。

**零調參 cross-check**:EVAA 07-07 於 09:00/12:00/16:00/17:00/18:00 HKT 全亮(spec 預期 V1 亮 ✓;09:00 = px 1.03,成條 +42% 腿之前)。

**申報(誠實)**:meanRet@24h 僅 +0.01% — 呢個 37d Binance 窗全家族都薄(S9-R1 同窗 re-gate 都係 +0.01%,原 OKX 窗係 +0.3%),彷 S9 判斷:lift 強但期望值薄,出場紀律比入場更重要,文案已寫明。單一窗、Binance 數據(同 live 源一致 — 遷移後 backtest=live 同所);同日 S9-R2 升班覆核失敗(t10/h48 ×1.07)為對照,V2 嘅 t10/h48 ×1.85 係本質差異唔係窗運氣。

**Implemented**:`backtest.ts --mode virgin`(V1-V3 + knobs + ⚡/sqD3/R1/R2 重疊);`interpret.ts` `computeVirginV2`(1H mirror,oi4h store-corrected NaN fail-closed,oi24h 讀 series)+「處女增倉」insight(bull p8,lift + 期望值 caveat)+ `VIRGIN_V2_SHIPPED` + `virginFires` + `virginSignals` flags;`toLite.virginBreakout` badge「擴」(讓位於 ⚡/增);recorder sweep-meta `virginSignals` sparse + `CLASS_VIRGIN` Telegram(rising edge,cd key `vg-notified-headless`,🚀 header,R4 photo card)。Micro-scan 照舊 ⚡-only。**Synthetic mirror 驗證 6/6 PASS**(forced-positive fire、untrusted fail-closed、flat 靜默、flush-shape 排除)。真 rising-edge 卡等首個真訊號(誠實 can't-verify)。

## 陷阱 / Do-NOT
- 唔准因為 EVAA 亮唔亮加減分 — 單一樣本係假說唔係評分表。
- oi4h/oi24h live mirror 跟 interpret NaN fail-closed 規則(oiTrusted false ⇒ 全部 OI-gated 條件 false)。
- 突破 24h 高 = 必然喺區間頂,唔准加 pos24 cap(S9 同款申報:呢個 family 本質係突破追認)。
- 數據源申報:gate 行喺 Binance 數據(2026-07-07 遷移後),同 S9 原 gate(OKX 數據)唔同窗唔同所 — 對照 S9 數字時要記住呢一點。

## 2026-07-21 H1 evidence update

V1／V2／V3 喺逐月完整 universe 都有高 matched lift（×1.54／×1.66／×1.48），但 after-cost/funding net 全負（−0.49%／−0.51%／−0.52%）、三者只得 1/6 positive folds、bootstrap 下界全負，所以全部 `historical-fail`。V1/V3 唔再叫收集中；V2 live 去留唔由本次審計自動更改。

用戶其後拍板退休 live surface：「擴」badge、detail insight 同 `vg` Telegram OFF；raw V2 flag、V1–V3 recording 同 Strategy Lab shadow 照行。
