import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('src/theme.css');

const pageContracts: Array<[string, string]> = [
  ['src/components/ScreenerList.tsx', 'page scan-page'],
  ['src/components/PushWatchView.tsx', 'page push-page'],
  ['src/components/HistoryView.tsx', 'page history-page'],
  ['src/components/SettingsView.tsx', 'page settings-page'],
  ['src/components/StrategyView.tsx', 'page strategy-page'],
];

for (const [file, className] of pageContracts) {
  assert.ok(read(file).includes(`className="${className}"`), `${file} participates in the shared app shell`);
}
assert.ok(read('src/App.tsx').includes('scan-loading-page app-loading-page'), 'loading routes use the same glass canvas');

assert.ok(css.includes('Full-app Liquid Glass pass.'), 'the full-app material layer is present');
for (const token of ['--glass-regular:', '--glass-strong:', '--glass-clear:', '--glass-row:', '--glass-border:']) {
  assert.ok(css.includes(token), `${token} is tokenized`);
}

const requiredSurfaces = [
  ":root[data-theme='dark'] .table-card",
  ":root[data-theme='dark'] .push-controls",
  ":root[data-theme='dark'] .strategy-metric",
  ":root[data-theme='dark'] .hist-scrub-bar",
  ":root[data-theme='dark'] .settings-page",
  ":root[data-theme='dark'] .search-pop",
  ":root[data-theme='dark'] .help-modal",
];
for (const selector of requiredSurfaces) {
  assert.ok(css.includes(selector), `${selector} has an app-wide Liquid Glass treatment`);
}

assert.ok(css.includes('children use clear/strong tint layers'), 'nested content follows the no-stacked-blur hierarchy');
assert.equal(css.includes('backdrop-filter: blur(14px) saturate(130%)'), false, 'nested inputs do not add another blur pass');
assert.ok(css.includes("grid-template-columns: repeat(6, minmax(0, 1fr))"), 'mobile navigation becomes a six-item floating dock');
assert.ok(css.includes("bottom: calc(10px + env(safe-area-inset-bottom))"), 'mobile dock respects the safe area');

assert.ok(css.includes(":root[data-theme='y2k'] #root::before"), 'Y2K removes the dark aurora layer');
assert.ok(css.includes("--glass-shadow-soft: 3px 3px 0 #ffa8dd"), 'Y2K maps new material tokens back to sticker styling');
assert.ok(css.includes(":root[data-theme='y2k'] .hist-source-button.active"), 'new controls retain Y2K treatment');

assert.ok(css.includes('@media (prefers-reduced-motion: reduce)') && css.includes('.lab-strategy-row'), 'reduced motion covers app rows');
assert.ok(css.includes('@media (prefers-reduced-transparency: reduce)') && css.includes(":root[data-theme='dark'] .hist-controls"), 'reduced transparency covers app panels');
assert.ok(css.includes('@supports not ((backdrop-filter: blur(1px))') && css.includes(":root[data-theme='dark'] .help-modal"), 'solid fallback covers overlays and panels');

console.log('full-app Liquid Glass contracts PASS');
