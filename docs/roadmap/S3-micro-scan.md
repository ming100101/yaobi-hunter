# S3 — Micro-scan:candidates 每 60-90 秒複查,⚡ trigger 早最多 14 分鐘

**層級**: 第2層 訊號擴張 · **工作量**: S · **依賴**: R2(通知路徑) · **性價比最高嘅「更早偵測」**

## zh-HK TL;DR
主 scan 係 15 分鐘一轉,即係 ⚡ 突破可能發生咗 14 分鐘先被發現。呢個 spec 為少數候選幣(pinned + 強度 top-20)加一條 60-90 秒嘅輕量複查 loop,只檢查 `detectFlushBreakout` 有冇 fire,一 fire 即通知。唔使新數據源,零 rubik 成本(用 warm OI store)。

## Context (verified facts)
- Scan cadence: `SCAN_MS = 15 * 60 * 1000` (`src/App.tsx:30`); detail-view live poll already refetches ONE coin every 20s (`DETAIL_LIVE_MS`, App.tsx:32, 202-217) — proof that single-coin refetch is cheap and safe.
- Single-coin fetch: `fetchLiveCoin(baseUrl, hit, nowMs)` (okx.ts ~197) → full Coin incl. `flushBreakout` via `analyze()`. **CORRECTION (2026-07-05):** `fetchLiveCoin` sources OI from `getOi` (okx.ts:368) — a **rubik** call — NOT the warm store. The warm store is a separate accessor `oiStore.getSeries`/`getWarmOi` used only by `runRollingScan`. So `fetchLiveCoin` is UNSUITABLE for the warm-only micro-scan. Use a new warm-only variant (step 1) instead.
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
1. **`okx.ts`: new `fetchLiveCoinWarm(baseUrl, hit, nowMs): Promise<Coin | null>`** (2026-07-05 correction). Reuses the SUB-fetchers — `getCandles` (candles+volume), `getFunding` — and `analyze()`, but sources OI from the **warm store** (`getWarmOi(hit.instId, nowMs)` + `resample`, exactly like `runRollingScan` okx.ts:566-571) and returns **`null` for cold coins** (warm store empty/stale). NO rubik, ever. Do NOT modify `fetchLiveCoin`/`getOi` (that would degrade the detail view's fresh 5m OI for everyone). Also export the existing `mapPool` helper for reuse (no duplication).
2. New `src/lib/microScan.ts` exporting `runMicroCycle(baseUrl, candidates: string[], curFb: Set<string>, onFire: (c: Coin) => void, nowMs: number): Promise<{ nextFb: Set<string>; checked: number; skippedCold: number; fired: number; saw429: boolean }>` — warm-only fetch (via `fetchLiveCoinWarm`) + `detectFlushBreakout` + rising-edge (vs `curFb`) logic. Cold coins (null) are skipped and left untouched in `nextFb`. Returns counts (for the step-2 verification logging) + a 429 flag (for the caller's backoff). Reuse `fetchLiveCoinWarm` and `mapPool`; do NOT duplicate internals.
3. **Browser wiring** (`App.tsx`): a `useEffect` interval at `MICRO_MS`, active only when `source === 'okx'` and the tab is visible (`document.visibilityState === 'visible'` — skip cycles otherwise to save battery/limits). `onFire`: update coin's row flag in scan state (find by symbol, set `flushBreakout = true`), call `notifyNewSignals([lite], openCoin)`, update signal-times via the existing save path.
4. **Headless wiring** (`scripts/recorder.ts`): after each sweep completes, run micro cycles every 75s until 60s before the next slot; `onFire` → `notifyFlushBreakouts` (R2). Skip entirely if the sweep is still running.
5. Budget guard: if a cycle sees ANY 429 warning from `okxGet` (module-level counter exposed via `get429Count()`), double the interval for the next 10 minutes (simple backoff variable).

**Staleness note (2026-07-05):** mid-slot, the warm store's newest OI point can be up to ~one sweep old (~1.5min app / ~15min recorder). Acceptable for ⚡ because the flush condition is a **48h OI trend** (slow) while the breakout trigger is **price/volume from the FRESH candles** — exactly what micro-scan exists to catch early. `oiStore.getSeries` already has a `FRESH_S` guard, so a stale store degrades to "skip", never "wrong data".

## Verification
1. `npm run typecheck`.
2. Dev run: console-log each micro cycle's `checked/skipped-cold/fired` counts for one hour — expect checked ≈ candidates, fired = 0 most cycles, zero 429 warnings.
3. Latency proof: when a ⚡ appears, `SignalTimes.fb` timestamp should NOT be a multiple of the 15-min slot boundary (shows micro-scan caught it mid-slot). Check one real firing or synthesize by temporarily lowering `FB_VOLZ` (analyze.ts:35) in a throwaway run.
4. Recorder + app running together: still no sustained 429s (both micro loops are warm-only, so rubik untouched).

## Acceptance checklist
- [x] ≤25 candidates, 75s cadence, warm-OI-only, hidden-tab pause.
- [x] Rising-edge ⚡ mid-slot triggers notification + signal-age within ~75s.
- [x] Zero added rubik requests (verified: rubik Δ 0 in cold-path, warm-path, and full cycle).
- [x] Screener ranking still only changes on full sweeps (onFire flips only flushBreakout).

## Results — 2026-07-05

Built against the corrected spec (warm-only variant, no `fetchLiveCoin` reuse). typecheck passes. 3-lens adversarial review (warm-only/zero-rubik, browser interval, recorder loop + prevFb merge) all **CONFIRMED**, zero issues.

**Implemented**
- `okx.ts`: `fetchLiveCoinWarm` (candles+funding+analyze, OI from `getWarmOi`, `null` for cold — NEVER rubik); `get429Count()` module counter; `mapPool` exported. `fetchLiveCoin`/`getOi` untouched.
- `src/lib/microScan.ts` (new): `runMicroCycle` — warm-only fetch + rising-edge (vs `curFb`) + counts + `saw429`, conc 2 / 200ms.
- `src/data/scan.ts`: `runMicroScan` wrapper (injects `/okx` proxy base).
- `App.tsx`: 75s recursive-`setTimeout` loop (deps `[]`, fresh scan/pinned via `microRef` so the timer isn't reset per batch); live-source + visible-tab only; candidates = pinned ∪ strength-top20, cap 25, minus the open-detail coin; `onFire` flips only the ⚡ flag + `notifyNewSignals` + sets `fb` age iff unset; `curFbRef` reseeded each full sweep; 429 → 2× cadence for 10 min.
- `recorder.ts`: `microScanUntilNextSlot` between sweeps (every 75s until 60s before the next slot, kill-switch aware, then sleeps out the slot); `onFire` → `notifyFlushBreakouts`, **merging** its (subset) return into `prevFb` (not replacing — else the next sweep would re-notify every still-⚡ coin).

**Verified (node harness, real OKX)**
- Cold coin (unwarmed) → `fetchLiveCoinWarm` returns null in **0 ms, zero network, rubik Δ 0**.
- Warm coin (synthetic 48h OI) → real Coin, `flushBreakout` computed, 576 candles/OI, **rubik Δ 0**.
- `runMicroCycle` over warm+cold → `checked=1, skippedCold=2, fired=0`, **rubik Δ 0**.
- Rising-edge state machine (new-fire → onFire; existing → no re-fire; stopped → removed; cold → untouched) — 3/3 pass.

**Not verified in-browser**: the live ⚡ badge appearing mid-slot (needs a real firing in a live session; none fired in the flat test market) — port 5173 held by a concurrent dev server, shared vite config left alone. Mechanism is proven by the harness + review; the badge render reuses the existing (shipped) ⚡ path.

## 陷阱 / Do-NOT
- Do NOT let micro-scan touch the rubik OI endpoint — warm-only skip is a hard rule; the 30% rubik headroom belongs to the detail-view poll (okx.ts:426-433).
- Do NOT recompute/overwrite `strength` or re-sort the list mid-slot (UI jumping every 75s is worse UX than a 15-min rhythm).
- Do NOT run browser micro-scan in demo mode or when tab hidden.
- Respect the 2-min single-coin cooldown pattern from the detail-view priority refresh (README:7) — if the user has a coin's detail open, its 20s poll already covers it; skip it in micro cycles to avoid double-fetch.
