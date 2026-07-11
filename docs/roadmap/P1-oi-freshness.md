# P1 — OI 凍結根治(冷路徑 rubik 滯後 + fail-open gate)

**層級**: 第1層 數據護城河 · **工作量**: M · **依賴**: P0, R1(recordings 係回填來源)

## zh-HK TL;DR
2026-07-05 ARX 複盤實證:app 顯示「OI 4h +0.6%」嗰刻,recorder 錄低嘅真 OI 由 929k 升到 1,238k(+33%)。原因係 OI store 要 48h 先算 warm,persistence 7/4 先開始,全市場行緊 rubik 冷路徑,而 rubik 對細幣滯後以**小時**計(okx.ts:257 寫「~one sweep stale」係嚴重低估)。後果:(1)「現貨帶動」靠 `|oi4h|<1.5` gate 開錯(interpret.ts:288),槓桿堆緊都話籌碼乾淨;(2)強度公式最大權重 24 分擺喺 OI 項(analyze.ts:267),冷路徑下成個引擎死火。修法三招:用 recordings 回填 store 即刻 warm、oi4h 用局部 warm 數據(得 4.5h 都夠)、冇可信 OI 時 gate fail-closed(null 唔准當 0)。

## Context (verified facts)
- 每 sweep 有一次 bulk 快照 `fetchBulkOi`(okx.ts:162-169,`/api/v5/public/open-interest?instType=SWAP`,oiUsd,live),經 `appendSnapshot` 入 store(okx.ts:608-609)。呢啲數係新鮮嘅。
- Store warm 條件:span ≥48h 且最後一點 ≤20min 前(oiStore.ts:21-23, getSeries 74-81)。未 warm → scan 冷路徑 rubik 5m(okx.ts:648-666, getOi 398-409);detail 頁**永遠**行 rubik(fetchLiveCoin okx.ts:215)。
- oi4h 由 oi15 series 計(analyze.ts:369-370)。冷路徑 series 滯後 → oi4h ≈ 0 → 凍結。
- 落閘證據(recordings 2026-07-05,%LOCALAPPDATA%\YaobiHunter\recordings\):ARX oiUsd 13:33=929,631 → 17:31=1,238,478(+33.2%),同一時段 app 顯示 +0.6%,detail 頁 OI panel 條線喺 1.1M 打橫。
- **第二獨立案例(ADA,經 multi-agent 驗證)**:老詹【上車準備】嘅「OI 健康增加」leg = 我方 `oiHealthy`(oi4h gate)。ADA recordings 入面 oi4h(idx21)喺**成個 07-04 + 07-05 09:51 之前全部 null**,即係 oiHealthy leg 喺整段可交易窗**根本評唔到**,一個靠 OI 嘅 detection 都開唔到。證明 OI 凍結唔止影響強度顯示,係**靜靜哋令 OI-gated 訊號偵測失效**。(誠實 caveat:呢度講「OI leg 整段評唔到」,唔好引「走漏 +13%」— 嗰個 +13% 係由早 8-9 個鐘嘅事後靚位起錨,由真叫價計 ADA 冇中 TP1;magnitude 唔算數,結構失效先係重點。root cause 疊加咗 recorder 行緊 pre-idx21 舊 build,見 Steps 6。)
- Fail-open 位:`spotLedPump` `|oi4h|<1.5`(interpret.ts:288)、`stealthSpotAccum` `|oi4h|<2`(interpret.ts:303)、`signals.fundsFirst/oiHealthy`(analyze.ts:393-395)— oi4h 唔可信時全部照計,凍結值 0 啱啱好通過「OI-flat」gate。
- 回填管道現成:GET `/recordings?from=&to=`(dev plugin vite.config.ts:82,exe 版 server.cjs,fs 邏輯 recordingsServe.ts:15)。RecCoin idx2 = oiUsd(recording.ts:13-17),同 bulk 快照**同源同單位**,可以安全 splice。
- oiStore 警告(oiStore.ts:8-9):rubik 係另一單位,**永遠唔准**同 oiUsd 混拼 — 回填只可以用 recordings 嘅 oiUsd。

