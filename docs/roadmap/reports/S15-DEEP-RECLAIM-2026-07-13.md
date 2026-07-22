# S15 深跌收復 — Build & Verification Report (2026-07-13)

**One-line status:** the two-stage deep-reclaim signal is **implemented, typechecks, and passes every unit test**, but its promotion harness returns **`HARD FAIL / RESEARCH ONLY`** — the binding constraint is *data* (quantity-OI has ~1 month of history), not a disproven edge. Runtime ships **test-only, `deepReclaimTestEnabled` default ON** (user-authorized override); **badge / paper trading stay OFF** behind the full gate.

This report records verified reality as of 2026-07-13. The frozen definition lives in [DEEP-RECLAIM-V0.md](DEEP-RECLAIM-V0.md); the build plan in [S15-deep-reclaim.md](../S15-deep-reclaim.md).

---

## 1. What shipped (all files confirmed present on branch `roadmap-checkpoint-s5`, untracked/modified)

| Area | Artifact | Note |
|---|---|---|
| Detector + state machine | `src/lib/deepReclaim.ts` (34KB) | Pure, no I/O, no `Date.now()` — explicit `ts` per transition. Price candidate + OI decision + two-stage `observeDeepReclaim` + supersede/sanitize/frozen-constants. |
| Atomic state file | `scripts/deepReclaimFile.ts` | `%LOCALAPPDATA%/YaobiHunter/deep-reclaim.json`, write+fsync+rename. Separate from `entry-watch.json` and `kv.json`. |
| Recorder runtime | `scripts/deepReclaimRuntime.ts` (20KB) | Top-1/sweep, per-Asia-Shanghai-day quota, durable 🟡→🟢 reply-thread, confirmation audit, shadow-when-OFF. |
| Backtest harness | `scripts/backtest-deep-reclaim.ts` | Cache-only; 5m→15m aggregation; qty-OI (`sum_open_interest`) vs USD-OI contaminated control vs fixed-60m vs shifted-OI placebo; matched comparisons + robustness + promotion verdict. |
| Data layer | `src/data/binance.ts`, `src/data/oiStore.ts`, `src/lib/recording.ts`, `src/types.ts` | Quantity-OI (`oiQty`) added alongside USD; recording columns appended; `NotifyCfg.deepReclaimTestEnabled`; `NotifySignalClass 'dr'`. |
| Notify + UI | `scripts/notifyHeadless.ts`, `scripts/recorder.ts`, `scripts/server.cjs`, `src/components/PushWatchView.tsx`, `src/components/SettingsView.tsx` | Threaded test pair, `/notify-test-deep-reclaim`, opt-out toggle, push-tab view. |
| Tests + seed | `scripts/test-deep-reclaim.ts`, `scripts/test-deep-reclaim-runtime.ts`, `scripts/test-oi-quantity.ts`, `scripts/seed-deep-reclaim-references.ts` | 32 assertions total + 6 hypothesis-only reference cases. |

npm scripts registered: `deep-reclaim`, `test-deep-reclaim`, `test-deep-reclaim-runtime`, `test-oi-quantity`, `seed-deep-reclaim-refs`.

## 2. Verification — actually run 2026-07-13

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0, clean** |
| Detector + state machine | `npm run test-deep-reclaim` | **30 / 30 PASS** |
| Recorder runtime | `npm run test-deep-reclaim-runtime` | **PASS** (Top-1, success quota, durable thread, confirmation audit) |
| OI quantity store/as-of/recording | `npm run test-oi-quantity` | **PASS** |
| Backtest harness | `node scripts/.build/backtest-deep-reclaim.mjs --max 120` | **runs to completion (exit 0)** — verdict below |

