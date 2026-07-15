# S15 — 深跌收復兩階段早察(backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: L · **依賴**: R1 + P1(OI 可信度)+ **推送後回踩監察 infra(entryWatch,同 branch WIP)** + S7-B2(祖先 detector)· **來源**: 用戶 2026-07-12 手記 6 參考案例(GUA/TLM/MMT/EDGE/GWEI/RESOLV)+ BASELINE-AUDIT-2026-07-08 揭 B2「深跌收復」係全 suite 兩個真.state-matched edge 之一

> ## ⚠️ 通知姿態 — 用戶拍板 2026-07-13:**即時 test-only 推送,預設 ON**
> 用戶明確選擇兩階段都發 TG、立即以測試訊號上線、每輪只推 Top 1、每日最多 10 個。呢個只係可 opt-out 嘅研究提醒,**唔代表 detector 已升班**:
> - `deepReclaimTestEnabled` 缺省/true = test-only 🟡→🟢；false = **shadow 模式**(全 audit 流,零 Telegram/toast/badge)。卡固定標「測試／市場提醒,非買入建議」。
> - **badge、模擬盤、除「測試」label** 全部仍鎖喺下面完整 promotion battery 之後,唔受 toggle 影響。呢個 toggle 只解鎖「用戶自己收 測試 TG」,唔係升班。
> - 6 個手記參考案例 = **hypothesis-only**,排除於一切 scoring / lift / 推送路徑(S13:9/50「單一樣本只做假說生成」)。

## zh-HK TL;DR
一條**獨立**於增/擴同「推送後回踩監察」嘅新訊號:**深跌/洗倉 → EMA20 收復 + OI(合約數量)回升 → 🟡早察 TG → 阻力線 L0 收復 → 🟢確認 TG(回覆原早察)**。BASELINE-AUDIT 已證「深跌收復」(B2 EMA-reclaim)係全 detector suite **得兩個真.state-matched incremental edge 之一(×1.7-2.0,排第一)** — 所以 S15 有真實先驗證據,唔似 S14 靠 unconditional-baseline 虛高。**但**嗰個 ×1.7-2.0 係 **1H/detail-tier、n=68、magnitude 明標「噪」**;而本 spec 用 **native 15m**,同已驗證嗰個 detector **唔同時框**;已試過嘅 15m/scan-tier 近似(`--bd-scan`)喺 below-18 ±25% **塌到 ×0.92**(< baseline)。**結論:S15 唔准繼承 B2 個數,要喺 15m 自己重過一個 state-matched gate。** 未過 gate 前只發明標 test-only 嘅用戶授權提醒；冇 badge、冇模擬盤、冇正式訊號宣稱。

## 反 overfit 協議(執行前已生效)
1. 6 參考案例(GUA/TLM/MMT/EDGE/GWEI/RESOLV)**只做假說生成**,唔准調參、唔准入 scoring、唔准入 lift 分母。全部以 `chart-entry-cross-estimate provisional`(估算時間 2026-07-12 HKT,誤差 ±15min)記低,排除於正式 gate(同 S9 CAP / S13 EVAA 先例)。
2. 定義族同閾值喺跑任何 backtest **之前**凍結(下面「Pre-registered 定義」表),唔准事後調參。
3. **State-matched baseline 係硬性**(BASELINE-AUDIT:25「贏嘅係 incremental over state-matched,唔係 unconditional 靚」)。headline lift 對 unconditional baseline **一律唔算數** — 呢個正正係 sink 咗 S14 嘅陷阱。
4. **兩段拆開 gate**:🟡早察(深跌+EMA20 收復)同 🟢確認(L0 阻力收復窗)係**兩個未驗證加法**;confirm-line L0 唔屬已驗證嘅 B2(B2 = 單一 EMA20-reclaim-on-vol),所以要各自量 incremental value,唔准把 B2 個數搬過嚟。
5. `--bd-scan`(EMA20 + N-below-EMA20 over 48h)已存在且 below-18 敗 robustness — 新 15m detector 要示範點解結構上唔係同一個死法。
6. 全部 cells 照登包括落敗;below-baseline 嘅 def 連 recording flag 都唔要(S7 B1/B3、S12 先例)。

