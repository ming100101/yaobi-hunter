import path from 'node:path';
import { cacheEvidenceHoldout, type HoldoutCacheConfig } from './evidenceCache';

function parseArgs(argv: string[], cwd = process.cwd()): HoldoutCacheConfig {
  const cfg: HoldoutCacheConfig = {
    root: path.join(cwd, 'scripts', 'backtest-data', 'evidence-holdout-2026-07-21-v1'),
    baselineRoot: path.join(cwd, 'scripts', 'backtest-data', 'evidence-v1'),
    month: '2026-07',
    asOf: '2026-07-21',
    datasets: ['futures5m', 'metrics', 'funding'],
    refresh: false,
    maxSymbols: 0,
    concurrency: 12,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg === '--refresh') cfg.refresh = true;
    else if (arg.startsWith('--root')) { cfg.root = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--baseline-root')) { cfg.baselineRoot = path.resolve(cwd, value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--month')) { cfg.month = value; if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--as-of')) { cfg.asOf = value; if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--datasets')) { cfg.datasets = value.split(',') as HoldoutCacheConfig['datasets']; if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--max-symbols')) { cfg.maxSymbols = Number(value); if (!arg.includes('=')) i++; }
    else if (arg.startsWith('--concurrency')) { cfg.concurrency = Number(value); if (!arg.includes('=')) i++; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!/^\d{4}-\d{2}$/.test(cfg.month)) throw new Error('--month must be YYYY-MM');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.asOf) || !cfg.asOf.startsWith(`${cfg.month}-`)) throw new Error('--as-of must be YYYY-MM-DD inside --month');
  if (!Number.isInteger(cfg.maxSymbols) || cfg.maxSymbols < 0) throw new Error('--max-symbols must be a non-negative integer');
  if (!Number.isInteger(cfg.concurrency) || cfg.concurrency < 1 || cfg.concurrency > 32) throw new Error('--concurrency must be 1..32');
  const valid = new Set(['futures5m', 'metrics', 'funding']);
  if (!cfg.datasets.includes('futures5m') || cfg.datasets.some((dataset) => !valid.has(dataset))) throw new Error('--datasets must include futures5m and may contain metrics,funding');
  return cfg;
}

try {
  await cacheEvidenceHoldout(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
