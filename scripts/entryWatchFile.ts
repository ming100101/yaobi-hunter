import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EntryWatchState } from '../src/types';
import { emptyEntryWatchState, sanitizeEntryWatchState } from '../src/lib/entryWatch';

// Recorder-owned state file. Keeping this outside the shared read/merge/write
// kv.json removes browser/server write races from a trade-timing state machine.
export function entryWatchFilePath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'entry-watch.json');
}

export function readEntryWatchState(file = entryWatchFilePath()): EntryWatchState {
  try {
    return sanitizeEntryWatchState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return emptyEntryWatchState();
  }
}

// Atomic replace: write+fsync a unique sibling, then rename over the destination.
// Unique temp names also keep an accidentally duplicated recorder process from
// deleting another process's temporary file (one-active semantics still assumes
// the normal single recorder owner).
export function writeEntryWatchState(state: EntryWatchState, file = entryWatchFilePath()): void {
  const clean = sanitizeEntryWatchState(state);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, JSON.stringify(clean));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed / process teardown */
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* a failed cleanup must not mask the original write error */
    }
  }
}

export function updateEntryWatchState(
  mutate: (state: EntryWatchState) => EntryWatchState,
  file = entryWatchFilePath(),
): EntryWatchState {
  const next = sanitizeEntryWatchState(mutate(readEntryWatchState(file)));
  writeEntryWatchState(next, file);
  return next;
}
