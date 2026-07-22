# Post-selection evidence holdout — 2026-07-01 to 2026-07-21

- Cache as-of：2026-07-20
- Scoring boundary：Only events with complete cached outcomes count; 48h cells naturally stop roughly two days before 2026-07-20.
- 結果：0 pass／1 fail／1 insufficient

## Frozen protocol

- Rulesets and filters are exactly the 2026-07-22 frozen v2 definitions; July is never used to tune them.
- Futures/metrics use daily Binance archive zips with official checksums; missing days fail closed. July funding daily/monthly archives were unavailable, so a frozen Binance REST snapshot is separately hashed and disclosed.
- Completed bars only, next native 15m open, as-of quantity OI/funding and the same matched-control filter.
- Provisional holdout pass requires ≥10 complete events, ≥10 coins, ≥7 UTC days, 10%×24h lift ≥1.3, positive after-cost/funding mean, worst cross-cell lift >1.15 and day-block bootstrap L95 >0.

## Results

| v2 cohort | 狀態 | Complete events / coins / days | 10%×24h lift | Net | Worst lift | Bootstrap L95 | 月度 | 建議 |
|---|---|---|---:|---:|---:|---:|---:|---|
| `top-t1-reversal-v2` | `insufficient-sample` | 7 / 7 / 7 | 0.96× | 2.53% | 0.00× | -3.21% | 1/1 | 樣本未夠；保持 forward shadow，唔作成敗結論。 |
| `wbottom-w2-uncrowded-v2` | `holdout-fail` | 22 / 21 / 12 | 0.48× | -3.68% | 0.48× | -6.35% | 0/1 | 獨立 holdout gate 失敗；停止升班，保留研究紀錄。 |

## Boundaries

- Historical holdout cannot prove recorder uptime, runtime selection, Telegram delivery, paper fills or real slippage.
- No holdout result automatically changes badge, Telegram, paper, entry-watch or tier state.
- A failed or insufficient July result must not be repaired by retuning on July.
