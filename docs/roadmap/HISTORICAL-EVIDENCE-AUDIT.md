# Historical evidence audit — 2026 H1

## Purpose

This audit separates two questions that older roadmap notes sometimes mixed:

1. Can a fixed detector be reconstructed from historical exchange data?
2. Can a real runtime action or delivery event be reconstructed after the fact?

The answer to the first question is often yes. Binance Vision has monthly 5m
futures/spot archives, daily 5m metrics (including quantity and USD open
interest, long/short ratios and taker ratio), and monthly funding archives.
The second answer remains no for Telegram delivery, runtime Top-1 selection,
cooldowns, process uptime, paper-account paths and real slippage.

## Commands

```text
npm run cache-evidence -- --months=2026-01,2026-02,2026-03,2026-04,2026-05,2026-06 --universe=archive
npm run audit-evidence -- --months=2026-01,2026-02,2026-03,2026-04,2026-05,2026-06 --offline
```

The cache is resumable and lives under ignored
`scripts/backtest-data/evidence-v1/`. The audit never performs a network
request. It verifies every cached file hash against the manifest before use.

## Frozen data rules

- Scoring months are exactly 2026-01 through 2026-06.
- December 2025 is warm-up only. The first three days after each scoring month
  are outcome-only; July 2026 is never counted as a research month.
- Each monthly universe comes from that month's archive, not today's listings.
- Every USDT perpetual that has the required archive input in that month is
  eligible. A coin need not exist for all six months.
- Index, commodity and equity perpetuals are excluded to match production's
  `underlyingType === COIN` boundary.
- Multiplier aliases (`1000*` and `1M*`) share one normalized base. The highest
  quote-volume contract in that month represents the base.
- Missing files, missing days, timestamp gaps and stale as-of OI fail closed.
  They are coverage facts, never zero-filled observations.
- Official archive zip checksums are verified. The short REST funding buffer
  used only after a month boundary is marked separately because no archive
  checksum exists until Binance publishes that daily/monthly archive.

## Causality and statistics

- Signals use completed bars only.
- OI and funding are as-of the decision timestamp.
- Entry is the next native 15m open.
- Outcomes report 10%/15% × 24h/48h, matched controls, 30bps round-trip cost,
  actual funding, monthly folds, deterministic day-block bootstrap and
  coin/day concentration.
- Production pure detector functions are the final authority for the live
  detector families. Cheap broad prefilters only avoid unnecessary calls.
- Thresholds are frozen. The H1 run does not tune a detector after seeing the
  result.

## Evidence capabilities

- `historical-pass`: the frozen H1 historical gate passed; no live promotion.
- `historical-fail`: sufficient H1 evidence failed the frozen gate.
- `forward-confirmation-required`: history can perform an initial gate, but a
  live-era or consecutive-month rule remains.
- `forward-only`: runtime delivery/execution evidence cannot be recreated.
- `source-unavailable`: the required historical archive does not exist.
- `manual-external`: evidence belongs to a protected external source.
- `superseded`: an older no-history claim was disproved by an archive.

## Product boundary

The generated audit is advisory. It does not edit live badges, Telegram
switches, paper-entry rules, Strategy Lab state or the E2 tier map. Historical
Strategy replay and forward Strategy Lab evidence remain separate, and T1's
one positive paper-P&L month cannot be satisfied by this backtest.

Post-audit note: the audit itself remains immutable and advisory. The user made
a separate product decision on 2026-07-21 to retire failed signal surfaces while
preserving shadow evidence; see `H1-EVIDENCE-DECISION-2026-07-21.md`.
