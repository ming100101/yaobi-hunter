export type EvidenceDataset = 'futures5m' | 'metrics' | 'funding' | 'spot5m';

export type EvidenceCapability =
  | 'historical-pass'
  | 'historical-fail'
  | 'forward-confirmation-required'
  | 'forward-only'
  | 'source-unavailable'
  | 'manual-external'
  | 'superseded';

export type CoverageStatus = 'complete' | 'partial' | 'missing' | 'invalid';

export interface DatasetCoverage {
  dataset: EvidenceDataset;
  symbol: string;
  base: string;
  period: string;
  status: CoverageStatus;
  relativePath?: string;
  sourceUrl?: string;
  archiveSha256?: string;
  cacheSha256?: string;
  rows: number;
  firstTs: number | null;
  lastTs: number | null;
  gaps: number;
  note?: string;
}

export interface MonthlyUniverseMember {
  month: string;
  base: string;
  symbol: string;
  mult: number;
  quoteVolume: number;
  priceRows: number;
  firstTs: number;
  lastTs: number;
}

export interface EvidenceManifest {
  v: 1;
  source: 'binance-public-data';
  months: string[];
  warmupMonth: string;
  outcomeThrough: string;
  generatedAt: string;
  excludedNonCoinSymbols?: string[];
  artifacts: DatasetCoverage[];
  monthlyUniverse: Record<string, MonthlyUniverseMember[]>;
}

export interface HorizonResult {
  targetPct: number;
  horizonH: number;
  events: number;
  complete: number;
  hitRate: number | null;
  baselineRate: number | null;
  lift: number | null;
  meanReturn: number | null;
  medianReturn: number | null;
  netAfterCost: number | null;
}

export interface HistoricalGateResult {
  key: string;
  label: string;
  capability: EvidenceCapability;
  events: number;
  coins: number;
  days: number;
  months: number;
  coverage: number;
  horizons: HorizonResult[];
  monthlyNet: Record<string, number | null>;
  walkForwardPositive: number;
  walkForwardTotal: number;
  bootstrapLower95: number | null;
  topCoinProfitShare: number | null;
  topDayProfitShare: number | null;
  robustness: { status: 'pass' | 'fail' | 'unavailable' | 'not-applicable'; worstLift: number | null; note: string };
  reasons: string[];
}

export interface EvidenceItem {
  key: string;
  label: string;
  oldBlocker: string;
  capability: EvidenceCapability;
  canBackfill: boolean;
  remainingForwardEvidence: string;
  recommendation: string;
  resultKey?: string;
}

export interface EvidenceAuditReport {
  v: 1;
  auditId: 'historical-evidence-audit-2026-h1';
  months: string[];
  sourceFingerprint: string;
  universe: { coinMonths: number; uniqueCoins: number; byMonth: Record<string, number> };
  coverage: {
    complete: number;
    partial: number;
    missing: number;
    invalid: number;
    byDataset: Record<EvidenceDataset, { complete: number; partial: number; missing: number; invalid: number }>;
  };
  results: HistoricalGateResult[];
  items: EvidenceItem[];
  boundaries: string[];
}
