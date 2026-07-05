# M2 — In-app 記錄/回測 tab:訊號日誌、lift 表、時間軸回放、模擬盤曲線

**層級**: 第3層 錢的語言 · **工作量**: L(拆 2-3 個 session:endpoint+journal → lift+scrubber → replay) · **依賴**: R1(v2 recordings)、M1(paper 數據)

## zh-HK TL;DR
第三個 tab「記錄」:睇返每次 ⚡/蓄 幾時 fire、之後 1h/4h/24h 行點、lift 統計表(同 CLI eval-rec 同一套邏輯)、時間軸拉桿回放任何時刻嘅 top-10、模擬盤 equity curve。仲有 replay 模式:改 detector 參數,即場用歷史 feature vector 重跑對比 lift。

## Context (verified facts)
- Tabs: `src/components/NavTabs.tsx` currently `scan`/`search`; tab state `src/App.tsx:44`.
- Recordings: daily JSONL at `%LOCALAPPDATA%/YaobiHunter/recordings/` (recordFile.ts:10-13); served by no endpoint yet. Dual-endpoint precedent: `/record` + `/kv` (server.cjs + vite.config.ts, see P0).
- Eval logic to REUSE not rewrite: `scripts/eval-recordings.ts` — slot dedup (47), `forward()` MFE/return walker (82-102), `summarize()` (108-120), rising-edge sampling (144-170), STATES list (123-128), H4=16/H24=96 slot constants (20-21). It currently imports `fs` — the core must move to a browser-safe module.
- v2 rows carry the feature vector (R1 field table); `recCoinField(row, idx)` is the accessor.
- Detector fns runnable in browser: `detectFlushBreakout` needs full series (NOT in recordings) — replay mode therefore re-evaluates only FEATURE-BASED predicates (thresholds over recorded features), not the full series detectors. This is a hard design boundary; do not promise series-level replay.
- Paper state/curve: kv key `paper-state` (M1).
- **M3(策略對照)如果已 land**:`/recordings` endpoint(`scripts/recordingsServe.ts` + 雙端點)同 `src/lib/evalCore.ts`(parse/index/rising-edge 部分)已經存在 — Step 1 先檢查,存在就 reuse;Step 2 變成只需再移 `forward`/`summarize`/STATES 入 evalCore(byte-identical 驗證照做)。

## Design (decided)
- **Endpoint**: `GET /recordings?from=YYYY-MM-DD&to=YYYY-MM-DD` → concatenated raw JSONL text (`content-type: application/x-ndjson`). Server: list dir, filter filenames within range, stream-concat. Same handler duplicated in server.cjs (CJS inline) + vite plugin (import from a new `scripts/recordingsServe.ts`). Cap: refuse ranges > 92 days (413).
- **Shared core**: new `src/lib/evalCore.ts` — move `forward/summarize/rising-edge/STATES/H4/H24` + a `parseRecordings(text): Map<slot, ScanRecord>` (dedup + skip meta lines). `scripts/eval-recordings.ts` becomes a thin CLI: read files → call core → print table. CLI output must stay byte-identical for the human table (regression-check by eye).
- **Tab UI** (new `src/components/HistoryView.tsx` + child components):
  1. **日期範圍** picker (two `<input type="date">`, default last 14d) → fetch + parse once, hold in state.
  2. **訊號日誌 SignalJournal** — table: 時間 | 幣 | 訊號(⚡/蓄) | 當時價 | +1h | +4h | +24h | MFE24h。Rows = rising-edge events from evalCore; forward returns via `forward()`. Row click → opens the coin's regular detail view.
  3. **Lift 表 LiftTable** — evalCore's states × {4h, 24h} hit/lift/meanMFE vs baseline; same numbers as `npm run eval-rec`.
  4. **時間軸 TimelineScrubber** — `<input type="range">` over available slots; shows that slot's top-10 by strength (from recorded rows) with regime/strength/fb/ea — a "time machine" of the screener.
  5. **模擬盤 PaperPanel** — equity curve (lightweight-charts line, one pane ~200px) + stats + last 20 ledger rows from `paper-state`.
  6. **Replay 重跑 ReplayPanel** — form of threshold inputs (e.g. `volZ ≥`, `oi4h ≤`, `pos ≤`, `funding| ≤`, `basisPct ≤`) building a predicate over v2 feature columns; run = evalCore rising-edge sampling with the custom predicate as a state; output a LiftTable row vs baseline, side-by-side with ⚡/蓄. Preset buttons: 「⚡ 近似」「蓄 setup 近似」.
- Styling: reuse `.card`, `.scr-head/.scr-row` grid patterns (theme.css:601-640), `.chip`. zh-TW labels.

