import type { CoinLite } from '../types';
import { kvGet, kvSet } from '../data/cache';
import { fmtMoney, fmtPct } from './format';
import { SIGNAL_EVIDENCE_COPY } from './evidenceCopy';

// Desktop toasts for newly-fired ⚡ 縮倉突破 signals. Fires at most once per
// symbol per cooldown window (persisted in IndexedDB so an app restart doesn't
// re-spam), only for live data, and only while the app is running — there is
// no background service. Everything is guarded: no Notification API or a
// denied permission silently degrades to badge-only behaviour.

const COOLDOWN_MS = 6 * 3600 * 1000;
const STORE_KEY = 'fb-notified';

let notified: Record<string, number> | null = null;

export function initNotifications(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    // returns a promise; result handled lazily on first notify attempt
    try {
      void Notification.requestPermission();
    } catch {
      /* some embedded contexts throw — badge-only fallback */
    }
  }
}

export async function notifyNewSignals(
  coins: CoinLite[],
  onOpen: (symbol: string) => void,
): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!notified) notified = (await kvGet<Record<string, number>>(STORE_KEY)) ?? {};
  const now = Date.now();
  let changed = false;
  for (const c of coins) {
    if (!c.flushBreakout) continue;
    if (now - (notified[c.symbol] ?? 0) < COOLDOWN_MS) continue;
    notified[c.symbol] = now;
    changed = true;
    try {
      const n = new Notification(`⚡ 縮倉突破 — ${c.symbol}/USDT`, {
        body:
          `強度 ${c.strength} · 1h ${fmtPct(c.change1h)} · 24h量 ${fmtMoney(c.vol24h)}\n` +
          `${SIGNAL_EVIDENCE_COPY.flushBreakout.notify} · 點擊查看`,
        tag: `fb-${c.symbol}`, // replaces rather than stacks per coin
        icon: '/favicon.svg',
      });
      n.onclick = () => {
        window.focus();
        onOpen(c.symbol);
        n.close();
      };
    } catch {
      /* Notification constructor can fail in embedded webviews */
    }
  }
  if (changed) {
    // prune coins past their cooldown — they no longer suppress anything, so
    // forgetting them keeps the map bounded to ~the last COOLDOWN window.
    for (const s in notified) if (now - notified[s] >= COOLDOWN_MS) delete notified[s];
    void kvSet(STORE_KEY, notified);
  }
}