The 30 detector tests cover the load-bearing invariants: causal (time-ordered) drawdown 6–20%, trough age 4–80 bars, fresh EMA20 cross, `pos24 ≤ 0.70`, `ret4h ∈ (0, 6%]`, setup-can-never-self-confirm, inclusive `[L0, L0+0.5·ATR0]` band, `L0+2·ATR0` no-chase, strict-below-trough invalidation, terminal precedence expiry→invalid→missed→confirm, OI as-of ≤10min fail-closed, and corrupt-row-drop sanitizer. **What this proves:** the code matches its own frozen contract at unit level. It does **not** prove live end-to-end behavior (no live 🟡→🟢 pair has fired yet).

## 3. Gate status — `HARD FAIL / RESEARCH ONLY` (verbatim harness output, 2026-06, 90 symbols, cache-only)

```
cache-only · symbols 90/90 · metrics 90 · price candidates 1003 · no 48h follow-up 71
setup quantity-OI: pass 31 · rejected 954 · missing/stale/future 18/0/0

method              H  alerts conf   rate  net/event net/coin  PF
price_only         24    1003  417  41.58%    -0.38%   -0.36%  0.53
qty_oi             24      31    3   9.68%    +0.02%   -0.04%  1.15
qty_oi             48      31    3   9.68%    +0.07%    0.00%  1.69
usd_oi_control     24      80   18  22.50%    -0.09%   +0.01%  0.77
fixed_60m          24    1003  945  94.22%    -1.02%   -1.14%  0.48
shifted_oi_placebo 24      45    8  17.78%    +0.42%   +0.47%  3.77

qty-OI matched net deltas (qty minus control), 24h:
  vs priceOnly n=31 · event +0.05% · coin -0.01%
  vs fixed60m  n=31 · event +0.27% · coin +0.13%
  vs usdOi     n=28 · event -0.18% · coin -0.25%
  vs shiftedOi n= 5 · event -1.01% · coin -1.01%

robustness (qty-OI): q4_lo PASS · q4_hi FAIL · band_lo FAIL · band_hi PASS · expiry_18h FAIL · expiry_30h FAIL · cost_40bps FAIL

PROMOTION: HARD FAIL / RESEARCH ONLY
counts confirms 3/100 · coins 3/40 · days 2/60 · months 1/3
reasons: confirms 3<100; confirmed coins 3<40; confirmed UTC days 2<60; confirmed months 1<3;
  cached quantity-metrics months 1<3; 24h net/coin <=0; h24/h48 does not beat matched priceOnly/usdOi/shiftedOi
  control on event+coin expectancy; robustness failed: q4_hi_3.75, band_lo_0.375atr, expiry_18h, expiry_30h, cost_40bps
```

## 4. Honest reading of the gate result

**The binding constraint is data, not a disproven edge.** Quantity-OI metrics (`sum_open_interest`) are cached for **only one month (2026-06)**, so of 1003 price candidates only **31** could even be OI-gated (954 rejected for absent metrics). At **31 alerts / 3 confirms**, nothing here is conclusive in either direction:

- **Matched incremental edge ≈ 0.** qty-OI minus price-only is **+0.05% event / −0.01% coin** at 24h — statistically indistinguishable from zero, and exactly the failure mode S14 warned about ("偵測更早冇 free lunch": triggers add ~0 incremental over the geometry state). It is *not yet* refuted the way S14 was, because n is far too small — but there is no positive signal either.
- **The shifted-OI placebo does not cleanly fail** (it looks spuriously *good* at n=45, PF 3.77). In a healthy gate the placebo must underperform; here it doesn't, which is a **symptom of insufficient data**, not evidence of edge.
- **Robustness is mixed** (4 of 7 knobs FAIL), again unreliable at n=3 confirms.
- USD-OI control fires more (80 alerts) only because USD OI has more history — but it is the *contaminated* control (price embedded in `sum_open_interest_value`), so its extra coverage is not a reason to prefer it.

