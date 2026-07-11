import { readKvFile, writeKvKey } from './kvFile';
import type { RefSignal } from '../src/types';

/* E4 — log one 老詹 reference signal into the kv logbook (key 'ref-signals').
 *
 *   npm run ref-log -- --sym ARX --ts 2026-07-05T13:56 --kind 蓄力加倉 \
 *     --strength 81 --px 0.2121 [--side LONG] [--tps 10,25,50] [--sl -15] \
 *     [--exits 0.3,0.3,0.35] [--hitrate 24,21,25,30] [--provisional] \
 *     [--notes "..."] [--src laozhan]
 *   npm run ref-log -- --list
 *
 * WINDOWS NOTE: use the T form for --ts (2026-07-05T13:56, no space) — npm's
 * arg re-quoting on Windows mangles quoted values containing spaces.
 *
 * --ts is HKT unless it already carries a timezone. Dedup key = sym+ts (re-log
 * to update, e.g. when the user confirms the real publish time — pass the same
 * sym with the corrected --ts plus --replace-ts <old provisional ts>).
 */

const KV_KEY = 'ref-signals';

function parseTs(v: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v);
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  const withSec = /T\d{2}:\d{2}$/.test(iso) ? iso + ':00' : iso;
  const t = Date.parse(hasTz ? withSec : withSec + '+08:00');
  if (Number.isNaN(t)) throw new Error(`bad --ts ${v} (use "YYYY-MM-DD HH:mm" HKT or ISO)`);
  return t;
}

const argv = process.argv.slice(2);
const get = (k: string): string | null => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null;
};
const has = (k: string): boolean => argv.includes(k);

const existing = ((readKvFile()[KV_KEY] as RefSignal[] | undefined) ?? []).slice();

if (has('--list')) {
  const hk = (t: number) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Hong_Kong', hour12: false });
  for (const s of existing.sort((a, b) => a.ts - b.ts)) {
    console.log(
      `${hk(s.ts)}${s.tsProvisional ? '(~)' : '   '} ${s.sym.padEnd(9)} ${s.kind} 強度${s.refStrength} @${s.px}` +
        (s.refHitRate ? ` 歷史${s.refHitRate.wins}/${s.refHitRate.alerts}` : '') +
        (s.notes ? `  · ${s.notes}` : ''),
    );
  }
  console.log(`${existing.length} signals logged`);
  process.exit(0);
}

const sym = get('--sym');
const tsRaw = get('--ts');
const kind = get('--kind');
const strength = get('--strength');
const px = get('--px');
if (!sym || !tsRaw || !kind || !strength || !px) {
  console.error('required: --sym --ts --kind --strength --px (see header for optional flags)');
  process.exit(1);
}

const sig: RefSignal = {
  ts: parseTs(tsRaw),
  ...(has('--provisional') ? { tsProvisional: true } : {}),
  src: get('--src') ?? 'laozhan',
  sym: sym.toUpperCase(),
  side: (get('--side') ?? 'LONG') as RefSignal['side'],
  kind,
  refStrength: Number(strength),
  px: Number(px),
};
const tps = get('--tps');
if (tps) sig.tpPcts = tps.split(',').map(Number);
const sl = get('--sl');
if (sl) sig.slPct = Number(sl);
const exits = get('--exits');
if (exits) sig.exits = exits.split(',').map(Number);
const hr = get('--hitrate');
if (hr) {
  const [alerts, wins, bestPct, windowDays] = hr.split(',').map(Number);
  sig.refHitRate = { alerts, wins, bestPct, windowDays };
}
const notes = get('--notes');
if (notes) sig.notes = notes;

// dedupe: same sym at (old provisional ts being corrected, or same ts) → replace
const replaceTs = get('--replace-ts');
const dropTs = replaceTs ? parseTs(replaceTs) : sig.ts;
const kept = existing.filter((s) => !(s.sym === sig.sym && (s.ts === dropTs || s.ts === sig.ts)));
kept.push(sig);
writeKvKey(KV_KEY, kept);
console.log(`logged ${sig.sym} ${sig.kind} @${sig.px} (${kept.length} total${sig.tsProvisional ? ', ts PROVISIONAL' : ''})`);
