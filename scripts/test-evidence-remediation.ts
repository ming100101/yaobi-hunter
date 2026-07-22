import assert from 'node:assert/strict';
import {
  EVIDENCE_REMEDIATION_FILTERS,
  VALIDATED_H1_REMEDIATIONS,
  passesEvidenceRemediationFilter,
  type EvidenceRemediationFeatures,
} from '../src/lib/evidenceRemediation';

const base: EvidenceRemediationFeatures = {
  assetRet1h: -0.01,
  assetRet4h: 0.02,
  assetRet24h: 0.20,
  btcRet24h: 0.01,
  oi4h: 0.02,
  fundingRate: 0,
  takerBuy1h: 0.5,
  volumeRatio24h: 1.2,
  rangePos24h: 0.8,
  strength: 70,
};

assert.deepEqual(EVIDENCE_REMEDIATION_FILTERS.map((row) => row.key), [
  'trend-aligned',
  'flow-confirmed',
  'uncrowded-trend',
  'reversal-confirmed',
  'participation-quality',
]);
assert.equal(passesEvidenceRemediationFilter('short', base, 'reversal-confirmed'), true);
assert.equal(passesEvidenceRemediationFilter('short', { ...base, assetRet1h: 0 }, 'reversal-confirmed'), false);
assert.equal(passesEvidenceRemediationFilter('short', { ...base, rangePos24h: 0.649 }, 'reversal-confirmed'), false);
assert.equal(passesEvidenceRemediationFilter('short', { ...base, oi4h: null }, 'reversal-confirmed'), false, 'quantity OI fails closed');

const w2: EvidenceRemediationFeatures = { ...base, assetRet1h: 0.01, assetRet4h: 0.06, assetRet24h: -0.05 };
assert.equal(passesEvidenceRemediationFilter('long', w2, 'uncrowded-trend'), true, 'frozen inclusive upper thresholds pass');
assert.equal(passesEvidenceRemediationFilter('long', { ...w2, assetRet4h: 0.06001 }, 'uncrowded-trend'), false);
assert.equal(passesEvidenceRemediationFilter('long', { ...w2, btcRet24h: -0.00001 }, 'uncrowded-trend'), false);
assert.equal(passesEvidenceRemediationFilter('long', { ...w2, fundingRate: 0.0001001 }, 'uncrowded-trend'), false);

assert.deepEqual(VALIDATED_H1_REMEDIATIONS, [
  { sourceKey: 'top-t1', strategyId: 'top-t1-reversal-v2', side: 'short', filter: 'reversal-confirmed' },
  { sourceKey: 'wbottom-w2', strategyId: 'wbottom-w2-uncrowded-v2', side: 'long', filter: 'uncrowded-trend' },
]);

console.log('evidence remediation filters and validated shadow cohorts PASS');
