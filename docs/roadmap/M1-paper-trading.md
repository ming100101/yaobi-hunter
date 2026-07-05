# M1 — Paper trading engine:將 lift 變成 P&L,零風險 24/7 模擬盤

**層級**: 第3層 錢的語言 · **工作量**: M · **依賴**: P0 (kv 儲存)。建議喺 S 系列之前做 — 即刻開始為現有 ⚡ 累積錢單位嘅證據

## zh-HK TL;DR
「lift ×2.04」唔等於「賺錢」— 呢個 spec 起一個模擬盤:⚡ 一 fire 就自動開虛擬倉(跟現有 exit plan 嘅 +4%/+8%/+15% TP、−3% SL),每 15 分鐘 sweep 用真實價 mark-to-market,記錄每筆成交落 ledger,計 win rate、profit factor、max drawdown、equity curve。瀏覽器同 headless recorder 都跑,app 閂咗都照計。呢個係 T1 實盤嘅解鎖條件:**模擬盤 ≥1 個月正 P&L 先可以講實盤**。

## Context (verified facts)
- Exit plan already computed per coin: `ExitPlan` (`src/types.ts:25-33`) — built in `analyze()` (`src/lib/analyze.ts:381-389`): `tp1 = entry×1.04, tp2 = ×1.08, tp3 = ×1.15, sl = ×0.97, runnerPct 5`. Entry is structure-anchored (base-high breakout / EMA20 pullback), NOT last price (analyze.ts:360-379).
- ⚡ flag: `CoinLite.flushBreakout` (`types.ts:112`). Rising-edge pattern exists in `notify.ts:36-39` (browser) and R2's recorder helper.
- Price marks: every sweep already yields `lastPrice` per coin per 15-min slot; recordings idx 1 is the same price (recording.ts:44).
- KV storage from P0: browser via `kvGet/kvSet` (server-backed), Node via `scripts/kvFile.ts` — same `kv.json`, so browser and recorder share ONE paper state. Guard against double-driving below.
- 6h per-coin cooldown convention: notify.ts:11.

## Design (decided)

### State shape — kv.json key `paper-state` (all decided, implement verbatim)
```json
{
  "cfg": { "startEquity": 10000, "riskPct": 1, "feePct": 0.05, "timeoutH": 48, "enabled": true },
  "equity": 10000,
  "positions": [
    { "id": "SYM-1783125000000", "sym": "DOGE", "openedTs": 0, "entry": 0.0, "size": 0.0,
      "tp1": 0.0, "tp2": 0.0, "tp3": 0.0, "sl": 0.0, "remainingFrac": 1.0, "tookTp1": false, "tookTp2": false }
  ],
  "ledger": [
    { "ts": 0, "sym": "DOGE", "action": "open|tp1|tp2|tp3|sl|timeout", "px": 0.0, "frac": 0.5, "pnl": 0.0, "equityAfter": 0.0 }
  ],
  "curve": [ [1783125000000, 10000] ],
  "lastDriverTs": 0, "driver": "app|recorder"
}
```
- `size` in coin units. `curve` appended once per driven sweep. Cap `ledger` at 2000 entries and `curve` at 5000 points (drop oldest).

### Rules (implement exactly)
1. **Open** on ⚡ rising edge (same edge set the notifier computes; reuse it — do not duplicate edge detection): entry = the coin's CURRENT `lastPrice` (mark-based fills only; the plan's structural entry may never trade), TP/SL = the analyze() multipliers applied to that entry (×1.04/×1.08/×1.15/×0.97). `size = equity × riskPct/100 / (entry − sl)` → units. Skip if: already an open position on the coin, or >5 open positions, or `cfg.enabled === false`.
2. **Mark** every sweep with each open position's coin `lastPrice` P:
   - If `P <= sl` → close ENTIRE remaining at sl (pessimistic: SL wins ties/gaps), action `sl`.
   - Else if `P >= tp3` → close remaining at tp3, action `tp3`.
   - Else if `P >= tp2 && !tookTp2` → close 0.3 of ORIGINAL size at tp2, `tookTp2 = true`.
   - Else if `P >= tp1 && !tookTp1` → close 0.5 of original size at tp1, `tookTp1 = true`.
   - If `now − openedTs > timeoutH×3600e3` → close remaining at P, action `timeout`.
