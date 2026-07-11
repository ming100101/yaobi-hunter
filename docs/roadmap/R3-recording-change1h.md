# R3 — Recording schema v3(補 change1h + f24h)

**層級**: 第1層 數據護城河 · **工作量**: S · **依賴**: R1

## zh-HK TL;DR
2026-07-05 老詹【上車準備】複盤揭發一個回測盲點:佢個訊號嘅定義 leg「1h 溫和抬升」= 我方 `mildRise`,而 `mildRise` 食 `change1h`,但 **`change1h` 根本唔喺 recording schema**(schema 得 change24h idx10、ret4h idx11,冇任何 1h 窗價格變化欄)。同樣,funding 一族 detector(費率轉負以外)要 `f24h`,亦冇錄。後果:任何靠呢兩個輸入嘅組合(上車準備 composite、fuller funding reads)**回測都回測唔到**,即係永遠過唔到 IRON RULE 個 gate、永遠 ship 唔到。呢個 task 淨係做一件事:append `change1h` 同 `f24h` 做 v3 新 index,令未來可以真回測。**唔動 idx 0-21。**

## Context (verified facts)
- Schema 紀律(recording.ts:9-12):v1 = 頭 10 欄,v2 append idx10-21,**永遠唔准 reorder/移除頭嗰批**,幾個月 data 用 position 做 key。v3 只可以繼續 append。
- 現有欄位(recording.ts:13-17):idx10 change24h%、idx11 ret4h%、idx14 f8h% — **冇 change1h、冇 f24h**。
- `change1h` live 有計(analyze.ts:367 `(last / c15[at(5)].close - 1) * 100`),`mildRise` 食佢(analyze.ts:394)。`f24h` live 喺 interpret buildCtx 有 — **interpret.ts:89 `const f24h = f15[at(97)].value`**;用家係 funding-overheat(interpret.ts:365)同 extreme-negative-funding(interpret.ts:401)。純粹係「錄」嘅一步冇做。
- 讀法:v3 row 長度 **24**(idx 0-23),舊 row 短,一律經 `recCoinField`(recording.ts:115-117)讀,短 row 讀返 null。
- buildScanRecord(recording.ts:76-111)係唯一 writer;CoinLite/Coin 要帶 change1h、f24h 落嚟(analyze.ts Derived 已有 change1h;f24h 要由 interpret ctx 或 fundingHist 拎)。

## Design (decided)
- append 兩個 v3 index:**idx22 = change1h%**(`fix(c.change1h, 2)`)、**idx23 = f24h%**(`fixN(f24h, 4)`,null-safe,細幣可能冇 24h funding 歷史)。
- bump `v: 3` 於 buildScanRecord + buildSweepMeta。reader(eval-recordings.ts、ref-eval、backtest replay)一律 `recCoinField(row, 22/23)`,唔准直接 `row[22]`。
- 更新 recording.ts:13-17 個 index map 註釋,加 22/23 兩行。
- headless recorder(recorder.ts)同 App 兩個 writer 都會經 buildScanRecord,所以改一處就兩邊齊 — 但 **recorder 要用新 build 重啟**(佢而家仲行緊 pre-idx21 舊 build,見 P1 Steps 6,連 idx21 都冇錄)。

## Steps
1. `types.ts`:確認 `CoinLite` 帶 `change1h`(Derived 已有);加 `f24h?: number | null`(由 analyze/interpret 傳出)。
2. `analyze.ts`:Derived 已有 change1h;喺 analyze() 尾計埋 f24h(`f15[at(97)].value`,**同 interpret.ts:89 完全同窗**,唔准另揀窗)放入 Derived。
3. `recording.ts`:RecCoin type 加兩個 slot;buildScanRecord map 加 idx22/23;`v:3`;更新 index-map 註釋。
4. `eval-recordings.ts` / `backtest.ts` replay:凡讀 change1h/f24h 用 recCoinField;舊 data(短 row)fallback 行為要明確(null → 該 read 唔評,唔准當 0)。
5. Ops:用新 build 重啟 headless recorder(同 P1 Steps 6 同一個動作),確認新 sweep row 有 24 欄。