## Design (decided)
1. **開 app 回填 store**:startup 時 fetch `/recordings?from=<今日-2>&to=<今日>`,逐行 parse(skip `type:'sweep-meta'`),每個 ScanRecord 砌 `rows = coins.map(c => ({instId: c[0]+'-USDT-SWAP', oiUsd: c[2]}))`(filter null),`appendSnapshot(rows, rec.ts)`。recorder 24/7 一直有寫 → 回填後大部分幣即刻 warm。斷網/冇 server → 靜默跳過,行為同而家一樣。
2. **局部 warm 嘅 oi4h**:oiStore 加 `getRecentSeries(instId, nowMs, minSpanS = 4.5*3600)` — 唔使 48h,span ≥4.5h 且 fresh 就俾。scan/detail 用佢計 `oi4hLive`,覆蓋 rubik 版 oi4h(panel 長歷史照用 rubik,唔郁)。
3. **Fail-closed**:兩邊都攞唔到可信 OI 時,`oi4h` 轉做 `null` 傳落 interpret/signals,OI-gated 讀數一律 skip(唔准當 0)。呢個係**還原** backtest 行為 — backtest 用真歷史 OI,live 用凍結 0 先係走樣。
4. **UI 誠實標示**:detail OI panel 用緊 rubik 冷路徑時,badge 加「滯後」字樣;oi4h null 時 chip 顯示「—」。
5. 改正 okx.ts:257 嘅註釋(「up to ~one sweep stale」→「可滯後數小時,見 P1/ARX 複盤」)。

## Steps
1. `oiStore.ts`:加 `getRecentSeries`(copy getSeries,WARM_S 換成參數 minSpanS)。加 `backfillFromRecords(lines: string)` — parse JSONL、按 ts 升序 appendSnapshot(persist 用而家嘅 fire-and-forget,唔使改)。
2. `okx.ts` 或 App 初始化:hydrateOi() 後 fetch `/recordings`(同 M2 tab 讀法一致)→ `backfillFromRecords`。console log 回填前後 `storeSize()` 同 warm 覆蓋率。
3. `okx.ts` scan 批次(648-666)同 `fetchLiveCoin`(208-251):砌 Coin 時計 `oi4hLive`(getRecentSeries 有 → 用佢 first/last 對齊 4h 窗;冇 → null)。`analyze()` 保持而家 series 入面計嘅 oi4h 做 fallback 顯示,但 `Derived.oi4h` 以 oi4hLive 優先,null 時傳 null。
4. `types.ts` `Derived.oi4h`/`CoinLite.oi4h` 轉 `number | null`;typecheck 會逼你執晒所有讀處 — `interpret.ts` buildCtx(92)、spotLedPump(288)、stealthSpotAccum(303)、其他用 `c.oi4h` 嘅讀數(365, 389, 415, 427, 440, 452 一帶)全部加 null guard(null → 讀數唔開);`analyze.ts` signals(393-395)同 riskFlags(401)同樣 fail-closed;UI(ScreenerList.tsx:172, CoinDetail.tsx:176, ChartPanels.tsx:483-489)null 顯示「—」。
5. recording idx21(recording.ts:107)寫 oi4hLive(null → 舊值 fallback),等 eval 對齊 live gate。
6. Ops(唔係 code,寫入 summary):用今日 build 重啟 headless recorder — 2026-07-05 佢行緊 pre-S5 舊 build(rows 冇 idx21、冇 spotSignals)而且 09:29 HKT 之後停咗。

## Verification
- `npm run typecheck`。
- Dev run:console 見回填 log,`[scan] OI: N warm` 由個位數跳上 ~300+(355 幣 universe)。
- 揀 3 隻幣(一隻大、兩隻細)人手對數:app oi4h vs 由 recordings 尾兩個 4h 窗自己計嘅 %,誤差 <1pp。
- 開 ARX detail:OI panel 唔再係打橫直線;若果仍然 rubik 冷(冇 recordings 覆蓋)就見到「滯後」badge。
- 迫一個 null 案例(改 minSpanS 做極大值)確認 現貨帶動/fundsFirst 唔開而唔係亂開。

## Acceptance checklist
- [ ] 回填後 warm 覆蓋率 ≥80% universe(recorder 有正常行嘅前提)。
- [ ] oi4h 三幣人手對數通過。
- [ ] OI-gated 讀數喺 oi4h null 時全部靜默 skip。
- [ ] okx.ts:257 註釋改正;recorder 用新 build 重啟並確認 spotSignals 開始出現。

## Results — 2026-07-06(shipped,owner 揀 option c)

**Owner 拍板嘅 spec 偏離**:Design 3/4 原案係 oi4h → `number | null` + UI 顯示「—」。實裝改行 **option (c)**:`Derived.oi4h` 保持 number(store 值優先,laggy series 做 fallback 顯示),另加 `oiTrusted: boolean`;**所有 boolean OI gate fail-closed**,但 UI 照顯示數值兼標「滯後」(muted class + tooltip)。理由:bug 嘅本體係「gate 喺凍結值上誤觸」,唔係「顯示咗個 laggy 數」;冷幣 UI 全「—」係無謂嘅 UX 代價。