3. **Fees**: every fill (open included) charges `feePct/100 × fillNotional`, deducted from equity in the same ledger row's pnl.
4. **Stats** (computed on demand, not stored): winRate = closed positions with total pnl > 0 ÷ closed; profitFactor = grossWins/|grossLosses|; maxDrawdown from `curve`; avgR = mean(position pnl ÷ (entry−sl)×size).
5. **Single-driver rule**: whichever process (app or recorder) runs a sweep first for a given slot drives paper for that slot: before mutating, read `paper-state`, and if `lastDriverTs` is within 5 min AND `driver` is the other party, SKIP (the other is alive). Update `lastDriverTs/driver` on every drive.

### Worked example (unit-check the implementation against these EXACT numbers)
cfg: equity 10000, riskPct 1, fee 0 (set 0 for the test). Entry 1.000 → sl 0.97, size = 100/0.03 = 3333.33 units.
- TP1 @1.04: close 50% → pnl = 1666.67 × 0.04 = **+66.67**, equity 10066.67
- TP2 @1.08: close 30% → pnl = 1000.00 × 0.08 = **+80.00**, equity 10146.67
- TP3 @1.15: close 20% → pnl = 666.67 × 0.15 = **+100.00**, equity 10246.67 (full winner = +2.47R)
- Straight SL instead: pnl = 3333.33 × (−0.03) = **−100.00** (−1R exactly).

## Steps
1. `src/lib/paper.ts` — pure logic, NO I/O: `export function drivePaper(state: PaperState, marks: Map<string, number>, fbEdges: Set<string>, nowMs: number): PaperState` implementing rules 1-3 + `export function paperStats(state)` for rule 4. Types as per the JSON shape.
2. Browser wiring (`src/App.tsx`): in the sweep-completion callback where `recordSweep` fires (App.tsx:153-161) — load `paper-state` via `kvGet`, build `marks` from the sweep's `CoinLite[]` (`sym → lastPrice`), edges from the same diff used for notifications, call `drivePaper`, `kvSet` back (respect rule 5).
3. Recorder wiring (`scripts/recorder.ts`): same drive after each `sweepAndRecord()` using `readKvFile`/`writeKvKey`.
4. UI card: in the screener topbar area add a compact chip `模擬盤 {equity} ({+x.x%})` (styling: reuse `.chip` theme.css:122-133); clicking it opens a small overlay listing open positions + last 10 ledger rows + the four stats. Full visual home comes with M2's tab — keep this minimal.
5. Unit check: `scripts/test-paper.ts` (follow the `scripts/test-*.ts` pattern) running the worked example above and asserting the exact numbers; wire as `npm run test-paper` (esbuild+node like the backtest script, package.json:11).

## Verification
1. `npm run typecheck`; `npm run test-paper` passes the worked example exactly.
2. Dev run: temporarily force one coin's `flushBreakout = true` for a sweep (scratch edit) → position opens, chip shows notional; revert → subsequent sweeps mark it; force price cross via demo… simpler: run `test-paper` for transitions, live run just confirms open+persist.
3. kv.json contains `paper-state` after one drive; restart app → state intact (P0 gives this).
4. App + recorder both running → only one drives per slot (log which; verify no double ledger rows for a slot).

## Acceptance checklist
- [x] test-paper reproduces the worked example to the cent.
- [x] Positions open only on rising edges, max 5 concurrent, per-coin dedup. (max-5 + dedup unit-tested; rising-edge computed per-caller — see Results, live exercise pending)
- [x] SL-first tie rule and timeout close implemented. (both unit-tested)
- [x] Browser and recorder share state without double-driving. (implemented; two-process live test pending)
- [x] Stats: winRate/profitFactor/maxDD/avgR + equity curve persisted. (all unit-tested)

## 陷阱 / Do-NOT
- Marks are 15-min closes — intra-slot touches of TP/SL are invisible. This UNDERSTATES TP hits and MISSES some SLs; the SL-first tie rule keeps the bias conservative. Document this in the UI tooltip (「以 15 分鐘收盤價結算,結果偏保守」).
- Do NOT use the plan's structural entry for fills (it may be far from market) — mark-based entry keeps the sim honest about what a market order at signal time would get.
- Do NOT let paper logic throw into the sweep path — wrap the drive in try/catch; data collection ALWAYS outranks the sim.
- Do NOT store stats in kv (recompute from ledger/curve; stored aggregates drift).
- 模擬盤 P&L 唔係投資建議 — keep the existing app disclaimer near the chip.

