import assert from 'node:assert/strict';
import type { CoinLite } from '../src/types';
import {
  H1_EVIDENCE_DECISION,
  H1_EVIDENCE_DECISION_ID,
  H1_RETIRED_STRATEGIES,
} from '../src/lib/evidenceDecision';
import { ENTRY_WATCH_AVAILABLE } from '../src/lib/entryWatch';
import {
  applyEvidencePaperDecision,
  createConfirmedPaperState,
  createPaperState,
  evidenceApprovedPaperEdges,
} from '../src/lib/paper';
import { CLASS_FB, CLASS_REBUILD, CLASS_VIRGIN } from './notifyHeadless';
import { collectExistingSignalShadowCandidates } from './strategyShadowFile';

assert.equal(H1_EVIDENCE_DECISION.id, H1_EVIDENCE_DECISION_ID);
assert.deepEqual(H1_EVIDENCE_DECISION.badges, {
  flushBreakout: false,
  earlyAccum: false,
  spotPump: false,
  rebuildBreakout: false,
  virginBreakout: false,
});
assert.deepEqual(
  { fb: CLASS_FB.enabled, rb: CLASS_REBUILD.enabled, vg: CLASS_VIRGIN.enabled },
  { fb: false, rb: false, vg: false },
  'all audited first-stage Telegram classes are retired',
);
assert.equal(H1_EVIDENCE_DECISION.telegram.deepReclaimTestFeed, false);
assert.equal(ENTRY_WATCH_AVAILABLE, false);
assert.equal(H1_EVIDENCE_DECISION.paperSignalEntry, false);
assert.equal(H1_EVIDENCE_DECISION.forwardShadowCollection, true);
assert.equal(H1_EVIDENCE_DECISION.rankOnly.strength70, true);
assert.equal(H1_EVIDENCE_DECISION.rankOnly.top10, true);

const coin: CoinLite = {
  symbol: 'TEST', regime: 'accumulate', strength: 75, change1h: 1, change24h: 3,
  oi4h: 2, funding: 0, volZ: 2, vol24h: 10_000_000, lastPrice: 1,
  oiUsd: 1_000_000, flushBreakout: true, earlyAccum: true, spotPump: true,
  rebuildBreakout: true, virginBreakout: true, riskFlags: [], signals: {},
};

assert.deepEqual([...evidenceApprovedPaperEdges([coin], new Set())], [], 'retired detector cannot open a new paper entry');

const paper = createPaperState();
paper.confirmed = createConfirmedPaperState();
paper.confirmed.pending = [{
  id: 'old-intent', sym: 'TEST', signalTs: 1000, signalPx: 1, expiresTs: 2000,
}];
const decided = applyEvidencePaperDecision(paper, 1500);
assert.equal(decided.confirmed?.pending?.length, 0, 'unfilled pre-decision intent is cancelled');
assert.equal(decided.confirmed?.entryAudit.at(-1)?.action, 'expired');

const shadow = collectExistingSignalShadowCandidates([coin], Date.UTC(2026, 6, 21));
assert.deepEqual(
  shadow.map((x) => x.strategyId),
  ['virgin-v2', 'rebuild-r1', 'flush-breakout'],
  'retirement never erases raw forward shadow candidates',
);
for (const row of shadow) assert.ok(H1_RETIRED_STRATEGIES.has(row.strategyId));

console.log('H1 evidence decision: surfaces retired, paper fail-closed, shadow preserved PASS');