**Net:** deep-reclaim is **research-only and data-starved**. The honest path is exactly what the promotion battery encodes — **forward-collect quantity OI, then re-gate at ≥3 months / ≥100 confirms / ≥40 coins**. This empirically confirms the feasibility flag raised at spec time: quantity OI has no backfill, so promotion is inherently forward-looking (same shape as entryWatch's "calendar-folds unavailable in one cached month").

## 5. IRON-RULE reconciliation

| Surface | State | Consistent with `ROADMAP.md:10/#86`? |
|---|---|---|
| Live 🟡→🟢 Telegram | **test-only, default ON**, cards labeled 「測試／市場提醒,非買入建議」, per-sweep Top-1, ≤10 successful/day, opt-out to shadow | User-authorized override (2026-07-13). Documented as a deliberate 用戶級 decision, *not* promotion. |
| Badge (screener) | **OFF** | ✅ locked behind full gate |
| Paper / auto trading | **OFF** | ✅ locked behind full gate |
| Removing 「測試」 label | **blocked** | ✅ requires the full promotion battery (Section 3 not met) |
| 6 reference cases | hypothesis-only, `chart-entry-cross-estimate`, ±15min, excluded from every gate | ✅ |

The single deviation from repo convention is the default-ON pre-gate **test** feed. It is bounded (test-labeled, opt-out, no badge/paper, gate still governs promotion) and is the user's explicit call.

## 6. Outstanding / next

- **Data**: forward-collect `sum_open_interest` (quantity) — 1 of 3 required months cached. This gates everything; nothing else can move the verdict.
- **Placebo integrity**: the shifted-OI control only becomes a meaningful "must fail" check once n is large enough; re-check at each monthly re-gate.
- **Robustness**: revisit `q4_hi`, `band_lo`, `expiry`, `cost_40bps` knobs only after n grows — current failures are noise-dominated.
- **Live fidelity**: no real 🟡→🟢 pair has fired; first live pair should be checked bar-for-bar against `observeDeepReclaim` (eval≠live risk, per the ⚡/S2 precedent).
- **B2 / S14** remain *external* controls — the harness deliberately refuses to fabricate approximate replays. Cross-checking against them is a separate 1H/5m harness run.

---

*Verification commands re-runnable: `npm run typecheck`, `npm run test-deep-reclaim`, `npm run test-deep-reclaim-runtime`, `npm run test-oi-quantity`, `npm run deep-reclaim`. Numbers above are from the 2026-06 cache-only run; they will change as quantity-OI history accumulates.*

## 7. 2026-07-14 activation addendum

- Re-ran typecheck, detector (30/30), runtime, quantity-OI and Push-tab tests: all passed.
- Added the explicit 12h and 36h expiry cells alongside the ±25% 18h/30h cells. Both additional cells fail on the current one-month sample, so the promotion verdict remains `HARD FAIL / RESEARCH ONLY`.
- Rebuilt the production UI, recorder bundle and Windows executable, then restarted the managed app and singleton recorder. The new recorder created `%LOCALAPPDATA%/YaobiHunter/deep-reclaim.json` successfully.
- Runtime remains test-only/default-on and disconnected from paper/automatic trading. The next evidence task is forward collection plus bar-for-bar review of the first real threaded early/confirmation pair.

## 8. 2026-07-14 anti-overfit gate hardening

The initial hardened promotion harness used protocol id `deep-reclaim-gate-v1@2026-07-13` and computed, rather than merely promised (this protocol is superseded by v2 in Section 11):

- exact-id matched `+10 before -5` precision lift against price-only and fixed-60m controls, both for all selected events and for the confirmation subset;
- deterministic one-sided block-bootstrap lower bounds, resampling symbol/day blocks for event expectancy and symbol blocks for coin expectancy;
- three chronological calendar folds with a 48h boundary purge; fewer than three months is explicitly unavailable and cannot pass;
- a shifted quantity-OI placebo audit that is unavailable, rather than credited as a pass, until it has enough months/events/blocks;
- robustness cells that must retain positive 24h/48h event and coin expectancy, positive matched deltas, and lift above 1.15.

The June cache remains a hard failure. New evidence is stricter: matched lift is 1.00 versus price-only, 0.25/0.17 versus fixed-60m for all 24h/48h selected events, bootstrap lower bounds are negative, walk-forward is unavailable, and placebo failure evidence is unavailable.

The geometry-threshold battery is now implemented as full-timeline re-detection, not post-filtering of the production candidates. It covers ±25% drawdown min/max, trough-age min/max (the +25% maximum is causally capped at 95 inside a 96-bar window), 24h range-position cap and 4h momentum cap. Every cell has its own same-geometry price-only control. The production detector continues to call only the frozen `DEEP_RECLAIM_GEOMETRY_V0`; research rules are an explicit separate seam and cannot mutate that object.

On the 2026-06 / 90-symbol cache all 22 robustness cells fail. The relaxed drawdown-min cell expands discovery from 1,003 to 1,284 candidates but its worst matched lift is only 0.50. The wider `0.625 ATR` confirmation cell, which had looked like the lone pass under the old base-control comparison, falls to FAIL with worst lift 1.00 when compared against its correct same-band price-only control. This is a concrete selection-bias correction; no runtime threshold was changed in response.

## 9. Evidence provenance lock

Live audit rows freeze `rulesetId`, `gateProtocolId`, and the causal UTC `cohortMonth` from setup time. Rows are also assigned an evidence role: source, lifecycle, delivery, or operational. Delivery/operational telemetry is explicitly ineligible for research denominators. Legacy unversioned watches remain monitorable after restart but are excluded from promotion evidence. Cohort isolation tests reject missing provenance, detector drift, gate-protocol drift, and a month inconsistent with the setup timestamp.

The Push tab now displays a separate `同規則樣本` count. It preserves eligibility once a source/lifecycle row exists, so a later Telegram delivery row cannot erase it. Browser verification on the rebuilt desktop app showed 48 visible deep-reclaim records but only 7 current-protocol evidence rows, which is the intended separation.

During browser verification Binance weight throttling exposed an unrelated availability issue: the old app blocked every tab behind the initial market scan. The app shell now renders navigation immediately; Push, Strategy, History and Settings remain usable while the scanner shows its own loading card. The rebuilt desktop app was verified from a cold loading state through navigation to Push, with no browser console errors.

## 10. Top-1 score separation and selection provenance

A runtime audit found that the per-sweep Top-1 path had been overwriting the detector's frozen price-only `rankScore` with the OI/buy-share `operationalScore`. Notification order was correct, but the stored research metadata was not: one field was silently representing two different definitions.

The two scores are now independent. `rankScore` remains the immutable geometry score produced by the detector; `operationalScore` alone determines the one-per-sweep delivery order. Deterministic ties fall back to price rank, drawdown, setup time and symbol. Runtime tests assert that selection and persistence cannot mutate the detector score.

New watches and audit rows freeze `selectionPolicyId=deep-reclaim-top1-v2@2026-07-14`. Promotion evidence and the Push-tab `同規則樣本` count now require an exact ruleset + gate protocol + selection-policy match. Old unversioned selection rows remain visible and monitorable but are excluded, so the previous seven current-protocol rows intentionally do not carry into the corrected denominator. No detector threshold, OI gate or Telegram cap was changed.

Live JSONL inspection also found that a restart/replay can append the same deterministic source event ID more than once (the UI already merged it). Protocol cohort isolation now keeps the first causally recorded exact ID and reports later copies as `duplicate-id`; repeated lines therefore cannot inflate the promotion denominator.

## 11. Runtime-selection fidelity gate

The deployed feed sends at most one early Telegram per sweep, ranked by a frozen score containing price geometry, quantity OI and `buyShare4h`. The historical harness had evaluated every quantity-OI-qualified detector event. Those are useful detector diagnostics, but they are not the same cohort as the alerts a user receives.

The operational score and total-order comparator now live in the shared pure detector module and are used directly by runtime, removing the risk of separate live/research implementations. The promotion protocol is bumped to `deep-reclaim-gate-v2@2026-07-14` and requires an exact replay of `deep-reclaim-top1-v2@2026-07-14`.

The current Binance Vision 5m cache contains OHLC only and cannot reconstruct the historical `buyShare4h` ranking input. The harness therefore reports the all-qualified cohort honestly, marks exact Top-1 replay unavailable, and adds that absence as a hard gate failure. It does not substitute a neutral buy-share value or an approximate rank. Forward v2 audit rows retain the exact operational inputs needed for a future delivered-feed holdout.

Each forward sweep that arms at least one OI-qualified watch now appends a `selection-round` operational record. It freezes the ranked candidate set, price and operational scores, quantity OI, buy-share input, per-candidate eligibility/exclusion reason, quota state and selected watch ID. These rows are explicitly ineligible for detector-performance denominators and hidden from coin rows in the Push UI; they exist only to make the live Top-1 policy exactly replayable and auditable.

`npm run eval-deep-selection` now validates those records against the shared comparator and current protocol. It fails on ordering drift, a selected watch other than the first eligible candidate, conflicting duplicate IDs, armed watches without a round, or deliveries without a selected round. Identical replay duplicates are counted but not treated as new decisions. With six current-protocol non-armed rows and no OI-qualified round at first deployment, the truthful initial result is `UNAVAILABLE`, not PASS.

The Push tab now runs the same pure auditor over its bounded recent-event payload and shows a non-technical status beside the research label: `Top-1 等首輪`, `Top-1 核對正常`, or `Top-1 核對異常`. Bounded UI data deliberately disables cross-window orphan checks while retaining exact within-round ordering and selected-watch validation; the full CLI remains authoritative for lifecycle linkage. Browser verification on the rebuilt desktop app showed `Top-1 等首輪` and 18 same-protocol detector rows, correctly distinguishing data collection from selection-fidelity evidence.

## 12. Desktop cold-start split

The scan list remains the only eager application surface. Coin charts and Push, History, Strategy and Settings are now separate lazy chunks with navigation-preserving loading shells. The production entry bundle fell from about 510 kB to 234 kB (54% smaller), and the previous 500 kB build warning disappeared. The SEA packager recursively embedded all 13 output assets. Browser verification opened all four secondary tabs and a live SNX chart detail from Push on the rebuilt desktop executable without a blank page.

## 13. Live evidence-copy audit

`npm run eval-rec` was rerun against the current Binance recordings before making any further detector change. The file contains 331 unique 15m slots across about 4.9 days. The current `flushBreakout` forward slice has 64 events: 4h hit lift 2.28, but the decision-relevant 24h hit lift is only **0.87** (3.1% versus the 3.6% all-observation baseline). This short window cannot justify a demotion by itself, but it does contradict presenting the frozen 37-day `lift ×2.0` study value as though it were current.

No detector threshold or notification tier was changed. Instead, every live product surface now distinguishes frozen research-window evidence from forward evidence:

- badges and detail reads label numeric studies as `舊研究窗` and direct the user to `記錄` for the accumulating result;
- the ⚡ copy carries a dated disclosure that the 2026-07-14 forward slice has not confirmed a 24h advantage;
- desktop and Telegram notifications no longer market a fixed lift multiple as a live property;
- Telegram's `同時亮` line no longer regex-extracts historical lift numbers from prose;
- `npm run test-evidence-copy` prevents the screener, detail, desktop-notification and Telegram surfaces from independently reintroducing an unlabelled frozen numeric claim.

The product action is deliberately narrower than a promote/demote decision. Reclassification remains a user-level decision after adequate forward span; the immediate anti-overfit requirement is that old study numbers cannot masquerade as current evidence while that span accumulates.

## 14. 2026-07-17 quantity-OI backfill — the "no backfill" premise was wrong

Sections 3–4 treated promotion as inherently forward-looking because quantity OI "has no backfill". That was verified today to be **false for Binance Vision**: the daily metrics dumps (`data.binance.vision/data/futures/um/daily/metrics/<SYM>USDT/`) carry `sum_open_interest` — the exact quantity series the June cache was already built from — at 5m resolution, available back to at least 2025-01 (spot-checked BTC and SKL across 2025-01/2025-07/2026-01/2026-04/2026-05; July is published to T-2). The 30-day limit that motivated the claim belongs to the fapi REST endpoint, not to Vision.

This backfill respects the spec's 「禁止假 backfill」 rule: it is the genuine `sum_open_interest` series from the same source the harness already used, not a USD-derived reconstruction and not OKX-spliced.

Backfilled into `scripts/backtest-data/5m/`: metrics for 2026-04 (81 symbols) and 2026-05 (89), plus klines+metrics for 2026-01..03 (in progress at time of writing). The first three-month gate run (`--month all`, 2026-04..06) follows.

## 15. 2026-07-17 three-month gate — the picture flips from data-starved to adverse

With 2026-04..06 metrics cached, `npm run deep-reclaim -- --month all` evaluates 2,437 price candidates and 93 quantity-OI-qualified setups (18 confirms, 15 coins, 16 days, 3/3 months — the months requirement is met for the first time). The verdict remains `HARD FAIL / RESEARCH ONLY`, but the reasons changed character:

- 24h net/event **−0.28%**, PF 0.34 (June alone had shown +0.02%; April and May are −0.56% and −0.42% per walk-forward fold).
- Purged walk-forward is now **available and FAILS** (two of three folds negative on both horizons).
- Matched deltas vs price-only are negative (−0.02% event / −0.21% coin at 24h); precision lift 0.29 all / 1.00 confirmed.
- The shifted-OI placebo now **fails as required** (lift 0.00/0.25) — the placebo anomaly in Section 4 was indeed a small-sample symptom, and the gate's integrity checks behave correctly once fed three months.
- All 21 geometry/knob robustness cells still fail.

Honest reading: the binding constraint is no longer only data volume. On three months the frozen band-confirmation signal has **negative expectancy and no incremental edge over its price-only control**. June was simply the good month. This is the same shape S14 died of, measured properly.

## 16. 2026-07-17 missed-cohort experiment — the 🟢 wick-miss leak, quantified

Live forward evidence (07-14 → 07-16: 17 armed 🟡, 2 confirmed, 4 missed, 7 invalid) exposed a structural fault: `observeDeepReclaim` terminates a watch the moment a single 15m **high** touches `L0 + 2·ATR` (`missed`), before any confirmation check. The four largest forward movers (HOME +36%, AERGO +24%, CAP +21%, BASED +14% MFE from setup) were all 🟡-flagged and none confirmed — they gapped through the band and were terminally missed, while the two smallest movers confirmed. The tight band systematically excludes the fastest pumps (the ⚡ tight-base precedent).

The harness now carries three research-only experiment cells (`EXPERIMENT_VARIANTS` in `backtest-deep-reclaim.ts`) testing the alternative confirmation seam: a strong **close** ≥ `L0 + 2·ATR` confirms (chase entry at the next 15m open, same fresh quantity-OI gate), and a wick touch alone is never terminal. Each cell has its own same-geometry price-only control; results print in a separate section and are **excluded from the promotion verdict and robustness battery**. The frozen `DEEP_RECLAIM_GEOMETRY_V0` and the production `observeDeepReclaim` are untouched; base-mode cells replicate the frozen semantics bit-for-bit (June regression identical, 35/35 detector tests pass, typecheck clean).

Three-month results (2026-04..06, 93 OI-qualified alerts):

| cell | confirms | 24h net/event | PF24 | base-missed captured | net/confirm on captured |
|---|---|---|---|---|---|
| `confirm_breakout_or_band` | 24 | −0.16% | 0.68 | 6 of 16 | +1.88% |
| `confirm_breakout_only` | 9 | **+0.11%** | 1.80 | 5 of 16 | **+2.92%** |
| `confirm_breakout_cost40` | 24 | −0.19% | 0.64 | 6 of 16 | +1.78% |

Reading: the leak is real and the captured missed-movers are genuinely profitable (+1.9–2.9% per confirm even after chase entry and costs). But the capture cohort is small (5–6 events over 3 months), and folding it into the band rule (`or_band`) still leaves overall expectancy negative because the band leg itself is negative (Section 15). Only the pure breakout leg is positive, at n=9, with matched precision lift vs its own control still below 1 — far from the ×1.3 promotion bar. A six-month extension (2026-01..03 backfill) decides whether the breakout leg is signal or noise (Section 17).

## 17. 2026-07-17 six-month verdict — the breakout leg shrinks with data; the base signal stays negative

2026-01..03 klines+metrics were backfilled the same way (211 coin-months added; 59 coin-months unlisted — newly listed coins have no Q1 history). `--month all` now evaluates six months: 4,695 price candidates, 176 quantity-OI-qualified alerts, 30 confirms across 27 coins / 28 days / 6 months.

**Base (frozen band rule): consistently non-positive at every scale tested.** 24h net/event −0.12%, PF 0.65, matched delta vs price-only −0.05% event / −0.13% coin, bootstrap lower bounds −0.31%/−0.35%, purged walk-forward FAIL (folds +0.20% / −0.28% / −0.22%). The placebo again fails as required, so this is a well-behaved gate reading, not an artifact. Verdict stays `HARD FAIL / RESEARCH ONLY`; with six months of genuine history the honest characterization moves from "data-starved" to "measured and adverse". June 2026 (+0.02%) was the best month in the sample and the one the signal was designed on.

**Breakout experiment: the noise signature.** Comparing three-month to six-month results:

| metric (`confirm_breakout_only`) | 3 months | 6 months |
|---|---|---|
| confirms | 9 | 19 |
| 24h net/event | +0.11% | +0.08% |
| PF24 | 1.80 | 1.52 |
| missed-cohort captured | 5 of 16 | 10 of 30 |
| net/confirm on captured (24h) | +2.92% | +0.96% |
| hit10 on captured | 2/5 | 2/10 |
| worst matched precision lift | 0.37 | 0.44 |

Every profitability metric regressed toward zero as the sample doubled, and the precision lift never approached 1.0, let alone the ×1.3 promotion bar (the quantity-OI gate makes precision *worse* than the same rule without it). `confirm_breakout_or_band` stays negative (−0.10% event, PF 0.77). The capture events are also rare: ~2 per month across 90 symbols.

**Decision.** The wick-miss leak is mechanically real — the frozen rules do discard the fastest movers, and the live 07-14→07-16 sample (HOME/AERGO/CAP/BASED) showed exactly that. But the measured fix is not a signal: its edge shrinks with data, its precision lift is far below the bar, and the base signal underneath is negative on six months of the very series whose absence previously excused it. Per the repo's iron rule (recording-only until lift ≥×1.3 + robustness), **the breakout confirmation must not ship to the runtime — not even as a test feed**. The experiment cells stay in the harness as the permanent, cheap way to re-measure this seam on future data. The remaining honest product question is user-level: whether the live test-only 早察 feed (default ON since 2026-07-13) is still worth its Telegram noise now that six months of backfilled evidence, not data scarcity, is what the gate is reporting.

## 18. 2026-07-21 unified H1 audit cross-check

Sections 14–17 remain the record of the 90-symbol dedicated harness. The root `HISTORICAL-EVIDENCE-AUDIT-2026-H1.md` is now the authoritative archive-wide comparison: it uses each month's complete eligible universe and the shared production detector path. It finds 2,681 armed events (10%×24h matched lift 1.38, net −0.19%) and 471 confirmations across 304 coins / 161 UTC days (lift 1.76, net +0.71%). The confirmation cohort still fails the frozen promotion battery because the day-block bootstrap lower bound is −0.26%; the armed cohort is net-negative. Both are classified `historical-fail`.

This larger cross-check changes the sample counts, not the product decision. No badge, Telegram switch, paper-entry rule or tier was changed. Exact historical Top-1 delivery remains unreconstructable and therefore forward-only; the test-feed decision remains with the user.
