# S12 — 插針掃損反轉(flush-wick reversal,backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1 · Motivating case: TRIA/USDT 2026-07-06 17:00(用戶指認嘅 classic example)

## zh-HK TL;DR
TRIA 拉盤前嘅 classic 形態:**橫行壓縮 → 一支深插針掃穿低位(掃損)即刻收回 → 下一支爆拉**。用戶指認三個特徵:(1) 拉盤前插針;(2) 4H 由跌轉升(EMA20/50 金叉,1H 序列以 EMA20>EMA50 做 proxy);(3) 拉前 BB squeeze 先跌後拉。TRIA 插針 bar 實數(1H 17:00):O 0.02383 / H 0.02412 / **L 0.02261** / C 0.02407 — 插穿之前 24h 低、下影佔 range 81%、收返 bar 頂 97% 位,下一支 1H 爆上。呢個同 S11-W2(spring)嘅分別:W2 要求插穿「舊 local-min」,S12 要求插穿 **24h 絕對低 + 長下影 + 即 bar 收回 + 下一支確認**,係更極端嘅 stop-hunt 形狀。過 gate 先有 badge/Telegram(用戶已拍板 gate-passers 通知)。

## 反 overfit 協議(執行前已生效)
1. TRIA 一個樣本只做假說生成;定義凍結於跑 gate 之前;唔准事後調參。
2. Ship gate(同 S9-S11):+10%/24h lift ≥ ×1.3 ∧ 全 ±25% cells > ×1.15 ∧ cross-target(t15/h24、t10/h48)> ×1.15 ∧ meanRet@24h > 0 ∧ n ≥ 20。
3. 重疊 vs ⚡ / S6-D3 / S11-W2(近親!)>50% = 翻版唔 ship。
4. below-baseline def 冇 recording flags;全 cells 照登。

## Pre-registered 定義族(凍結於 2026-07-07,gate 未跑)
全部 1H series。**插針 bar s(共同)**:`low[s] < min(low[s−24..s−1])`(插穿 24h 絕對低 = 掃損)∧ 下影 `(min(o,c)−l)/range ≥ 0.6` ∧ 收回 `close ≥ low + 0.5×range`。**Trigger bar i = s+1**:`close[i] > high[s]`(收穿插針 bar 高 = V 型確認)∧ `max(volZ(s), volZ(i)) ≥ 1.5`(插針 bar 或確認 bar 爆量,TRIA 兩支都爆)。

- **F1 插針反轉**:上述本體。
- **F2 = F1 ∧ 升勢 context**:`EMA20(1H)[i] > EMA50(1H)[i]`(用戶嘅「4H 金叉/跌轉升」1H proxy — 4H EMA 喺 ~30d @1H harness 度 bar 數唔夠,申報)。
- **F3 = F1 ∧ squeeze context**:S6-D3 幾何壓縮(BB 入 Keltner,confirm none — 方向由插針本身表達)喺 s−6..s 內 on 過(用戶嘅「拉前 BB squeeze」)。
- 閾值 provenance:下影 0.6 係 interpret 現成 capitulation-wick 慣例值(0.55)round 上;收回 0.5 同 capBarStrongClose 一致;24h lookback 同 ⚡ base window 一致;冇 fit 落 TRIA(TRIA 值 0.81/0.97 遠超閾值)。

## Gate 計劃
1. `backtest.ts`:`--mode flushwick`、`--fw-def F1|F2|F3`、`--fw-wick 0.6`、`--fw-lookback 24`、`--fw-close-pos 0.5`;warmup 72;⚡/sqD3/W2 重疊。
2. F1/F2/F3 × t10/h24 → 勝者:wick ±25%(0.45/0.75)、lookback ±25%(18/30)、close-pos ±25%(0.375/0.625)、volZ ±25%、t15/h24、t10/h48。
3. 零調參 cross-check:TRIA 07-06 17:00-18:00 邊個 def 亮(唔亮照登)。
4. 過 gate → interpret 1H mirror + 「插針掃損」insight + badge + Telegram class + sweep-meta flags;唔過 → 非 below-baseline 記 flags 等 E1。

## Results — 2026-07-07(gate 完成,**全族 below baseline → 死,唔 ship 唔錄 flags**)

**Gate(150 幣 $2M-$150M,~37d @1H,+10%/24h MFE,cooldown 24h,基準 hit ~9.8%)**

| def | n | hit | lift | meanRet@24h | 判決 |
|---|---|---|---|---|---|
| F1 插針反轉 | 267 | 3.7% | **×0.38** | **−2.9%** | 死(below baseline) |
| F2 F1+EMA升勢 | 26 | 7.7% | **×0.78** | **−3.9%** | 死(below baseline) |
| F3 F1+squeeze | 120 | 3.3% | **×0.34** | **−3.8%** | 死(below baseline) |

**判決:S7-B1/B3 先例 — below baseline 死得徹底,連 recording flags 都唔錄。** 唔 ship badge、唔 ship Telegram。

