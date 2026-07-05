# E3 — 市場 regime 標記:牛/熊/橫行分開統計 lift

**層級**: 第5層 自我進化 · **工作量**: S · **依賴**: R1

## zh-HK TL;DR
一個訊號喺牛市有 lift 唔代表熊市都有。呢個 spec 每 sweep 標記當時嘅 BTC regime(up/down/chop),記落 sweep-meta,等 eval-rec 可以分 regime 出 lift 表。防止「單一 regime 窗口」呢個 backtest 已知盲點(README:70)延續到 live eval。

## Design (decided)
- Regime rule (fixed): BTC 1H closes, last 200 bars (~8d): `ret7d = close/close[168h ago] − 1`. `up` if ret7d ≥ +5%, `down` if ≤ −5%, else `chop`. Data: `getBtcRet24h` pattern (okx.ts:341-351) extended — one extra candles call per sweep, cached per slot.
- Storage: sweep-meta line (R1) gains `"btcRegime": "up|down|chop", "btcRet7d": -3.2`.
- Eval: evalCore/eval-recordings gains `--regime up|down|chop` filter — slots whose meta says otherwise are excluded from BOTH signal events and baseline (baseline must match the filter or lift is meaningless).

## Steps
1. okx.ts: `getBtcRegime(base): Promise<{regime: string, ret7d: number} | null>` — `/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1H&limit=200`, compute rule above, module-cache 15 min.
2. Both sweep-meta writers include it (App recordSweep + recorder).
3. evalCore: index slot→regime from meta lines; `--regime` flag filters; E1 checklist gains a per-regime section (three lift tables) once ≥1 month of tagged data exists.

## Verification
- Sweep-meta lines carry `btcRegime`; `npm run eval-rec -- --regime chop` runs and reports fewer slots than unfiltered.

## Acceptance
- [ ] Fixed ±5%/7d rule, one cheap request, cached.
- [ ] Meta tagged by both writers; eval filter works with matched baseline.

## 陷阱 / Do-NOT
- Baseline MUST be filtered to the same regime slots as the signal events — mismatched baselines fabricate lift.
- Rule threshold changes require editing this spec (comparability, same as S4d).
- Pre-E3 recordings have no tag → excluded from regime-filtered runs (unfiltered runs unaffected). Note the cutover date in E1 reports.
