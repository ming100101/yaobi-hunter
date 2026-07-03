// Headless check: fetch a few real coins and print which interpretation
// patterns fire. Bundle with esbuild, run with node.
import { fetchLiveCoin, searchInstruments } from '../src/data/okx';
import { interpret } from '../src/lib/interpret';

const OKX = 'https://www.okx.com';
const hits = (await searchInstruments(OKX, '')).slice(0, 5);
for (const hit of hits) {
  const coin = await fetchLiveCoin(OKX, hit, Date.now());
  const ins = interpret(coin);
  console.log(
    `${coin.symbol.padEnd(7)} ${coin.regime.padEnd(10)} str=${String(coin.strength).padStart(2)} | ` +
      (ins.map((i) => `[${i.tone}] ${i.title}`).join('  ') || '—'),
  );
  for (const i of ins) console.log(`    ${i.detail}`);
}
