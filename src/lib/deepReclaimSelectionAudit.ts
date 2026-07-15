import {
  DEEP_RECLAIM_RULESET_ID,
  DEEP_RECLAIM_SELECTION_POLICY_ID,
  compareDeepReclaimOperationalCandidates,
  type DeepReclaimOperationalRankInput,
} from './deepReclaim';
import { DEEP_RECLAIM_GATE_PROTOCOL } from './researchGate';

export type DeepSelectionAnomalyCode =
  | 'missing-round-id'
  | 'conflicting-duplicate-id'
  | 'invalid-candidate'
  | 'eligibility-reason-mismatch'
  | 'candidate-order-drift'
  | 'selected-watch-mismatch'
  | 'status-mismatch'
  | 'armed-without-selection-round'
  | 'delivery-without-selection-round';

export interface DeepSelectionAnomaly {
  code: DeepSelectionAnomalyCode;
  roundId?: string;
  watchId?: string;
  detail: string;
}

export interface DeepSelectionAuditCandidate extends DeepReclaimOperationalRankInput {
  watchId: string;
  buyShare4h: number;
  qty1h: number;
  qty4h: number;
  eligible: boolean;
  reason: string | null;
}

export interface DeepSelectionAuditResult {
  rulesetId: string;
  gateProtocolId: string;
  selectionPolicyId: string;
  verdict: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  currentProtocolRows: number;
  legacySelectionRounds: number;
  rounds: number;
  validRounds: number;
  invalidRounds: number;
  duplicateRows: number;
  conflictingDuplicates: number;
  selectedRounds: number;
  suppressedRounds: number;
  deliveredSelections: number;
  failedSelections: number;
  uncertainSelections: number;
  pendingSelections: number;
  suppressionReasons: Record<string, number>;
  anomalies: DeepSelectionAnomaly[];
}

export interface DeepSelectionAuditOptions {
  /** False for bounded UI windows where older matching lifecycle rows may be outside the payload. */
  requireCompleteLinkage?: boolean;
}

interface ParsedRound {
  id: string;
  status: string;
  selectedWatchId: string | null;
  candidates: DeepSelectionAuditCandidate[];
  signature: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function currentProtocol(row: Record<string, unknown>): boolean {
  return row.rulesetId === DEEP_RECLAIM_RULESET_ID &&
    row.gateProtocolId === DEEP_RECLAIM_GATE_PROTOCOL.id &&
    row.selectionPolicyId === DEEP_RECLAIM_SELECTION_POLICY_ID;
}

function parseCandidate(value: unknown): DeepSelectionAuditCandidate | null {
  const row = record(value);
  if (!row || typeof row.watchId !== 'string' || !row.watchId || typeof row.sym !== 'string' || !row.sym) return null;
  if (![row.setupTs, row.ddPct, row.rankScore, row.operationalScore, row.buyShare4h, row.qty1h, row.qty4h].every(finite)) return null;
  if (typeof row.eligible !== 'boolean' || !(row.reason == null || typeof row.reason === 'string')) return null;
  if ((row.buyShare4h as number) < 0 || (row.buyShare4h as number) > 1) return null;
  return {
    watchId: row.watchId,
    sym: row.sym,
    setupTs: row.setupTs as number,
    ddPct: row.ddPct as number,
    rankScore: row.rankScore as number,
    operationalScore: row.operationalScore as number,
    buyShare4h: row.buyShare4h as number,
    qty1h: row.qty1h as number,
    qty4h: row.qty4h as number,
    eligible: row.eligible,
    reason: row.reason == null ? null : row.reason as string,
  };
}

function roundSignature(status: string, selectedWatchId: string | null, candidates: DeepSelectionAuditCandidate[]): string {
  return JSON.stringify({ status, selectedWatchId, candidates });
}

function parseRound(row: Record<string, unknown>, anomalies: DeepSelectionAnomaly[]): ParsedRound | null {
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) {
    anomalies.push({ code: 'missing-round-id', detail: 'current-protocol selection-round has no deterministic id' });
    return null;
  }
  const rawCandidates = Array.isArray(row.candidates) ? row.candidates : [];
  const candidates: DeepSelectionAuditCandidate[] = [];
  rawCandidates.forEach((value, index) => {
    const candidate = parseCandidate(value);
    if (candidate) candidates.push(candidate);
    else anomalies.push({ code: 'invalid-candidate', roundId: id, detail: `candidate ${index} is missing a frozen ranking input` });
  });
  const selectedWatchId = row.selectedWatchId == null
    ? null
    : typeof row.selectedWatchId === 'string' && row.selectedWatchId
      ? row.selectedWatchId
      : null;
  const status = typeof row.status === 'string' ? row.status : '';
  return { id, status, selectedWatchId, candidates, signature: roundSignature(status, selectedWatchId, candidates) };
}

function eventWatchId(row: Record<string, unknown>): string | null {
  return typeof row.watchId === 'string' && row.watchId ? row.watchId : null;
}

