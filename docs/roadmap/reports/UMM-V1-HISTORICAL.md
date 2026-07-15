# Ultimate Money Maker v1 — Historical evaluator report

Generated: 2026-07-15T02:26:24.481Z

Source: Binance Vision futures 5m cache (2026-04, 2026-05, 2026-06), 90 symbols.
Execution: next complete native 15m open; conservative stop-first ordering; 30 bps round trip plus actual Binance funding.
Funding unavailable for 0 event-bearing symbols; those rows remain visible but cannot pass a gate.

| Strategy | Exit | Complete | Coins | UTC days | Net mean | 60bps stress | Median | +4 before -3 | Max DD | Coverage |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| boarding-b2-v1 | time24-sl3-v1 | 85 | 52 | 46 | +0.55% | +0.25% | -3.19% | 27.1% | 49.9% | 98.8% |
| boarding-b2-v1 | ladder-4-8-15-sl3-v1 | 83 | 51 | 45 | -0.35% | -0.65% | -0.93% | 31.3% | 46.9% | 96.5% |
| boarding-b2-oi-v1 | time24-sl3-v1 | 5 | 5 | 4 | +17.57% | +17.27% | -1.24% | 40.0% | 4.5% | 83.3% |
| boarding-b2-oi-v1 | ladder-4-8-15-sl3-v1 | 5 | 5 | 4 | +0.95% | +0.65% | +0.20% | 40.0% | 3.6% | 83.3% |
| ema20-reclaim-control-v1 | time24-sl3-v1 | 791 | 90 | 85 | +0.14% | -0.16% | -1.02% | 30.6% | 88.9% | 98.9% |
| ema20-reclaim-control-v1 | ladder-4-8-15-sl3-v1 | 764 | 90 | 85 | -0.12% | -0.42% | -1.09% | 37.6% | 98.2% | 95.5% |

Matched directional lift (B2 / ordinary EMA20 reclaim, +4 before -3): 0.88.

| B2 24h month | Trades | Net mean | +4 before -3 |
|---|---:|---:|---:|
| 2026-04 | 16 | +3.05% | 50.0% |
| 2026-05 | 29 | -1.53% | 13.8% |
| 2026-06 | 40 | +1.07% | 27.5% |

Walk-forward positive monthly folds: 2/3.
Day-block bootstrap 95% lower bound for mean B2 return: -1.24%.
PnL concentration: top coin 56.9%, top UTC day 53.7%.

Quantity-OI challenger: 5 trades, net mean +17.57%, +4-before-3 40.0%.
24h-shifted OI placebo: 5 trades, net mean -1.42%, +4-before-3 0.0%.

This is a fixed-rule research replay, not a promotion decision. The initial OI ablation is sample-starved; full-month OI coverage, parameter sensitivity and promotion gates remain outstanding.
