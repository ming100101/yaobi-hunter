import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVIDENCE_AUDIT_AS_OF,
  FLUSH_FORWARD_NOTE,
  SIGNAL_EVIDENCE_COPY,
  oldStudyEvidence,
} from '../src/lib/evidenceCopy';

assert.match(EVIDENCE_AUDIT_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
assert.match(FLUSH_FORWARD_NOTE, /H1 歷史 gate 已失敗/);
assert.match(FLUSH_FORWARD_NOTE, /badge、通知同新 paper entry 已關閉/);
assert.match(FLUSH_FORWARD_NOTE, /shadow evidence/);
assert.match(SIGNAL_EVIDENCE_COPY.flushBreakout.badge, /舊研究窗/);
assert.match(SIGNAL_EVIDENCE_COPY.flushBreakout.badge, /H1 歷史 gate 已失敗/);
assert.match(SIGNAL_EVIDENCE_COPY.flushBreakout.badge, /shadow/);
assert.doesNotMatch(SIGNAL_EVIDENCE_COPY.flushBreakout.notify, /命中率\s*\d/);
assert.doesNotMatch(SIGNAL_EVIDENCE_COPY.rebuildBreakout.notify, /lift\s*[×x]/i);
assert.match(SIGNAL_EVIDENCE_COPY.rebuildBreakout.notify, /通知已關閉/);
assert.doesNotMatch(SIGNAL_EVIDENCE_COPY.virginBreakout.notify, /lift\s*[×x]/i);

const formatted = oldStudyEvidence('測試 lift ×1.23');
assert.match(formatted, /^舊研究窗：/);
assert.match(formatted, /非現時命中率/);
assert.match(formatted, /H1 歷史 gate 已失敗/);
assert.match(formatted, /只保留 shadow evidence/);

// Guard the user-facing surfaces which previously copied frozen study numbers
// as if they were current. Historical figures may live in evidenceCopy and be
// rendered through oldStudyEvidence, but must not be hard-coded independently.
const root = process.cwd();
const surfaces = [
  'src/components/ScreenerList.tsx',
  'src/lib/interpret.ts',
  'src/lib/notify.ts',
  'scripts/notifyHeadless.ts',
];
const stalePatterns = [
  /回測\s*lift\s*[×x]/i,
  /回測[（(]\s*\d+\s*幣/,
  /回測\s+\d+\s*日/,
];

for (const relative of surfaces) {
  const source = readFileSync(`${root}/${relative}`, 'utf8');
  for (const pattern of stalePatterns) {
    assert.doesNotMatch(source, pattern, `${relative} contains an unlabelled frozen study claim`);
  }
}

console.log('evidence copy tests passed');