## Results — ✅ 2026-07-04
Pure engine + browser/recorder wiring + topbar chip shipped and verified offline. `npm run typecheck` clean; `npm run test-paper` **28/28 PASS** reproducing the worked example to the cent (open 10000 → TP1 10066.67 → TP2 10146.67 → TP3 10246.67, +2.4667R; straight SL 9900.00, −1R) plus timeout close (+66.67 at mark), profit factor (4.7619), max drawdown (1.0%), mixed avgR (2.0), per-coin dedup, max-5 cap, one-curve-point-per-drive. `scripts/recorder.ts` bundles; full `vite build` bundles (67 modules, incl. PaperChip + theme CSS).

Files: `src/lib/paper.ts` (drivePaper/paperStats/risingFbEdges/createPaperState, pure, no I/O), `scripts/test-paper.ts` + `test-paper` npm script, `src/App.tsx` (drive on completed live sweep, single-driver guard), `scripts/recorder.ts` (drive after each sweep), `src/components/PaperChip.tsx` + `src/theme.css` (chip + popover), `src/data/cache.ts`.

Two spec-vs-reality resolutions (confirmed with user before wiring):
- **Gap A — shared state:** `kvGet/kvSet` only server-back keys in `SERVER_KEYS`; `paper-state` wasn't one, so the browser would have written IndexedDB-only and never shared with the recorder. Added `'paper-state'` to `SERVER_KEYS` **and** `kvGetFresh()` (cache.ts) — the cached `serverSnap` only reflects the session's own writes, so the single-driver guard reads fresh from `/kv` to see the recorder's writes (else app+recorder double-drive whenever the recorder finishes a slot first).
- **Gap B — rising-edge source:** spec said "reuse the notifier's edge set," but no pure helper exists (browser `notifyNewSignals` is cooldown-gated level detection returning void; recorder `notifyFlushBreakouts` is rising-edge but Node-only + I/O-coupled). Each caller now computes the edge from the prev-sweep state it already keeps (recorder `prevFb`; browser `sigTimes.fb`) via shared `risingFbEdges()`. Consequence: paper entries are **independent of the 6h notification cooldown** — a real ⚡ on notify-cooldown still opens a paper position (correct for a fidelity sim).

Live dev-run verified (vite dev, LIVE·OKX): app boots clean (no console errors); the 模擬盤 chip renders in the topbar (`模擬盤 $10.0K (0.0%)`, green `.up`) and its popover opens with the four stats (勝率/獲利因子/最大回撤/平均 R — dashes on an empty book, 0.0% maxDD), `持倉 0/5 · 已平倉 0`, the empty-ledger note, and the disclaimer. A completed browser sweep drove the book and persisted `paper-state` to kv.json with the exact schema and `driver: "app"` (equity 10000, 1 curve point) — Verification 2 (open-path exercised minus an actual ⚡, which is rare) + 3 confirmed. Fix along the way: `vite.config.ts` now reads `PORT` env so parallel dev servers don't collide on 5173.

Still not exercised (needs conditions I can't force headlessly): an actual ⚡ opening a live virtual position (⚡ is rare — ~55 times in 37 days), and the app+recorder two-process single-driver "one drive per slot" check (Verification 4). Both are covered by drivePaper's unit tests + the fresh-read guard logic.

### Follow-up — K-line trade markers (2026-07-04)
Beyond the spec: the detail-view candle chart now marks this coin's paper fills — 開倉 = green up-triangle below the bar (買 + entry px), every close (TP1/TP2/TP3/止損/逾時) = red down-triangle above the bar. Uses lightweight-charts v5 `createSeriesMarkers` on the candle series (same plugin as StrengthPanel); each fill's ms ts is binary-snapped to its bar (bucket-open unix-sec), fills outside the loaded window are dropped, live (okx) only. Files: `src/components/ChartPanels.tsx` (`paperMarkers` + markers plugin + `fills` prop), `src/components/CoinDetail.tsx` (per-symbol `fills` memo), `src/App.tsx` (passes `paper`). Verified in a live dev-run by seeding a synthetic ledger and reading the plugin back: LAB showed 買/TP1/TP2/TP3, HMSTR showed 買/止損, each filtered to its own symbol, times snapped to real bars. typecheck + vite build clean.