## Pre-registered 定義族(凍結,native 15m;bar-for-bar 對 harness)
全部用**已完成**原生 15m K 線,至少 100 根完整資料;in-progress bar 一律排除(mirror `deriveEntryWatchAnchor` drop-in-progress 紀律)。設 i = 最新已完成 bar。

**🟡 早察 trigger(全條件 AND):**
- `hi24 / lo24` = 前 24h(96 bars,不含 i 之後)最高 high / 最低 low。
- **先高後低**:最大回撤 `dd = (hiBeforeLo / lo24 − 1)` 嘅 hi 在 lo 之前,`dd ∈ [6%, 20%]`。
- **築底**:lo24 出現於 **4–80** 根 15m 之前,之後未再創新低。
- **EMA20 轉升 + 首次收復**:`e20[i] > e20[i−1]` ∧ `close[i] > e20[i]` ∧ `close[i−1] ≤ e20[i−1]`。
- **未追高**:`pos24 = (close[i] − lo24)/(hi24 − lo24) ≤ 0.70`。
- **anti-chase**:`ret4h = close[i]/close[i−16] − 1 ∈ [0, +6%]`。
- **OI(合約數量)**:`oiQty1h > 0` ∧ `oiQty4h ≥ +3%`;新鮮度 `≤ DR_OI_FRESH_S(10min)`、收市前已知。**fail-closed**:`oiQtyTrusted === false` ⇒ NaN sentinel ⇒ 兩條 OI 條件皆 false(照 P1 interpret.ts 規則,**null/untrusted 唔准當 0**)。
- 成交量、funding **只顯示**;買盤比例 `buyShare` 只入排序,唔作硬 gate。

**觸發時凍結(進 DeepReclaimCandidate):** `lo24, e20[i], e50[i], atr14[i]=ATR0, pushPx=close[i], oiQtySnap, oiUsdSnap, expiresAt = triggerTs + 24h`。
- **確認線** `L0 = max(e50[i], 低位後至 i 之前最高 15m high)`。
- **確認窗** `[L0, L0 + 0.5·ATR0]`;**走車線** `L0 + 2·ATR0`;**失效線** `invalidBelow = lo24`(凍結,禁止靜默移動)。
- 建構期 assert `L0 > lo24`(同 entryWatch `atr < support` guard 一樣,唔成立就 throw,唔准出訊號)。

**🟢 確認 trigger(早察後 next-or-later 已完成 15m):** `close ∈ [L0, L0 + 0.5·ATR0]` ∧ OI 再過(`oiQty1h > 0` ∧ `oiQty4h ≥ +3%`)。

**終局優先次序(prod 同 backtest 都要一模一樣,mirror `observeEntryWatch` 保守序):**
`expired(≥24h)` → `invalidated(close < lo24)` → `escaped 走車(high ≥ L0+2·ATR0 未確認)` → `confirmed(在窗 ∧ OI ok)`。
- **OI 缺失**(snapshot 唔 fresh):**繼續等,唔當失效**。
- **價入窗但 OI 明確不合格**:記 `OI未確認`,**唔發第二次 TG**(shadow row,計入 audit,唔計入 confirm 統計)。
- idempotent replay:同/舊 closeTs no-op。

**排序 `deep-reclaim-v0`(獨立測試分,只揀同輪 Top 1):** 固定加權 `dd`、築底 bar 數、`(close−e50)/ATR0` EMA50 距離、`oiQty1h`、`oiQty4h`、`buyShare`、追價程度(`ret4h`)。**分數只決定同輪 Top 1,唔宣稱係命中率或模仿老詹強度。** 放 `src/lib/rank.ts`(single-definition home,同 `strengthRank` 一齊,total-order tiebreak)。

