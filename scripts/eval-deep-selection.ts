import fs from 'node:fs';
import path from 'node:path';
import { auditDeepReclaimSelection } from '../src/lib/deepReclaimSelectionAudit';
import { recordingsDir } from './recordFile';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const days = Math.max(1, Math.min(365, Math.trunc(Number(argValue('--days') ?? 90)) || 90));
const json = process.argv.includes('--json');
const dir = recordingsDir();
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .slice(-days)
  : [];
const events: unknown[] = [];
let malformedLines = 0;
for (const file of files) {
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
    if (!line.includes('"deep-reclaim"')) continue;
    try { events.push(JSON.parse(line)); } catch { malformedLines++; }
  }
}

const result = auditDeepReclaimSelection(events);
if (json) {
  console.log(JSON.stringify({ files, malformedLines, ...result }, null, 2));
} else {
  console.log(`deep-reclaim Top-1 fidelity: ${result.verdict}`);
  console.log(`protocol ${result.gateProtocolId} · selection ${result.selectionPolicyId}`);
  console.log(
    `files ${files.length} · current rows ${result.currentProtocolRows} · rounds ${result.rounds} ` +
    `(${result.validRounds} valid / ${result.invalidRounds} invalid) · duplicates ${result.duplicateRows}/${result.conflictingDuplicates} conflicting`,
  );
  console.log(
    `selected ${result.selectedRounds} · delivered ${result.deliveredSelections} · failed ${result.failedSelections} ` +
    `· uncertain ${result.uncertainSelections} · pending ${result.pendingSelections} · suppressed ${result.suppressedRounds}`,
  );
  const reasons = Object.entries(result.suppressionReasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length) console.log(`suppression: ${reasons.map(([reason, count]) => `${reason}=${count}`).join(' · ')}`);
  if (malformedLines) console.log(`warning: ${malformedLines} malformed deep-reclaim line(s) ignored`);
  for (const anomaly of result.anomalies) {
    console.log(`FAIL ${anomaly.code}${anomaly.roundId ? ` round=${anomaly.roundId}` : ''}${anomaly.watchId ? ` watch=${anomaly.watchId}` : ''}: ${anomaly.detail}`);
  }
  if (result.verdict === 'UNAVAILABLE') console.log('No current-protocol selection-round yet; waiting for the first OI-qualified forward setup.');
}
if (result.verdict === 'FAIL') process.exitCode = 1;
