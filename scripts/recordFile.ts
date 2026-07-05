import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Node-side JSONL sink for scan records. Shared by the headless recorder and
// the Vite dev middleware; server.cjs (raw CJS in the SEA) inlines the same
// logic. Daily files keyed by UTC date so every writer agrees regardless of
// timezone. append-only; duplicate slots are de-duped at read time.

export function recordingsDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'recordings');
}

export function appendRecordLine(json: string): string {
  const dir = recordingsDir();
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  fs.appendFileSync(file, json.replace(/\s*\n\s*/g, ' ').trim() + '\n');
  return file;
}