**解讀(誠實)**:「插穿 24h 低 + 長下影收回 + 下一支收穿插針高」喺全宇宙統計上係**反向指標** — 之後 24h 平均 −3~−4%,掂 +10% 嘅機率低過隨機一截。TRIA 嗰種「插針即拉」係倖存者偏差:見到嘅係拉咗嗰啲,大多數同形態嘅插針之後繼續跌(掃損之後真係冇人接)。F2 加埋 EMA 升勢 context 都救唔返(×0.78)。呢個同 S7-B1 深跌首彈(meanRet −3.4%)係同一個教訓嘅第二次確認:**低位反轉形態喺妖幣度係接刀,唔係入場**。

**申報 caveat**:gate 喺 1H 行;用戶指認嘅「5m 幾條 K 線 squeeze 先跌後拉」微結構喺 1H bar 內冇得表達 — 5m/15m 版本冇得測(OKX 5m 歷史深度唔夠 backtest 窗)。所以結論嚴格係「**1H 可測版本死**」,唔係「pattern 喺所有時框死」。但 harness 可測嘅範圍內,證據一面倒,冇理由 ship。TRIA 零調參 cross-check:TRIA 唔喺 backtest universe 頂 150 內,冇得驗(同 CAP/YFI 一樣,E1 補)。

**有用嘅副產品**:S12 嘅反向強度(×0.34-0.38)咁誇張,值得記低一個 E1 假說 —「插針掃損確認」作為**迴避訊號**(見到就唔好追)可能有用,但嗰個係另一個 gate 嘅事,唔准偷步。

## 附錄:S12-5m 重測(Binance Vision 數據,用戶指示「can try binance API」)

1H 版死咗,但申報過「5m 微結構冇得喺 1H 表達」。用 data.binance.vision **monthly 5m klines dump**(免 key、免費,zip 內單 CSV,已實測 TRIA 2026-06 有 8640 支)起獨立 harness `scripts/backtest5m.ts` 重測 5m 版。

**Pre-registered 5m 定義(凍結於 2026-07-07,gate 未跑)**:
- 插針 bar s(5m):`low[s] < min(low[s−96..s−1])`(插穿 8h 低)∧ 下影 ≥ 0.6 range ∧ close ≥ low + 0.5×range;confirm bar i = s+1:`close > high[s]` ∧ `max(volZ(s), volZ(i)) ≥ 2`(volZ 窗 = prior 288 支 5m = 24h)。
- **F1-5m**:上述本體。**F2-5m**:F1 ∧ `close > EMA600(5m)`(≈ EMA50@1H 升勢 proxy)。
- Outcome:+10% MFE / 24h(288 bars);baseline 全 bars;cooldown 24h。Gate 準則同主 spec。
- 數據:2026-05 + 2026-06 兩個完整月(~60 日),universe = backtest cache 同一批 Binance-listed(cap 100);TRIA 零調參 cross-check 用 7 月 daily zip 另行驗(佢事件喺 gate 窗之外,乾淨)。

## Results — 5m 重測 2026-07-07(**5m 版一樣 below baseline → 確認死**)

**Gate(Binance Vision 2026-05+06 兩個月 5m,89 幣 loaded / 11 skipped(該月未上市),+10%/24h,baseline hit 9.3%)**

| def | n | hit | lift | meanRet@24h |
|---|---|---|---|---|
| F1-5m | 643 | 6.2% | **×0.67** | −0.4% |
| F2-5m(+EMA600 升勢) | 99 | 7.1% | **×0.76** | −1.1% |

**判決不變:插針掃損反轉喺 5m 微結構層面一樣係 below baseline。** 1H ×0.34-0.78、5m ×0.67-0.76 — 兩個時框、兩個數據源(OKX/Binance)、~60 日窗,結論一致:呢個形態唔係入場 edge。用戶見到嘅 TRIA/YFI 案例係倖存者記憶 — 每一個「插針即拉」背後有九個「插針繼續跌」。

**基建副產品(呢個先係真收穫)**:`scripts/backtest5m.ts` — Binance Vision monthly 5m dump harness(免 key,純 zlib 解 zip,零依賴,per-coin streaming,~90 幣 × 2 月 cache 一次 ~3 分鐘)。以後任何 5m 級 detector 假說都有得測,唔再受 OKX 5m 深度限制。TRIA 07-06 事件 bar 零調參 cross-check:daily dump T+1 未出,延後(結果唔會改判決 — gate 係全宇宙統計,唔係單樣本)。

## 陷阱 / Do-NOT
- W2 近親申報:S11-W2(spring)都係「插穿舊低收回」— S12 要求更嚴(24h 絕對低 + 長下影 + 下一支收穿插針高)。重疊 >50% 就當 W2 變種,唔准另 ship。
- 插針喺 5m 圖最靚,但 gate 喺 1H 行(harness 一致性);1H bar 內嘅 5m 微結構(先跌後拉幾支 K)冇得喺 1H 表達 — 申報,15m/5m 版本係 E1 後另一實驗。
- 4H 金叉用 1H EMA20>50 proxy — 唔係字面 4H 金叉,申報。
