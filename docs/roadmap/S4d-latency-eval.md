# S4d — 訊號延遲分析:eval-rec 加「fire 早過個 move 幾多」分層

**層級**: 第2層 訊號擴張(實驗) · **工作量**: S · **依賴**: R1 + 一段時間嘅 recordings(≥2-4 週先有意義)

## zh-HK TL;DR
「更早偵測」要有得量度先知有冇進步。呢個 spec 幫 eval-recordings 加一個延遲指標:每個訊號事件,向後搵「move 起點」(價格開始持續上升嗰個 slot),計訊號係 move 之前定之後幾多個 slot fire。以後任何「更早」實驗(S2/S3/S4x)都用呢個指標驗證。

## Context (verified facts)
- `scripts/eval-recordings.ts` samples rising edges (144-170) and computes forward MFE/ret (`forward()`, 82-102) from the recorded 15-min price path. After M2, core lives in `src/lib/evalCore.ts` — implement there (CLI + UI both benefit); if M2 not yet landed, implement in eval-recordings.ts and note the move.
- Slots are 15-min (`SLOT_MS`, line 19-21).

## Design (decided)
- **Move-start definition** (fixed, so results are comparable across runs): for an event at slot S with MFE24h ≥ target, walk slots S..S+96 and find the first slot m where price ≥ entry × (1 + 0.25 × target%) — i.e. the move is 25% underway. `leadSlots = m − S` (≥0; small = signal fired just before/at the move; large = fired long before).
- For events that never hit target: excluded from lead stats (they have no move).
- Output per state: `leadSlots` distribution — p25/median/p75, plus `% fired ≤2 slots before move` (the "almost too late" share).

## Steps
1. In evalCore (or eval-recordings.ts): `leadTime(sym, slot, targetPct): number | null` using the same `priceAt` map as `forward()`.
2. Aggregate per state in the existing results object: `results.states[key].lead = {n, p25, med, p75, late2}`.
3. CLI: extend the human table with a `lead(med)` column and a `--lead` flag to print the full distribution. JSON output includes the object automatically.
4. M2 LiftTable: show `median lead` column (defer if M2 not merged).

## Verification
- `npm run eval-rec -- --target 10 --lead` on accumulated recordings → lead stats print; sanity: top10 state (persistent) should show larger spread than ⚡ (trigger-timed).

## Acceptance
- [ ] Deterministic move-start rule implemented exactly as defined (0.25 × target underway).
- [ ] Lead columns in CLI table + JSON.
- [ ] No change to existing hit/lift numbers (pure addition).

## 陷阱 / Do-NOT
- Do NOT redefine move-start per experiment — comparability is the whole point. Change requires updating THIS spec first.
- 15-min slots bound resolution: micro-scan (S3) improvements show up in `SignalTimes` latency, not here — this measures the SIGNAL's structural earliness, not delivery latency. Note the distinction in the CLI help text.
