import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tasks = Object.keys(pkg.scripts).filter((name) => name.startsWith('test-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('test:all must be started through npm');

for (const task of tasks) {
  console.log(`\n=== ${task} ===`);
  const result = spawnSync(process.execPath, [npmCli, 'run', task], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nAll ${tasks.length} test scripts passed.`);
