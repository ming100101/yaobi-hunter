import fs from 'node:fs';
import path from 'node:path';
import {
  EVIDENCE_DETECTORS,
  runEvidenceAudit,
  summarizeDetector,
  type AuditConfig,
  type DetectorDef,
  type EvalEvent,
  type EvidenceResearchCollection,
  type EvidenceResearchFeatures,
} from './evidenceAudit';
import { stableJson } from './evidenceCache';
import type { EvidenceAuditReport, HistoricalGateResult } from './evidenceTypes';
import {
  EVIDENCE_REMEDIATION_FILTERS,
  passesEvidenceRemediationFilter,
  type EvidenceRemediationFilterKey,
} from '../src/lib/evidenceRemediation';

export type EvidenceItemRole = 'entry' | 'ranking' | 'control' | 'setup';
export type RemediationStatus = 'role-corrected' | 'no-train-candidate' | 'validation-fail' | 'validation-pass';

export interface RemediationConfig extends AuditConfig {
  outputRemediationJson: string;
  outputRemediationMarkdown: string;
}

export interface RemediationTrial {
  filter: string;
  events: number;
  coins: number;
  primaryLift: number | null;
  primaryNetAfterCost: number | null;
  positiveMonths: number;
  worstLift: number | null;
  bootstrapLower95: number | null;
  trainEligible: boolean;
  score: number | null;
}

export interface RemediationItem {
  key: string;
  label: string;
  role: EvidenceItemRole;
  status: RemediationStatus;
  diagnosis: string;
  selectedFilter: string | null;
  train: HistoricalGateResult | null;
  validation: HistoricalGateResult | null;
  trials: RemediationTrial[];
  recommendation: string;
}

export interface EvidenceRemediationReport {
  v: 1;
  remediationId: 'historical-evidence-remediation-2026-h1-v1';
  sourceAuditId: string;
  sourceFingerprint: string;
  discoveryMonths: string[];
  validationMonths: string[];
  protocol: string[];
  summary: {
    failedItems: number;
    roleCorrected: number;
    entryCandidates: number;
    validationPass: number;
    validationFail: number;
    noTrainCandidate: number;
  };
  items: RemediationItem[];
  boundaries: string[];
}

interface ResearchFilter {
  key: EvidenceRemediationFilterKey;
  description: string;
  accept: (event: EvalEvent, features: EvidenceResearchFeatures) => boolean;
}

const ROLE_OVERRIDES: Record<string, Exclude<EvidenceItemRole, 'entry'>> = {
  strength70: 'ranking',
  top10: 'ranking',
  'leverage-froth': 'control',
  'umm-ema-control': 'control',
  'early-setup': 'setup',
  'spot-accum': 'setup',
  'deep-reclaim-armed': 'setup',
};

// These hypotheses are fixed before looking at the discovery/validation split.
// They deliberately use broad economic states rather than per-detector threshold grids.
export const REMEDIATION_FILTERS: ResearchFilter[] = EVIDENCE_REMEDIATION_FILTERS.map((filter) => ({
  ...filter,
  accept: (event, features) => passesEvidenceRemediationFilter(event.side, features, filter.key),
}));

function roleFor(key: string): EvidenceItemRole {
  return ROLE_OVERRIDES[key] ?? 'entry';
}

function cloneCandidate(event: EvalEvent, key: string, label: string): EvalEvent {
  return { ...event, key, label };
}

function primary(result: HistoricalGateResult) {
  return result.horizons.find((cell) => cell.targetPct === 10 && cell.horizonH === 24)!;
}

