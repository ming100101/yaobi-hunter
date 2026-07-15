import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyDeepReclaimState,
  sanitizeDeepReclaimState,
  type DeepReclaimState,
  type DeepReclaimWatch,
} from '../src/lib/deepReclaim';

export type DeepReclaimEarlyDeliveryStatus =
  | 'shadow'
  | 'sending'
  | 'retry'
  | 'delivered'
  | 'failed'
  | 'uncertain';
export type DeepReclaimConfirmDeliveryStatus = 'none' | 'sending' | 'retry' | 'delivered' | 'failed' | 'uncertain';

export interface DeepReclaimDeliveryState {
  watchId: string;
  sym: string;
  earlyStatus: DeepReclaimEarlyDeliveryStatus;
  earlyAttempts: number;
  earlyNextAttemptAt?: number;
  earlyDeliveredAt?: number;
  telegramMessageId?: number;
  confirmStatus: DeepReclaimConfirmDeliveryStatus;
  confirmAttempts: number;
  confirmNextAttemptAt?: number;
  confirmCandidate?: DeepReclaimWatch;
  confirmDeliveredAt?: number;
}

export interface DeepReclaimRuntimeState extends DeepReclaimState {
  deliveries: Record<string, DeepReclaimDeliveryState>;
}

const EARLY = new Set<DeepReclaimEarlyDeliveryStatus>(['shadow', 'sending', 'retry', 'delivered', 'failed', 'uncertain']);
const CONFIRM = new Set<DeepReclaimConfirmDeliveryStatus>(['none', 'sending', 'retry', 'delivered', 'failed', 'uncertain']);

export function deepReclaimFilePath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'YaobiHunter', 'deep-reclaim.json');
}

export function emptyDeepReclaimRuntimeState(updatedAt = 0): DeepReclaimRuntimeState {
  return { ...emptyDeepReclaimState(updatedAt), deliveries: {} };
}

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function sanitizeDeepReclaimRuntimeState(raw: unknown): DeepReclaimRuntimeState {
  if (!raw || typeof raw !== 'object') return emptyDeepReclaimRuntimeState();
  const o = raw as Record<string, unknown>;
  const core = sanitizeDeepReclaimState(o);
  const deliveries: Record<string, DeepReclaimDeliveryState> = {};
  if (o.deliveries && typeof o.deliveries === 'object') {
    for (const [id, value] of Object.entries(o.deliveries as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const d = value as Record<string, unknown>;
      if (
        typeof d.watchId !== 'string' || d.watchId !== id ||
        typeof d.sym !== 'string' || !EARLY.has(d.earlyStatus as DeepReclaimEarlyDeliveryStatus) ||
        !CONFIRM.has(d.confirmStatus as DeepReclaimConfirmDeliveryStatus)
      ) continue;
      deliveries[id] = {
        watchId: id,
        sym: d.sym.trim().toUpperCase(),
        earlyStatus: d.earlyStatus as DeepReclaimEarlyDeliveryStatus,
        earlyAttempts: finite(d.earlyAttempts) ? Math.max(0, Math.trunc(d.earlyAttempts)) : 0,
        confirmStatus: d.confirmStatus as DeepReclaimConfirmDeliveryStatus,
        confirmAttempts: finite(d.confirmAttempts) ? Math.max(0, Math.trunc(d.confirmAttempts)) : 0,
        ...(finite(d.earlyNextAttemptAt) ? { earlyNextAttemptAt: d.earlyNextAttemptAt } : {}),
        ...(finite(d.earlyDeliveredAt) ? { earlyDeliveredAt: d.earlyDeliveredAt } : {}),
        ...(finite(d.telegramMessageId) && d.telegramMessageId > 0 ? { telegramMessageId: Math.trunc(d.telegramMessageId) } : {}),
        ...(finite(d.confirmNextAttemptAt) ? { confirmNextAttemptAt: d.confirmNextAttemptAt } : {}),
        ...(d.confirmCandidate && typeof d.confirmCandidate === 'object'
          ? { confirmCandidate: d.confirmCandidate as DeepReclaimWatch }
          : {}),
        ...(finite(d.confirmDeliveredAt) ? { confirmDeliveredAt: d.confirmDeliveredAt } : {}),
      };
    }
  }
  return {
    v: 1,
    updatedAt: core.updatedAt,
    active: core.active,
    deliveries,
  };
}

export function readDeepReclaimState(file = deepReclaimFilePath()): DeepReclaimRuntimeState {
  try {
    return sanitizeDeepReclaimRuntimeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return emptyDeepReclaimRuntimeState();
  }
}

export function writeDeepReclaimState(state: DeepReclaimRuntimeState, file = deepReclaimFilePath()): void {
  const clean = sanitizeDeepReclaimRuntimeState(state);
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
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}
