import type { CoinLite } from '../types';

// THE top-10 definition, shared by every consumer (App signal-times, screener
// chip, anywhere else). Before 2026-07-06 the screener gated the chip on
// scan.coins.slice(0,10) — the SCAN ORDER's first ten, not the strength top-10
// — while App.tsx aged a strength-sorted set: two different definitions, chips
// appearing/disappearing at random. One function, one ordering, deterministic
// tiebreaks:
//   strength desc → 24h volume desc (equal strength: the more liquid coin is
//   the more tradeable one) → symbol asc (total order, no flapping on ties).
export function strengthRank(coins: CoinLite[]): CoinLite[] {
  return [...coins].sort(
    (a, b) => b.strength - a.strength || b.vol24h - a.vol24h || a.symbol.localeCompare(b.symbol),
  );
}

// sym → 1-based rank for the current top-10 (rank shown in the screener chip)
export function top10Ranks(coins: CoinLite[]): Map<string, number> {
  const m = new Map<string, number>();
  const ranked = strengthRank(coins);
  for (let i = 0; i < Math.min(10, ranked.length); i++) m.set(ranked[i].symbol, i + 1);
  return m;
}
