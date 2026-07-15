import fs from 'node:fs';
import path from 'node:path';
import { recordingsDir } from './recordFile';

const DAY_MS = 24 * 3600 * 1000;
export const SIGNAL_EVENTS_MAX_DAYS = 31;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Small, symbol-filtered event feed for Coin Detail. Full scan rows account for
// almost all recording bytes, so the chart should not download them merely to
// locate a handful of successful TG cards and watch transitions.
export function serveSignalEvents(
  symbol: string,
  from: string,
  to: string,
): { code: number; body: string } {
  const sym = symbol.trim().toUpperCase();
  if (!sym || sym.length > 64) return { code: 400, body: 'invalid symbol' };
  if (!isDate(from) || !isDate(to)) return { code: 400, body: 'from/to must be YYYY-MM-DD' };
  const fromMs = Date.parse(from + 'T00:00:00Z');
  const toMs = Date.parse(to + 'T00:00:00Z');
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
    return { code: 400, body: 'invalid range (to before from?)' };
  }
  if ((toMs - fromMs) / DAY_MS > SIGNAL_EVENTS_MAX_DAYS) {
    return { code: 413, body: `range too wide (> ${SIGNAL_EVENTS_MAX_DAYS} days)` };
  }

  let out = '';
  try {
    const dir = recordingsDir();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
      const day = file.slice(0, -'.jsonl'.length);
      if (day < from || day > to) continue;
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (!line || (!line.includes('"type":"notify"') && !line.includes('entry-watch') && !line.includes('entry_watch'))) continue;
        try {
          const event = JSON.parse(line) as { type?: string; sym?: string };
          if (
            (event.type === 'notify' || event.type === 'entry-watch' || event.type === 'entry_watch') &&
            typeof event.sym === 'string' &&
            event.sym.toUpperCase() === sym
          ) out += `${line}\n`;
        } catch {
          /* malformed audit lines stay excluded */
        }
      }
    }
  } catch {
    /* no recordings yet -> empty 200 */
  }
  return { code: 200, body: out };
}
