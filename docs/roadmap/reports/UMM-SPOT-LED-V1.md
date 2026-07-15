# UMM Spot-led v1 historical replay

Generated: 2026-07-15T02:24:18.569Z

Source: 59 spot/perp matched symbols, 2026-04, 2026-05, 2026-06. Prices multiplier-aligned. Organic proxy requires fresh USD OI metrics and therefore uses only covered months.
Execution: common next-native-15m evaluator, 30bps plus actual funding. Fixed 24h per-strategy cooldown.

| Cohort | Exit | Trades | Coins | Days | Net mean | 60bps | +4 before -3 | Max DD |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ret4h>=2 momentum control | time24-sl3-v1 | 3140 | 59 | 89 | -0.53% | -0.83% | 31.2% | 100.0% |
| ret4h>=2 momentum control | ladder-4-8-15-sl3-v1 | 3088 | 59 | 88 | -0.47% | -0.77% | 36.6% | 100.0% |
| organic spot-volume proxy | time24-sl3-v1 | 132 | 55 | 29 | +0.27% | -0.03% | 28.0% | 60.1% |
| organic spot-volume proxy | ladder-4-8-15-sl3-v1 | 127 | 55 | 27 | -0.87% | -1.17% | 30.7% | 72.5% |
| true spot-led v1 | time24-sl3-v1 | 8 | 6 | 8 | +1.95% | +1.65% | 62.5% | 4.1% |
| true spot-led v1 | ladder-4-8-15-sl3-v1 | 8 | 6 | 8 | +1.80% | +1.50% | 62.5% | 3.3% |
