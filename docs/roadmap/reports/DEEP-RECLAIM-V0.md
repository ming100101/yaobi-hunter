# Deep Reclaim v0 — independent two-stage test signal

Date frozen: 2026-07-13. Runtime label: **測試**. This detector is independent
of R1/V2 delivery and the post-push entry watcher. It must not be presented as
validated or connected to paper/automatic trading.

## Reference observations (hypothesis only)

Six protected-channel screenshots were aligned provisionally to the local
recordings using the visible entry-line crossing. They share a 24h drawdown of
roughly 6.5–14.4%, an EMA20 reclaim (five of six also reclaimed EMA50), and a
recorded USD-OI 4h rise of roughly 4.5–11.3%. Volume and funding were not common
conditions. USD OI is mechanically affected by price, so the live gate and the
research primary use **open-interest quantity**, never USD OI.

| Symbol | Provisional HKT anchor | Label | Strength | Printed price |
|---|---:|---|---:|---:|
| GUA | 2026-07-12 13:45 | 蓄力加倉 | 81 | 0.05266 |
| TLM | 2026-07-12 13:30 | 蓄力加倉 | 81 | 0.001887 |
| MMT | 2026-07-12 13:15 | 接人上車 | 78 | 0.1854 |
| EDGE | 2026-07-12 12:00 | 蓄力加倉 | 81 | 0.3822 |
| GWEI | 2026-07-12 07:45 | 蓄力加倉 | 81 | 0.0652 |
| RESOLV | 2026-07-12 02:15 | 蓄力加倉 | 74 | 0.01982 |

Every row above has `anchorMethod=chart-entry-cross-estimate`, uncertainty
±15 minutes, and is excluded from all gates. A chart crossing is not evidence
of the Telegram publication time.

## Frozen v0 contract

All decisions use canonical completed 15m bars. Require at least 100 bars and
use the final 96 (24h) for the context. The earlier running high and later low
that produce maximum drawdown must be ordered in time.

Early stage:

- maximum drawdown 6–20%; trough age 4–80 bars;
- no later low, fresh close cross above a rising EMA20;
- 24h range position ≤0.70 and 4h return >0% and ≤6%;
- quantity OI 1h >0% and 4h ≥3%, with the latest as-of observation no more
  than 10 minutes old;
- freeze ATR14, trough, EMA20/50 and `L0=max(EMA50, highest high after the
  trough and before the trigger)`; the trigger close may not already exceed
  `L0+0.5 ATR`.

Confirmation stage begins on the next completed 15m bar. A close inside
`[L0, L0+0.5 ATR0]` with the same fresh quantity-OI gate confirms. Close below
the frozen trough invalidates; a high at or above `L0+2 ATR0` before confirmation
is missed/no-chase; an explicit fresh OI failure on a price-confirming bar is
OI-rejected; missing/stale OI waits; expiry is 24h. Frozen fields never move.

The detector-specific score is only a deterministic Top-1 rank. One early
Telegram may be delivered per sweep and at most ten successful early messages
per Asia/Shanghai day. Confirmations reply to the original message and do not
consume this cap. Cooldown and cap are consumed only after Telegram accepts the
early message.

## Promotion gate

The test label remains until at least 100 confirmations, 40 symbols, 60 UTC
trading days and three calendar months are available. The 24h and 48h net
expectancy (30 bps costs) must be positive at event and coin weighting. The
quantity-OI variant must beat the same price-only events and fixed delay with
matched lift ≥1.30; every ±25% parameter and 12/24/36h window must remain above
1.15; purged walk-forward folds must be positive; the block-bootstrap lower
bound must be above zero; and circularly shifted OI must fail. If OI fails but
price-only passes, OI becomes display-only. If both fail, test Telegram is
disabled and collection continues in shadow mode. Promotion also requires an
exact replay of the current per-sweep Top-1 selection policy; an all-qualified
detector cohort cannot stand in for the feed users actually receive.