**Implemented**
- `oiStore.ts`:`getRecentSeries`(≥4.5h partial-warm + fresh)、`backfillFromRecords`(真 merge — recordings 舊點要插喺 live 點之前,append-only 做唔到;同 t 時 live 蓋 recordings;一次 persist)、`appendOne` 重構。
- `okx.ts`:`oi4hLiveFromStore`(store 首尾對齊 4h 窗)、`backfillOiOnce`(首掃 GET `/recordings` 近 3 日,Node 環境 fetch 相對 URL throw → 靜默跳過)、三個 `analyze` 呼叫點全部傳 `oi4hLive`(detail / micro-scan warm / scan batch)、:257 錯誤註釋已更正。
- `analyze.ts`:`oi4hLive` override + `oiTrusted`;`fundsFirst`/`oiHealthy`/「OI 4h 增速過快」riskFlag 全部 `oiTrusted &&` fail-closed;regime 分類照用 soft 值(scoring 唔係 gate)。
- `interpret.ts`:buildCtx 唔再由 laggy series 自計 oi4h,改用 `coin.oiTrusted === false ? NaN : coin.oi4h` — **NaN sentinel 令全部 13 個 OI-gated 讀數一行 fail-closed**(NaN 任何比較都 false);註釋明禁 negated comparison。
- `recording.ts`:idx21 untrusted 時寫 null(eval 同 live gate 對齊 fail-close)。
- `recorder.ts`:開機由 recordings 目錄 fs 直讀 backfill(重啟唔使再等 48h 暖機)。
- UI:CoinDetail Stat「OI 4h·滯後」+ muted、ChartPanels OI badge「·滯後」+ tooltip、ScreenerList cell muted + tooltip。

**Verified**
- typecheck 過(×3 個階段)。
- 真 recordings 回放:ARX @ 07-05 17:31(app 當時凍結顯示 +0.6%)→ `oi4hLive` = **+31.3%**;16:50 → +26.0%;ADA 02:00 → +11.1%;未知幣 → null(fail-closed)。
- 13-check 離線 harness 全 PASS:v3 row 24 欄、idx21 null-when-untrusted / 保值-when-trusted、idx22/23 正確、JSON 無 NaN 洩漏、analyze fail-closed、NaN 全方向 gate 語義。
- 無 reader 用 `v === 2` gating(grep 過 src+scripts)→ v3 bump 安全。
- Recorder 已用新 build 重啟(2026-07-06 05:55 HKT)。**Live 實測**:開機 `[oi] backfilled 217 recorded sweeps`(兩日檔),首個 sweep **353/353 幣 idx21 non-null** — oi4h 信任覆蓋 100%,遠超 acceptance 嘅 ≥80%。人手對數:ARX idx21 = **-10.11** vs 由 raw oiUsd 手計(1,039,984 / 1,156,964)= **-10.11%**,完全一致。
- 注:`[scan] OI: 0 warm (store), 358 cold` — **series-warm**(48h span,決定 sweep 速度)同 **oi4h-trusted**(4.5h,決定 gate)係兩回事;backfill 數據起點 07-04 08:28,到本 sweep span ~45.5h,差 ~2.5h 就會 series-warm、sweep 自動由 ~4.5min 縮到 ~1.5min。oi4h 就已經即時 100% 可信。
- **未做**:browser 端 backfill log + UI 滯後 tag render 實測 — 下次開 app 先驗到(特登冇喺呢部機起第三個 scanner:owner 啱啱先揀咗單一 scanner 方案)。

## 陷阱 / Do-NOT
- **唔准**用 rubik 數據回填 store(單位唔同,oiStore.ts:8-9 已警告)。回填來源只有 recordings 嘅 oiUsd。
- 回填要按 ts 升序 append(appendSnapshot 假設 append-only,oiStore.ts:55 只 dedup 最尾一點)。
- v1 rows(length 10)冇 idx2 以外問題,但要經 `recCoinField` 讀(recording.ts:115-117)。
- 唔好順手改強度公式 — OI 項點重新校準係 E5 嘅事,P1 只負責俾佢食真數據。
- Detail 頁 OI panel 嘅 48h 長歷史照用 rubik(店冇咁長歷史時),但**指標計算**唔准再食 rubik 尾巴。
