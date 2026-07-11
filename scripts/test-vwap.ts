// S8 unit sanity: anchoredVwap / rollingVwap must equal a hand-computed
// Σ(quote)/Σ(base) — and MUST NOT degrade to a mean-of-per-bar-ratios (the
// harmonic-mean monster the spec 陷阱 warns about). Run: npm run test-vwap
import { anchoredVwap, rollingVwap } from '../src/lib/indicators';
import type { VolumeBar } from '../src/types';

let fails = 0;
const ok = (name: string, got: number, want: number) => {
  const pass = Math.abs(got - want) < 1e-9;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: got ${got}, want ${want}`);
};

// four bars, each (quote USD, base coins). per-bar VWAP = q/b:
//   b0 100/10=10 · b1 220/20=11 · b2 90/6=15 · b3 260/20=13
const vol: VolumeBar[] = [
  { time: 1, value: 100, up: true },
  { time: 2, value: 220, up: true },
  { time: 3, value: 90, up: false },
  { time: 4, value: 260, up: true },
];
const base = [10, 20, 6, 20];

// anchored at idx1: running Σquote/Σbase from bar 1
//   i1 220/20 · i2 (220+90)/(20+6)=310/26 · i3 (220+90+260)/(20+6+20)=570/46
const av = anchoredVwap(vol, base, 1);
ok('avwap len', av.length, 3);
ok('avwap@1', av[0].value, 220 / 20);
ok('avwap@2', av[1].value, 310 / 26);
ok('avwap@3', av[2].value, 570 / 46);
// the key property: it's Σq/Σb (≈11.92 at i2), NOT the mean of ratios (11,15 → 13)
ok('is Σq/Σb not mean-of-ratios', av[1].value, 310 / 26);

// rolling win=2: i0 100/10 · i1 320/30 · i2 (220+90)/26 · i3 (90+260)/26
const rv = rollingVwap(vol, base, 2);
ok('rvwap len', rv.length, 4);
ok('rvwap@0', rv[0].value, 100 / 10);
ok('rvwap@1', rv[1].value, 320 / 30);
ok('rvwap@2', rv[2].value, 310 / 26);
ok('rvwap@3', rv[3].value, 350 / 26);

// zero-base bar is skipped, not NaN/Inf
const av0 = anchoredVwap([{ time: 1, value: 0, up: true }, ...vol], [0, ...base], 0);
ok('zero-base skipped', av0.length, 4);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