function trialFor(result: HistoricalGateResult): RemediationTrial {
  const cell = primary(result);
  const strict = result.key.startsWith('umm-') || result.key.startsWith('entry-watch-') || result.key.startsWith('deep-reclaim-');
  const sampleFloor = strict
    ? result.events >= 100 && result.coins >= 40 && result.days >= (result.key.startsWith('deep-reclaim-') ? 60 : 20)
    : result.events >= 20;
  const trainEligible = sampleFloor && result.months === 3 && (cell.lift ?? 0) >= 1.1 &&
    (cell.netAfterCost ?? -Infinity) > 0 && (result.robustness.worstLift ?? 0) >= 1 && result.walkForwardPositive >= 2;
  const score = trainEligible
    ? (cell.lift ?? 0) + (result.robustness.worstLift ?? 0) + (cell.netAfterCost ?? 0) * 100 + result.walkForwardPositive * 0.1
    : null;
  return {
    filter: result.key.slice(result.key.lastIndexOf('--') + 2),
    events: result.events,
    coins: result.coins,
    primaryLift: cell.lift,
    primaryNetAfterCost: cell.netAfterCost,
    positiveMonths: result.walkForwardPositive,
    worstLift: result.robustness.worstLift,
    bootstrapLower95: result.bootstrapLower95,
    trainEligible,
    score,
  };
}

function filteredEvents(rows: EvalEvent[], sourceKey: string, months: Set<string>, filter: ResearchFilter, candidateKey: string, label: string): EvalEvent[] {
  return rows
    .filter((event) => event.key === sourceKey && months.has(event.month) && event.research && filter.accept(event, event.research))
    .map((event) => cloneCandidate(event, candidateKey, label));
}

function filteredControls(rows: EvalEvent[], matchedKey: string, months: Set<string>, filter: ResearchFilter): EvalEvent[] {
  return rows.filter((event) => event.key === matchedKey && months.has(event.month) && event.research && filter.accept(event, event.research));
}

function fixedDefs(): DetectorDef[] {
  return [
    ...EVIDENCE_DETECTORS,
    { key: 'strength70', label: 'Strength ≥70 crossing', side: 'long', matchedKey: 'all' },
    { key: 'top10', label: '全市場 Top 10 entry', side: 'long', matchedKey: 'all' },
  ];
}

function diagnosisFor(result: HistoricalGateResult, role: EvidenceItemRole): string {
  if (role !== 'entry') return `${role} 並非獨立入場策略；原先用 entry gate 評分屬角色錯配。`;
  const cell = primary(result);
  if ((cell.netAfterCost ?? -Infinity) <= 0) return `原規則 10%×24h after-cost expectancy ${(100 * (cell.netAfterCost ?? 0)).toFixed(2)}%，需要新 confirmation，而非放寬 gate。`;
  if ((result.robustness.worstLift ?? 0) <= 1.15) return `部分 cell 有收益，但跨 10%/15% × 24h/48h robustness 不足。`;
  if ((result.bootstrapLower95 ?? -Infinity) <= 0) return `平均值偏正，但 day-block confidence lower bound 未高於零。`;
  return '樣本／月份一致性未達固定 gate。';
}

function pct(value: number | null): string { return value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`; }
function lift(value: number | null): string { return value == null ? 'n/a' : `${value.toFixed(2)}×`; }

export function renderRemediationMarkdown(report: EvidenceRemediationReport): string {
  const lines = [
    '# Historical evidence remediation — 2026 H1', '',
    `- Discovery：${report.discoveryMonths.join('、')}`, `- Validation：${report.validationMonths.join('、')}`,
    `- 失敗項目：${report.summary.failedItems}；角色修正：${report.summary.roleCorrected}；真正 entry candidates：${report.summary.entryCandidates}`,
    `- Validation pass：${report.summary.validationPass}；validation fail：${report.summary.validationFail}；train 無候選：${report.summary.noTrainCandidate}`, '',
    '## 規則', '',
    ...report.protocol.map((line) => `- ${line}`), '',
    '## 結果', '',
    '| 項目 | 角色 | 狀態 | 選定 filter | Train | Validation | 建議 |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const item of report.items) {
    const train = item.train ? `${item.train.events} events · ${lift(primary(item.train).lift)} · ${pct(primary(item.train).netAfterCost)}` : '—';
    const validation = item.validation ? `${item.validation.events} events · ${lift(primary(item.validation).lift)} · ${pct(primary(item.validation).netAfterCost)} · ${item.validation.walkForwardPositive}/${item.validation.walkForwardTotal} 月` : '—';
    lines.push(`| ${item.label} | \`${item.role}\` | \`${item.status}\` | ${item.selectedFilter ?? '—'} | ${train} | ${validation} | ${item.recommendation} |`);
  }
  lines.push('', '## 邊界', '', ...report.boundaries.map((line) => `- ${line}`), '');
  return lines.join('\n');
}