export function auditDeepReclaimSelection(
  events: unknown[],
  options: DeepSelectionAuditOptions = {},
): DeepSelectionAuditResult {
  const rows = events.map(record).filter((row): row is Record<string, unknown> => row != null && row.type === 'deep-reclaim');
  const current = rows.filter(currentProtocol);
  const legacySelectionRounds = rows.filter((row) => row.event === 'selection-round' && !currentProtocol(row)).length;
  const anomalies: DeepSelectionAnomaly[] = [];
  const byId = new Map<string, ParsedRound>();
  let duplicateRows = 0;
  let conflictingDuplicates = 0;

  for (const row of current.filter((value) => value.event === 'selection-round')) {
    const parsed = parseRound(row, anomalies);
    if (!parsed) continue;
    const previous = byId.get(parsed.id);
    if (!previous) {
      byId.set(parsed.id, parsed);
      continue;
    }
    if (previous.signature === parsed.signature) duplicateRows++;
    else {
      conflictingDuplicates++;
      anomalies.push({
        code: 'conflicting-duplicate-id',
        roundId: parsed.id,
        detail: 'the same deterministic round id carries different selection content',
      });
    }
  }

  const candidateWatchIds = new Set<string>();
  const selectedWatchIds = new Set<string>();
  const suppressionReasons: Record<string, number> = {};
  let validRounds = 0;
  let invalidRounds = 0;
  let selectedRounds = 0;
  let suppressedRounds = 0;

  for (const round of byId.values()) {
    const before = anomalies.length;
    for (const candidate of round.candidates) {
      candidateWatchIds.add(candidate.watchId);
      if ((candidate.eligible && candidate.reason != null) || (!candidate.eligible && candidate.reason == null)) {
        anomalies.push({
          code: 'eligibility-reason-mismatch',
          roundId: round.id,
          watchId: candidate.watchId,
          detail: 'eligible must be exactly equivalent to reason=null',
        });
      }
      if (candidate.reason != null) suppressionReasons[candidate.reason] = (suppressionReasons[candidate.reason] ?? 0) + 1;
    }

    const expectedOrder = [...round.candidates].sort(compareDeepReclaimOperationalCandidates);
    if (expectedOrder.map((candidate) => candidate.watchId).join('|') !== round.candidates.map((candidate) => candidate.watchId).join('|')) {
      anomalies.push({ code: 'candidate-order-drift', roundId: round.id, detail: 'recorded order differs from the deployed comparator' });
    }
    const expectedSelected = expectedOrder.find((candidate) => candidate.eligible && candidate.reason == null)?.watchId ?? null;
    if (round.selectedWatchId !== expectedSelected) {
      anomalies.push({
        code: 'selected-watch-mismatch',
        roundId: round.id,
        watchId: round.selectedWatchId ?? undefined,
        detail: `recorded=${round.selectedWatchId ?? 'null'} expected=${expectedSelected ?? 'null'}`,
      });
    }
    if ((round.status === 'selected') !== (round.selectedWatchId != null)) {
      anomalies.push({ code: 'status-mismatch', roundId: round.id, detail: `status=${round.status} selected=${round.selectedWatchId ?? 'null'}` });
    }
    if (round.selectedWatchId) {
      selectedRounds++;
      selectedWatchIds.add(round.selectedWatchId);
    } else suppressedRounds++;
    if (anomalies.length === before) validRounds++;
    else invalidRounds++;
  }

  const completeLinkage = options.requireCompleteLinkage !== false;
  if (completeLinkage) {
    const armed = new Set(current.filter((row) => row.event === 'armed').map(eventWatchId).filter((id): id is string => id != null));
    for (const watchId of armed) {
      if (!candidateWatchIds.has(watchId)) anomalies.push({
        code: 'armed-without-selection-round', watchId, detail: 'an OI-qualified armed watch is absent from forward selection provenance',
      });
    }
  }

  const delivered = new Set(current.filter((row) => row.event === 'early-delivered').map(eventWatchId).filter((id): id is string => id != null));
  const failed = new Set(current.filter((row) => row.event === 'delivery-failed').map(eventWatchId).filter((id): id is string => id != null));
  const uncertain = new Set(current.filter((row) => row.event === 'delivery-uncertain').map(eventWatchId).filter((id): id is string => id != null));
  if (completeLinkage) {
    for (const watchId of delivered) {
      if (!selectedWatchIds.has(watchId)) anomalies.push({
        code: 'delivery-without-selection-round', watchId, detail: 'Telegram delivery has no matching selected round',
      });
    }
  }

  let deliveredSelections = 0;
  let failedSelections = 0;
  let uncertainSelections = 0;
  let pendingSelections = 0;
  for (const watchId of selectedWatchIds) {
    if (delivered.has(watchId)) deliveredSelections++;
    else if (uncertain.has(watchId)) uncertainSelections++;
    else if (failed.has(watchId)) failedSelections++;
    else pendingSelections++;
  }
  const rounds = byId.size;
  const verdict = anomalies.length ? 'FAIL' : rounds === 0 ? 'UNAVAILABLE' : 'PASS';
  return {
    rulesetId: DEEP_RECLAIM_RULESET_ID,
    gateProtocolId: DEEP_RECLAIM_GATE_PROTOCOL.id,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
    verdict,
    currentProtocolRows: current.length,
    legacySelectionRounds,
    rounds,
    validRounds,
    invalidRounds,
    duplicateRows,
    conflictingDuplicates,
    selectedRounds,
    suppressedRounds,
    deliveredSelections,
    failedSelections,
    uncertainSelections,
    pendingSelections,
    suppressionReasons,
    anomalies,
  };
}
