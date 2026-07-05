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
- [ ] 5 sortable columns, 3-state cycle, pinned-first invariant kept.
- [ ] Regime + volume filters, persisted (if U1).
- [ ] Sticky header inside the horizontal-scroll card.

## 陷阱 / Do-NOT
- Do NOT re-sort mid-sweep on every batch update in a way that makes rows jump under the cursor — apply sort in the same memo that already handles batch re-sorting so behaviour stays consistent with today's per-batch updates.
- Do NOT break the ⚡ filter interaction (filters compose with AND).
- Keep 8-column grid alignment — new UI lives in the topbar/chips row, not new columns.
