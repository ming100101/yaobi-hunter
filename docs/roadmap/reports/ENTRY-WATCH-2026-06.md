# Post-push entry-watch study (2026-06)

## Verdict

Keep both `rb` and `vg` entry-watch promotion gates **off**.

- The production-shaped breakout retest has an encouraging R1 point estimate and clears the matched-lift robustness floor, but only has 50 fills across 35 coins and 16 UTC days.
- V2 breakout retests improve expectancy versus an immediate fill, but reduce target precision and do not beat the fixed-pullback control.
- ATR + EMA20 loses expectancy for both classes and is rejected.
- Only one execution month is cached. Calendar-fold evidence and a symbol/date block-bootstrap confidence interval are unavailable, so the harness cannot emit a passing promotion verdict.

These are reconstructed R1/V2 alert opportunities, not a replay of an actual Telegram delivery log.

## Causal contract

- Reconstruct exact R1/V2 predicates from cached canonical 1H bars and OI.
- Emit only off-to-on rising edges, with a six-hour per-symbol/per-class cooldown.
- The signal becomes knowable at the completed 1H bar boundary (`bar open + 1h`).
- Freeze support at the prior 24-hour high and ATR0 at the simple mean of the final 14 completed 1H true ranges, including the signal bar.
- Aggregate only complete, clock-aligned triplets of Vision 5m bars into 15m bars.
- Primary readiness: after 30 minutes, a completed 15m bar overlaps `support +/- 0.5 ATR0`, closes at or above support and no higher than the upper band, then fills at the next 15m open.
- Before readiness, expire at 24 hours, invalidate on a 15m **close** below `support - ATR0`, or mark missed when a completed bar reaches `signal price * 1.15`.
- Controls: immediate, ATR pullback/reclaim, fixed-percent pullback/reclaim, EMA20, and EMA50. The secondary candidate requires both an ATR pullback and EMA20 reclaim.
- Evaluation is signal-relative through 48 hours. No-fill alerts remain in the denominator with a zero cash return. The ladder is 50% at +4%, 30% at +8%, 20% at +15%, with a -3% stop and a conservative stop-first rule for ambiguous OHLC bars. A 30 bp total cost is deducted from fills.

## Data coverage

| Item | Available cache |
|---|---:|
| Canonical 1H JSON files | 395 |
| 1H UTC extent across files | 2026-05-26 21:00 to 2026-07-08 06:00 |
| 1H bars per file | 260 to 900 |
| Non-metrics Vision 5m files for June | 90 symbols |
| June 5m UTC extent | 2026-06-01 00:00 to 2026-06-30 23:55 |
| Alert-bearing symbols joined to complete 15m bars | 62 |

The hourly scan reconstructed 370 R1 and 561 V2 edges in the full 395-symbol universe. The 90-symbol June execution universe contained 71 R1 and 112 V2 edges. After requiring ATR, a price join within 5%, and a full signal-relative 48-hour follow-up, 63 R1 and 100 V2 alerts remained. Nineteen lacked full follow-up and one failed the price join. Mean join gap was 0.023%; maximum accepted gap was 0.321%.

The script uses cached hourly OI only to reconstruct the initial class. It does not require the 5m metrics files. There is no July 5m cache, which is why late-June alerts cannot enter the 48-hour sample.

## Base results

Returns are mean net ladder return per original alert, so unfilled alerts count as cash at 0%. `Net/coin` first averages alerts inside each symbol, then weights symbols equally. Precision is the conditional rate of +10% before -5% among fills; matched lift compares only against immediate-entry outcomes for the exact same original alerts that the method filled.

### R1 (`rb`), 63 eligible alerts

| Method | Fills | Coins | UTC days | Net/alert | Net/coin | Delta vs immediate | Precision | Matched lift | PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Immediate | 63 | 42 | 18 | -0.08% | -0.36% | 0.00% | 25% | 1.00 | 0.95 |
| Breakout retest | 50 | 35 | 16 | **+0.48%** | **+0.27%** | **+0.55%** | **34%** | **1.42** | 1.48 |
| ATR + EMA20 | 61 | 40 | 18 | -0.20% | -0.53% | -0.12% | 18% | 0.69 | 0.87 |
| ATR reclaim | 55 | 38 | 18 | +0.31% | +0.13% | +0.39% | 22% | 0.80 | 1.25 |
| Fixed pullback | 49 | 33 | 17 | +0.23% | -0.05% | +0.30% | 27% | 0.93 | 1.23 |
| EMA20 | 63 | 42 | 18 | -0.17% | -0.51% | -0.09% | 21% | 0.81 | 0.89 |
| EMA50 | 62 | 41 | 18 | -0.73% | -0.86% | -0.65% | 21% | 0.81 | 0.58 |

Primary terminal counts: 50 filled, 4 expired, 6 invalidated, 3 missed.

### V2 (`vg`), 100 eligible alerts

| Method | Fills | Coins | UTC days | Net/alert | Net/coin | Delta vs immediate | Precision | Matched lift | PF |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Immediate | 100 | 47 | 21 | +0.21% | -0.38% | 0.00% | 32% | 1.00 | 1.15 |
| Breakout retest | 71 | 42 | 20 | +0.44% | +0.10% | +0.23% | 25% | 0.90 | 1.46 |
| ATR + EMA20 | 100 | 47 | 21 | -0.23% | -0.56% | -0.44% | 22% | 0.69 | 0.86 |
| ATR reclaim | 91 | 46 | 21 | +0.05% | -0.57% | -0.16% | 29% | 0.93 | 1.04 |
| Fixed pullback | 86 | 42 | 21 | **+0.49%** | **+0.24%** | **+0.28%** | 26% | 0.76 | 1.47 |
| EMA20 | 100 | 47 | 21 | -0.24% | -0.56% | -0.45% | 21% | 0.66 | 0.86 |
| EMA50 | 100 | 47 | 21 | -0.77% | -1.04% | -0.98% | 24% | 0.75 | 0.57 |