export function runEvidenceRemediation(cfg: RemediationConfig, log: (line: string) => void = console.log): EvidenceRemediationReport {
  if (cfg.months.length !== 6) throw new Error('remediation requires exactly six ordered months');
  const discoveryMonths = cfg.months.slice(0, 3);
  const validationMonths = cfg.months.slice(3);
  const discovery = new Set(discoveryMonths);
  const validation = new Set(validationMonths);
  let collection: EvidenceResearchCollection | null = null;
  const audit: EvidenceAuditReport = runEvidenceAudit({
    ...cfg,
    writeOutputs: false,
    captureResearch: (value) => { collection = value; },
  }, log);
  if (!collection) throw new Error('research event collection was not captured');
  const captured: EvidenceResearchCollection = collection;
  const defs = new Map(fixedDefs().map((def) => [def.key, def]));
  const failed = audit.results.filter((result) => result.capability === 'historical-fail');
  const items: RemediationItem[] = [];

  for (const source of failed) {
    const role = roleFor(source.key);
    if (role !== 'entry') {
      items.push({
        key: source.key, label: source.label, role, status: 'role-corrected',
        diagnosis: diagnosisFor(source, role), selectedFilter: null, train: null, validation: null, trials: [],
        recommendation: role === 'ranking' ? '保留排序用途，禁止當 entry。' : role === 'control' ? '保留作 veto／baseline。' : '保留 setup／armed evidence，等獨立 confirmation。',
      });
      continue;
    }
    const def = defs.get(source.key);
    if (!def) throw new Error(`missing remediation detector definition for ${source.key}`);
    const trained = REMEDIATION_FILTERS.map((filter) => {
      const candidateKey = `${source.key}-v2--${filter.key}`;
      const label = `${source.label} v2 ${filter.key}`;
      const events = filteredEvents(captured.events, source.key, discovery, filter, candidateKey, label);
      const controls = filteredControls(captured.controls, def.matchedKey, discovery, filter);
      const result = summarizeDetector({ key: candidateKey, label, matchedKey: def.matchedKey }, events, controls, source.coverage);
      return { filter, result, trial: trialFor(result) };
    });
    const selected = trained
      .filter((row) => row.trial.trainEligible)
      .sort((a, b) => (b.trial.score ?? -Infinity) - (a.trial.score ?? -Infinity) || a.filter.key.localeCompare(b.filter.key))[0];
    if (!selected) {
      items.push({
        key: source.key, label: source.label, role, status: 'no-train-candidate',
        diagnosis: diagnosisFor(source, role), selectedFilter: null, train: null, validation: null,
        trials: trained.map((row) => row.trial), recommendation: '固定 v2 hypotheses 喺 discovery 已不足；維持退休。',
      });
      continue;
    }
    const candidateKey = `${source.key}-v2--${selected.filter.key}`;
    const label = `${source.label} v2 ${selected.filter.key}`;
    const validationEvents = filteredEvents(captured.events, source.key, validation, selected.filter, candidateKey, label);
    const validationControls = filteredControls(captured.controls, def.matchedKey, validation, selected.filter);
    const validated = summarizeDetector({ key: candidateKey, label, matchedKey: def.matchedKey }, validationEvents, validationControls, source.coverage);
    const pass = validated.capability === 'historical-pass';
    items.push({
      key: source.key, label: source.label, role, status: pass ? 'validation-pass' : 'validation-fail',
      diagnosis: diagnosisFor(source, role), selectedFilter: selected.filter.key, train: selected.result, validation: validated,
      trials: trained.map((row) => row.trial),
      recommendation: pass ? '只加入 v2 shadow cohort；仍需 forward confirmation，唔開 badge／TG／paper。' : 'Validation 未通過；維持退休，唔用 H1 validation 再調參。',
    });
  }

  const report: EvidenceRemediationReport = {
    v: 1,
    remediationId: 'historical-evidence-remediation-2026-h1-v1',
    sourceAuditId: audit.auditId,
    sourceFingerprint: audit.sourceFingerprint,
    discoveryMonths,
    validationMonths,
    protocol: [
      '原 H1 audit 同失敗分類保持不變；v2 係新研究 cohort。',
      '只使用 decision timestamp 已完成 bar、as-of OI／funding 同當時 BTC regime。',
      '五個 broad hypotheses 預先固定；2026-01 至 03 只用作 discovery，2026-04 至 06 只驗證一次。',
      'Validation 失敗後不得再用同一 H1 validation months 調門檻。',
      'Ranking、control、setup 不再錯當獨立 entry strategy。',
    ],
    summary: {
      failedItems: failed.length,
      roleCorrected: items.filter((item) => item.status === 'role-corrected').length,
      entryCandidates: items.filter((item) => item.role === 'entry').length,
      validationPass: items.filter((item) => item.status === 'validation-pass').length,
      validationFail: items.filter((item) => item.status === 'validation-fail').length,
      noTrainCandidate: items.filter((item) => item.status === 'no-train-candidate').length,
    },
    items,
    boundaries: [
      '任何 validation-pass 只可進入 shadow cohort，唔會自動重開 live surface。',
      'Telegram delivery、runtime selection、paper fill 同真實 slippage 仍然只可 forward 記錄。',
      '本研究唔會覆寫 immutable H1 audit，亦唔會清除原 detector recordings。',
    ],
  };
  fs.mkdirSync(path.dirname(cfg.outputRemediationJson), { recursive: true });
  fs.writeFileSync(cfg.outputRemediationJson, stableJson(report));
  fs.writeFileSync(cfg.outputRemediationMarkdown, renderRemediationMarkdown(report));
  log(`[remediation] wrote ${cfg.outputRemediationJson}`);
  log(`[remediation] wrote ${cfg.outputRemediationMarkdown}`);
  return report;
}

