# HISTORICAL EVIDENCE AUDIT — 2026 H1

審計窗：2026-01、2026-02、2026-03、2026-04、2026-05、2026-06。來源指紋：`7906082333c5765f5f5e20b595b764cf3cda4165996d370294bb9a24dc294522`。

市場資料：[Binance Public Data](https://github.com/binance/binance-public-data#readme) daily/monthly archives；archive 檔案逐一核對官方 checksum。

> 呢份係歷史 replay 證據，唔係 Telegram 實際送達、paper 成交或 live 升降班決定。所有 live badge、通知、paper rule 同 tier map 維持不變。

## Universe 與 coverage

- 4039 coin-months；759 個 normalized bases。
- 每月 universe：2026-01=625、2026-02=637、2026-03=652、2026-04=668、2026-05=700、2026-06=757。
- Cache artifacts：complete 18949、partial 6127、missing 3537、invalid 0。缺資料一律 fail-closed，冇用零值補。

| Dataset | Complete | Partial | Missing | Invalid |
|---|---:|---:|---:|---:|
| futures5m | 5407 | 2 | 683 | 0 |
| metrics | 4449 | 3992 | 1022 | 0 |
| funding | 5985 | 2133 | 1477 | 0 |
| spot5m | 3108 | 0 | 355 | 0 |

## 歷史結果

| 項目 | 分類 | Events / Coins / Days / Months | Coverage | 10%×24h matched lift | 淨期望值 | Walk-forward | Bootstrap L95 | Robustness |
|---|---|---:|---:|---:|---:|---:|---:|---|
| ⚡ 縮倉突破 | `historical-fail` | 1115 / 485 / 171 / 6 | 84.9% | ×0.62 | -0.97% | 0/6 | -1.54% | fail ×0.55 |
| 蓄 早期累積 setup | `historical-fail` | 1617 / 565 / 179 / 6 | 84.9% | ×1.38 | -0.76% | 1/6 | -1.15% | fail ×1.10 |
| D3 squeeze breakout | `historical-fail` | 19213 / 682 / 181 / 6 | 84.9% | ×0.87 | -0.21% | 1/6 | -0.56% | fail ×0.82 |
| B2 EMA20 reclaim | `historical-fail` | 1570 / 560 / 173 / 6 | 84.9% | ×1.09 | -0.07% | 3/6 | -0.64% | fail ×0.96 |
| R1 增倉突破 | `historical-fail` | 1512 / 534 / 181 / 6 | 84.9% | ×1.31 | -0.47% | 2/6 | -1.13% | pass ×1.18 |
| R2 淨增倉 | `historical-fail` | 5032 / 648 / 181 / 6 | 84.9% | ×0.99 | -0.34% | 1/6 | -0.75% | fail ×0.94 |
| R3 funding-cap rebuild | `historical-fail` | 1416 / 520 / 181 / 6 | 84.9% | ×1.26 | -0.46% | 1/6 | -1.14% | fail ×1.15 |
| V1 處女擴張 | `historical-fail` | 7495 / 664 / 181 / 6 | 84.9% | ×1.54 | -0.49% | 1/6 | -0.87% | pass ×1.37 |
| V2 處女增倉突破 | `historical-fail` | 6824 / 659 / 181 / 6 | 84.9% | ×1.66 | -0.51% | 1/6 | -0.91% | pass ×1.44 |
| V3 funding-cap virgin | `historical-fail` | 6886 / 658 / 181 / 6 | 84.9% | ×1.48 | -0.52% | 1/6 | -0.91% | pass ×1.32 |
| S10 T1 雙頂拒絕 | `historical-fail` | 111 / 86 / 88 / 6 | 84.9% | ×0.88 | +1.14% | 3/6 | -1.73% | fail ×0.88 |
| S10 T2 新高背離 | `historical-fail` | 69 / 59 / 51 / 6 | 84.9% | ×1.24 | +2.54% | 3/6 | -1.63% | pass ×1.20 |
| S10 T3 climax rejection | `historical-fail` | 24 / 22 / 22 / 6 | 84.9% | ×0.97 | +7.41% | 6/6 | +2.05% | fail ×0.73 |
| S10 T4 funding stall | `historical-fail` | 47 / 36 / 37 / 6 | 84.9% | ×1.09 | +0.82% | 3/6 | -4.30% | fail ×1.01 |
| S11 W1 雙底 | `historical-fail` | 3798 / 576 / 181 / 6 | 84.9% | ×1.09 | -0.38% | 1/6 | -0.91% | fail ×1.05 |
| S11 W2 spring | `historical-fail` | 1212 / 420 / 181 / 6 | 84.9% | ×1.27 | -0.22% | 3/6 | -1.18% | pass ×1.21 |
| S11 W3 OI-confirmed | `historical-fail` | 3368 / 563 / 181 / 6 | 84.9% | ×1.09 | -0.31% | 1/6 | -0.83% | fail ×1.05 |
| S14 early pump | `historical-fail` | 5503 / 619 / 181 / 6 | 84.9% | ×1.73 | -0.26% | 1/6 | -0.74% | pass ×1.42 |
| Spot pump | `historical-fail` | 6552 / 391 / 181 / 6 | 56.7% | ×1.20 | -0.51% | 1/6 | -0.88% | fail ×1.13 |
| Spot accumulation | `historical-fail` | 2900 / 369 / 181 / 6 | 56.7% | ×0.95 | -0.31% | 2/6 | -0.69% | fail ×0.93 |
| Organic spot proxy | `historical-pass` | 27 / 16 / 24 / 6 | 56.7% | ×1.65 | +0.77% | 4/6 | -0.73% | pass ×1.43 |
| Leverage froth control | `historical-fail` | 5094 / 150 / 181 / 6 | 56.7% | ×0.57 | -0.72% | 1/6 | -1.11% | fail ×0.53 |
| True spot-led | `historical-pass` | 27 / 16 / 24 / 6 | 56.7% | ×1.65 | +0.77% | 4/6 | -0.67% | pass ×1.43 |
| UMM EMA20 reclaim control | `historical-fail` | 10608 / 675 / 181 / 6 | 84.9% | ×0.94 | -0.21% | 1/6 | -0.53% | fail ×0.91 |
| UMM B2 | `historical-fail` | 1570 / 560 / 173 / 6 | 84.9% | ×1.09 | -0.07% | 3/6 | -0.71% | fail ×0.96 |
| UMM B2 quantity-OI challenger | `historical-fail` | 187 / 159 / 95 / 6 | 84.9% | ×1.73 | +1.48% | 4/6 | -0.41% | pass ×1.40 |
| S15 deep reclaim quantity-OI armed | `historical-fail` | 2681 / 605 / 181 / 6 | 84.9% | ×1.38 | -0.19% | 4/6 | -0.70% | pass ×1.20 |
| S15 deep reclaim confirmed | `historical-fail` | 471 / 304 / 161 / 6 | 84.9% | ×1.76 | +0.71% | 4/6 | -0.26% | pass ×1.43 |
| Entry-watch R1 breakout retest | `historical-fail` | 1110 / 475 / 180 / 6 | 84.9% | ×0.87 | -0.49% | 0/6 | -1.16% | fail ×0.75 |
| Entry-watch V2 breakout retest | `historical-fail` | 5426 / 653 / 182 / 6 | 84.9% | ×0.77 | -0.28% | 1/6 | -0.70% | fail ×0.71 |
| Strength ≥70 crossing | `historical-fail` | 20940 / 684 / 181 / 6 | 84.9% | ×2.04 | -0.27% | 1/6 | -0.57% | pass ×1.59 |
| 全市場 Top 10 entry | `historical-fail` | 14237 / 679 / 181 / 6 | 84.9% | ×2.41 | -0.26% | 1/6 | -0.57% | pass ×1.80 |

## Evidence 分類主表

| 項目 | 舊阻塞理由 | 可 backfill | 分類 | 尚欠 forward 證據 | 建議 |
|---|---|---:|---|---|---|
| ⚡ 縮倉突破 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| 蓄 早期累積 setup | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| D3 squeeze breakout | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| B2 EMA20 reclaim | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| R1 增倉突破 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| R2 淨增倉 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| R3 funding-cap rebuild | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| V1 處女擴張 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| V2 處女增倉突破 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| V3 funding-cap virgin | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S10 T1 雙頂拒絕 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S10 T2 新高背離 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S10 T3 climax rejection | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S10 T4 funding stall | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S11 W1 雙底 | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S11 W2 spring | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S11 W3 OI-confirmed | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S14 early pump | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Spot pump | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Spot accumulation | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Organic spot proxy | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-pass` | 市場漂移及連續月份仍可用 forward holdout 覆核；不可自動升 live | 候選覆核（不自動升級） |
| Leverage froth control | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| True spot-led | 舊文標作 recording-only、等待 E1 或歷史窗不足 | 是 | `historical-pass` | 市場漂移及連續月份仍可用 forward holdout 覆核；不可自動升 live | 候選覆核（不自動升級） |
| UMM EMA20 reclaim control | 舊 UMM replay 只有部分月份與 OI coverage，標作 sample-starved | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| UMM B2 | 舊 UMM replay 只有部分月份與 OI coverage，標作 sample-starved | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| UMM B2 quantity-OI challenger | 舊 UMM replay 只有部分月份與 OI coverage，標作 sample-starved | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S15 deep reclaim quantity-OI armed | 舊結論指 quantity-OI 無法歷史 backfill，只得一個月，需等 forward recordings | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| S15 deep reclaim confirmed | 舊結論指 quantity-OI 無法歷史 backfill，只得一個月，需等 forward recordings | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Entry-watch R1 breakout retest | 舊 study 只有 2026-06 execution month，calendar folds / bootstrap 不可用 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Entry-watch V2 breakout retest | 舊 study 只有 2026-06 execution month，calendar folds / bootstrap 不可用 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Strength ≥70 crossing | 舊 recording state 樣本及 span 太短，未可行動 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| 全市場 Top 10 entry | 舊 recording state 樣本及 span 太短，未可行動 | 是 | `historical-fail` | 歷史 gate 已足以否決目前固定規則；如改規則必須另作預註冊研究 | 退休／停止寫成「收集中」 |
| Telegram 實際送達 | 送達只會喺真實時間發生 | 否 | `forward-only` | message id、API response、用戶端收件 | 保留 forward audit，歷史 replay 不計送達 |
| Top-1 runtime selection | 同 sweep 候選、排序及發送狀態屬 runtime | 否 | `forward-only` | 完整同輪候選及實際 selected row | 保留 forward-only |
| 通知 cooldown | 依賴持久化狀態及 process lifecycle | 否 | `forward-only` | 跨 restart runtime audit | 保留 forward-only |
| Recorder uptime | 歷史市場資料不能證明 recorder 當時在線 | 否 | `forward-only` | heartbeat / process telemetry | 保留 forward-only |
| Paper account / T1 一個月正 P&L | 實際 paper book 路徑不可由 replay 冒充 | 否 | `forward-only` | 連續一個月同規則 paper P&L | 維持 Strategy Lab 分隔 |
| 真實 slippage | archive 無本系統實際下單及成交 | 否 | `forward-only` | 真實成交或 paper execution telemetry | 保留 forward-only |
| E2 連續月份／市場漂移確認 | 歷史 H1 可做固定初步 gate，但不能證明部署後市場無漂移 | 是 | `forward-confirmation-required` | 同規則 live-era 連續月份 holdout | 歷史 pass 只列候選，等 forward confirmation |
| Liquidation detector | Binance Vision 無 liquidation archive | 否 | `source-unavailable` | 前向 websocket liquidation stream | 保留收集；不可零值補齊 |
| E4 protected Telegram reference | 受保護外部來源不可由市場 archive 還原 | 否 | `manual-external` | 人手保存原訊號及 timestamp | 維持 manual-external |
| 「Binance 只有 30 日歷史」舊結論 | 舊文件混淆 REST retention 同 Vision archive | 是 | `superseded` | 無 | 保留舊文並加 superseded note |

## Detector 詳細統計

### ⚡ 縮倉突破

分類：`historical-fail`；樣本 1115 events / 485 coins / 171 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1115 | 1115 | +10.31% | +16.76% | ×0.62 | -0.69% | -1.04% | -0.97% |
| 10% | 48h | 1115 | 1115 | +17.67% | +24.36% | ×0.73 | -1.08% | -1.37% | -1.34% |
| 15% | 24h | 1115 | 1115 | +5.29% | +9.56% | ×0.55 | -0.69% | -1.04% | -0.97% |
| 15% | 48h | 1115 | 1115 | +8.61% | +14.65% | ×0.59 | -1.08% | -1.37% | -1.34% |

月度 walk-forward：2026-01 -1.53%；2026-02 -1.04%；2026-03 -0.82%；2026-04 -0.24%；2026-05 -1.78%；2026-06 -0.35%。
Day-block bootstrap L95：-1.54%；正 P&L 集中度：top coin +5.80%、top UTC day +8.93%。
Robustness：fail，worst lift ×0.55。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1115 events / 485 coins / 171 days / 6 months
- 10%×24h matched lift 0.62
- after-cost/funding mean -0.97%
- 0/6 positive monthly folds
- one or more fixed historical gates failed

### 蓄 早期累積 setup

分類：`historical-fail`；樣本 1617 events / 565 coins / 179 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1617 | 1617 | +9.71% | +7.03% | ×1.38 | -0.48% | -0.76% | -0.76% |
| 10% | 48h | 1617 | 1617 | +16.08% | +14.58% | ×1.10 | -0.73% | -1.06% | -1.00% |
| 15% | 24h | 1617 | 1617 | +5.01% | +2.83% | ×1.77 | -0.48% | -0.76% | -0.76% |
| 15% | 48h | 1617 | 1617 | +8.10% | +6.68% | ×1.21 | -0.73% | -1.06% | -1.00% |

月度 walk-forward：2026-01 -0.99%；2026-02 -0.98%；2026-03 -1.02%；2026-04 +0.09%；2026-05 -0.97%；2026-06 -0.63%。
Day-block bootstrap L95：-1.15%；正 P&L 集中度：top coin +4.43%、top UTC day +6.21%。
Robustness：fail，worst lift ×1.10。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1617 events / 565 coins / 179 days / 6 months
- 10%×24h matched lift 1.38
- after-cost/funding mean -0.76%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### D3 squeeze breakout

分類：`historical-fail`；樣本 19213 events / 682 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 19213 | 19213 | +14.58% | +16.76% | ×0.87 | +0.04% | -0.51% | -0.21% |
| 10% | 48h | 19213 | 19213 | +22.37% | +24.36% | ×0.92 | +0.02% | -0.69% | -0.19% |
| 15% | 24h | 19213 | 19213 | +7.85% | +9.56% | ×0.82 | +0.04% | -0.51% | -0.21% |
| 15% | 48h | 19213 | 19213 | +12.88% | +14.65% | ×0.88 | +0.02% | -0.69% | -0.19% |

月度 walk-forward：2026-01 -0.91%；2026-02 -0.16%；2026-03 -0.07%；2026-04 +0.14%；2026-05 -0.14%；2026-06 -0.21%。
Day-block bootstrap L95：-0.56%；正 P&L 集中度：top coin +3.65%、top UTC day +7.10%。
Robustness：fail，worst lift ×0.82。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 19213 events / 682 coins / 181 days / 6 months
- 10%×24h matched lift 0.87
- after-cost/funding mean -0.21%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### B2 EMA20 reclaim

分類：`historical-fail`；樣本 1570 events / 560 coins / 173 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1570 | 1570 | +11.08% | +10.19% | ×1.09 | +0.17% | -0.26% | -0.07% |
| 10% | 48h | 1570 | 1570 | +20.57% | +18.34% | ×1.12 | +0.24% | -0.18% | +0.08% |
| 15% | 24h | 1570 | 1570 | +4.78% | +4.97% | ×0.96 | +0.17% | -0.26% | -0.07% |
| 15% | 48h | 1570 | 1570 | +10.13% | +9.57% | ×1.06 | +0.24% | -0.18% | +0.08% |

月度 walk-forward：2026-01 -1.79%；2026-02 +0.65%；2026-03 -0.06%；2026-04 +1.47%；2026-05 -0.82%；2026-06 +0.69%。
Day-block bootstrap L95：-0.64%；正 P&L 集中度：top coin +5.96%、top UTC day +16.73%。
Robustness：fail，worst lift ×0.96。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1570 events / 560 coins / 173 days / 6 months
- 10%×24h matched lift 1.09
- after-cost/funding mean -0.07%
- 3/6 positive monthly folds
- one or more fixed historical gates failed

### R1 增倉突破

分類：`historical-fail`；樣本 1512 events / 534 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1512 | 1512 | +21.89% | +16.76% | ×1.31 | -0.36% | -1.88% | -0.47% |
| 10% | 48h | 1512 | 1512 | +28.84% | +24.36% | ×1.18 | -0.96% | -1.98% | -0.92% |
| 15% | 24h | 1512 | 1512 | +12.83% | +9.56% | ×1.34 | -0.36% | -1.88% | -0.47% |
| 15% | 48h | 1512 | 1512 | +18.65% | +14.65% | ×1.27 | -0.96% | -1.98% | -0.92% |

月度 walk-forward：2026-01 -1.08%；2026-02 -1.56%；2026-03 -1.06%；2026-04 +0.84%；2026-05 -0.95%；2026-06 +0.14%。
Day-block bootstrap L95：-1.13%；正 P&L 集中度：top coin +8.04%、top UTC day +9.85%。
Robustness：pass，worst lift ×1.18。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1512 events / 534 coins / 181 days / 6 months
- 10%×24h matched lift 1.31
- after-cost/funding mean -0.47%
- 2/6 positive monthly folds
- one or more fixed historical gates failed

### R2 淨增倉

分類：`historical-fail`；樣本 5032 events / 648 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 5032 | 5032 | +16.57% | +16.76% | ×0.99 | -0.11% | -1.02% | -0.34% |
| 10% | 48h | 5032 | 5032 | +23.85% | +24.36% | ×0.98 | -0.08% | -1.24% | -0.27% |
| 15% | 24h | 5032 | 5032 | +9.06% | +9.56% | ×0.95 | -0.11% | -1.02% | -0.34% |
| 15% | 48h | 5032 | 5032 | +13.83% | +14.65% | ×0.94 | -0.08% | -1.24% | -0.27% |

月度 walk-forward：2026-01 -0.17%；2026-02 -0.95%；2026-03 -0.56%；2026-04 -0.12%；2026-05 +0.09%；2026-06 -0.91%。
Day-block bootstrap L95：-0.75%；正 P&L 集中度：top coin +4.93%、top UTC day +9.08%。
Robustness：fail，worst lift ×0.94。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 5032 events / 648 coins / 181 days / 6 months
- 10%×24h matched lift 0.99
- after-cost/funding mean -0.34%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### R3 funding-cap rebuild

分類：`historical-fail`；樣本 1416 events / 520 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1416 | 1416 | +21.19% | +16.76% | ×1.26 | -0.38% | -1.88% | -0.46% |
| 10% | 48h | 1416 | 1416 | +27.97% | +24.36% | ×1.15 | -0.91% | -1.94% | -0.82% |
| 15% | 24h | 1416 | 1416 | +11.94% | +9.56% | ×1.25 | -0.38% | -1.88% | -0.46% |
| 15% | 48h | 1416 | 1416 | +17.58% | +14.65% | ×1.20 | -0.91% | -1.94% | -0.82% |

月度 walk-forward：2026-01 -1.16%；2026-02 -1.25%；2026-03 -1.00%；2026-04 +0.92%；2026-05 -0.65%；2026-06 -0.46%。
Day-block bootstrap L95：-1.14%；正 P&L 集中度：top coin +8.24%、top UTC day +10.21%。
Robustness：fail，worst lift ×1.15。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1416 events / 520 coins / 181 days / 6 months
- 10%×24h matched lift 1.26
- after-cost/funding mean -0.46%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### V1 處女擴張

分類：`historical-fail`；樣本 7495 events / 664 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 7495 | 7495 | +25.87% | +16.76% | ×1.54 | -0.40% | -1.60% | -0.49% |
| 10% | 48h | 7495 | 7495 | +33.29% | +24.36% | ×1.37 | -0.49% | -2.18% | -0.48% |
| 15% | 24h | 7495 | 7495 | +16.36% | +9.56% | ×1.71 | -0.40% | -1.60% | -0.49% |
| 15% | 48h | 7495 | 7495 | +22.21% | +14.65% | ×1.52 | -0.49% | -2.18% | -0.48% |

月度 walk-forward：2026-01 -0.65%；2026-02 -1.59%；2026-03 -0.70%；2026-04 +0.14%；2026-05 -0.26%；2026-06 -0.49%。
Day-block bootstrap L95：-0.87%；正 P&L 集中度：top coin +3.34%、top UTC day +8.38%。
Robustness：pass，worst lift ×1.37。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 7495 events / 664 coins / 181 days / 6 months
- 10%×24h matched lift 1.54
- after-cost/funding mean -0.49%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### V2 處女增倉突破

分類：`historical-fail`；樣本 6824 events / 659 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 6824 | 6824 | +27.77% | +16.76% | ×1.66 | -0.45% | -1.81% | -0.51% |
| 10% | 48h | 6824 | 6824 | +35.10% | +24.36% | ×1.44 | -0.54% | -2.43% | -0.50% |
| 15% | 24h | 6824 | 6824 | +17.57% | +9.56% | ×1.84 | -0.45% | -1.81% | -0.51% |
| 15% | 48h | 6824 | 6824 | +23.62% | +14.65% | ×1.61 | -0.54% | -2.43% | -0.50% |

月度 walk-forward：2026-01 -0.72%；2026-02 -1.61%；2026-03 -0.80%；2026-04 +0.16%；2026-05 -0.32%；2026-06 -0.37%。
Day-block bootstrap L95：-0.91%；正 P&L 集中度：top coin +3.58%、top UTC day +8.61%。
Robustness：pass，worst lift ×1.44。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 6824 events / 659 coins / 181 days / 6 months
- 10%×24h matched lift 1.66
- after-cost/funding mean -0.51%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### V3 funding-cap virgin

分類：`historical-fail`；樣本 6886 events / 658 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 6886 | 6886 | +24.88% | +16.76% | ×1.48 | -0.47% | -1.58% | -0.52% |
| 10% | 48h | 6886 | 6886 | +32.18% | +24.36% | ×1.32 | -0.57% | -2.18% | -0.50% |
| 15% | 24h | 6886 | 6886 | +15.63% | +9.56% | ×1.63 | -0.47% | -1.58% | -0.52% |
| 15% | 48h | 6886 | 6886 | +21.20% | +14.65% | ×1.45 | -0.57% | -2.18% | -0.50% |

月度 walk-forward：2026-01 -0.67%；2026-02 -1.63%；2026-03 -0.59%；2026-04 +0.08%；2026-05 -0.30%；2026-06 -0.60%。
Day-block bootstrap L95：-0.91%；正 P&L 集中度：top coin +3.75%、top UTC day +8.89%。
Robustness：pass，worst lift ×1.32。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 6886 events / 658 coins / 181 days / 6 months
- 10%×24h matched lift 1.48
- after-cost/funding mean -0.52%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### S10 T1 雙頂拒絕

分類：`historical-fail`；樣本 111 events / 86 coins / 88 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 111 | 111 | +37.84% | +43.08% | ×0.88 | +1.81% | +2.45% | +1.14% |
| 10% | 48h | 111 | 111 | +54.95% | +56.95% | ×0.96 | +2.79% | +3.64% | +1.89% |
| 15% | 24h | 111 | 111 | +24.32% | +22.06% | ×1.10 | +1.81% | +2.45% | +1.14% |
| 15% | 48h | 111 | 111 | +32.43% | +34.35% | ×0.94 | +2.79% | +3.64% | +1.89% |

月度 walk-forward：2026-01 +5.30%；2026-02 -3.57%；2026-03 +2.90%；2026-04 +6.31%；2026-05 -0.84%；2026-06 -1.71%。
Day-block bootstrap L95：-1.73%；正 P&L 集中度：top coin +8.23%、top UTC day +7.86%。
Robustness：fail，worst lift ×0.88。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 111 events / 86 coins / 88 days / 6 months
- 10%×24h matched lift 0.88
- after-cost/funding mean 1.14%
- 3/6 positive monthly folds
- one or more fixed historical gates failed

### S10 T2 新高背離

分類：`historical-fail`；樣本 69 events / 59 coins / 51 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 69 | 69 | +53.62% | +43.08% | ×1.24 | +4.00% | +4.32% | +2.54% |
| 10% | 48h | 69 | 69 | +68.12% | +56.95% | ×1.20 | +3.59% | +6.99% | +1.04% |
| 15% | 24h | 69 | 69 | +34.78% | +22.06% | ×1.58 | +4.00% | +4.32% | +2.54% |
| 15% | 48h | 69 | 69 | +47.83% | +34.35% | ×1.39 | +3.59% | +6.99% | +1.04% |

月度 walk-forward：2026-01 -5.17%；2026-02 +3.95%；2026-03 -9.39%；2026-04 +32.47%；2026-05 -1.68%；2026-06 +2.84%。
Day-block bootstrap L95：-1.63%；正 P&L 集中度：top coin +14.79%、top UTC day +14.96%。
Robustness：pass，worst lift ×1.20。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 69 events / 59 coins / 51 days / 6 months
- 10%×24h matched lift 1.24
- after-cost/funding mean 2.54%
- 3/6 positive monthly folds
- one or more fixed historical gates failed

### S10 T3 climax rejection

分類：`historical-fail`；樣本 24 events / 22 coins / 22 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 24 | 24 | +41.67% | +43.08% | ×0.97 | +7.94% | +5.24% | +7.41% |
| 10% | 48h | 24 | 24 | +58.33% | +56.95% | ×1.02 | +9.38% | +3.63% | +8.78% |
| 15% | 24h | 24 | 24 | +25.00% | +22.06% | ×1.13 | +7.94% | +5.24% | +7.41% |
| 15% | 48h | 24 | 24 | +25.00% | +34.35% | ×0.73 | +9.38% | +3.63% | +8.78% |

月度 walk-forward：2026-01 +6.11%；2026-02 +5.60%；2026-03 +10.55%；2026-04 +32.80%；2026-05 +0.38%；2026-06 +4.17%。
Day-block bootstrap L95：+2.05%；正 P&L 集中度：top coin +25.13%、top UTC day +25.00%。
Robustness：fail，worst lift ×0.73。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 24 events / 22 coins / 22 days / 6 months
- 10%×24h matched lift 0.97
- after-cost/funding mean 7.41%
- 6/6 positive monthly folds
- one or more fixed historical gates failed

### S10 T4 funding stall

分類：`historical-fail`；樣本 47 events / 36 coins / 37 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 47 | 47 | +46.81% | +43.08% | ×1.09 | +0.91% | +1.42% | +0.82% |
| 10% | 48h | 47 | 47 | +57.45% | +56.95% | ×1.01 | +2.13% | +2.94% | +2.12% |
| 15% | 24h | 47 | 47 | +31.91% | +22.06% | ×1.45 | +0.91% | +1.42% | +0.82% |
| 15% | 48h | 47 | 47 | +38.30% | +34.35% | ×1.11 | +2.13% | +2.94% | +2.12% |

月度 walk-forward：2026-01 +4.85%；2026-02 -3.33%；2026-03 -0.70%；2026-04 -13.06%；2026-05 +6.18%；2026-06 +5.19%。
Day-block bootstrap L95：-4.30%；正 P&L 集中度：top coin +18.20%、top UTC day +16.46%。
Robustness：fail，worst lift ×1.01。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 47 events / 36 coins / 37 days / 6 months
- 10%×24h matched lift 1.09
- after-cost/funding mean 0.82%
- 3/6 positive monthly folds
- one or more fixed historical gates failed

### S11 W1 雙底

分類：`historical-fail`；樣本 3798 events / 576 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 3798 | 3798 | +34.54% | +31.82% | ×1.09 | -0.40% | -2.68% | -0.38% |
| 10% | 48h | 3798 | 3798 | +42.26% | +40.30% | ×1.05 | -0.79% | -3.58% | -0.61% |
| 15% | 24h | 3798 | 3798 | +22.64% | +21.17% | ×1.07 | -0.40% | -2.68% | -0.38% |
| 15% | 48h | 3798 | 3798 | +29.78% | +28.48% | ×1.05 | -0.79% | -3.58% | -0.61% |

月度 walk-forward：2026-01 -1.02%；2026-02 -1.16%；2026-03 -1.30%；2026-04 +0.85%；2026-05 -0.03%；2026-06 -0.17%。
Day-block bootstrap L95：-0.91%；正 P&L 集中度：top coin +3.45%、top UTC day +6.63%。
Robustness：fail，worst lift ×1.05。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 3798 events / 576 coins / 181 days / 6 months
- 10%×24h matched lift 1.09
- after-cost/funding mean -0.38%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### S11 W2 spring

分類：`historical-fail`；樣本 1212 events / 420 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1212 | 1212 | +40.35% | +31.82% | ×1.27 | -0.37% | -2.54% | -0.22% |
| 10% | 48h | 1212 | 1212 | +48.68% | +40.30% | ×1.21 | -0.59% | -3.64% | -0.25% |
| 15% | 24h | 1212 | 1212 | +27.23% | +21.17% | ×1.29 | -0.37% | -2.54% | -0.22% |
| 15% | 48h | 1212 | 1212 | +35.89% | +28.48% | ×1.26 | -0.59% | -3.64% | -0.25% |

月度 walk-forward：2026-01 +0.10%；2026-02 -0.28%；2026-03 -1.78%；2026-04 +0.65%；2026-05 +0.16%；2026-06 -0.58%。
Day-block bootstrap L95：-1.18%；正 P&L 集中度：top coin +7.74%、top UTC day +6.05%。
Robustness：pass，worst lift ×1.21。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1212 events / 420 coins / 181 days / 6 months
- 10%×24h matched lift 1.27
- after-cost/funding mean -0.22%
- 3/6 positive monthly folds
- one or more fixed historical gates failed

### S11 W3 OI-confirmed

分類：`historical-fail`；樣本 3368 events / 563 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 3368 | 3368 | +34.59% | +31.82% | ×1.09 | -0.34% | -2.78% | -0.31% |
| 10% | 48h | 3368 | 3368 | +42.22% | +40.30% | ×1.05 | -0.63% | -3.69% | -0.45% |
| 15% | 24h | 3368 | 3368 | +22.74% | +21.17% | ×1.07 | -0.34% | -2.78% | -0.31% |
| 15% | 48h | 3368 | 3368 | +29.96% | +28.48% | ×1.05 | -0.63% | -3.69% | -0.45% |

月度 walk-forward：2026-01 -0.95%；2026-02 -0.89%；2026-03 -1.44%；2026-04 +1.22%；2026-05 -0.31%；2026-06 -0.13%。
Day-block bootstrap L95：-0.83%；正 P&L 集中度：top coin +3.53%、top UTC day +6.60%。
Robustness：fail，worst lift ×1.05。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 3368 events / 563 coins / 181 days / 6 months
- 10%×24h matched lift 1.09
- after-cost/funding mean -0.31%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### S14 early pump

分類：`historical-fail`；樣本 5503 events / 619 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 5503 | 5503 | +24.19% | +13.95% | ×1.73 | -0.17% | -1.09% | -0.26% |
| 10% | 48h | 5503 | 5503 | +31.96% | +22.57% | ×1.42 | -0.30% | -1.76% | -0.28% |
| 15% | 24h | 5503 | 5503 | +14.72% | +7.38% | ×2.00 | -0.17% | -1.09% | -0.26% |
| 15% | 48h | 5503 | 5503 | +21.15% | +12.95% | ×1.63 | -0.30% | -1.76% | -0.28% |

月度 walk-forward：2026-01 -1.25%；2026-02 -1.34%；2026-03 -0.74%；2026-04 +1.82%；2026-05 -0.05%；2026-06 -0.08%。
Day-block bootstrap L95：-0.74%；正 P&L 集中度：top coin +3.65%、top UTC day +7.49%。
Robustness：pass，worst lift ×1.42。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 5503 events / 619 coins / 181 days / 6 months
- 10%×24h matched lift 1.73
- after-cost/funding mean -0.26%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### Spot pump

分類：`historical-fail`；樣本 6552 events / 391 coins / 181 UTC days / 6 months；coverage 56.7%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 6552 | 6552 | +13.51% | +11.23% | ×1.20 | -0.29% | -0.79% | -0.51% |
| 10% | 48h | 6552 | 6552 | +20.51% | +18.17% | ×1.13 | -0.43% | -0.95% | -0.60% |
| 15% | 24h | 6552 | 6552 | +6.43% | +5.38% | ×1.19 | -0.29% | -0.79% | -0.51% |
| 15% | 48h | 6552 | 6552 | +10.79% | +9.40% | ×1.15 | -0.43% | -0.95% | -0.60% |

月度 walk-forward：2026-01 -0.91%；2026-02 -0.38%；2026-03 -0.31%；2026-04 +0.22%；2026-05 -1.04%；2026-06 -0.72%。
Day-block bootstrap L95：-0.88%；正 P&L 集中度：top coin +7.56%、top UTC day +6.64%。
Robustness：fail，worst lift ×1.13。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 6552 events / 391 coins / 181 days / 6 months
- 10%×24h matched lift 1.20
- after-cost/funding mean -0.51%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### Spot accumulation

分類：`historical-fail`；樣本 2900 events / 369 coins / 181 UTC days / 6 months；coverage 56.7%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 2900 | 2900 | +7.03% | +7.40% | ×0.95 | -0.03% | -0.33% | -0.31% |
| 10% | 48h | 2900 | 2900 | +13.45% | +14.36% | ×0.94 | -0.18% | -0.50% | -0.41% |
| 15% | 24h | 2900 | 2900 | +3.00% | +3.22% | ×0.93 | -0.03% | -0.33% | -0.31% |
| 15% | 48h | 2900 | 2900 | +6.59% | +6.77% | ×0.97 | -0.18% | -0.50% | -0.41% |

月度 walk-forward：2026-01 -0.20%；2026-02 -0.83%；2026-03 -0.31%；2026-04 +0.29%；2026-05 +0.10%；2026-06 -1.17%。
Day-block bootstrap L95：-0.69%；正 P&L 集中度：top coin +8.20%、top UTC day +8.46%。
Robustness：fail，worst lift ×0.93。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 2900 events / 369 coins / 181 days / 6 months
- 10%×24h matched lift 0.95
- after-cost/funding mean -0.31%
- 2/6 positive monthly folds
- one or more fixed historical gates failed

### Organic spot proxy

分類：`historical-pass`；樣本 27 events / 16 coins / 24 UTC days / 6 months；coverage 56.7%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 27 | 27 | +18.52% | +11.23% | ×1.65 | +0.60% | -0.11% | +0.77% |
| 10% | 48h | 27 | 27 | +25.93% | +18.17% | ×1.43 | +8.98% | -1.09% | +9.45% |
| 15% | 24h | 27 | 27 | +14.81% | +5.38% | ×2.75 | +0.60% | -0.11% | +0.77% |
| 15% | 48h | 27 | 27 | +22.22% | +9.40% | ×2.36 | +8.98% | -1.09% | +9.45% |

月度 walk-forward：2026-01 -0.28%；2026-02 +12.85%；2026-03 -0.79%；2026-04 +0.65%；2026-05 +1.39%；2026-06 +0.09%。
Day-block bootstrap L95：-0.73%；正 P&L 集中度：top coin +26.52%、top UTC day +22.37%。
Robustness：pass，worst lift ×1.43。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 27 events / 16 coins / 24 days / 6 months
- 10%×24h matched lift 1.65
- after-cost/funding mean 0.77%
- 4/6 positive monthly folds

### Leverage froth control

分類：`historical-fail`；樣本 5094 events / 150 coins / 181 UTC days / 6 months；coverage 56.7%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 5094 | 5094 | +6.38% | +11.23% | ×0.57 | -0.41% | -0.58% | -0.72% |
| 10% | 48h | 5094 | 5094 | +12.78% | +18.17% | ×0.70 | -0.70% | -1.00% | -1.01% |
| 15% | 24h | 5094 | 5094 | +2.87% | +5.38% | ×0.53 | -0.41% | -0.58% | -0.72% |
| 15% | 48h | 5094 | 5094 | +5.75% | +9.40% | ×0.61 | -0.70% | -1.00% | -1.01% |

月度 walk-forward：2026-01 -0.75%；2026-02 -1.31%；2026-03 -0.62%；2026-04 +0.10%；2026-05 -0.66%；2026-06 -1.16%。
Day-block bootstrap L95：-1.11%；正 P&L 集中度：top coin +51.73%、top UTC day +14.57%。
Robustness：fail，worst lift ×0.53。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 5094 events / 150 coins / 181 days / 6 months
- 10%×24h matched lift 0.57
- after-cost/funding mean -0.72%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### True spot-led

分類：`historical-pass`；樣本 27 events / 16 coins / 24 UTC days / 6 months；coverage 56.7%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 27 | 27 | +18.52% | +11.23% | ×1.65 | +0.60% | -0.11% | +0.77% |
| 10% | 48h | 27 | 27 | +25.93% | +18.17% | ×1.43 | +8.98% | -1.09% | +9.45% |
| 15% | 24h | 27 | 27 | +14.81% | +5.38% | ×2.75 | +0.60% | -0.11% | +0.77% |
| 15% | 48h | 27 | 27 | +22.22% | +9.40% | ×2.36 | +8.98% | -1.09% | +9.45% |

月度 walk-forward：2026-01 -0.28%；2026-02 +12.85%；2026-03 -0.79%；2026-04 +0.65%；2026-05 +1.39%；2026-06 +0.09%。
Day-block bootstrap L95：-0.67%；正 P&L 集中度：top coin +26.52%、top UTC day +22.37%。
Robustness：pass，worst lift ×1.43。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 27 events / 16 coins / 24 days / 6 months
- 10%×24h matched lift 1.65
- after-cost/funding mean 0.77%
- 4/6 positive monthly folds

### UMM EMA20 reclaim control

分類：`historical-fail`；樣本 10608 events / 675 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 10608 | 10608 | +10.19% | +10.89% | ×0.94 | +0.06% | -0.27% | -0.21% |
| 10% | 48h | 10608 | 10608 | +18.34% | +18.87% | ×0.97 | -0.13% | -0.61% | -0.36% |
| 15% | 24h | 10608 | 10608 | +4.97% | +5.49% | ×0.91 | +0.06% | -0.27% | -0.21% |
| 15% | 48h | 10608 | 10608 | +9.57% | +10.31% | ×0.93 | -0.13% | -0.61% | -0.36% |

月度 walk-forward：2026-01 -1.00%；2026-02 -0.54%；2026-03 -0.15%；2026-04 +0.77%；2026-05 -0.16%；2026-06 -0.20%。
Day-block bootstrap L95：-0.53%；正 P&L 集中度：top coin +3.07%、top UTC day +5.62%。
Robustness：fail，worst lift ×0.91。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 10608 events / 675 coins / 181 days / 6 months
- 10%×24h matched lift 0.94
- after-cost/funding mean -0.21%
- 1/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### UMM B2

分類：`historical-fail`；樣本 1570 events / 560 coins / 173 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1570 | 1570 | +11.08% | +10.19% | ×1.09 | +0.17% | -0.26% | -0.07% |
| 10% | 48h | 1570 | 1570 | +20.57% | +18.34% | ×1.12 | +0.24% | -0.18% | +0.08% |
| 15% | 24h | 1570 | 1570 | +4.78% | +4.97% | ×0.96 | +0.17% | -0.26% | -0.07% |
| 15% | 48h | 1570 | 1570 | +10.13% | +9.57% | ×1.06 | +0.24% | -0.18% | +0.08% |

月度 walk-forward：2026-01 -1.79%；2026-02 +0.65%；2026-03 -0.06%；2026-04 +1.47%；2026-05 -0.82%；2026-06 +0.69%。
Day-block bootstrap L95：-0.71%；正 P&L 集中度：top coin +5.96%、top UTC day +16.73%。
Robustness：fail，worst lift ×0.96。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1570 events / 560 coins / 173 days / 6 months
- 10%×24h matched lift 1.09
- after-cost/funding mean -0.07%
- 3/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### UMM B2 quantity-OI challenger

分類：`historical-fail`；樣本 187 events / 159 coins / 95 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 187 | 187 | +17.65% | +10.19% | ×1.73 | +1.58% | -0.56% | +1.48% |
| 10% | 48h | 187 | 187 | +25.67% | +18.34% | ×1.40 | +1.87% | -0.19% | +1.96% |
| 15% | 24h | 187 | 187 | +11.23% | +4.97% | ×2.26 | +1.58% | -0.56% | +1.48% |
| 15% | 48h | 187 | 187 | +16.58% | +9.57% | ×1.73 | +1.87% | -0.19% | +1.96% |

月度 walk-forward：2026-01 -1.21%；2026-02 +0.74%；2026-03 +3.36%；2026-04 +3.20%；2026-05 -0.24%；2026-06 +2.04%。
Day-block bootstrap L95：-0.41%；正 P&L 集中度：top coin +18.70%、top UTC day +20.25%。
Robustness：pass，worst lift ×1.40。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 187 events / 159 coins / 95 days / 6 months
- 10%×24h matched lift 1.73
- after-cost/funding mean 1.48%
- 4/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### S15 deep reclaim quantity-OI armed

分類：`historical-fail`；樣本 2681 events / 605 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 2681 | 2681 | +17.16% | +12.42% | ×1.38 | -0.02% | -0.55% | -0.19% |
| 10% | 48h | 2681 | 2681 | +26.22% | +21.74% | ×1.21 | -0.66% | -1.02% | -0.73% |
| 15% | 24h | 2681 | 2681 | +9.21% | +6.18% | ×1.49 | -0.02% | -0.55% | -0.19% |
| 15% | 48h | 2681 | 2681 | +14.29% | +11.94% | ×1.20 | -0.66% | -1.02% | -0.73% |

月度 walk-forward：2026-01 +0.09%；2026-02 +0.12%；2026-03 -0.16%；2026-04 +0.55%；2026-05 +0.46%；2026-06 -1.58%。
Day-block bootstrap L95：-0.70%；正 P&L 集中度：top coin +5.43%、top UTC day +7.99%。
Robustness：pass，worst lift ×1.20。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 2681 events / 605 coins / 181 days / 6 months
- 10%×24h matched lift 1.38
- after-cost/funding mean -0.19%
- 4/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### S15 deep reclaim confirmed

分類：`historical-fail`；樣本 471 events / 304 coins / 161 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 471 | 471 | +21.87% | +12.42% | ×1.76 | +0.85% | -0.48% | +0.71% |
| 10% | 48h | 471 | 471 | +31.00% | +21.74% | ×1.43 | +0.21% | -0.84% | +0.20% |
| 15% | 24h | 471 | 471 | +12.53% | +6.18% | ×2.03 | +0.85% | -0.48% | +0.71% |
| 15% | 48h | 471 | 471 | +18.26% | +11.94% | ×1.53 | +0.21% | -0.84% | +0.20% |

月度 walk-forward：2026-01 -0.49%；2026-02 -0.24%；2026-03 +0.42%；2026-04 +2.87%；2026-05 +1.72%；2026-06 +0.63%。
Day-block bootstrap L95：-0.26%；正 P&L 集中度：top coin +5.26%、top UTC day +5.48%。
Robustness：pass，worst lift ×1.43。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 471 events / 304 coins / 161 days / 6 months
- 10%×24h matched lift 1.76
- after-cost/funding mean 0.71%
- 4/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### Entry-watch R1 breakout retest

分類：`historical-fail`；樣本 1110 events / 475 coins / 180 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 1110 | 1110 | +19.10% | +21.93% | ×0.87 | -0.33% | -1.39% | -0.49% |
| 10% | 48h | 1110 | 1110 | +26.58% | +29.02% | ×0.92 | -0.85% | -1.69% | -0.89% |
| 15% | 24h | 1110 | 1110 | +9.64% | +12.82% | ×0.75 | -0.33% | -1.39% | -0.49% |
| 15% | 48h | 1110 | 1110 | +15.77% | +18.87% | ×0.84 | -0.85% | -1.69% | -0.89% |

月度 walk-forward：2026-01 -1.07%；2026-02 -0.68%；2026-03 -0.63%；2026-04 -0.20%；2026-05 -0.07%；2026-06 -0.54%。
Day-block bootstrap L95：-1.16%；正 P&L 集中度：top coin +10.11%、top UTC day +11.99%。
Robustness：fail，worst lift ×0.75。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 1110 events / 475 coins / 180 days / 6 months
- 10%×24h matched lift 0.87
- after-cost/funding mean -0.49%
- 0/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### Entry-watch V2 breakout retest

分類：`historical-fail`；樣本 5426 events / 653 coins / 182 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 5426 | 5426 | +22.83% | +29.52% | ×0.77 | -0.13% | -1.21% | -0.28% |
| 10% | 48h | 5426 | 5426 | +31.44% | +36.84% | ×0.85 | -0.26% | -1.71% | -0.34% |
| 15% | 24h | 5426 | 5426 | +13.49% | +18.93% | ×0.71 | -0.13% | -1.21% | -0.28% |
| 15% | 48h | 5426 | 5426 | +19.81% | +25.09% | ×0.79 | -0.26% | -1.71% | -0.34% |

月度 walk-forward：2026-01 -0.22%；2026-02 -1.18%；2026-03 -0.27%；2026-04 +0.13%；2026-05 -0.17%；2026-06 -0.41%。
Day-block bootstrap L95：-0.70%；正 P&L 集中度：top coin +6.25%、top UTC day +8.63%。
Robustness：fail，worst lift ×0.71。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 5426 events / 653 coins / 182 days / 6 months
- 10%×24h matched lift 0.77
- after-cost/funding mean -0.28%
- 1/6 positive monthly folds
- pre-registered block-bootstrap lower bound is unavailable or non-positive
- one or more fixed historical gates failed

### Strength ≥70 crossing

分類：`historical-fail`；樣本 20940 events / 684 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 20940 | 20940 | +22.24% | +10.89% | ×2.04 | -0.11% | -1.13% | -0.27% |
| 10% | 48h | 20940 | 20940 | +30.01% | +18.87% | ×1.59 | -0.13% | -1.42% | -0.20% |
| 15% | 24h | 20940 | 20940 | +13.40% | +5.49% | ×2.44 | -0.11% | -1.13% | -0.27% |
| 15% | 48h | 20940 | 20940 | +19.36% | +10.31% | ×1.88 | -0.13% | -1.42% | -0.20% |

月度 walk-forward：2026-01 -0.70%；2026-02 -0.59%；2026-03 -0.30%；2026-04 +0.49%；2026-05 -0.13%；2026-06 -0.52%。
Day-block bootstrap L95：-0.57%；正 P&L 集中度：top coin +6.12%、top UTC day +5.32%。
Robustness：pass，worst lift ×1.59。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 20940 events / 684 coins / 181 days / 6 months
- 10%×24h matched lift 2.04
- after-cost/funding mean -0.27%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

### 全市場 Top 10 entry

分類：`historical-fail`；樣本 14237 events / 679 coins / 181 UTC days / 6 months；coverage 84.9%。

| Target | Horizon | Events | Complete | Hit rate | Matched baseline | Lift | Mean return | Median return | After cost/funding |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 24h | 14237 | 14237 | +26.25% | +10.89% | ×2.41 | -0.16% | -1.32% | -0.26% |
| 10% | 48h | 14237 | 14237 | +33.97% | +18.87% | ×1.80 | -0.18% | -1.78% | -0.15% |
| 15% | 24h | 14237 | 14237 | +16.53% | +5.49% | ×3.01 | -0.16% | -1.32% | -0.26% |
| 15% | 48h | 14237 | 14237 | +22.63% | +10.31% | ×2.19 | -0.18% | -1.78% | -0.15% |

月度 walk-forward：2026-01 -0.70%；2026-02 -0.82%；2026-03 -0.03%；2026-04 +0.67%；2026-05 -0.12%；2026-06 -0.54%。
Day-block bootstrap L95：-0.57%；正 P&L 集中度：top coin +7.55%、top UTC day +3.80%。
Robustness：pass，worst lift ×1.80。Frozen cross-target cells: 10%/15% × 24h/48h; detector thresholds are production constants.

- 14237 events / 679 coins / 181 days / 6 months
- 10%×24h matched lift 2.41
- after-cost/funding mean -0.26%
- 1/6 positive monthly folds
- one or more fixed historical gates failed

## 產品邊界

- 歷史 Strategy replay 同 forward Strategy Lab 分開。
- T1「一個月正 paper P&L」不可由 backtest 代替。
- Telegram delivery、Top-1 runtime selection、cooldown、uptime、paper account、真實 slippage 只可用 forward evidence。
- 本工具唔會改 live badge、Telegram、paper entry rule 或 signal tier。

## 統計註記

- Entry 係 decision 後下一個 native 15m open；只用 completed bars、as-of quantity/USD OI 同當時已知 funding。
- 每個 detector 每幣 24h cooldown；結果同時報 10%/15% × 24h/48h、30bps 後加實際 funding、月度 folds、day-block bootstrap 同集中度。
- `historical-pass` 只代表固定歷史 gate；唔會自動改任何產品 surface。
