# TG provenance and ⚡ pullback shadow — 2026-07-14

## Decision

THE is retained as a verified successful Telegram-card example, not as a detector-tuning target. This release does not change any ⚡, 📈 or 🚀 detector threshold and does not create a retroactive paper fill or watch from THE.

The Telegram card price is a scan reference only. Product copy and chart labels call it **TG 卡價**; only the independent confirmed-paper ledger is allowed to use **確認盤** markers.

## Shipped runtime contract

- Notify audit schema v3 separates `attemptedAt` from confirmed `deliveredAt` / `ts` and preserves class, strength, channel, message ID and card price.
- All Telegram-confirmed cards become `DeliveredSignal` rows. Only rich cards with clock-aligned completed-1H support/ATR become `DeliveredPush` / watchable rows.
- Failed Telegram delivery consumes neither cooldown nor watch state.
- ⚡ now enters the existing frozen support ±0.5 ATR shadow state machine after a successful anchored card.
- The minimum wait remains 30 minutes; invalidation remains support −1 ATR; +15% before a reclaim remains missed/no-chase; expiry remains 24 hours.
- `ENTRY_WATCH_PROMOTED.fb` remains false. A ready ⚡ shadow row is recorded in App/JSONL and can never send a second Telegram or enter paper/automatic trading.
- One active watch per symbol is preserved; a newer successful anchored card supersedes the active product watch without deleting historical outcomes.

## UI and evaluation truth

- Coin Detail fetches only symbol-filtered signal events and draws successful ⚡/📈/🚀 TG cards at confirmed delivery time.
- Coin Detail reads only `paper.confirmed.ledger`; legacy A/B/C paper books remain in History.
- Push, History and Coin Detail share one v1/v2/v3 delivery parser.
- History compares TG card price with the next exact completed 15-minute scan at 4h, 24h and 48h.
- Mid-slot Telegram cards start from the next slot. Missing entry slots, internal gaps and unfinished horizons remain data-missing/pending.
- Cohort output includes MFE, MAE, terminal return, 30 bps net reference, +4/+8/+10, −3/−5 and target-first ordering.

## Promotion lock

⚡ is evaluated separately. Promotion is not permitted in this release. A later decision requires at least 100 reached entries, 40 coins and 20 UTC days, positive expectation after 30 bps, matched lift at least 1.30, and sensitivity results above 1.15. THE is an audit example only and is excluded from one-case parameter selection.

## Deployment verification

- Typecheck, paper/strategy, notify, entry-watch, push compatibility, strict signal-outcome, era-seam and regime tests passed.
- Production UI and recorder bundles built, the Windows executable was replaced, and exactly one app plus one recorder process was observed after resume.
- The deployed `/signal-events` endpoint returned THE message IDs 691 / 696 / 710. Message 691 remained the historical ⚡ TG marker at 0.05467, with zero retroactive ⚡ entry-watch rows.
- A newly delivered card was observed in notify v3 with distinct attempt/delivery timestamps, a message ID and `watch.mode = shadow`.
- The deployed THE 15m chart visibly showed the ⚡ TG card at 0.05467 and the later TG markers; no confirmed-paper marker was fabricated.
- The deployed History page rendered both strict TG outcome cohorts and the Settings page showed the shadow monitor enabled with explicit no-second-TG / no-trading copy.
