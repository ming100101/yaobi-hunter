# S3 — Micro-scan:candidates 每 60-90 秒複查,⚡ trigger 早最多 14 分鐘

**層級**: 第2層 訊號擴張 · **工作量**: S · **依賴**: R2(通知路徑) · **性價比最高嘅「更早偵測」**

## zh-HK TL;DR
主 scan 係 15 分鐘一轉,即係 ⚡ 突破可能發生咗 14 分鐘先被發現。呢個 spec 為少數候選幣(pinned + 強度 top-20)加一條 60-90 秒嘅輕量複查 loop,只檢查 `detectFlushBreakout` 有冇 fire,一 fire 即通知。唔使新數據源,零 rubik 成本(用 warm OI store)。

## Context (verified facts)
- Scan cadence: `SCAN_MS = 15 * 60 * 1000` (`src/App.tsx:30`); detail-view live poll already refetches ONE coin every 20s (`DETAIL_LIVE_MS`, App.tsx:32, 202-217) — proof that single-coin refetch is cheap and safe.
- Single-coin fetch: `fetchLiveCoin(baseUrl, hit, nowMs)` (okx.ts:157+) → full Coin incl. `flushBreakout` via `analyze()`. Candles = 2 paginated calls; funding = 1 call; OI comes from the warm store when the coin has ≥48h accumulated (README:74-79), rubik otherwise.
- Rate budget: candles documented 40 req/2s (okx.ts:422-424 comments); detail poll + scan already coexist. 20 coins × 3 req / 75s ≈ 0.8 req/s — trivial. Rubik headroom is the ONLY concern → micro-scan must be warm-OI-only.
- Notification paths: browser `notifyNewSignals` (`src/lib/notify.ts:28-59`); headless `notifyFlushBreakouts` (R2, `scripts/notifyHeadless.ts`).
- Signal-age tracking keys on rising edges per full sweep (`SignalTimes`, types.ts:82-87, App.tsx:130,160) — micro-scan must UPDATE the same map so ages stay honest.

## Design (decided)
- Candidate set recomputed after each full sweep: `pinned ∪ strengthTop20`, cap 25.
- Loop cadence: 75s (between 60-90; one knob `MICRO_MS = 75_000`).
- Warm-only rule: before fetching a coin, ask the OI store whether it can serve the coin's OI series (`oiStore.getSeries` returning non-null — see `src/data/oiStore.ts`); cold coins are SKIPPED this cycle (they'll warm within 48h of the store running).
- Each cycle: `mapPool(candidates, 2, fetchAndCheck, 200)`; for each coin run `detectFlushBreakout` on fresh series; rising edge (vs a module-level `Set` of currently-⚡ symbols, seeded from the last full sweep) → notify + mark `SignalTimes.fb` if unset.
- Runs in BOTH: browser (`App.tsx` interval, live source only) and headless recorder (same helper, after each sweep starts a micro loop that pauses during the next full sweep).
- Micro-scan results do NOT re-rank the screener (no `strength` recompute shown) — they only flip the ⚡ badge/notify. Full re-rank stays on the 15-min cadence.

## Steps
1. New `src/lib/microScan.ts` exporting `runMicroCycle(baseUrl, candidates: string[], curFb: Set<string>, onFire: (c: Coin) => void): Promise<Set<string>>` — implements the warm-only fetch + detect + rising-edge logic above. Reuse `fetchLiveCoin` and `detectFlushBreakout`; do NOT duplicate their internals.
2. **Browser wiring** (`App.tsx`): a `useEffect` interval at `MICRO_MS`, active only when `source === 'okx'` and the tab is visible (`document.visibilityState === 'visible'` — skip cycles otherwise to save battery/limits). `onFire`: update coin's row flag in scan state (find by symbol, set `flushBreakout = true`), call `notifyNewSignals([lite], openCoin)`, update signal-times via the existing save path (App.tsx:130).
3. **Headless wiring** (`scripts/recorder.ts`): after each sweep completes, run micro cycles every 75s until 60s before the next slot; `onFire` → `notifyFlushBreakouts` (R2). Skip entirely if the sweep is still running.
4. Budget guard: if a cycle sees ANY 429 warning from `okxGet` (expose a counter from okx.ts or track fetch failures), double the interval for the next 10 minutes (simple backoff variable).

## Verification
1. `npm run typecheck`.
2. Dev run: console-log each micro cycle's `checked/skipped-cold/fired` counts for one hour — expect checked ≈ candidates, fired = 0 most cycles, zero 429 warnings.
3. Latency proof: when a ⚡ appears, `SignalTimes.fb` timestamp should NOT be a multiple of the 15-min slot boundary (shows micro-scan caught it mid-slot). Check one real firing or synthesize by temporarily lowering `FB_VOLZ` (analyze.ts:35) in a throwaway run.
4. Recorder + app running together: still no sustained 429s (both micro loops are warm-only, so rubik untouched).

## Acceptance checklist
- [ ] ≤25 candidates, 75s cadence, warm-OI-only, hidden-tab pause.
- [ ] Rising-edge ⚡ mid-slot triggers notification + signal-age within ~75s.
- [ ] Zero added rubik requests (verify: no cold-path OI fetches from micro cycles).
- [ ] Screener ranking still only changes on full sweeps.

## 陷阱 / Do-NOT
- Do NOT let micro-scan touch the rubik OI endpoint — warm-only skip is a hard rule; the 30% rubik headroom belongs to the detail-view poll (okx.ts:426-433).
- Do NOT recompute/overwrite `strength` or re-sort the list mid-slot (UI jumping every 75s is worse UX than a 15-min rhythm).
- Do NOT run browser micro-scan in demo mode or when tab hidden.
- Respect the 2-min single-coin cooldown pattern from the detail-view priority refresh (README:7) — if the user has a coin's detail open, its 20s poll already covers it; skip it in micro cycles to avoid double-fetch.
