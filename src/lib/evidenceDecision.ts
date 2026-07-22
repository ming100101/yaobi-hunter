// Product decision derived from the checksum-verified 2026-H1 historical
// evidence audit. Detector formulas and forward recording stay live; only the
// user-facing/action surfaces below are retired. Keeping the decision in one
// module prevents a badge, Telegram path or paper driver from drifting back on
// independently.

import type { StrategyId } from '../types';

export const H1_EVIDENCE_DECISION_ID = 'h1-evidence-decision-v1@2026-07-21';

export const H1_EVIDENCE_DECISION = {
  id: H1_EVIDENCE_DECISION_ID,
  badges: {
    flushBreakout: false,
    earlyAccum: false,
    spotPump: false,
    rebuildBreakout: false,
    virginBreakout: false,
  },
  insights: {
    flushBreakout: false,
    earlyAccum: false,
    spotPump: false,
    squeezeD3: false,
    boardingB2: false,
    rebuildR1: false,
    virginV2: false,
  },
  telegram: {
    fb: false,
    rb: false,
    vg: false,
    deepReclaimTestFeed: false,
  },
  entryWatch: false,
  paperSignalEntry: false,
  forwardShadowCollection: true,
  rankOnly: {
    strength70: true,
    top10: true,
  },
} as const;

export const H1_RETIRED_STRATEGIES: ReadonlySet<StrategyId> = new Set<StrategyId>([
  'boarding-b2-v1',
  'boarding-b2-oi-v1',
  'ema20-reclaim-control-v1',
  'virgin-v2',
  'rebuild-r1',
  'flush-breakout',
]);
