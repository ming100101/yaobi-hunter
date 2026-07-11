# F1 — 🎀 Y2K girly pixel 主題 toggle(for fun)

**層級**: 支援層 · **工作量**: M · **依賴**: P0(theme 選擇持久化);U1 有 settings 面板更好

## zh-HK TL;DR
一個 🎀 掣切去惡搞主題:粉紅粉紫 pastel、像素字體、Y2K 貼紙感。全部靠 `theme.css` 嘅 token 覆蓋 + chart 顏色重讀,唔郁任何邏輯。

## Context (verified facts)
- ALL tokens central: `src/theme.css:5-47` (`:root { --bg … --font }`); body background gradients hardcoded in the `body` rule (theme.css:59-69) — needs its own override.
- Chart colors go through `cssVar(name)` (`src/lib/cssVar.ts:24-27`) with a dark-theme `FALLBACK` map (5-22) — charts read tokens AT CREATE TIME (`ChartPanels.tsx` is create-once, README:49). Theme switch therefore must REMOUNT charts: pass the theme string into the React `key` of the chart panel container so panels recreate (pan/zoom reset on switch is acceptable).
- No `data-theme` mechanism exists yet.

## Design (decided)

### Token override block — add to theme.css (values final; tweak only if contrast fails verification)
```css
:root[data-theme='y2k'] {
  --bg: #ffe9f7; --card: #fff3fb; --card-edge: #ffa8dd; --grid: rgba(255, 105, 180, 0.14);
  --text: #6b2a5b; --text-2: #a4568e; --text-3: #c286ad;
  --accent: #ff6ec7; --accent-deep: #ff3eb5;
  --accent-soft: rgba(255, 110, 199, 0.16); --accent-fill: rgba(255, 110, 199, 0.28); --accent-fill-0: rgba(255, 110, 199, 0);
  --neon: #ff3eb5; --neon-strong: #d6187f; --neon-glow: rgba(255, 62, 181, 0.30);
  --up: #00b389; --up-soft: rgba(0, 179, 137, 0.14); --up-fill: rgba(0, 179, 137, 0.22);
  --down: #ff4f9a; --down-soft: rgba(255, 79, 154, 0.14); --down-fill: rgba(255, 79, 154, 0.20);
  --warn: #ff9f1c; --warn-soft: rgba(255, 159, 28, 0.16);
  --ema20: #ff8c00; --ema50: #3aa6ff; --bb: #d59ce0;
  --vol-up: rgba(0, 179, 137, 0.45); --vol-down: rgba(255, 79, 154, 0.4);
  --font: 'Fusion Pixel', 'Zpix', 'Microsoft JhengHei', monospace;
}
:root[data-theme='y2k'] body {
  background:
    radial-gradient(900px 520px at 12% -8%, rgba(255, 110, 199, 0.25), transparent 65%),
    radial-gradient(760px 420px at 96% 4%, rgba(178, 130, 255, 0.22), transparent 62%),
    linear-gradient(180deg, #ffeaf8 0%, #ffe0f2 100%);
}
:root[data-theme='y2k'] .card { border-radius: 4px; box-shadow: 3px 3px 0 var(--card-edge); }
:root[data-theme='y2k'] .btn, :root[data-theme='y2k'] .pill, :root[data-theme='y2k'] .chip { border-radius: 4px; }
:root[data-theme='y2k'] ::-webkit-scrollbar-thumb { background: #ff9ade; border-color: #ffe9f7; }
```
(方角 + 硬陰影 = 像素貼紙感;dark 主題完全唔受影響。)

### Pixel font (CJK coverage REQUIRED — UI 係中文)
- Use **Fusion Pixel Font**(開源 OFL,支援繁中): download the 12px-proportional `.woff2` from https://github.com/TakWolf/fusion-pixel-font releases → place at `public/fonts/fusion-pixel.woff2` (self-hosted; no CDN).
- theme.css top: `@font-face { font-family: 'Fusion Pixel'; src: url('/fonts/fusion-pixel.woff2') format('woff2'); font-display: swap; }`
- If glyph coverage disappoints in practice, acceptable fallback chain is already in the token (`Zpix` if user installs it, then JhengHei).

### Toggle + persistence + charts
- App state `theme: 'dark' | 'y2k'`, default from kv `settings.theme` (U1 shape; plain kv `theme` if U1 not landed). Apply via `document.documentElement.dataset.theme = theme` in a `useEffect`.
- 🎀 button in `.top-actions` (ghost style): toggles + persists.
- Charts: thread `theme` into the detail view and include it in the chart panels' React `key` (e.g. `key={symbol + tf + theme}`) so lightweight-charts recreates and `cssVar()` re-reads the new token values. Grep `ChartPanels` usage in `CoinDetail.tsx` for the existing key/props pattern and extend it.
- `cssVar.ts` FALLBACK stays dark-values (only used before stylesheets apply) — no change.

