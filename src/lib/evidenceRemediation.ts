export type EvidenceTradeSide = 'long' | 'short';

export interface EvidenceRemediationFeatures {
  assetRet1h: number | null;
  assetRet4h: number | null;
  assetRet24h: number | null;
  btcRet24h: number | null;
  oi4h: number | null;
  fundingRate: number | null;
  takerBuy1h: number | null;
  volumeRatio24h: number | null;
  rangePos24h: number | null;
  strength: number | null;
}

export type EvidenceRemediationFilterKey =
  | 'trend-aligned'
  | 'flow-confirmed'
  | 'uncrowded-trend'
  | 'reversal-confirmed'
  | 'participation-quality';

export const EVIDENCE_REMEDIATION_FILTERS: ReadonlyArray<{
  key: EvidenceRemediationFilterKey;
  description: string;
}> = [
  { key: 'trend-aligned', description: '4h/24h price direction and BTC 24h regime agree with the trade side' },
  { key: 'flow-confirmed', description: 'latest completed hour, taker flow and quantity OI agree without extreme crowding' },
  { key: 'uncrowded-trend', description: 'side-aligned 4h move with benign funding, moderate OI and BTC support' },
  { key: 'reversal-confirmed', description: '24h extension has begun a one-hour reversal at the appropriate range location' },
  { key: 'participation-quality', description: 'volume expansion, moderate strength and side-aligned taker participation' },
] as const;

export const VALIDATED_H1_REMEDIATIONS = [
  { sourceKey: 'top-t1', strategyId: 'top-t1-reversal-v2', side: 'short', filter: 'reversal-confirmed' },
  { sourceKey: 'wbottom-w2', strategyId: 'wbottom-w2-uncrowded-v2', side: 'long', filter: 'uncrowded-trend' },
] as const satisfies ReadonlyArray<{
  sourceKey: string;
  strategyId: string;
  side: EvidenceTradeSide;
  filter: EvidenceRemediationFilterKey;
}>;

function known(...values: Array<number | null>): boolean {
  return values.every((value) => value != null && Number.isFinite(value));
}

export function passesEvidenceRemediationFilter(
  side: EvidenceTradeSide,
  features: EvidenceRemediationFeatures,
  filter: EvidenceRemediationFilterKey,
): boolean {
  const f = features;
  switch (filter) {
    case 'trend-aligned':
      return known(f.assetRet4h, f.assetRet24h, f.btcRet24h) && (side === 'long'
        ? f.assetRet4h! > 0 && f.assetRet24h! > 0 && f.btcRet24h! >= 0
        : f.assetRet4h! < 0 && f.btcRet24h! <= 0);
    case 'flow-confirmed':
      return known(f.assetRet1h, f.oi4h, f.fundingRate, f.takerBuy1h) && (side === 'long'
        ? f.assetRet1h! > 0 && f.oi4h! >= 0 && f.oi4h! <= 0.15 && f.fundingRate! <= 0.0003 && f.takerBuy1h! >= 0.52
        : f.assetRet1h! < 0 && f.oi4h! >= 0 && f.oi4h! <= 0.15 && f.fundingRate! >= 0 && f.takerBuy1h! <= 0.48);
    case 'uncrowded-trend':
      return known(f.assetRet4h, f.btcRet24h, f.oi4h, f.fundingRate) && (side === 'long'
        ? f.assetRet4h! > 0 && f.assetRet4h! <= 0.06 && f.btcRet24h! >= 0 && f.oi4h! >= 0 && f.oi4h! <= 0.10 && f.fundingRate! <= 0.0001
        : f.assetRet4h! < 0 && f.btcRet24h! <= 0 && f.oi4h! >= 0 && f.oi4h! <= 0.10 && f.fundingRate! >= 0);
    case 'reversal-confirmed':
      return known(f.assetRet1h, f.assetRet24h, f.rangePos24h, f.oi4h) && (side === 'long'
        ? f.assetRet24h! < 0 && f.assetRet1h! > 0 && f.rangePos24h! <= 0.65 && f.oi4h! >= 0
        : f.assetRet24h! > 0 && f.assetRet1h! < 0 && f.rangePos24h! >= 0.65 && f.oi4h! >= 0);
    case 'participation-quality':
      return known(f.assetRet1h, f.takerBuy1h, f.volumeRatio24h, f.strength) &&
        f.volumeRatio24h! >= 1.2 && f.strength! >= 55 && f.strength! <= 85 && (side === 'long'
          ? f.assetRet1h! > 0 && f.takerBuy1h! >= 0.52
          : f.assetRet1h! < 0 && f.takerBuy1h! <= 0.48);
  }
}
