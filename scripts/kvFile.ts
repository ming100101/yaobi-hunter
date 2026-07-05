import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Node-side key/value file sink, shared by the Vite dev middleware. server.cjs
// (raw CJS in the SEA) inlines the same logic. One JSON object under
// LOCALAPPDATA, written atomically (tmp + rename) so a concurrent reader never
// sees a torn file. This is the port-agnostic home for the small persisted keys
// (pins, recently-viewed, signal ages, notify cooldowns, warm OI store) that
// IndexedDB used to lose whenever the exe's port drifted (per-origin storage).

export function kvFilePath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'kv.json');
}

// Master off-switch marker. When this file exists every background job (the
// recorder loop, the --auto app launch, and future live-trading loops) should
// stop and stay stopped until it is removed. Managed by scripts/yaobi-ctl.ps1.
export function killFilePath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'KILL');
}

export function isKilled(): boolean {
  try {
    return fs.existsSync(killFilePath());
  } catch {
    return false;
  }
}

export function readKvFile(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(kvFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

// reread-merge-write so parallel writers to different keys don't clobber each
// other, then atomic rename so no reader ever sees a half-written file.
export function writeKvKey(key: string, value: unknown): void {
  const p = kvFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const cur = readKvFile();
  cur[key] = value;
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur));
  fs.renameSync(tmp, p);
}