## OiSnapshotV2 + Recording schema(數據層,append-only)
現況(grounding 確認):warm store 係 **USD-only**(`Pt {t,v}`,`v=oiUsd`,oiStore.ts:18-21);`fetchBulkOi` 其實已由 `/fapi/v1/openInterest` 讀到 `j.openInterest`(合約數量)但**即刻掉咗**(binance.ts:347);recording idx2 只存 oiUsd;冇 `DATA_VERSION` const,版本靠每行 inline `v`;RecCoin 現 **v4、idx0-24**(S14 idx24=earlyPump)。

- **OiSnapshotV2**:`Pt` 擴成同時存**合約數量**同 **USD**(例:`{t, q, v}` 或 `[t, q, v]`)。舊 `[t, v]` 2-tuple **照讀為 USD、但唔准當 gate 用**(hydrate 規則明寫,mirror P1「null ≠ 0」)。`fetchBulkOi` 加返 `openInterest`(contracts),`appendSnapshot` 收多一個 qty。
- **quantity 不可由 USD 倒推**:舊 recordings 只有 oiUsd(idx2),但 cold Binance `openInterestHist.sumOpenInterest` 可用同一交易所真實 quantity seed；缺真實 quantity 時仍 fail-closed，永不以 USD 代替。
- **新鮮度**:S15 OI gate 用**自己嘅** `DR_OI_FRESH_S = 10min`(比 store `FRESH_S = 20min` 緊),`getRecentSeries` 要收一個 freshness 參數(目前 hardcode FRESH_S)。
- **Recording**:新欄位 **append 到 idx25+**(`oiQty`, `oiQty1hPct`, `oiQty4hPct`, `deepReclaim` detector flag),bump `ScanRecord` **v:5**;**所有 idx≥10 讀取行 `recCoinField()`**(短舊 row 回 null,**唔准當 0**)。`SweepMeta` 現 v:3,可順手夾 detector fire flag 入 sparse bag(sweep-meta 自己 bump 定跟 v:5 由執行者定,唔准 overload 舊 `{type:'notify',v:2}` / `{type:'entry-watch',v:1}`)。
- **DeepReclaimEvent** 自己 type tag(`'deep-reclaim'`)+ 自己 `v`,append-only JSONL,`id = \`${watchId}:${event}:${ts}\``,mirror `EntryWatchEvent`(types.ts:208-227)。
- **單位污染禁令(硬 honesty rule)**:合約數量 series 唔准同 USD、rubik `openInterestHist`、或 OKX 年代 OI 拼接;backfill 只 apply `source==='binance'`(oiStore.ts:101)。
- **P0 size**:`oi-snapshots` 48h 已 ~2MB;加 quantity 大約翻倍 → P0 已 flag「大就 split sidecar」,S15 令呢件事更可能,執行時量返。