export function parseRemediationArgs(argv: string[], cwd = process.cwd()): RemediationConfig {
  const cfg: RemediationConfig = {
    root: path.join(cwd, 'scripts', 'backtest-data', 'evidence-v1'),
    months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
    offline: true,
    outputJson: path.join(cwd, 'HISTORICAL-EVIDENCE-AUDIT-2026-H1.json'),
    outputMarkdown: path.join(cwd, 'HISTORICAL-EVIDENCE-AUDIT-2026-H1.md'),
    outputRemediationJson: path.join(cwd, 'HISTORICAL-EVIDENCE-REMEDIATION-2026-H1.json'),
    outputRemediationMarkdown: path.join(cwd, 'HISTORICAL-EVIDENCE-REMEDIATION-2026-H1.md'),
    maxCoinMonths: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg === '--offline') continue;
    if (arg.startsWith('--months')) { cfg.months = value.split(','); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--root')) { cfg.root = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-json')) { cfg.outputRemediationJson = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-md')) { cfg.outputRemediationMarkdown = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--max-coin-months')) { cfg.maxCoinMonths = Number(value); if (!arg.includes('=')) i++; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (cfg.months.length !== 6 || cfg.months.some((month) => !/^\d{4}-\d{2}$/.test(month))) throw new Error('remediation months must be six comma-separated YYYY-MM values');
  if (!Number.isInteger(cfg.maxCoinMonths) || cfg.maxCoinMonths < 0) throw new Error('max-coin-months must be a non-negative integer');
  return cfg;
}
