/**
 * Reusable anti-overfit primitives for promotion research.
 *
 * These helpers are deliberately deterministic and have no market-data or I/O
 * dependencies.  A strategy may change only by registering a new protocol id;
 * historical output from different protocol ids must never be pooled.
 */

export const DEEP_RECLAIM_GATE_PROTOCOL = Object.freeze({
  id: 'deep-reclaim-gate-v2@2026-07-14',
  selectionPolicyId: 'deep-reclaim-top1-v2@2026-07-14',
  requireExactSelectionReplay: true,
  success: '+10-before-5',
  costBps: 30,
  minConfirmations: 100,
  minSymbols: 40,
  minUtcDays: 60,
  minCalendarMonths: 3,
  matchedLift: 1.3,
  robustnessLiftExclusive: 1.15,
  bootstrapAlpha: 0.05,
  bootstrapIterations: 2_000,
  bootstrapMinBlocks: 20,
  walkForwardFolds: 3,
  purgeHours: 48,
  placeboMinEvents: 100,
} as const);

export interface ResearchGateRow {
  id: string;
  sym: string;
  ts: number;
  confirmed: boolean;
  value: number;
  success: boolean;
  rulesetId?: string;
  gateProtocolId?: string;
  selectionPolicyId?: string;
  cohortMonth?: string;
}

export interface ProtocolCohortAudit {
  included: ResearchGateRow[];
  excluded: number;
  excludedByReason: Record<'missing-provenance' | 'ruleset-mismatch' | 'gate-protocol-mismatch' | 'selection-policy-mismatch' | 'cohort-mismatch' | 'duplicate-id', number>;
}

export interface PrecisionLift {
  eligible: number;
  primaryHits: number;
  controlHits: number;
  primaryPrecision: number;
  controlPrecision: number;
  lift: number;
}

export interface BootstrapBounds {
  available: boolean;
  iterations: number;
  alpha: number;
  eventBlocks: number;
  coinBlocks: number;
  eventLower: number | null;
  coinLower: number | null;
  reason: string | null;
}

export interface WalkForwardFold {
  fold: number;
  months: string[];
  rows: number;
  confirmations: number;
  symbols: number;
  eventMean: number;
  coinMean: number;
  pass: boolean;
}

export interface WalkForwardAudit {
  available: boolean;
  folds: WalkForwardFold[];
  pass: boolean;
  reason: string | null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function validRow(row: ResearchGateRow): boolean {
  return Boolean(
    row && row.id && row.sym && Number.isFinite(row.ts) && Number.isFinite(row.value),
  );
}

/** Prevents records produced by different detector/gate definitions from sharing one denominator. */
export function isolateProtocolCohort(
  rows: ResearchGateRow[],
  expected: { rulesetId: string; gateProtocolId: string; selectionPolicyId?: string },
): ProtocolCohortAudit {
  const excludedByReason: ProtocolCohortAudit['excludedByReason'] = {
    'missing-provenance': 0,
    'ruleset-mismatch': 0,
    'gate-protocol-mismatch': 0,
    'selection-policy-mismatch': 0,
    'cohort-mismatch': 0,
    'duplicate-id': 0,
  };
  const included: ResearchGateRow[] = [];
  const includedIds = new Set<string>();
  for (const row of rows) {
    if (!row.rulesetId || !row.gateProtocolId || !row.cohortMonth || (expected.selectionPolicyId && !row.selectionPolicyId)) {
      excludedByReason['missing-provenance']++;
      continue;
    }
    if (row.rulesetId !== expected.rulesetId) {
      excludedByReason['ruleset-mismatch']++;
      continue;
    }
    if (row.gateProtocolId !== expected.gateProtocolId) {
      excludedByReason['gate-protocol-mismatch']++;
      continue;
    }
    if (expected.selectionPolicyId && row.selectionPolicyId !== expected.selectionPolicyId) {
      excludedByReason['selection-policy-mismatch']++;
      continue;
    }
    if (row.cohortMonth !== new Date(row.ts).toISOString().slice(0, 7)) {
      excludedByReason['cohort-mismatch']++;
      continue;
    }
    if (includedIds.has(row.id)) {
      excludedByReason['duplicate-id']++;
      continue;
    }
    includedIds.add(row.id);
    included.push({ ...row });
  }
  return { included, excluded: rows.length - included.length, excludedByReason };
}

/** Exact-id comparison; optional confirmation selection is always based only on the primary arm. */
export function matchedPrecisionLift(
  primary: ResearchGateRow[],
  control: ResearchGateRow[],
  confirmedOnly: boolean,
): PrecisionLift {
  const byId = new Map(control.filter(validRow).map((row) => [row.id, row]));
  const pairs = primary
    .filter(validRow)
    .filter((row) => !confirmedOnly || row.confirmed)
    .map((row) => [row, byId.get(row.id)] as const)
    .filter((pair): pair is readonly [ResearchGateRow, ResearchGateRow] => pair[1] != null);
  const primaryHits = pairs.reduce((n, [row]) => n + Number(row.success), 0);
  const controlHits = pairs.reduce((n, [, row]) => n + Number(row.success), 0);
  const primaryPrecision = primaryHits / Math.max(1, pairs.length);
  const controlPrecision = controlHits / Math.max(1, pairs.length);
  const lift = controlPrecision > 0 ? primaryPrecision / controlPrecision : primaryPrecision > 0 ? Infinity : 0;
  return { eligible: pairs.length, primaryHits, controlHits, primaryPrecision, controlPrecision, lift };
}

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 0x9e3779b9;
}