## Runtime — 兩段 watch state machine(mirror entryWatch,但獨立)
新 pure lib `src/lib/deepReclaim.ts`,**mirror `src/lib/entryWatch.ts` 全部紀律**:
- **純函數,零 I/O,零 `Date.now()`** — 每個 transition 收明確 `ts`(呢個先令 recorder restart / replay / backtest bit-identical)。OI freshness / wall-clock 檢查放 recorder,唔放 state machine。
- **獨立 state file** `%LOCALAPPDATA%/YaobiHunter/deep-reclaim.json`,atomic write+fsync+rename to unique tmp(mirror `scripts/entryWatchFile.ts`)。**唔准**共用 `entry-watch.json`、**唔准**入 `kv.json`(避免 browser/server 寫 race)。
- **每幣一個活躍監察**,keyed by upper symbol;`supersede` on sourceId idempotent;superseded source 嘅 stale transition 唔准覆寫/刪走 replacement(mirror `applyEntryWatchTransition` guard)。
- **兩個 delivery sub-machine**(比 entryWatch 多一個):🟡 early send 同 🟢 confirm send **各自** sending/retry/backoff/at-most-once。retry ladder mirror `[60s,300s,900s]`,3 次後 drop。
- **Restart 對賬**:mirror `reconcileAmbiguousEntrySends` — 持久化 `sending` row(🟡 或 🟢)可能已到 Telegram,重啟一律 drop 做 ambiguous `delivery-failed` audit,**唔自動重發**。crash 喺 🟡 同 🟢 之間:未確認嘅 🟡 **留住繼續 watch**(佢已 delivered,只係 🟢 未出),唔當 terminal。
- **🟡 message_id 要凍結入 candidate**(mirror `EntryWatchCandidate.telegramMessageId`),由 🟡 send result 攞,persist 咗先可以 restart-safe 咁 🟢 reply-thread。
- Recorder wiring(mirror entryWatch 段,recorder.ts:433-451, :276-318):每個原生 15m 收市 → 對每個活躍監察 fetch 已完成 15m candles(`closeTs = bar.time*1000 + SLOT_MS`)→ replay `observeDeepReclaim` bar-by-bar → deliver。每次完整 sweep 揀早察 Top 1;活躍確認監察優先於新早察。

## Notification path(🟡/🟢,mirror CLASS_VIRGIN + entryWatch threading)
- **新 class `'dr'`** 入 `NotifySignalClass` union;自己 `cdKey = 'dr-notified-headless'`、自己 recorder-level prev-Set。**唔准**重用 fb/rb/vg key(R2 Do-NOT:重用 key 會 race)。
- **Reply-threading**:`sendTelegram(token, chatId, text, { replyToMessageId })` 已支援(notifyHeadless.ts:47-74)。🟡 攞返 `messageId` 凍結;🟢 用 `replyToMessageId = 🟡 messageId`。R4 photo card(`sendTelegramPhoto`)一樣 thread。卡用 `buildSignalCard` dropRank pattern(title + L0/失效線 rank 0 唔掉)。
- **Toggle**:`NotifyCfg.deepReclaimTestEnabled?: boolean`,缺省/true ⇒ live test-only 推送；false ⇒ **shadow**(記 audit,零 send)。
- **Kill switch**:唯一 master 係 `KILL` file(`isKilled()`,kvFile.ts:20-31);S15 跑喺 recorder loop 內(recorder.ts:603/:468 已檢查)所以自動被 kill — **唔准**開一條 loop 外的推送路徑繞過佢。
- **Caps**:每輪最多 **1** 早察(same-round Top 1 by deep-reclaim-v0);每 Asia/Shanghai 日最多 **10** 次成功早察(kv-backed bucket)。**確認 🟢 回覆唔計入上限**。
- **Cap/cooldown 一致性**(mirror notifyHeadless.ts:337-343, :405-410):cooldown/counter **只喺 Telegram ok 嗰刻 commit**;**失敗嘅 🟡 唔燒 daily slot、唔寫 cooldown**(容許下 sweep retry);cooldown map 要 prune 過期 symbol(bound the maps 審計)。
- **toast**:跟 `cfg.toast`;測試卡係咪出 Windows toast 由執行者跟現有 class 一致處理(建議跟 cfg.toast)。
- **card 內容**:深跌%、EMA20 收復、OI 合約 1h·4h、L0 阻力、失效線、剩餘時間;固定尾標**「測試／市場提醒,非買入建議」**。
- **fires() 結構 gap**:`NotifyClass.fires(c: CoinLite)` 係單-bar predicate,**表達唔到** S15 嘅 frozen multi-bar 深跌/EMA/OI-qty state。所以 S15 **唔係** drop-in `notifyClassEdges` —> 用 bespoke detector 產 `DeepReclaimCandidate[]` 交俾新 helper(rich payload 喺 `toLite` strip candles **之前** capture,recorder.ts:336-339)。

