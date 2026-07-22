import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  EVIDENCE_DETECTORS,
  evaluateOutcome,
  runEvidenceAudit,
  summarizeDetector,
  type AuditConfig,
  type EvalEvent,
  type EvidenceResearchCollection,
} from './evidenceAudit';
import { stableJson } from './evidenceCache';
import type { EvidenceManifest, HistoricalGateResult } from './evidenceTypes';
import {
  VALIDATED_H1_REMEDIATIONS,
  passesEvidenceRemediationFilter,
  type EvidenceRemediationFilterKey,
  type EvidenceTradeSide,
} from '../src/lib/evidenceRemediation';

export type HoldoutStatus = 'holdout-pass' | 'holdout-fail' | 'insufficient-sample';

export interface HoldoutGateInput {
  completeEvents: number;
  completeCoins: number;
  completeDays: number;
  primaryLift: number | null;
  netAfterCost: number | null;
  worstLift: number | null;
  bootstrapLower95: number | null;
}

export interface HoldoutGateClassification {
  status: HoldoutStatus;
  gates: HoldoutItem['gates'];
}

export interface HoldoutItem {
  strategyId: (typeof VALIDATED_H1_REMEDIATIONS)[number]['strategyId'];
  sourceKey: string;
  side: EvidenceTradeSide;
  filter: EvidenceRemediationFilterKey;
  status: HoldoutStatus;
  result: HistoricalGateResult;
  completeEvents: number;
  completeCoins: number;
  completeDays: number;
  gates: {
    sample: boolean;
    primaryLift: boolean;
    netAfterCost: boolean;
    robustness: boolean;
    bootstrap: boolean;
  };
  recommendation: string;
}

export interface EvidenceHoldoutReport {
  v: 1;
  holdoutId: 'historical-evidence-holdout-2026-07-01_2026-07-21-v1';
  frozenRulesetAt: '2026-07-22';
  sourceFingerprint: string;
  cacheAsOf: string;
  scoringBoundary: string;
  protocol: string[];
  summary: { pass: number; fail: number; insufficient: number };
  items: HoldoutItem[];
  boundaries: string[];
}

export interface HoldoutAuditConfig extends AuditConfig {
  outputHoldoutJson: string;
  outputHoldoutMarkdown: string;
}

function cloneCandidate(event: EvalEvent, key: string, label: string): EvalEvent {
  return { ...event, key, label };
}

function pct(value: number | null): string { return value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`; }
function lift(value: number | null): string { return value == null ? 'n/a' : `${value.toFixed(2)}×`; }

/** Frozen before the July holdout is read; keep threshold changes auditable. */
export function classifyEvidenceHoldoutGate(input: HoldoutGateInput): HoldoutGateClassification {
  const gates = {
    sample: input.completeEvents >= 10 && input.completeCoins >= 10 && input.completeDays >= 7,
    primaryLift: (input.primaryLift ?? 0) >= 1.3,
    netAfterCost: (input.netAfterCost ?? -Infinity) > 0,
    robustness: (input.worstLift ?? 0) > 1.15,
    bootstrap: (input.bootstrapLower95 ?? -Infinity) > 0,
  };
  const pass = gates.sample && Object.values(gates).every(Boolean);
  return {
    gates,
    status: !gates.sample ? 'insufficient-sample' : pass ? 'holdout-pass' : 'holdout-fail',
  };
}

export function renderEvidenceHoldoutMarkdown(report: EvidenceHoldoutReport): string {
  const lines = [
    '# Post-selection evidence holdout — 2026-07-01 to 2026-07-21', '',
    `- Cache as-of：${report.cacheAsOf}`,
    `- Scoring boundary：${report.scoringBoundary}`,
    `- 結果：${report.summary.pass} pass／${report.summary.fail} fail／${report.summary.insufficient} insufficient`, '',
    '## Frozen protocol', '',
    ...report.protocol.map((line) => `- ${line}`), '',
    '## Results', '',
    '| v2 cohort | 狀態 | Complete events / coins / days | 10%×24h lift | Net | Worst lift | Bootstrap L95 | 月度 | 建議 |',
    '|---|---|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const item of report.items) {
    const primary = item.result.horizons.find((cell) => cell.targetPct === 10 && cell.horizonH === 24)!;
    lines.push(`| \`${item.strategyId}\` | \`${item.status}\` | ${item.completeEvents} / ${item.completeCoins} / ${item.completeDays} | ${lift(primary.lift)} | ${pct(primary.netAfterCost)} | ${lift(item.result.robustness.worstLift)} | ${pct(item.result.bootstrapLower95)} | ${item.result.walkForwardPositive}/${item.result.walkForwardTotal} | ${item.recommendation} |`);
  }
  lines.push('', '## Boundaries', '', ...report.boundaries.map((line) => `- ${line}`), '');
  return lines.join('\n');
}

