# H1 evidence product decision — 2026-07-21

## Decision

User approved the post-audit retirement recommendation after reviewing
`HISTORICAL-EVIDENCE-AUDIT-2026-H1.md`. This is a product-surface decision, not
a detector rewrite: all frozen formulas, archive reports, recording fields and
runtime persistence schemas remain unchanged.

Central reversible policy: `src/lib/evidenceDecision.ts`, decision id
`h1-evidence-decision-v1@2026-07-21`.

## Retired user/action surfaces

- Screener badges hidden: ⚡ flush breakout, 蓄 early accumulation, spot pump,
  📈 rebuild R1 and 🚀 virgin V2. Their raw flags still reach recordings and
  forward Strategy Lab shadow collection.
- Detail insights hidden: ⚡, 蓄, spot-pump, D3 squeeze, B2 EMA reclaim, R1 and
  V2. Non-audited market/risk reads are unchanged.
- Automatic browser toast and Telegram first-stage classes `fb` / `rb` / `vg`
  are fail-closed. Cooldown state is preserved but no new send is attempted.
- R1/V2/⚡ entry-watch is unavailable and no longer armed or monitored. Existing
  state files are preserved for audit/recovery; no schema or destructive state
  migration is performed.
- S15 deep-reclaim automatic test Telegram is hard-off even if an older saved
  setting says true. Detection, OI assessment, selection-round audit and the
  complete shadow lifecycle continue; no delivery quota is consumed.
- The legacy ⚡ paper books receive no new signal entries. Unfilled intents are
  cancelled as expired audit rows; already-open paper positions continue to be
  marked and closed normally, preserving the ledger.

## Kept surfaces

- Strength and Top10 remain visible as ranking references only, never as entry
  triggers.
- Strategy Lab continues forward shadow evidence. Historical failures display
  `H1 歷史失敗 · 影子`, never `收集中` or an automatic promotion state.
- Organic-spot proxy remains an internal control; the product UI shows only the
  real-semantics `spot-led-v1` forward candidate. Neither receives a badge,
  notification or paper entry.
- Recorder, liquidation collection, archive cache/audit and all forward-only
  telemetry remain active. T1 stays locked.
- The non-audited 5m ignition research badge is outside this decision and is
  unchanged.

## Verification

- `test-evidence-decision` proves every retired surface is off while raw shadow
  candidates remain available.
- Notification tests prove production classes perform zero Telegram calls;
  transport plumbing remains covered through explicitly enabled test-only class
  copies.
- Deep-reclaim runtime tests prove stale saved opt-ins cannot send either stage,
  while selection and lifecycle evidence still complete causally.
- Final verification completed on 2026-07-21: typecheck passed, all 25
  deterministic test scripts passed, and the production app build succeeded.
- The recorder bundle was rebuilt and the running recorder was restarted onto
  decision id `h1-evidence-decision-v1@2026-07-21`.

## 2026-07-22 remediation addendum

The failed originals remain retired. A separate Jan–Mar discovery / Apr–Jun
validation study produced two new rulesets, `top-t1-reversal-v2` and
`wbottom-w2-uncrowded-v2`. They are forward-shadow only: this does not reopen
any badge, Telegram class, legacy paper entry, entry-watch or signal tier. See
`HISTORICAL-EVIDENCE-REMEDIATION-2026-H1.md`.