## UI(推送 tab 新 sibling view / 擴 PushWatchView)
- 加 **早察 / 等確認 / 確認 / 失效 / 過期 / 走車** 篩選;每 row 顯示 24H 縮圖、EMA、確認線 L0、回撤、OI(合約 1h/4h)、距 L0、剩餘時間。
- **UI seam parse**:mirror `PushWatchView` — 自己 parse recordings JSONL(唔行 evalCore),by `watchId` last-write-wins merge、frozen-zone 欄位保留、壞行逐條 skip、poll `/recordings` 30s / 7 日窗;runtime status 收成幾個 UI bucket。
- **人手記錄入口**:俾用戶未來補真 TG 時間 + 失敗案例(6 參考案例 + 之後 live miss),明標 provisional、排除 gate。
- **合成兩段 TG 測試**:mirror `/notify-test-entry`(server.cjs:297 + vite.config.ts)— 加 `/notify-test-deep-reclaim` 發 🟡→🟢 threaded pair,**唔建 state、唔消耗 cooldown/cap**。
- **設定**:mirror `entryWatchEnabled` UI block，預設 ON/可 opt-out，明標研究限定；新欄位加入 backup 非機密投影。

## Gate 計劃(升班先除「測試」label + 開 badge;toggle 唔算升班)
1. **Harness**:新 `--mode deepreclaim`(native 15m;extend `backtest5m.ts` 或起 `backtest15m.ts`),**frozen bar-for-bar** 對 `detectDeepReclaim`(同 detectEarlyPump↔signalEarlyAt 先例)。
2. **State-matched baseline(硬性)**:`--matched` envelope = 同「深跌+EMA20 收復」geometry 但**冇 OI trigger** 嘅 bars 做分母(mirror `emaReclaimOnVol` matched envelope,backtest.ts:421-436)。報 **incremental** lift,唔報 unconditional。
3. **Placebo(net-new)**:加 `--shift-oi` — 把 OI series 隨機平移做 placebo,**必須失效**;現時 scripts/ 冇任何 placebo/shift mode(grep 0 hit),要新寫。
4. **兩段各自量**:🟡早察 fire 對 state-matched 增量;🟢確認窗(L0)對「淨 EMA20 收復、冇 L0 gate」嘅增量。
5. **同場比較**(draft):價格結構-only、價+quantity OI、USD OI、固定延遲、B2(1H detail)、現有 S14、買盤/成交量版、隨機平移 OI placebo。下一根 15m open 模擬入場扣 30bps;報 +4/+8/+15/−3%、+10 before −5%、MFE/MAE、等待、提前量、走車率、逐事件/逐幣回報。無確認/失效/走車以現金 0 留喺分母。
6. **Promotion battery(全部要過先除「測試」+ 開 badge)**:≥100 確認、40 幣、60 UTC 交易日、3 個月;24H/48H 淨期望值皆正;**OI 版 matched lift ≥ 1.30 勝 price-only + 固定等待**;±25% 參數 & 12/24/36H 窗**全 >1.15**;walk-forward folds 正;bootstrap 下界 >0;**平移 OI placebo 必須失效**。
7. **分支**:OI 冇增量但價格結構過 → 正式版**移除 OI 硬 gate、OI 只當資訊**;兩者皆敗 → **關測試 TG,只留 shadow 記錄**。

