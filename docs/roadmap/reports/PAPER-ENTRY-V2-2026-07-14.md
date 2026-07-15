# Paper Entry V2 — 2026-07-14

## Outcome

The paper-trading screen now treats the next completed 15-minute observation as the executable entry instead of pretending that a signal can always be filled at the signal close. The policy is frozen as `next-closed-15m-v1@2026-07-14`.

This is an execution-quality correction, not a claim that the underlying signal has become profitable. The prior immediate-entry A/B/C books remain available as controls and are never merged into the new confirmed book.

## Why the old entry was inaccurate

The previous paper engine opened a position at the same scan price that created the signal. In live use, the scan must first finish and the next market observation is the earliest reproducible fill. Same-bar entry therefore gave the paper result information and execution quality that a live user could not reliably obtain.

## Frozen confirmed-entry policy

1. A completed scan creates an entry intent when a rising signal edge appears.
2. It does not open a position on that same scan.
3. The first later completed scan with a usable price becomes the paper fill, normally the next native 15-minute observation.
4. An intent expires after 45 minutes if no usable observation arrives; the engine does not back-fill at a convenient later price.
5. The signal time, signal price, actual fill time, actual fill price, delay, slippage and policy id are preserved in the ledger.
6. Existing position limits and duplicate-symbol protection still apply.

## Forward mechanism audit

The local recording set contained 336 unique completed slots covering 2026-07-09 through 2026-07-14. It is a short, gappy sample and is used only to check mechanism direction; it is not a promotion gate.

| Signal / side | Immediate close | Confirmed next observation | Mean entry slippage |
| --- | ---: | ---: | ---: |
| ⚡ long, ladder | 36 trades, -24.56% mean margin ROI | 34 trades, -15.21% | -0.38% |
| ⚡ short, ladder | 36 trades, +22.38% | 34 trades, +13.78% | direction-sensitive |
| Strength ≥70 long, ladder | 496 trades, -6.98% | 467 trades, -6.10% | recorded per trade |
| Strength ≥70 short, ladder | 517 trades, +12.16% | 489 trades, +7.37% | recorded per trade |

The sample is dominated by a short-side regime. It would be overfitting to switch the product to short-only because of these few days. The confirmed policy lowers the average ⚡ long fill by 0.38%, but it does not turn the long signal into a demonstrated edge.

## Product changes

- The Strategy screen leads with the current confirmed paper book: funds, return, open positions, pending entries, closed trades, win rate and profit factor.
- Comparisons are shown one dimension at a time: entry timing, signal class, direction and exit style.
- The daily table is reduced to date, sample count, win rate and result. Trade details expand only when requested.
- Methodology and limitations are collapsed by default.
- The dense legacy A/B/C research framework remains accessible from History instead of competing with the current strategy view.
- The compact paper status chip defaults to the confirmed book and hides fill-level details until expanded.

## Anti-overfit constraints

- No EMA length, pullback percentage, ATR multiple or score threshold was optimized for this change.
- The entry policy has a version id and fixed expiry window.
- Old and new books are separated so a policy change cannot rewrite past performance.
- Both long and short results remain visible; recent regime winners are not auto-selected.
- Missing next observations are skipped or expired rather than imputed.

## Verification

- TypeScript typecheck: pass.
- Paper state-machine tests, including queue, next-observation fill, provenance and expiry: pass.
- Strategy report tests, including 15-minute delay and slippage: pass.
- Strategy UI progressive-disclosure guards: pass.
- Production web build: pass.

## Remaining limitation

The confirmed book starts from zero on deployment so that old same-bar trades cannot contaminate it. A meaningful strategy conclusion still requires substantially more forward data across different market regimes. Until then, the screen should be read as an execution audit and market experiment, not a validated trading system.