## Steps
1. `scripts/recordingsServe.ts` (list+filter+concat, pure fs) → vite plugin `recordingsEndpoint()` in vite.config.ts; inline CJS copy in server.cjs routed at `rawUrl.startsWith('/recordings')` next to server.cjs:122.
2. `src/lib/evalCore.ts` extraction + `eval-recordings.ts` slim-down. `npm run eval-rec` before/after on the same dir → identical table.
3. NavTabs: add `{ key: 'history', label: '記錄' }`; App.tsx renders `HistoryView` for it (state lives inside HistoryView; App only mounts it).
4. HistoryView: fetch/parse/state + the six children in the order above. Each child is presentational; all computation in evalCore or HistoryView-level `useMemo`.
5. ReplayPanel predicate builder: `(row: RecCoin) => boolean` composed from filled-in fields only (empty = ignore); null features (v1 rows, missing spot) → predicate false for that row (count shown as「不適用 N」).
6. Perf guard: 14d ≈ 1344 slots × ~350 coins ≈ 470k rows — parse once into typed maps (evalCore), memoize; scrubber renders only its slot. If parse takes >2s show a `.spinner` (theme.css:546).

## Verification
1. `npm run typecheck`; `npm run eval-rec` output unchanged post-extraction (diff the table).
2. Dev run → 記錄 tab: journal lists 2026-07-04+ events (⚡ events are rare — strength≥70/top10 states from evalCore give immediate rows to eyeball); lift table matches a fresh CLI run for the same date range.
3. Scrubber at the newest slot ≈ current screener top-10 (same symbols, minor timing drift OK).
4. Replay: preset 「⚡ 近似」 over ≥14d runs < 3s and outputs a lift row.
5. Paper panel matches the topbar chip's equity.

## Acceptance checklist
- [x] `/recordings` endpoint in BOTH server.cjs and vite; range-capped. *(already landed with M3)*
- [x] evalCore shared by CLI and UI; CLI table byte-identical. *(verified: eval-rec JSON + table diff = IDENTICAL post-extraction)*
- [~] Journal / lift / scrubber / paper / replay all functional on real recordings. *(session 1: journal + lift done; scrubber / paper / replay = session 2)*
- [ ] Replay honestly labeled: feature-level 重跑,唔係完整序列回測. *(session 2 — replay panel deferred)*

## Results — Session 1 (evalCore extraction + journal + lift), 2026-07-05

M2's endpoint (Step 1) was already built by M3 (`/recordings` in vite.config.ts + server.cjs, `recordingsServe.ts`, range-capped 92d). This session did the **evalCore extraction (Step 2)** + the **記錄 tab with SignalJournal + LiftTable** (Steps 3–4, partial). Scrubber / paper / replay (Steps 4–5 remainder) = session 2. typecheck passes. 2-lens adversarial review (extraction fidelity, UI wiring/honest-stats/scope) — both **CONFIRMED**, zero issues.

**evalCore (Step 2)** — moved `forward` / `summarize` / `evalStates` / `runEval` + `H4/H24` + result types out of `eval-recordings.ts` into `src/lib/evalCore.ts` (browser-safe). `summarize` now takes `target` as a param; `evalStates(idx)` is a factory (top10 reads `idx.top10At`). CLI slimmed to `{ dir, ...runEval(idx, target) }`. **Byte-identical verified**: `npm run eval-rec --json` and the human table both diff IDENTICAL before/after — ONE implementation, no drift.

**記錄 tab** (`HistoryView.tsx`, `NavTabs` +記錄, `App` history route) —
- **LiftTable**: `runEval` states × {4h, 24h} hit/lift/meanMFE vs baseline (baseline ×1.00); `< 20` events → 「樣本不足」.
- **SignalJournal**: ⚡/蓄 rising edges + forward +1h/+4h/+24h + MFE24h (via `forward`); row-click → coin detail (`onSelect`→`openCoin`); null forward windows → 「—」; capped at 250 rows with a count note.
- Date-range picker (default 14d), status states (loading/empty/error incl. 413), non-advice footer.

**Verified (node harness on real recordings, 108 slots)** — LiftTable numbers (`strength≥70` ×4.66, `top10` ×1.77, baseline 24h 1.6%; ⚡/蓄/organic flagged 樣本不足) match the byte-identical CLI; SignalJournal built 22 ⚡/蓄 events with correct forward returns + null-window handling.

**Not verified in-browser**: the actual render of the two tables (port 5173 held by a concurrent dev server; shared vite config untouched). Data is proven correct; the tables reuse existing `.card`/grid patterns.

**Session 2 (remaining)**: TimelineScrubber (slot slider → top-10 time machine), PaperPanel (equity curve from `paper-state`), ReplayPanel (feature-predicate builder → custom-state lift, honestly labeled feature-level).

## 陷阱 / Do-NOT
- Do NOT rewrite the eval math in the UI — ONE implementation (evalCore) or the CLI and tab will drift and produce two different truths.
- Do NOT ship replay over full-series detectors (recordings don't carry series; see Context) — feature predicates only.
- Do NOT load recordings via fs in browser code — everything through `/recordings`.
- Parse defensively: malformed lines skipped (same try/catch as eval-recordings.ts:45-50); meta lines are DATA for duration display but not coin rows.
- Small-sample honesty: when a state has < 20 events, show 「樣本不足」 next to its lift (copy the disclaimer culture from eval-recordings.ts:194).
