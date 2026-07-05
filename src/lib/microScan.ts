import type { Coin, SearchHit } from '../types';
import { fetchLiveCoinWarm, get429Count, mapPool } from '../data/okx';

// S3 micro-scan: between the 15-min full sweeps, re-check a small candidate set
// every ~75s for the ⚡ 縮倉突破 trigger so a mid-slot breakout is caught in ~75s
// instead of up to 14 min later. WARM-OI-ONLY (zero rubik): fetchLiveCoinWarm
// returns null for cold coins, which we skip. It does NOT re-rank the screener —
// full re-rank stays on the 15-min cadence; micro-scan only flips ⚡ + notifies.

export interface MicroResult {
  nextFb: Set<string>; // currently-⚡ candidate set, to thread into the next cycle
  checked: number; // candidates that were warm and evaluated
  skippedCold: number; // candidates the warm store couldn't serve (skipped, no rubik)
  fired: number; // rising-edge ⚡ this cycle (onFire was called this many times)
  saw429: boolean; // any HTTP 429 during the cycle → caller should back off
}

// One micro cycle. `curFb` = the ⚡ set known at cycle start (seeded from the last
// full sweep, threaded across cycles). A candidate that fires ⚡ AND was not in
// curFb is a rising edge → onFire. Cold candidates are left untouched in nextFb
// (we don't know their state), so a later warm cycle can still catch them.
export async function runMicroCycle(
  base: string,
  candidates: string[],
  curFb: Set<string>,
  onFire: (c: Coin) => void,
  nowMs: number,
): Promise<MicroResult> {
  const before429 = get429Count();
  const nextFb = new Set(curFb);
  let checked = 0;
  let skippedCold = 0;
  let fired = 0;

  await mapPool(
    candidates,
    2,
    async (sym) => {
      const hit: SearchHit = { instId: `${sym}-USDT-SWAP`, base: sym, last: 0, change24h: 0, vol24hUsd: 0 };
      let coin: Coin | null;
      try {
        coin = await fetchLiveCoinWarm(base, hit, nowMs);
      } catch {
        return; // fetch error (throttle/network) — leave nextFb untouched this cycle
      }
      if (!coin) {
        skippedCold++;
        return; // cold — warm store can't serve OI
      }
      checked++;
      if (coin.flushBreakout) {
        if (!curFb.has(sym)) {
          fired++;
          onFire(coin); // rising edge
        }
        nextFb.add(sym);
      } else {
        nextFb.delete(sym); // no longer ⚡ → a future re-fire is a fresh rising edge
      }
    },
    200,
  );

  return { nextFb, checked, skippedCold, fired, saw429: get429Count() > before429 };
}