## Verification
- `npm run typecheck`。
- 錄一條真 sweep,人手 check 某幣 row.length === 24,idx22 ≈ 該幣 live change1h、idx23 ≈ live f24h。
- 舊 2026-07-0x recordings 經 reader 讀 idx22/23 一律 null、唔 throw。

## Acceptance checklist
- [ ] idx22 change1h、idx23 f24h append,idx0-21 一字不動,`v:3`。
- [ ] 所有 reader 經 recCoinField 讀新欄,短 row → null(唔當 0)。
- [ ] recorder 用新 build 重啟,新 row 24 欄。
- [ ] 註釋 index map 更新。

## 陷阱 / Do-NOT
- **絕對唔准 reorder 或塞中間** — 只可以 append。塞錯位置 = 幾個月 data 全廢。
- change1h ≠ ret4h:一個係 1h 窗、一個係 4h 窗,唔可以攞 idx11 當 change1h 用(就係呢個混淆令上車準備 composite 一直回測唔到)。
- f24h null-safe:細幣冇夠 funding 歷史,寫 null,唔好寫 0(0 會扭曲 funding detector 判斷)。
- 呢個 task **唔改任何 detector 邏輯**,唔郁強度公式,淨係加錄兩個欄。上車準備 composite 起唔起、E5 點校準,係 R3 有咗 data 之後、各自 spec 過 gate 嘅事。

## Results — 2026-07-06(shipped,同 P1 同一 session)

- `analyze.ts` 加 `f24h = f15[at(97)].value`(同 interpret.ts:89 同式同窗)入 Derived;change1h 本已有。
- `types.ts`:`Coin.f24h?`/`CoinLite.f24h?`(optional,demo/舊 cache 兼容);toLite pass-through。
- `recording.ts`:RecCoin append idx22 `fix(change1h,2)`、idx23 `fixN(f24h,4)`;`v:3`(buildScanRecord + buildSweepMeta 都 bump);idx21 同時改為 untrusted→null(P1);index-map 註釋更新。
- 離線 harness:row 長度 24、idx22=1.23、idx23=-0.0172 原值保留、JSON 無 NaN — 全 PASS。grep 證實無 reader 用 `v===2` 判版本。
- Recorder 新 build 重啟,**live sweep 驗證過**(2026-07-06 05:56 HKT):`v=3`、353 幣全部 row 24 欄、ARX idx21=-10.11(同 raw oiUsd 手計完全一致)/ idx22=-0.72 / idx23=0.005。
- **數據 provenance 注腳(eval 用家必讀)**:idx21 語義有一段過渡 — 2026-07-05 19:51 至 07-06 05:40 HKT 之間嘅 sweep 係 pre-P1 build 寫嘅,idx21 = **laggy series 值**(凍結風險);07-06 05:56 起 = store-derived 或 null(fail-closed)。用 idx21 做 OI gate 嘅 eval 要 skip 或標記呢段過渡窗。
- 註:spec Steps 4 講嘅「eval-recordings/backtest reader 用 recCoinField 讀 22/23」— 而家未有 consumer,第一個用家(上車準備 backtest / E5)接手時照規矩讀。

## 為咗邊個下游
- **E4 / 上車準備 backtest**:有咗 change1h 先可以精確 replay `mildRise`,唔使用 ret4h 硬代(代咗就唔係同一個 gate)。
- **E5**:setup 成份要乾淨歷史輸入。
- **interpret funding 一族**:f24h 補齊先可以離線 eval funding-overheat/disbelief-rally/extreme-negative(而家淨得 funding-flip-negative replay 到,因為佢只食 fNow+f8h)。
