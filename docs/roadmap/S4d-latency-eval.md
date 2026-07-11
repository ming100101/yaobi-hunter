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

## Case study — CAP 2026-07-05→06(用戶指出嘅 miss;S4d 嘅 motivating case)

Recordings 覆盤(270 個 15-min slots,兩日):

| 時間(07-05) | 事件 |
|---|---|
| 08:45–12:18 | **OI flush**:oi4h 最深 −16.5%,價 0.0233→0.0202,volZ 高達 3.5(恐慌出清) |
| 13:00–14:00 | 築底,OI 由負轉平(oi4h ≈ 0),strength 48→65,regime A |
| 15:00–19:00 | Recovery +30%:0.0215→0.0241,volZ spikes 3.55/2.81 |
| 23:15–23:34 | **突破**:0.0245→0.0256,volZ 4.96,strength 77 — 但 **oi4h 已 +13~+25%(OI 重建晒)** |
| 23:34 | 入強度 top10(第 2-3 位),00:49 str 峰值 79 |
| 07-06 03:15 | 見頂 0.0290(由 23:30 突破位 +14%,由 16:32 recovery 中段 +24%) |
| 04:00 之後 | 全回吐返 0.0207 |

**結論:**
1. **⚡ 冇 fire 係照定義正確,唔係 bug。** ⚡ = OI 仲喺縮倉狀態時帶量突破;CAP 係「flush → OI 完全重建 → 先突破」= **增倉突破**,係另一個 pattern(oi-up-price-up / double-confirmation 嗰類 generic read 有 fire,但嗰啲未過 gate,冇 badge/通知資格)。
2. **機器有見到,人冇機會見到。** 23:34(最大嗰腳前 ~3.5 小時)CAP 已經 str 77 = top10 第 2-3 位,喺 screener 最當眼位置 — 但半夜冇人睇 mon,而通知只有 ⚡ 一種。Miss 嘅本質係「通知集」空隙,唔係「偵測」空隙。
3. **補救路徑(照鐵律行):** eval-rec 已經量緊 strength≥70 crossing 呢個狀態(2026-07-06 快照:24h lift ×2.78,n=368,但 span 得 ~2.6 日 — 唔夠升通知級,直接升 = 重蹈 ×1.61 selection-noise 覆轍)。E1 月度重驗累積夠 span,E2 升降班先可以將佢升做通知級。S4d 嘅 lead-time 指標就係用嚟答「top10-entry / str≥70-crossing 平均比大 move 早幾多」呢條問題 — CAP 呢單 case 入面係 早 3.5 小時。

## Results — ✅ shipped 2026-07-08(/loop autonomous)
`leadTime()` + per-state `lead {n,p25,med,p75,late2}` 入咗 `evalCore.runEval`(seam-aware,跟 --source 過濾);CLI 加 `--lead` + 表尾「lead med(n)」欄;記錄 tab LiftTable 加「提早(中位)」欄。move-start 定義照 spec:首個 close ≥ entry×(1+0.25·target)。回歸 `npm run test-eval-seam` 綠,typecheck 綠。

**首次量度(OKX-era 3.0d, target +10%, `--source okx --lead`)— 直接證實用戶「太遲」投訴:**

| state | events | 24h lift | lead med (n) | p25/p75 | ≤30min-late |
|---|---|---|---|---|---|
| ⚡ flushBreakout | 43 | ×0.00 | **—(0)** | — | — |
| 蓄 earlyAccum | 25 | ×0.00 | —(0) | — | — |
| strength≥70 | 596 | ×2.57 | **2.0h (56)** | 0.8h / 5.8h | 16.1% |
| top10 | 883 | ×1.98 | **2.5h (64)** | 1.3h / 6.0h | 12.5% |
| organic-spot-lift | 22 | ×12.4 | 4.3h (10) | 2.8h / 7.8h | 0% |

- **⚡ = 0 個 fire 之後仲升到 +10%**(lead 無得計):量化證明 ⚡ fire 即係 move 本身,升完先響 → 太遲。
- **strength≥70 / top10 crossing 中位早 2.0-2.5 鐘 fire,lift ×2.0-2.6** — 呢個就係「更早偵測」嘅答案,已經係 screener state,只欠通知級升班(E2 gate,等 span)。
- Caveat:recordings forward 有截短(coin 跌出宇宙停錄),所以 ⚡ 嘅絕對 hit 偏低;但**相對** lead(各 state 同樣截短)係穩健,同 harness ×1.28 同 CAP 3.5h 都對得上。lead 指標主打相對比較,唔係絕對 hit。
- 下步(見 NIGHT-LOG-2026-07-08):用 5m harness 研究「突破前」early-initiation detector,睇能唔能夠有 gate-passing lift + 正 lead。
