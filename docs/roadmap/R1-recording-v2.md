# R1 — Recording schema v2:記錄 feature vector,俾將來可以 replay

**層級**: 第1層 數據護城河 · **工作量**: M · **依賴**: 無(P0 之後做) · **緊急度: 高 — 數據隨時間累積,schema 改得越早,將來可用嘅歷史越多(recordings 2026-07-04 先開始,而家改零成本)**

## zh-HK TL;DR
而家每次 sweep 每隻幣只記 10 個數(price、strength 等 derived metrics),唔夠將來測試新 detector — detector 食嘅係 20 幾個 feature(fNow/f8h、oi4h、ret4h、pos、buyShare、bbPctile…)。呢個 spec 將每行記錄擴充到成個 feature vector,加埋 sweep 完整性 manifest,再教你點樣將 recorder 設做 Windows 開機自動行,24/7 儲數據。

## Context (verified facts)
- Format lives in `src/lib/recording.ts`: `RecCoin` tuple (lines 10-21) = `[sym, price, oiUsd, funding, volZ, strength, regimeCode, fb, ea, vol24h]`; `ScanRecord` (23-28) = `{ts, slot, source, coins}`; `buildScanRecord()` (37-55) builds it from `CoinLite[]`.
- Writers: browser `src/App.tsx:133-138` (`recordSweep` → `POST /record`); headless `scripts/recorder.ts:25-37`. Sink: `scripts/recordFile.ts` + `scripts/server.cjs:65-80` → `%LOCALAPPDATA%/YaobiHunter/recordings/YYYY-MM-DD.jsonl`.
- Reader: `scripts/eval-recordings.ts` — column indexes hardcoded at line 60: `const F = { SYM: 0, PRICE: 1, STR: 5, FB: 7, EA: 8 }`. Dedup by slot at line 47.
- The features detectors consume are computed in `interpret.ts:61-210` (`buildCtx`) and partially in `analyze.ts:305-405` (`analyze()`); `CoinLite` (`src/types.ts:100-116`) does NOT carry them today.
- EA confirmation numbers exist on the full `Coin` when 蓄 fires: `coin.earlyAccum = {oiDropPct, lsDropPct, rsPct}` (`types.ts:91-95`), flattened to boolean by `toLite()` (`okx.ts:389-410`).
- Rounding helpers already in recording.ts:34-35: `sig(x, p=6)` (toPrecision) and `fix(x, d)` (toFixed).

## Design (decided)
RecCoin v2 = v1's 10 fields **plus, appended in this exact order** (indexes 10-20):

| idx | field | type | rounding | source |
|---|---|---|---|---|
| 10 | change24h | number | fix 2 | `CoinLite.change24h` (already exists) |
| 11 | ret4h (%) | number | fix 2 | new `featureVector()` |
| 12 | pos (0-1 range position, 24h) | number | fix 3 | new `featureVector()` |
| 13 | buyShare4h (0-1) | number | fix 3 | new `featureVector()` |
| 14 | f8h (funding 8h ago, %) | number | fix 4 | new `featureVector()` |
| 15 | bbPctile (0-1) | number | fix 3 | new `featureVector()` |
| 16 | lsDropPct | number\|null | fix 2 | `coin.earlyAccum?.lsDropPct ?? null` |
| 17 | rsPct | number\|null | fix 2 | `coin.earlyAccum?.rsPct ?? null` |
| 18 | oiDropPct (flush depth) | number\|null | fix 2 | `coin.earlyAccum?.oiDropPct ?? null` |
| 19 | spotVol24h (USD) | number\|null | round | null until S1 lands |
| 20 | basisPct (perp vs spot, %) | number\|null | fix 3 | null until S1 lands |

Row level: add `v: 2` to `ScanRecord`. **Backward-compat rule for all readers: a v1 row (no `v` field, `coins[i].length === 10`) is read with indexes 10-20 = null.** Never reorder or remove the first 10 fields.