Primary terminal counts: 71 filled, 2 expired, 15 invalidated, 12 missed.

## Robustness cells

### Primary breakout retest

| Class | Cell | Fills | Net/alert | Net/coin | Delta vs immediate | Matched lift |
|---|---|---:|---:|---:|---:|---:|
| R1 | Base | 50 | +0.477% | +0.267% | +0.554% | 1.417 |
| R1 | Retest band -25% | 48 | +0.454% | +0.261% | +0.531% | 1.455 |
| R1 | Retest band +25% | 52 | +0.439% | +0.154% | +0.515% | 1.357 |
| R1 | Wait 12h | 48 | +0.336% | +0.188% | +0.412% | 1.455 |
| R1 | Wait 36h | 51 | +0.480% | +0.271% | +0.557% | 1.417 |
| R1 | Horizon 24h | 50 | +0.417% | +0.368% | +0.523% | **1.182** |
| V2 | Base | 71 | +0.443% | +0.095% | +0.232% | 0.900 |
| V2 | Retest band -25% | 66 | +0.375% | -0.044% | +0.164% | 1.000 |
| V2 | Retest band +25% | 78 | +0.472% | -0.040% | +0.261% | 0.826 |
| V2 | Wait 12h | 64 | +0.319% | +0.013% | +0.108% | 0.944 |
| V2 | Wait 36h | 72 | +0.410% | +0.025% | +0.199% | 0.900 |
| V2 | Horizon 24h | 71 | +0.445% | +0.139% | +0.144% | **0.722** |

### Secondary ATR + EMA20

| Class | Cell | Fills | Net/alert | Net/coin | Delta vs immediate | Matched lift |
|---|---|---:|---:|---:|---:|---:|
| R1 | Base | 61 | -0.199% | -0.530% | -0.123% | 0.688 |
| R1 | ATR pullback -25% | 62 | -0.153% | -0.486% | -0.077% | 0.813 |
| R1 | ATR pullback +25% | 60 | -0.414% | -0.658% | -0.338% | 0.667 |
| R1 | Wait 12h | 56 | -0.282% | -0.599% | -0.206% | 0.714 |
| R1 | Wait 36h | 62 | -0.200% | -0.532% | -0.124% | 0.688 |
| R1 | Horizon 24h | 61 | -0.335% | -0.572% | -0.230% | **0.533** |
| V2 | Base | 100 | -0.234% | -0.563% | -0.445% | 0.688 |
| V2 | ATR pullback -25% | 100 | -0.274% | -0.562% | -0.485% | 0.656 |
| V2 | ATR pullback +25% | 100 | -0.081% | -0.282% | -0.292% | 0.688 |
| V2 | Wait 12h | 97 | -0.278% | -0.553% | -0.489% | 0.677 |
| V2 | Wait 36h | 100 | -0.234% | -0.563% | -0.445% | 0.688 |
| V2 | Horizon 24h | 100 | -0.136% | -0.406% | -0.437% | **0.667** |

## Gate audit

Promotion requires at least 100 fills, 40 coins, 20 UTC days, positive net return per alert, positive delta versus immediate entry, higher expectancy than the generic pullback control, at least 1.30 base precision lift, worst-cell lift above 1.15, positive worst-cell delta, plus calendar-fold and block-bootstrap evidence.

- **R1 breakout retest: fail/inconclusive.** The base matched lift is 1.42 and every frozen robustness cell stays above 1.15 with positive event- and coin-weighted returns, but it misses fill, coin, day, calendar-fold, and bootstrap requirements.
- **V2 breakout retest: fail/inconclusive.** It loses to the fixed-pullback control, has negative coin-weighted returns in both retest-band sensitivity cells, misses base and robust matched-precision requirements, and lacks calendar-fold/bootstrap evidence.
- **R1/V2 ATR + EMA20: fail.** Both lose expectancy and precision versus immediate entry and lack the required robustness/evidence.

Reproduce with:

```text
npm run entry-watch -- --month 2026-06
npm run entry-watch -- --month 2026-06 --json
```

## 2026-07-21 superseded evidence note

以上 June-only 結果保留作當時研究紀錄，但唔再係 archive evidence 嘅最新準據。統一 H1 audit 用逐月完整 universe、同一 production pure detector、next native 15m open、as-of OI、30bps + actual funding、matched controls、六個月 folds 同 day-block bootstrap 重跑：

- R1 breakout retest：1,110 events / 475 coins / 180 days / 6 months；10%×24h matched lift ×0.87、net −0.49%、0/6 positive folds、bootstrap L95 −1.16% → `historical-fail`。
- V2 breakout retest：5,426 events / 653 coins / 182 days / 6 months；10%×24h matched lift ×0.77、net −0.28%、1/6 positive folds、bootstrap L95 −0.70% → `historical-fail`。

所以兩項由「一個月樣本不足」改為 **H1 historical gate failed**；唔再寫成等待 recordings。詳見根目錄 `HISTORICAL-EVIDENCE-AUDIT-2026-H1.md`。呢個分類唔會自動改通知、entry-watch toggle、paper rule 或 tier。

2026-07-21 用戶後續拍板：entry-watch production availability 關閉；唔再 arm／monitor 新 R1、V2 或 ⚡ watch。現有 state file 保留作 audit，冇刪資料；復議必須係新預註冊規則或真正 forward holdout，而唔係繼續叫「收集中」。