## Steps(test-only runtime 已授權；正式升班仍 gate 鎖定)
> 行數以本 spec grounding pass(2026-07-12)為準;`entryWatch` 係同 branch WIP,執行前對返實際檔案,唔對得上就停低報告(執行守則 #4)。

1. `src/data/binance.ts` `fetchBulkOi`:回傳加 `openInterest`(contracts)。`src/data/oiStore.ts`:`Pt`→ V2(qty+usd)、`appendSnapshot` 收 qty、`getRecentSeries` 收 freshness 參數、hydrate 舊 `[t,v]` 讀成 USD-only-not-gate、加 `DR_OI_FRESH_S=10min`。**唔准**擾亂 P1 依賴嘅 USD warm 路徑。
2. `src/lib/indicators.ts`:**新寫** `atr14`、`maxDrawdown`(先高後低)helper(現時只有 ema/bollinger/anchoredVwap/rollingVwap,冇 ATR14/drawdown/volZ)。
3. `src/lib/analyze.ts`:`detectDeepReclaim(candles15m, volume, oiQtySeries)` 純函數,return struct|null,shape 對齊 `detectFlushBreakout`/`detectEarlyPump`;加 `DEEP_RECLAIM_SHIPPED = false`(recording/badge gate,同 EARLY_PUMP_SHIPPED 先例)。
4. `src/lib/deepReclaim.ts`(新,mirror entryWatch.ts):`createDeepReclaimCandidate`(凍結 + L0/ATR0/band/invalid,assert L0>lo24)、`observeDeepReclaim`(單 15m bar,保守序 + 兩段 advance + OI 缺失=等)、supersede/apply/active/sanitize/empty、frozen-constants。
5. `scripts/deepReclaimFile.ts`(新,mirror entryWatchFile.ts):atomic `deep-reclaim.json` read/write/update。
6. `src/types.ts`:`DeepReclaimCandidate`、`DeepReclaimEvent`、`DeepReclaimState{v,updatedAt,active}`、`NotifyCfg.deepReclaimTestEnabled?`、`NotifySignalClass` 加 `'dr'`、CoinLite 加 `oiQty/oiQty1hPct/oiQty4hPct/oiQtyTrusted`。
7. `src/lib/recording.ts`:append idx25+（oiQty, oiQty1hPct, oiQty4hPct, deepReclaim flag),`buildScanRecord` bump v:5,新讀取行 `recCoinField`。
8. `src/lib/rank.ts`:`deepReclaimV0Rank`(同輪 Top-1 comparator,total-order tiebreak)。
9. `scripts/deepReclaimRuntime.ts` + `scripts/recorder.ts`:bespoke 🟡/🟢 threaded send(reply-to)+ 24h cd + per-round Top-1 + HKT-day counter + restart 對賬兩 stage + shadow-when-OFF。`deepReclaimTestEnabled` 預設 ON。
10. `src/components/SettingsView.tsx` + `scripts/server.cjs` + `vite.config.ts`:toggle(預設 ON)+ `/notify-test-deep-reclaim` 合成兩段測試 + backup 投影。
11. 推送 tab 新 view / 篩選 + UI-seam parse + 人手記錄入口。
12. `scripts/backtest15m.ts`(或 extend backtest5m):`--mode deepreclaim` + `--matched` + `--shift-oi` placebo + 同場比較臂。

## Acceptance
- [ ] `detectDeepReclaim` 同 `--mode deepreclaim` harness **逐 bar 對齊**(forced-positive fixture 驗,mirror test-early-live)。
- [ ] 兩段 state machine:正常兩段確認、新低失效、走車、OI 拒絕(OI未確認 no 2nd TG)、OI 缺失=等、到期、重啟兩 stage 對賬、TG threading。
- [ ] 數據層:OiSnapshotV2 forward-warm、舊 `[t,v]` 讀 USD-not-gate、無單位污染、recording v:5 append + `recCoinField` 短 row null。
- [ ] 通知:預設 ON = test-only、OFF = shadow；測試卡標籤正確、per-round Top-1、每日 10 上限、失敗 🟡 唔燒 slot、🟢 唔計 cap、cd map bounded、KILL file 硬停。
- [ ] typecheck + production build + recorder bundle + 歷史 harness + 桌面實際資料驗證。
- [ ] **Gate(升班先做,未做)**:state-matched incremental lift ≥1.30(兩段各自)、±25% & 12/24/36H 全 >1.15、walk-forward 正、bootstrap 下界 >0、**平移 OI placebo 敗**、≥100 確認/40 幣/60 日/3 月、24H/48H 期望值正。**過齊先除「測試」label + 開 badge。**

