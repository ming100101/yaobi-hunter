// Package the app as a single Windows executable using Node's Single
// Executable Application support: embed scripts/server.cjs as the entry and
// every file in dist/ as SEA assets, then inject the blob into a copy of the
// running node.exe with postject. Usage:  node scripts/make-exe.mjs [outPath]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'sea');
const outExe = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(outDir, 'YaobiHunter.exe');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` first');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

// collect dist files as SEA assets, keyed by web-relative path
const assets = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else assets[path.relative(dist, full).replace(/\\/g, '/')] = full;
  }
})(dist);
console.log(`embedding ${Object.keys(assets).length} asset(s):`, Object.keys(assets).join(', '));

const seaConfig = {
  main: path.join(root, 'scripts', 'server.cjs'),
  output: path.join(outDir, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  assets,
};
const cfgPath = path.join(outDir, 'sea-config.json');
fs.writeFileSync(cfgPath, JSON.stringify(seaConfig, null, 2));

console.log('generating SEA blob...');
execSync(`node --experimental-sea-config "${cfgPath}"`, { stdio: 'inherit', cwd: root });

console.log(`copying node binary (${process.execPath})...`);
fs.copyFileSync(process.execPath, outExe);

console.log('injecting blob with postject...');
execSync(
  `npx --yes postject "${outExe}" NODE_SEA_BLOB "${seaConfig.output}" ` +
    '--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  { stdio: 'inherit', cwd: root },
);

const mb = (fs.statSync(outExe).size / 1e6).toFixed(1);
console.log(`done -> ${outExe} (${mb} MB)`);
