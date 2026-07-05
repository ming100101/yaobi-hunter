# U2 — Screener 好用啲:排序、篩選、sticky header

**層級**: 支援層 · **工作量**: S · **依賴**: 無(U1 提供篩選持久化更好)

## zh-HK TL;DR
列表而家只可以按 strength 排(pinned 置頂)+ ⚡ filter。加:點 column header 排序、regime 篩選 chips、最低 24h 量篩選、header 黏頂。

## Context (verified facts)
- List: `src/components/ScreenerList.tsx`; grid columns defined at theme.css:601-640 (`.scr-head/.scr-row`, 8 columns, `min-width: 780px`); sort logic in `src/App.tsx:35-39` (pinned first, strength desc).
- ⚡ toggle precedent: App.tsx:52-53, 371-372 + `.fb-toggle` styling (theme.css:333-362) — copy this pattern for new filters.
- Columns: Symbol | 階段 | 強度 | 1h | OI 4h | 資金 | 24h量 | 風險.

## Design (decided)
- **Sort**: click a header cell → sort by that column desc, click again → asc, third click → default (strength). Sortable: 強度/1h/OI 4h/資金/24h量. Pinned coins ALWAYS float above unpinned regardless of sort (sort applies within each group — preserves the pinning promise). Indicator: ▲/▼ suffix on the active header.
- **Regime filter**: three toggle chips 蓄力/拉升/出貨 next to the ⚡ toggle (multi-select; none active = all). Reuse `.fb-toggle` classes.
- **Volume filter**: a small select in the topbar: 全部 / ≥$5M / ≥$20M / ≥$50M.
- Persist all three in kv `settings.screener` (U1 shape) if U1 landed; else module state only (note it).
- **Sticky header**: `.scr-head { position: sticky; top: 0; z-index: 1; background: var(--card); }` — verify against the `overflow-x: auto` on `.table-card` (theme.css:602-604): sticky inside a scroll container sticks to the container, which is fine here.

## Steps
1. App.tsx: extend the sort/filter memo (35-39) with `sortKey/sortDir/regimeSet/minVol` state; keep pinned-first invariant.
2. ScreenerList.tsx: clickable headers (button semantics, `aria-sort`), filter chips row.
3. theme.css: sticky header rule + active-header styling (reuse `.nav-tab.active` gradient sparingly — a subtle `color: var(--neon)` is enough).
4. Wire persistence to settings if available.

## Verification
- Sort by 1h asc/desc/default cycles correctly with pins still on top; regime chips filter counts sanely; sticky header holds while scrolling 350 rows; `npm run typecheck`.

## Acceptance
- [x] 5 sortable columns (強度/1h/OI 4h/Funding/24h量), 3-state cycle, pinned-first invariant kept.
- [x] Regime (3-chip multi-select) + volume (select) filters. *Persistence deferred to U1* — state lives in App (survives tab switches, resets on full reload).
- [x] Sticky header inside the (now bounded) scroll card. *(visual tuning of max-height pending browser check)*

## Results — 2026-07-05

- **App.tsx**: `sortKey/sortDir/regimeSet/minVol` state + `cycleSort` (col→desc→asc→default) + `toggleRegime`; threaded to ScreenerList. State in App so it survives settings/strategy tab switches (ScreenerList unmounts on those — early returns App.tsx:441-457).
- **ScreenerList.tsx**: one `useMemo` pipeline — filter (⚡/regime/minVol, AND) → column sort (numeric field, dir, symbol tiebreak) → pinned-first. `SortHeader` (button + `aria-sort` + ▼/▲). Regime chips reuse `.fb-toggle`; `.vol-select` in the topbar. `top10` still from the strength-sorted `scan.coins` (unaffected by display sort). Generalized empty state.
- **theme.css**: `.table-card` → `overflow:auto; max-height:calc(100vh-160px)` (bounded so it scrolls internally); `.scr-head` → `position:sticky; top:0; z-index:1; background:var(--card)`; `.sort-h`/`.sort-ind`/`.vol-select`.
- **types.ts**: `ScreenerSortKey` / `ScreenerSortDir`.
- **Verified**: `npm run typecheck`; a 14-case logic harness (all 5 sort keys ×2 dirs, filter AND-composition incl. regime multi-select, pinned-first invariant, 3-state cycle) all pass.
- **Not verified in-browser**: sticky-header hold on scroll, the `max-height` value, topbar crowding, ▼/▲ render — the concurrent dev server holds port 5173 and I didn't touch the shared vite config. The other session's server (same repo) HMR-reloads these edits, so it's live-previewable there.
- **Deviation from spec step 1/4**: persistence to `settings.screener` is deferred to U1 (not landed) — the spec sanctions "module state only (note it)"; App React state is used.

## 陷阱 / Do-NOT
- Do NOT re-sort mid-sweep on every batch update in a way that makes rows jump under the cursor — apply sort in the same memo that already handles batch re-sorting so behaviour stays consistent with today's per-batch updates.
- Do NOT break the ⚡ filter interaction (filters compose with AND).
- Keep 8-column grid alignment — new UI lives in the topbar/chips row, not new columns.