function rng(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)));
  return sorted[idx];
}

function groupValues(rows: ResearchGateRow[], key: (row: ResearchGateRow) => string): number[][] {
  const groups = new Map<string, number[]>();
  for (const row of rows.filter(validRow)) {
    const values = groups.get(key(row)) ?? [];
    values.push(row.value);
    groups.set(key(row), values);
  }
  return [...groups.values()];
}

function resampledPooledMean(blocks: number[][], random: () => number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[Math.floor(random() * blocks.length)];
    for (const value of block) {
      sum += value;
      count++;
    }
  }
  return count ? sum / count : 0;
}

/**
 * One-sided deterministic block-bootstrap lower bounds.
 * Event expectancy resamples symbol/day blocks; coin expectancy resamples symbols.
 */
export function blockBootstrapLowerBounds(
  rows: ResearchGateRow[],
  options: { iterations?: number; alpha?: number; minBlocks?: number; seed?: string } = {},
): BootstrapBounds {
  const iterations = options.iterations ?? DEEP_RECLAIM_GATE_PROTOCOL.bootstrapIterations;
  const alpha = options.alpha ?? DEEP_RECLAIM_GATE_PROTOCOL.bootstrapAlpha;
  const minBlocks = options.minBlocks ?? DEEP_RECLAIM_GATE_PROTOCOL.bootstrapMinBlocks;
  const clean = rows.filter(validRow);
  const eventBlocks = groupValues(clean, (row) => `${row.sym}:${new Date(row.ts).toISOString().slice(0, 10)}`);
  const coinBlocks = groupValues(clean, (row) => row.sym);
  if (
    !Number.isInteger(iterations) || iterations < 100 || !(alpha > 0 && alpha < 0.5) ||
    eventBlocks.length < minBlocks || coinBlocks.length < minBlocks
  ) {
    return {
      available: false,
      iterations,
      alpha,
      eventBlocks: eventBlocks.length,
      coinBlocks: coinBlocks.length,
      eventLower: null,
      coinLower: null,
      reason: `need at least ${minBlocks} symbol/day and symbol blocks`,
    };
  }
  const random = rng(options.seed ?? DEEP_RECLAIM_GATE_PROTOCOL.id);
  const eventMeans: number[] = [];
  const coinMeans: number[] = [];
  const coinMeansByBlock = coinBlocks.map((values) => [mean(values)]);
  for (let i = 0; i < iterations; i++) {
    eventMeans.push(resampledPooledMean(eventBlocks, random));
    coinMeans.push(resampledPooledMean(coinMeansByBlock, random));
  }
  return {
    available: true,
    iterations,
    alpha,
    eventBlocks: eventBlocks.length,
    coinBlocks: coinBlocks.length,
    eventLower: percentile(eventMeans, alpha),
    coinLower: percentile(coinMeans, alpha),
    reason: null,
  };
}

function monthStart(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`);
}

function nextMonthStart(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return Date.UTC(year, mon, 1);
}

/** Three chronological, non-overlapping calendar folds with a 48h boundary purge. */
export function purgedWalkForward(
  rows: ResearchGateRow[],
  options: { folds?: number; purgeHours?: number } = {},
): WalkForwardAudit {
  const foldCount = options.folds ?? DEEP_RECLAIM_GATE_PROTOCOL.walkForwardFolds;
  const purgeMs = (options.purgeHours ?? DEEP_RECLAIM_GATE_PROTOCOL.purgeHours) * 60 * 60 * 1000;
  const clean = rows.filter(validRow);
  const months = [...new Set(clean.map((row) => new Date(row.ts).toISOString().slice(0, 7)))].sort();
  if (months.length < foldCount) {
    return { available: false, folds: [], pass: false, reason: `need ${foldCount} calendar months` };
  }
  const groups: string[][] = Array.from({ length: foldCount }, () => []);
  months.forEach((month, index) => groups[Math.min(foldCount - 1, Math.floor((index * foldCount) / months.length))].push(month));
  const folds = groups.map((group, index): WalkForwardFold => {
    const start = monthStart(group[0]) + purgeMs;
    const end = nextMonthStart(group[group.length - 1]) - purgeMs;
    const selected = clean.filter((row) => row.ts >= start && row.ts < end);
    const byCoin = new Map<string, number[]>();
    for (const row of selected) {
      const values = byCoin.get(row.sym) ?? [];
      values.push(row.value);
      byCoin.set(row.sym, values);
    }
    const eventMean = mean(selected.map((row) => row.value));
    const coinMean = mean([...byCoin.values()].map(mean));
    const confirmations = selected.filter((row) => row.confirmed).length;
    return {
      fold: index + 1,
      months: group,
      rows: selected.length,
      confirmations,
      symbols: byCoin.size,
      eventMean,
      coinMean,
      pass: selected.length > 0 && confirmations > 0 && eventMean > 0 && coinMean > 0,
    };
  });
  return { available: true, folds, pass: folds.every((fold) => fold.pass), reason: null };
}
