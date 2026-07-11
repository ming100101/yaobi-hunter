// Seam-filter regression: runEval must restrict a lift analysis to ONE live era
// so forward returns never cross the OKX→Binance migration seam. Run: npm run test-eval-seam
import { parseRecordings, runEval, resolveEvalSource, forward, H4, type RecIndex } from '../src/lib/evalCore';

let fails = 0;
const ok = (name: string, got: unknown, want: unknown) => {
  const pass = got === want;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// minimal v1-length coin row: [sym, price, oiUsd, funding, volZ, strength, regime, fb, ea, vol24h]
const coin = (sym: string, price: number, str = 50) => [sym, price, null, 0, 0, str, 'A', 0, 0, 0];
const mk = (slot: number, source: string, coins: unknown[]) =>
  JSON.stringify({ v: 3, ts: slot * 900000, slot, source, coins });

// okx era: slots 100-102 ; binance era: 103-106 (CONTIGUOUS, so an 'all' forward
// from the last okx slot would reach into binance — the exact seam crossing).
const lines = [
  mk(100, 'okx', [coin('X', 1.0), coin('Y', 2.0)]),
  mk(101, 'okx', [coin('X', 1.1), coin('Y', 2.0)]),
  mk(102, 'okx', [coin('X', 1.2), coin('Y', 2.0)]),
  mk(103, 'binance', [coin('X', 5.0), coin('Y', 2.0)]),
  mk(104, 'binance', [coin('X', 5.1), coin('Y', 2.0)]),
  mk(105, 'binance', [coin('X', 5.2), coin('Y', 2.0)]),
  mk(106, 'binance', [coin('X', 5.3), coin('Y', 2.0)]),
];
const idx = parseRecordings(lines.join('\n'));

ok('sourcesPresent', JSON.stringify(idx.sourcesPresent), JSON.stringify(['okx', 'binance']));
ok('auto resolves to newest era', resolveEvalSource(idx, 'auto'), 'binance');

ok('auto uniqueSlots (binance only)', runEval(idx, 10, 'auto').uniqueSlots, 4);
ok('auto source field', runEval(idx, 10, 'auto').source, 'binance');
ok('okx uniqueSlots', runEval(idx, 10, 'okx').uniqueSlots, 3);
ok('binance uniqueSlots', runEval(idx, 10, 'binance').uniqueSlots, 4);
ok('all uniqueSlots (blended)', runEval(idx, 10, 'all').uniqueSlots, 7);

// The core proof: forward from the LAST okx slot must NOT see binance prices when
// restricted to the okx era, but WOULD when blended ('all', full index).
const okxSlots = idx.slots.filter((s) => idx.bySlot.get(s)?.source === 'okx');
const eidxOkx: RecIndex = { ...idx, slots: okxSlots };
ok('era-cut: no forward past the seam', forward(eidxOkx, 'X', 102, H4), null);
const crossed = forward(idx, 'X', 102, H4); // full index blends → crosses into binance
ok('blended: forward DOES cross the seam', crossed != null && crossed.mfe > 3, true); // 5.3/1.2-1 ≈ 3.4

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
