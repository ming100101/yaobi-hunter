// E3 verification: BTC-regime tag (writer) + regime-filtered eval (reader), plus
// one live getBtcRegime call. No recorder sweep → no notify side effects.
// Run: npm run test-regime
import { BN_LIVE, getBtcRegime } from '../src/data/binance';
import { buildSweepMeta } from '../src/lib/recording';
import { parseRecordings, runEval } from '../src/lib/evalCore';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

// 1. writer: buildSweepMeta emits btcRegime / btcRet7d
const meta = buildSweepMeta(10, 1000 * 900000, 5, undefined, undefined, { regime: { regime: 'up', ret7d: 6.3 } });
ok('buildSweepMeta tags btcRegime', meta.btcRegime === 'up' && meta.btcRet7d === 6.3);
const metaNone = buildSweepMeta(10, 1000 * 900000, 5, undefined, undefined, { regime: null });
ok('buildSweepMeta null regime → untagged', metaNone.btcRegime === undefined);

// 2. reader: synthetic JSONL (2 up slots, 2 down), scan + regime-meta per slot
const coin = (sym: string, price: number) => [sym, price, null, 0, 0, 50, 'A', 0, 0, 0];
const scan = (slot: number, coins: unknown[]) => JSON.stringify({ v: 4, ts: slot * 900000, slot, source: 'binance', coins });
const metaLine = (slot: number, reg: string) =>
  JSON.stringify({ type: 'sweep-meta', v: 3, slot, ts: slot * 900000, coins: 1, durationMs: 0, btcRegime: reg, btcRet7d: reg === 'up' ? 6 : -6 });
const lines: string[] = [];
for (const [slot, reg] of [[1000, 'up'], [1001, 'up'], [1002, 'down'], [1003, 'down']] as Array<[number, string]>) {
  lines.push(scan(slot, [coin('X', 1 + slot * 0.001)]));
  lines.push(metaLine(slot, reg));
}
const idx = parseRecordings(lines.join('\n'));
ok('regimeAt size', idx.regimeAt.size === 4);
ok('regimeAt 1000=up / 1002=down', idx.regimeAt.get(1000) === 'up' && idx.regimeAt.get(1002) === 'down');
ok('runEval --regime up → 2 slots', runEval(idx, 10, 'auto', 'up').uniqueSlots === 2);
ok('runEval --regime down → 2 slots', runEval(idx, 10, 'auto', 'down').uniqueSlots === 2);
ok('runEval no regime → 4 slots', runEval(idx, 10, 'auto').uniqueSlots === 4);
ok('runEval result carries regime field', runEval(idx, 10, 'auto', 'up').regime === 'up');
ok('runEval no-regime → regime null', runEval(idx, 10, 'auto').regime === null);

// 3. live getBtcRegime (one klines request)
const reg = await getBtcRegime(BN_LIVE);
ok('getBtcRegime live', reg != null && ['up', 'down', 'chop'].includes(reg.regime) && Number.isFinite(reg.ret7d), reg ? `${reg.regime} (ret7d ${reg.ret7d}%)` : 'null');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
