import fs from 'node:fs';
import path from 'node:path';
import { recordingsDir } from './recordFile';

// Pure fs logic for GET /recordings?from=YYYY-MM-DD&to=YYYY-MM-DD — imported by
// the Vite dev plugin and mirrored inline in server.cjs (CJS/SEA can't import
// this ESM module). Returns concatenated raw JSONL for daily files whose date
// falls in [from, to]. Range is capped at 92 days so a stray request can't slurp
// the whole archive. Missing files in range are simply absent (no error).

const DAY_MS = 24 * 3600 * 1000;
export const RECORDINGS_MAX_DAYS = 92;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function serveRecordings(from: string, to: string): { code: number; body: string } {
  if (!isDate(from) || !isDate(to)) return { code: 400, body: 'from/to must be YYYY-MM-DD' };
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const toMs = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
    return { code: 400, body: 'invalid range (to before from?)' };
  }
  if ((toMs - fromMs) / DAY_MS > RECORDINGS_MAX_DAYS) {
    return { code: 413, body: `range too wide (> ${RECORDINGS_MAX_DAYS} days)` };
  }
  let out = '';
  try {
    const dir = recordingsDir();
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const day = f.slice(0, -'.jsonl'.length); // YYYY-MM-DD; lexical compare == date compare
      if (day < from || day > to) continue;
      out += fs.readFileSync(path.join(dir, f), 'utf8');
      if (!out.endsWith('\n')) out += '\n';
    }
  } catch {
    /* no recordings dir yet → empty body, still 200 */
  }
  return { code: 200, body: out };
}
