import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const modal = fs.readFileSync(path.join(root, 'src/components/CoinDetailModal.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'src/components/CoinDetail.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/theme.css'), 'utf8');

assert.equal(app.includes('if (detail) {'), false, 'detail no longer replaces the active page');
assert.equal(app.includes('if (fetching && !detail)'), false, 'uncached detail no longer uses a full-screen loader');
assert.ok(app.includes('const detailOverlay = detailRequest ? ('), 'one shared detail overlay is rendered by App');
assert.ok((app.match(/\{detailOverlay\}/g) ?? []).length >= 6, 'every active tab/loading surface retains the shared overlay');
assert.ok(app.indexOf('setDetailRequest({ symbol, origin })') < app.indexOf('await getCachedFull(symbol)'), 'popup opens before cache/network work');
assert.ok(app.includes('wantDetail.current !== symbol') && app.includes('wantDetail.current === symbol'), 'stale detail responses stay guarded');
assert.ok(app.includes('<HistoryView tab={tab} onTab={switchTab} onSelect={openCoin} />'));
assert.ok(app.includes('onSelect={openCoin}'), 'scan/history/push entry points share openCoin');
assert.ok(app.includes('onPick={(sym) =>') && app.includes('openCoin(sym);'), 'search opens the same modal flow');

assert.ok(modal.includes("createPortal"), 'modal is portaled above every tab');
assert.ok(modal.includes('role="dialog"') && modal.includes('aria-modal="true"'), 'modal exposes dialog semantics');
assert.ok(modal.includes("event.key === 'Escape'") && modal.includes("event.key !== 'Tab'"), 'Escape and focus trap are implemented');
assert.ok(modal.includes("document.body.style.overflow = 'hidden'"), 'background body scroll is locked');
assert.ok(modal.includes('returnFocus?.focus()'), 'trigger focus is restored on close');
assert.ok(modal.includes('event.target === event.currentTarget'), 'only a real backdrop click closes the window');
assert.ok(modal.includes('onRetry') && modal.includes('detail-skeleton-chart'), 'inline retry and shaped loading state are present');
assert.equal(detail.includes('backLabel'), false);
assert.equal(detail.includes('onBack'), false);
assert.ok(detail.includes('className="coin-detail"'), 'detail content is surface-neutral inside the window');

assert.ok(css.includes('--glass-regular:') && css.includes('--glass-strong:') && css.includes('--glass-clear:'), 'three glass tiers are tokenized');
assert.ok(css.includes('width: min(1280px, calc(100vw - 48px));'));
assert.ok(css.includes('height: min(900px, calc(100dvh - 48px));'));
assert.ok(css.includes('@media (max-width: 720px)') && css.includes('height: 100dvh;'), 'mobile sheet fills the dynamic viewport');
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
assert.ok(css.includes('@media (prefers-reduced-transparency: reduce)'));
assert.ok(css.includes('@supports not ((backdrop-filter: blur(1px))'), 'solid fallback exists without backdrop-filter');
assert.ok(css.includes(":root[data-theme='y2k'] .detail-modal"), 'Y2K retains an explicit non-glass modal treatment');

console.log('coin detail Liquid Glass modal contracts PASS');