## 陷阱 / Do-NOT
- **正式升班規則**:`deepReclaimTestEnabled` 只控制用戶已授權嘅 test-only feed；**badge / 模擬盤 / 除「測試」label 全部鎖喺完整 gate 之後**。OFF = shadow(零 send)。
- **唔准繼承 B2 個 ×1.7-2.0**:嗰個係 **1H/detail-tier、n=68、magnitude 噪**(BASELINE-AUDIT:57),而且 B2 = 單一 EMA20-reclaim-on-vol,**冇 L0 確認窗**。已試嘅 15m/scan-tier(`--bd-scan`)below-18 **×0.92 敗 robustness**(:88)。S15 要喺 15m 自己重過。
- **偵測更早冇 free lunch(S14)**:早察階段要示範**對 state-matched baseline 有增量**,唔係揀「已經深跌反彈緊」嘅 geometry。S14 定案:突破前所有 trigger 對 markup geometry 增量 ×0.99-1.04 ≈ 0。深跌收復係**唔同機制**(mean-revert 而非 markup),所以有機會 —— 但要數據講,唔係論述講。
- **6 參考案例 hypothesis-only**:排除 scoring / lift / 推送;provisional ±15min;唔准因為佢亮唔亮加減分。
- **State-matched 係硬性**:unconditional headline lift 一律唔算(×1.61 selection-noise 先例)。
- **合約數量 OI 禁止假 backfill**:可用 Binance `sumOpenInterest` 真實 cold history seed，但唔准由 USD 倒推，亦唔准同 OKX 拼接；缺資料 fail-closed，唔准當 0。
- **純函數紀律**:`deepReclaim.ts` 零 I/O 零 wall-clock;獨立 state file;唔共用 entry-watch.json / kv.json。
- **兩 stage at-most-once**:🟡 同 🟢 各自 durable-before-send + 重啟 drop-ambiguous;唔准自動重發不確定 send。
- **cd/cap 一致**:只 commit on TG-ok;失敗 🟡 唔燒 slot;🟢 唔計 cap;map 要 prune;自己 cdKey。
- **meanRet 薄申報**:同 S9/S13 家族 — lift 係排序/precision,**唔係已證嘅自動進場 edge**;測試卡唔准暗示可交易。數字聲明同 README/analyze.ts 一致(ROADMAP:87)。
- **🟡/🟢 唔入 `signalColors.ts`**:嗰個係型態解讀 palette,唔係 badge registry;🟡/🟢 係 Telegram-thread lifecycle state。
- **免費約束**:合約數量 OI 用免費 `/fapi/v1/openInterest`;唔准引入付費/keyed 數據源。

## Tests
- 完成 K 線/時區對齊、in-progress bar 排除、先高後低回撤、EMA20 首次收復、OI freshness(10min)、USD 價格污染防護。
- 正常兩段確認、新低失效、跳空過度走車、OI 拒絕(OI未確認)、OI 缺失=等、到期、cooldown、每日上限(跨 sweep+micro-scan)、Top 排序。
- 重啟恢復、單例 recorder、原子狀態、TG threading、兩 stage 失敗重試、crash 去重。
- 舊 recording/設定兼容、provisional 樣本排除、推送 tab 狀態/排序/縮圖、backup round-trip。
- typecheck、production build、recorder bundle、歷史 harness、桌面實際資料驗證。

## Results block
2026-07-13 implementation:quantity OI v2、純 detector/state machine、atomic runtime、Top-1/每日10、兩段 threaded test TG、Push UI及 provisional log 已完成。Gate 未通過，正式 badge／模擬盤仍關閉；test-only feed 預設 ON，可在設定 opt-out 轉 shadow。