### 加分位 (optional, do last, keep OFF-able)
- Sparkle: `:root[data-theme='y2k'] .brand-name::after { content: ' ✧₊⁺'; }` and title 妖幣獵手 → keep text, cosmetics only.
- `image-rendering: pixelated` on `.brand img` if a logo exists.
- NO cursor-trail JS (perf on a 350-row live table; skip it).

## Steps
1. Font file → `public/fonts/`; `@font-face` + token block + body/decor overrides into theme.css (bottom, clearly commented section).
2. Theme state + dataset apply + 🎀 button in App.tsx; persistence via kv.
3. Chart remount keying in CoinDetail/ChartPanels.
4. U1 landed → move the control into settings 外觀 section too (both entry points fine).

## Verification
1. `npm run typecheck`; toggle 🎀 → whole app flips instantly (list, tabs, chips, buttons); reload → persists; port-change → persists (P0).
2. Open a coin detail in y2k → candles/EMA/volume/OI/funding panels use the new palette (remount happened); crosshair sync still works; switch timeframe → still themed.
3. 中文字 render 用 pixel font(檢查 掃描/搜尋/蓄力 labels — no tofu boxes);數字 tabular alignment 冇爆(`.num` rows line up)。
4. Contrast spot-check: `--text` on `--card` and `--neon` on `--accent-soft` readable in daylight; screenshot both themes for the summary.
5. Dark theme untouched: toggle back → pixel-identical to before (compare screenshot).

## Acceptance
- [ ] One-click toggle, persisted, charts re-themed via remount.
- [ ] CJK pixel font self-hosted, OFL licence file dropped alongside (`public/fonts/LICENSE-fusion-pixel.txt`).
- [ ] Zero logic/data changes; dark theme byte-identical.

## 陷阱 / Do-NOT
- Do NOT restyle by editing component styles — tokens + `[data-theme='y2k']` overrides ONLY, or the themes drift apart.
- lightweight-charts holds colors internally — without the key-remount the charts stay dark; don't try to patch every `applyOptions` call site instead (remount is the sanctioned path).
- Pixel fonts at 13px can hurt readability of dense numbers — if verification step 3 fails for `.num` cells, add `:root[data-theme='y2k'] .num { font-family: 'Inter', sans-serif; }` (numbers keep a readable font; vibe stays elsewhere).
- Font file ~1-8MB (CJK) — woff2 only, `font-display: swap`, and it ships in dist/ + SEA assets (make-exe includes dist — check `sea-config.json` asset globs cover `fonts/`).

---

## Results (2026-07-07)

- **Shipped.** Font: Fusion Pixel 12px-proportional **zh_hant** woff2 (v2026.07.01 release), **703KB** self-hosted at `public/fonts/fusion-pixel.woff2` + OFL licence alongside. `document.fonts.check('13px "Fusion Pixel"')` → true in-app.
- Token block as specced + F1 section at theme.css bottom. Extra dark-hardcoded values found beyond the spec's body-gradient note and overridden y2k-scoped (never inline): `.nav-tabs` / `.tf-seg` / `.hist-date input` pills (`rgba(11,7,22,…)`), `.nav-tab.active` / `.tf-btn.active` violet gradients, `.ohlc-legend` box.
- Toggle: 🎀 ghost button in BOTH `.top-actions` (screener + coin detail); App owns `theme: ThemeName` state, applies via `documentElement.dataset.theme`, persists under kv `'theme'` — **added to cache.ts SERVER_KEYS** so it lives in kv.json and survives port drift (P0), verified via GET /kv after toggle.
- Charts: `key={`price-${theme}`}` etc. on the four panels in CoinDetail → remount re-reads tokens; verified live — candles/EMA/BB/vol/OI/funding/strength all pastel after toggle, crosshair sync + timeframe switch still fine.
- Verification: typecheck clean; toggle flips whole app instantly; reload persists (dataset=y2k after reload); CJK pixel glyphs render (掃描/蓄力/出貨 etc., no tofu); `.num` columns stayed aligned (grid-driven) so the Inter fallback for numbers was NOT needed; dark theme toggles back pixel-identical (screenshot-compared — only visible delta is the 🎀 button itself).
- `make-exe` walks dist/ recursively → font embeds automatically; exe rebuilt same day.
- Not done: settings 外觀 section (spec gates it on U1, which hasn't landed).