export function runEvidenceHoldout(cfg: HoldoutAuditConfig, log: (line: string) => void = console.log): EvidenceHoldoutReport {
  if (cfg.months.length !== 1 || cfg.months[0] !== '2026-07') throw new Error('frozen holdout month must be 2026-07');
  const manifestText = fs.readFileSync(path.join(cfg.root, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText) as EvidenceManifest;
  if (manifest.outcomeThrough < '2026-07-01' || manifest.outcomeThrough > '2026-07-21') throw new Error(`frozen cache as-of mismatch: ${manifest.outcomeThrough}`);
  let collection: EvidenceResearchCollection | null = null;
  runEvidenceAudit({
    ...cfg,
    writeOutputs: false,
    captureResearch: (value) => { collection = value; },
  }, log);
  if (!collection) throw new Error('holdout event collection was not captured');
  const captured: EvidenceResearchCollection = collection;
  const defs = new Map(EVIDENCE_DETECTORS.map((def) => [def.key, def]));
  const items: HoldoutItem[] = [];

  for (const frozen of VALIDATED_H1_REMEDIATIONS) {
    const def = defs.get(frozen.sourceKey);
    if (!def) throw new Error(`missing source detector ${frozen.sourceKey}`);
    const candidateKey = `${frozen.strategyId}--holdout`;
    const label = `${frozen.strategyId} July holdout`;
    const events = captured.events
      .filter((event) => event.key === frozen.sourceKey && event.research && passesEvidenceRemediationFilter(frozen.side, event.research, frozen.filter))
      .map((event) => cloneCandidate(event, candidateKey, label));
    const controls = captured.controls.filter((event) =>
      event.key === def.matchedKey && event.research && passesEvidenceRemediationFilter(frozen.side, event.research, frozen.filter));
    const result = summarizeDetector({ key: candidateKey, label, matchedKey: def.matchedKey }, events, controls, 1);
    const complete = events.filter((event) => evaluateOutcome(event, 10, 24).complete);
    const completeEvents = complete.length;
    const completeCoins = new Set(complete.map((event) => event.sym)).size;
    const completeDays = new Set(complete.map((event) => new Date(event.decisionTs).toISOString().slice(0, 10))).size;
    const primary = result.horizons.find((cell) => cell.targetPct === 10 && cell.horizonH === 24)!;
    const { gates, status } = classifyEvidenceHoldoutGate({
      completeEvents,
      completeCoins,
      completeDays,
      primaryLift: primary.lift,
      netAfterCost: primary.netAfterCost,
      worstLift: result.robustness.worstLift,
      bootstrapLower95: result.bootstrapLower95,
    });
    const pass = status === 'holdout-pass';
    items.push({
      strategyId: frozen.strategyId,
      sourceKey: frozen.sourceKey,
      side: frozen.side,
      filter: frozen.filter,
      status,
      result,
      completeEvents,
      completeCoins,
      completeDays,
      gates,
      recommendation: pass
        ? '保持 forward shadow；仍要實際 post-freeze runtime month，唔升 paper。'
        : status === 'insufficient-sample'
          ? '樣本未夠；保持 forward shadow，唔作成敗結論。'
          : '獨立 holdout gate 失敗；停止升班，保留研究紀錄。',
    });
  }

  const report: EvidenceHoldoutReport = {
    v: 1,
    holdoutId: 'historical-evidence-holdout-2026-07-01_2026-07-21-v1',
    frozenRulesetAt: '2026-07-22',
    sourceFingerprint: crypto.createHash('sha256').update(manifestText).digest('hex'),
    cacheAsOf: manifest.outcomeThrough,
    scoringBoundary: `Only events with complete cached outcomes count; 48h cells naturally stop roughly two days before ${manifest.outcomeThrough}.`,
    protocol: [
      'Rulesets and filters are exactly the 2026-07-22 frozen v2 definitions; July is never used to tune them.',
      'Futures/metrics use daily Binance archive zips with official checksums; missing days fail closed. July funding daily/monthly archives were unavailable, so a frozen Binance REST snapshot is separately hashed and disclosed.',
      'Completed bars only, next native 15m open, as-of quantity OI/funding and the same matched-control filter.',
      'Provisional holdout pass requires ≥10 complete events, ≥10 coins, ≥7 UTC days, 10%×24h lift ≥1.3, positive after-cost/funding mean, worst cross-cell lift >1.15 and day-block bootstrap L95 >0.',
    ],
    summary: {
      pass: items.filter((item) => item.status === 'holdout-pass').length,
      fail: items.filter((item) => item.status === 'holdout-fail').length,
      insufficient: items.filter((item) => item.status === 'insufficient-sample').length,
    },
    items,
    boundaries: [
      'Historical holdout cannot prove recorder uptime, runtime selection, Telegram delivery, paper fills or real slippage.',
      'No holdout result automatically changes badge, Telegram, paper, entry-watch or tier state.',
      'A failed or insufficient July result must not be repaired by retuning on July.',
    ],
  };
  fs.writeFileSync(cfg.outputHoldoutJson, stableJson(report));
  fs.writeFileSync(cfg.outputHoldoutMarkdown, renderEvidenceHoldoutMarkdown(report));
  log(`[holdout] wrote ${cfg.outputHoldoutJson}`);
  log(`[holdout] wrote ${cfg.outputHoldoutMarkdown}`);
  return report;
}

export function parseHoldoutAuditArgs(argv: string[], cwd = process.cwd()): HoldoutAuditConfig {
  const cfg: HoldoutAuditConfig = {
    root: path.join(cwd, 'scripts', 'backtest-data', 'evidence-holdout-2026-07-21-v1'),
    months: ['2026-07'],
    offline: true,
    outputJson: path.join(cwd, 'scripts', '.build', 'holdout-base-audit.json'),
    outputMarkdown: path.join(cwd, 'scripts', '.build', 'holdout-base-audit.md'),
    outputHoldoutJson: path.join(cwd, 'HISTORICAL-EVIDENCE-HOLDOUT-2026-07-21.json'),
    outputHoldoutMarkdown: path.join(cwd, 'HISTORICAL-EVIDENCE-HOLDOUT-2026-07-21.md'),
    maxCoinMonths: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg === '--offline') continue;
    if (arg.startsWith('--root')) { cfg.root = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-json')) { cfg.outputHoldoutJson = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--output-md')) { cfg.outputHoldoutMarkdown = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--max-coin-months')) { cfg.maxCoinMonths = Number(value); if (!arg.includes('=')) i++; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(cfg.maxCoinMonths) || cfg.maxCoinMonths < 0) throw new Error('--max-coin-months must be a non-negative integer');
  return cfg;
}