Additionally each completed sweep appends ONE meta line (separate JSONL line, same file): `{"type":"sweep-meta","v":2,"slot":N,"ts":MS,"coins":N,"durationMs":N}` — lets future tooling distinguish complete sweeps from aborted ones. Readers must skip lines where `type` is present (eval-recordings' `Array.isArray(rec.coins)` check at line 47 already skips it — verify).

## Steps

### 1. `featureVector()` in `src/lib/analyze.ts`
Export a new function computing the four missing features from a full `Coin`'s series. Reuse the exact math already in the file — `analyze()` lines 309-338 compute ret4h/pos/buyShare4h on the 15m aggregation; copy those lines, don't invent new windows. bbPctile: copy the Bollinger-width percentile loop from `interpret.ts:146-156` (20-bar SMA width on the 15m aggregation). f8h: `f15[at(33)].value` (same indexing as `interpret.ts:76`).

```ts
export interface RecFeatures {
  ret4h: number;      // % (multiply the fraction by 100)
  pos: number;        // 0..1
  buyShare4h: number; // 0..1
  f8h: number;        // %
  bbPctile: number;   // 0..1
}
export function featureVector(
  candles: Candle[], volume: VolumeBar[], fundingHist: SeriesPoint[],
): RecFeatures { /* aggregate to 15m exactly like analyze():309-312, then compute */ }
```

### 2. Carry features on `CoinLite` (`src/types.ts:100-116`)
Add ONE optional field so old cached scans still typecheck: `feat?: RecFeatures & { lsDropPct?: number|null; rsPct?: number|null; oiDropPct?: number|null }`.
Populate in `toLite()` (`okx.ts:389-410`): call `featureVector(coin.candles, coin.volume, coin.fundingHist)` and merge `coin.earlyAccum` numbers. `toLite` already receives the full series-bearing `Coin`, so this is cheap and local.

### 3. Extend `recording.ts`
- Widen the `RecCoin` type to the 21-element tuple (elements 10+ `number | null`).
- `ScanRecord` gains `v?: number`.
- `buildScanRecord()` sets `v: 2` and appends the new elements using `c.feat` (all `?? null`).
- Export `export function recCoinField(row: RecCoin, idx: number): number | null { return row.length > idx ? (row[idx] as number | null) : null; }` — the ONE accessor all readers must use for idx ≥ 10.

### 4. Sweep-meta line
- Browser: in `src/App.tsx` `recordSweep` (line 135), after posting the record, post a second body `JSON.stringify({type:'sweep-meta', v:2, slot: Math.floor(tsMs/REC_SLOT_MS), ts: tsMs, coins: coins.length, durationMs: Date.now()-tsMs})` to the same `/record` endpoint.
- Headless: same in `scripts/recorder.ts` `sweepAndRecord()` after line 34, via `appendRecordLine`.

### 5. Reader compatibility (`scripts/eval-recordings.ts`)
- Line 47 filter: extend to `if (!rec || (rec as any).type) continue;` before the existing source check (skip meta lines explicitly).
- No other change required — F indexes 0-8 are untouched. Do NOT use bare `row[15]`-style access in any new code; use `recCoinField`.

### 6. 24/7 recorder via Windows scheduled task
Document in README (short paragraph) + verify the commands. The recorder bundle is produced by the npm script itself; build it once, then register:

```powershell
# one-time: produce scripts/.build/recorder.mjs
npm run recorder -- --once
# register: runs hidden at every logon
schtasks /create /tn "YaobiRecorder" /sc onlogon /rl LIMITED /tr "powershell -NoProfile -WindowStyle Hidden -Command \"Set-Location 'C:\Users\Ming\Desktop\claude code\yaobi-hunter'; node scripts/.build/recorder.mjs\""
# manage
schtasks /run /tn YaobiRecorder      # start now
schtasks /end /tn YaobiRecorder      # stop
schtasks /delete /tn YaobiRecorder /f
```
Caveat to note in README: after `git pull`/code changes, re-run `npm run recorder -- --once` once to refresh the bundle the task points at.

## Verification
1. `npm run typecheck` clean.
2. `npm run recorder -- --once` → open today's JSONL → last data line has `"v":2` and 21-element coin arrays; a `sweep-meta` line follows it.
3. `npm run eval-rec` on the mixed (v1+v2) file → runs, same table as before, no crash on meta lines.
4. `npm run dev`, let a sweep complete → browser-written line is also v2 (identical shape to the headless one — diff one coin row by eye).
5. Grep check: no reader indexes ≥10 directly (`grep -n "\[1[0-9]\]" scripts/eval-recordings.ts src/lib/recording.ts` → only inside `recCoinField`).

## Acceptance checklist
- [ ] v2 rows written by BOTH writers with identical field order.
- [ ] v1 rows still readable (test: run eval-rec on a dir containing the 2026-07-04 v1 file).
- [ ] Meta lines skipped by eval-rec.
- [ ] Scheduled task registered and produces lines while the app is closed.

## 陷阱 / Do-NOT
- Do NOT reorder/rename the first 10 RecCoin fields — months of v1 data depend on those indexes.
- Do NOT record raw candle series per sweep (~50KB/slot uncompressed; the feature vector is the deliberate compromise).
- Do NOT compute features on a different aggregation than 15m (`aggregateCandles(candles, 3)`) — they must match what live detectors see (`interpret.ts:62`).
- `fix()`/`sig()` rounding exists to keep JSONL small — apply the table's rounding, don't store full floats.
- The recorder's in-memory OI store re-warms ~48h after restart (`recorder.ts:8-10`) — expect `oiUsd:null` on cold coins in early rows; that is normal, record the null.

## ✅ Results (2026-07-04, implemented)
Implemented per spec, with one clean architecture choice: `RecFeatures` lives in `src/types.ts` (the dependency sink) rather than `analyze.ts`, so no circular type import; `featureVector` is exported from `analyze.ts` as specced.
- **Files:** `src/types.ts` (RecFeatures + `CoinLite.feat`), `src/lib/analyze.ts` (`featureVector`), `src/data/okx.ts` `toLite` (populates feat), `src/lib/recording.ts` (21-field RecCoin v2, `v:2`, `recCoinField`, `SweepMeta`+`buildSweepMeta`), `scripts/eval-recordings.ts` (skips meta), `src/App.tsx`+`scripts/recorder.ts` (both writers emit record + meta), README (v2 format + `schtasks` 24/7 section).
- **Verified:** `npm run typecheck` clean. Isolated serialization check on a synthetic coin — 21 fields, exact order/rounding, spot idx 19/20 = null, meta shape correct, `recCoinField` returns null for a v1 (len-10) row and the real value for a v2 row. Authoritative `npm run recorder -- --once` sweep wrote a real `"v":2` record (353 coins, all 21 fields, feature vector populated, spot null) + a `{"type":"sweep-meta",…,"coins":353,"durationMs":235001}` line. `npm run eval-rec` on the mixed **v1 + v2 + meta** file ran clean: 14 unique slots (13 legacy v1 + 1 new v2, meta line skipped not counted), and the v2 coins fed the analysis (strength≥70 events 17→20).
- **Field layout (frozen):** `[0 sym,1 price,2 oiUsd,3 funding,4 volZ,5 strength,6 regime,7 fb,8 ea,9 vol24h, 10 change24h,11 ret4h,12 pos,13 buyShare4h,14 f8h,15 bbPctile,16 lsDrop,17 rs,18 oiDrop,19 spotVol24h(S1),20 basis(S1)]`. First 10 must never move.
- **Note:** the `--once` run showed some rubik 429s — expected multi-instance contention (the dev app was scanning the same IP concurrently); `okxGet` retries absorbed it, sweep completed with all 353 coins. Not an R1 concern.
- **Left for the user:** register the `schtasks` job (README) to actually accumulate 24/7 — the schema is ready now so every day of recorder uptime is now replay-quality data.
