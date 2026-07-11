# M3 — 策略對照:「策略」tab 每日全跟 ⚡/強度>70 正反手 P&L + CLI 歷史 P&L

**層級**: 第3層 錢的語言 · **工作量**: M · **依賴**: R1(recordings)。同 M2 共用 `/recordings` endpoint 同 `evalCore` — 邊份先做,另一份 reuse(兩份 spec 都有註明)。

## zh-HK TL;DR
兩 part。**(A)新「策略」tab**:每日一行,答「尋日如果全跟 ⚡ 縮倉突破 / 全跟 強度>70 crossing,每注等權,00:00 埋單,做多同做空各賺蝕幾多?」全部由已有 recordings 計 — 零新 API、零 cron:過咗午夜尋日嗰行自然定格,tab 開嗰陣重計就係「00:00 更新」。**(B)CLI `npm run backtest -- --pnl`**:用 ~37 日 OKX 1H 歷史即刻回測「全跟 ⚡(近似)」正反手收益,唔使等新數據。**強度>70 冇得誠實歷史重構**(strength 係 live composite,由 5m 序列+OI+funding 計,免費 API 冇歷史 5m/OI)— 只可以由 recordings 向前累積,呢個 tab 就係佢嘅累積器。

## Context (verified facts)
- Recording row 係 tuple:`F = { SYM: 0, PRICE: 1, STR: 5, FB: 7, EA: 8 }`(`scripts/eval-recordings.ts:61`,對應 `recording.ts:78-96` 嘅欄位次序)。15-min slots。
- 要 reuse 唔准重寫嘅邏輯(全部喺 `scripts/eval-recordings.ts`):slot dedup + 載入(39-58)、per-sym price/row index + top10(60-80)、**rising-edge 語義 = 上一個 recorded slot 該 sym 為 off / 未見**(148-164)。呢個 CLI 用緊 `fs` — M3 要抽 browser-safe 部分出嚟(M2 spec §Step 2 本來就計劃咗;M3 抽自己需要嘅 subset,M2 之後再移 forward/summarize)。
- `/recordings` endpoint 設計已喺 M2 spec §Design 決定:`GET /recordings?from=YYYY-MM-DD&to=YYYY-MM-DD` → 原始 JSONL concat(`application/x-ndjson`),range >92 日 → 413;fs 邏輯放 `scripts/recordingsServe.ts`,vite plugin + `server.cjs` inline CJS 雙實現(P0/R2 precedent)。**照嗰個設計做,唔好自創。**
- Tabs:`AppTab = 'scan' | 'search' | 'settings'`(`src/components/NavTabs.tsx:1`);App.tsx 路由喺 351-357,`SettingsView` 係 full-page tab 嘅 pattern(`App.tsx:351-352`,自帶 topbar + NavTabs)。
- CLI backtest(`scripts/backtest.ts`):`mode=breakout` 係 live ⚡ 嘅認可 1H 近似(README ×2.04 就係呢個 harness 出嘅);`outcomeAt` 已經計 close-to-close `retH`(393-405),signal 收集喺 452-470。**--pnl 只加 summarise/print,唔准掂 signal 邏輯。**
- 數據來源已在:recorder 24/7(R1)+ app 開住都會 record(`App.tsx:137,167`),寫入同一個 recordings dir。

## Design (decided)

### 策略定義(2 策略 × 正反手,implement verbatim)
- **入場**:state 喺該 sym 嘅 rising edge(語義同 eval-recordings 148-164 一致)。策略 fb:`row[F.FB] === 1`;策略 s70:`(row[F.STR] as number) >= 70`。
- **入場價** = edge slot 嘅 recorded price。**出場** = 該幣喺同一「本地日」(`new Date(ts)` + `setHours(0,0,0,0)` 界定 00:00–24:00)內、edge slot 之後最後一個有價 slot 嘅價。搵唔到出場(edge 係該幣當日最後一個 slot)→ 剔除該筆,計入 `skipped`。
- 多頭 `retLong = exit/entry − 1`;空頭 = `−retLong`(鏡像;無費用/funding 模型下 exact,UI 要照顯示因為勝率/分佈閱讀方向唔同)。等權每注 1 單位。
- **日 aggregate**(每策略每方向):n、勝率、合計(= 等權日收益)、平均。今日 = 進行中(以最新 slot 埋單,標「進行中」)。
- **00:00 更新機制**:冇 cron。過去日子係 recordings 嘅 pure derivation — tab mount 時 fetch+計一次,另加 60s `setInterval` 檢查本地日期轉變,轉咗就重計。效果等同「每日 00:00 更新」。

### 型別(`src/lib/strategyReport.ts`)
```ts
export interface StratTrade { sym: string; entryTs: number; entry: number; exitTs: number; exit: number; retLong: number }
export interface StratDay {
  dayStartMs: number;
  final: boolean; // false = 今日進行中
  fb: { trades: StratTrade[]; skipped: number };
  s70: { trades: StratTrade[]; skipped: number };
}
export function buildDailyReport(idx: RecIndex, days: number, nowMs: number): StratDay[]
```

## Steps

### 1. `src/lib/evalCore.ts` — browser-safe 抽取(partial)
從 eval-recordings.ts **搬**(唔係 copy)以下內容,CLI 改為 import:
```ts
import type { RecCoin, ScanRecord } from './recording';

export const SLOT_MS = 15 * 60 * 1000;
export const F = { SYM: 0, PRICE: 1, STR: 5, FB: 7, EA: 8 } as const;

export interface RecIndex {
  slots: number[]; // ascending unique
  bySlot: Map<number, ScanRecord>;
  priceAt: Map<string, Map<number, number>>;
  rowAt: Map<string, Map<number, RecCoin>>;
  top10At: Map<number, Set<string>>;
}
export function parseRecordings(text: string): RecIndex   // port 39-58(每行 try/catch、skip type meta、source==='okx' 先要、last-write-wins)+ 60-80 index
export interface EdgeEvent { sym: string; slot: number; ts: number; price: number; row: RecCoin }
export function risingEdges(idx: RecIndex, on: (row: RecCoin, slot: number, sym: string) => boolean): EdgeEvent[]  // port 148-164;ts = slot * SLOT_MS
```
fs/path/readdir 留返喺 CLI(CLI 讀檔 → concat text → `parseRecordings`)。改完行 `npm run eval-rec`,同改之前 capture 嘅輸出 **byte-identical**(執行守則 #3)。

### 2. `/recordings` endpoint
照 M2 spec §Design + §Step 1 逐字做:`scripts/recordingsServe.ts`(list dir、按 filename 日期 range filter、concat)→ vite plugin `recordingsEndpoint()` + server.cjs inline CJS mirror(route 喺 server.cjs:122 附近,跟 /record `/kv` precedent)。**如果 M2 已 land 咗呢部分 → skip,唔好重建。**

### 3. `src/lib/strategyReport.ts` — pure logic
`buildDailyReport`:對每個策略行 `risingEdges`;每個 event 歸入 `dayStart = new Date(ts).setHours(0,0,0,0)`;出場 = 由該日最尾向前搵第一個 `slot > event.slot` 且該 sym 有價嘅 slot;砌 `StratTrade`/`StratDay[]`(新→舊,只保留 `days` 日)。無 I/O、無 React。

### 4. Unit test `scripts/test-strategy.ts`(跟 `scripts/test-*.ts` pattern,加 npm script `test-strategy`)
Fixture 用 `new Date(2026, 6, 1, hh, mm).getTime()` 砌 ts(本地時區無關),tuple rows 只需 idx 0-8 正確、其餘補 0,砌 NDJSON text 行 `parseRecordings`(順便 test parse):
- AAA:10:00 price 1.00 FB=0 → 10:15 price 1.00 **FB=1(edge)** → 23:45 price 1.05。斷言 fb trade:entry 1.00、exit 1.05、retLong **+0.05**。
- BBB:10:00 STR 65 price 2.00 → 10:15 **STR 72(edge)** price 2.00 → 23:45 price 1.90。斷言 s70 trade retLong **−0.05**(即空頭 +5%)。
- CCC:淨係 23:45 一個 slot FB=1 price 3.00 → 無出場,斷言 fb `skipped === 1`。
- 斷言日 aggregate:fb n=1 勝率 1.0 合計 +0.05;s70 n=1 勝率 0 合計 −0.05。

### 5. `src/components/StrategyView.tsx` + 路由
- `NavTabs.tsx`:`AppTab` 加 `'strategy'`,新 button 「策略」(照現有 button 結構);`App.tsx` 加 `if (tab === 'strategy') return <StrategyView tab={tab} onTab={switchTab} />;`(照 SettingsView pattern)。
- View:mount 時 `GET /recordings?from={today−14}&to={today}` → `parseRecordings` → `buildDailyReport(idx, 14, Date.now())`,`useMemo` 一次;>2s 顯示 `.spinner`(theme.css:546)。
- 佈局(zh-TW,reuse `.card`/`.scr-head`/`.scr-row` grid patterns + `.chip`):
  1. 頂部 4 張 summary cards:**尋日** ⚡多 / ⚡空 / >70多 / >70空(n=0 → 「—」)。
  2. 主表近 14 日(新→舊,今日標「進行中」):`日期 | ⚡n | ⚡多 | ⚡空 | >70 n | >70多 | >70空`;行 click expand 該日 trade 明細(時間、幣、入場、出場、多%;空 = 負號鏡像唔使重覆列)。skipped>0 喺明細尾註「跳過 N(無出場價)」。
  3. Footer:近14日合計 per 策略/方向;方法說明一行:「等權每注、無費用滑點資金費率、以15分鐘記錄價於00:00結算、⚡ 稀少屬正常、非投資建議」;累計 events <20 嘅策略加「樣本不足」chip(抄 eval-recordings.ts:195 嘅誠實文化)。
  4. 空狀態(冇 recordings / fetch 404):「未有記錄數據 — 行 npm run recorder(見 README)」。

### 6. CLI `--pnl`(`scripts/backtest.ts`)
- `Args` 加 `pnl: boolean`(default false),parseArgs 加 `--pnl`。
- 喺 `const sig = summarize(signals)` 之後(472 附近),`args.pnl` 時由 `signals` 嘅 `retH` 計:
```ts
const rets = signals.map((o) => o.retH);
const sum = rets.reduce((a, b) => a + b, 0);
const winL = rets.filter((r) => r > 0).length;
// LONG:  n, winL/n, mean, median, sum
// SHORT: n, (n-winL-ties)/n… 用 rets.filter(r => r < 0).length, mean = −mean, median = −median, sum = −sum
```
- Human output 加一個 block(`=== 全跟 P&L(等權,close@horizon 出場)===` LONG/SHORT 兩行 + baseline meanRet 對照);`--json` 時加 `result.pnl`。
- Block 尾必印 caveat:「short 為價格鏡像(未計 funding/費用);⚡ 為 1H 近似重構(mode=breakout),非 live detector 本身」。
- 用法(README 加一行):`npm run backtest -- --mode breakout --pnl` = 全跟 ⚡ 近似 ~37日 歷史 P&L;`--horizon 4` 換持倉時長。

## Verification
1. `npm run typecheck`;`npm run eval-rec` 輸出同抽取前 byte-identical;`npm run test-strategy` 過晒斷言。
2. Dev run → 策略 tab:今日行有數(recordings 由 2026-07-04 起);>70 一般日日有幾單、⚡ 好多日 0(顯示「—」)屬正常;expand 一日,揀一筆 trade 用 recordings 原始行手動對數(entry/exit price 同 ret)。
3. `curl "/recordings?from=...&to=..."` → NDJSON;>92 日 range → 413。
4. `npm run backtest -- --mode breakout --pnl` → P&L block;LONG mean 必須等於原表 `mean ret@24h`(同一個數,新 framing — 唔等 = 計錯);`--json` 有 `pnl`。
5. 留過午夜(或較機器時鐘)驗證日界:昨日行定格、新「今日(進行中)」行出現。

## Acceptance
- [x] 策略 tab:近14日 ⚡/>70 正反手日結 + 今日進行中 + 午夜自動翻日(60s interval)。(翻日 logic 就位;live 過午夜未行到 — 見 Results)
- [x] 方法/免責喺 UI 講明;n<20 樣本不足 chip;空狀態友好。
- [x] evalCore 單一實現(CLI 同 tab 共用),eval-rec 輸出不變;test-strategy 過 worked example。
- [x] `--pnl` 出 LONG/SHORT 歷史 P&L,冇掂 signal 邏輯,caveat 照印。

## 陷阱 / Do-NOT
- **Do NOT 嘗試歷史重構 strength>70**(CLI 或任何形式)— strength 係 live composite(5m 序列+OI+funding),免費 API 冇歷史 5m OI;砌個近似出嚟叫「strength>70 回測」= 違反誠實統計傳統(README:53-57 先例)。歷史部分只做 ⚡ 近似;>70 由 recordings 向前累積。
- Do NOT 喺 UI fork parse/rising-edge 邏輯 — 一律經 evalCore(M2 同款陷阱:兩份實現 = 兩個真相)。
- Do NOT 喺 browser code 用 fs — 一律經 `/recordings`。
- 反手數字係多頭鏡像,唔好當獨立發現寫落 README;想測真變種(例:pump 後 24h 先反手)→ 另開 spec 或 M2 ReplayPanel。
- Recordings 有 gap(recorder 冇行)→ 該日 n 少/skipped 多屬正常,**唔准 interpolate**。
- Do NOT 改 recording schema 或 recorder — 呢個 feature 100% 純讀。
- Do NOT 加費用/滑點/funding 模型「令佢真啲」— M1 模擬盤先係做嗰樣嘢嘅地方;呢度係透明嘅等權鏡子,兩者定位唔同。

## Results — ✅ 2026-07-04
Both parts shipped. Verified:
- **evalCore extraction** (`src/lib/evalCore.ts`: `parseRecordings`/`risingEdges`/`F`/`SLOT_MS`/`RecIndex`) — `eval-recordings.ts` slimmed to import it; `npm run eval-rec` output **byte-identical** (diff'd before/after on the live dir). `npm run typecheck` clean.
- **`/recordings` endpoint** (`scripts/recordingsServe.ts` + vite plugin + server.cjs CJS mirror + route) — live dev-run: valid 14d range → **200 `application/x-ndjson`** (65 lines), >92d range → **413**, bad param → **400**. (vite path runtime-verified; the server.cjs mirror is the same logic inline, syntax-checked — only runs in the packaged exe.)
- **`strategyReport.ts`** pure logic + **`npm run test-strategy`** = **13/13 PASS** on the AAA/BBB/CCC fixture (fb win +0.05, s70 long −0.05 / short +0.05, CCC skipped, day aggregates).
- **策略 tab** (`StrategyView.tsx` + NavTabs `'strategy'` + App route) — live dev-run on real recordings: 4 summary cards (尋日 all「—」, no yesterday data yet), today's row **07-04 進行中** ⚡ n=7 (多 −13.12% / 空 +13.12%), >70 n=47 (多 +38.11% / 空 −38.11%); row expands to 54 trade rows (time→time, sym, entry, exit, 多%); footer 14d totals with **樣本不足** chip on ⚡ (n=7<20) not >70 (n=47); method/免責 line present; empty/loading/error states wired.
- **`--pnl`** (`backtest.ts`) — `npm run backtest -- --mode breakout --pnl`: prints LONG/SHORT P&L block + baseline + caveat; **LONG mean === signal `meanRetH` exactly** (bit-for-bit, the Verification-4 invariant); SHORT is the exact price mirror; `--json` carries `result.pnl`. Signal logic untouched.

Files: `src/lib/evalCore.ts`, `src/lib/strategyReport.ts`, `src/components/StrategyView.tsx`, `src/components/NavTabs.tsx`, `src/App.tsx`, `src/theme.css`, `scripts/eval-recordings.ts` (slimmed), `scripts/recordingsServe.ts`, `scripts/test-strategy.ts` (+ `test-strategy` npm script), `scripts/backtest.ts`, `vite.config.ts`, `scripts/server.cjs`.

Not exercised: live midnight roll-over (Verification 5) — the 60s date-change re-derive is wired and the today-vs-yesterday split is already correct (today = 進行中, yesterday cards =「—」), but an actual 00:00 crossing wasn't waited out. Note: only ~0.5d of recordings exist (recorder KILL-blocked — see S1 Results), so most days are empty; that's the honest state, not a bug.

## Amendment — 2026-07-04 (用戶指示,取代原「日終鏡像」設計)

原設計兩個問題(用戶睇 screenshot 指出):(1) short = −retLong 純鏡像,「空」欄冇資訊量;(2) rising-edge 令強度喺 70 上下震盪嘅幣一日重複開單(「定時 renew 買入位」),recorder gap 造假 edge,連 USDC 都入單。新機制(`src/lib/strategyReport.ts` 重寫,evalCore 不變):

- **出場改 20x 槓桿括號**:每注 1 保證金單位,名義 20 單位。TP1 = 幣價 +5%(平半倉,ROI +100% on that half = +0.5 單位)、TP2 = 幣價 +10%(平餘半,+0.5)、SL = 幣價 −5%(餘倉清零,−1.0×餘 frac,爆倉式)、runner(25%)日終平(今日則 mark 為 unrealized,標「持倉中」)。成交用觸發 level 價,SL 優先,±5%/±10% 觸發加 `EPS=1e-9` 容差(float dust)。**Long / short 各自行真實 15-min 路徑 → 參數鏡像但結果唔對稱**(實測今日 >70 多 +370% vs 空 +84%,唔再鏡像;⚡ 因當日冇幣掂到 ±5% bracket 仍為單腳鏡像,屬正常)。
- **入場改持倉紀律**(M1 同款):per (策略 × 方向 × 幣 × 日) 獨立倉態,有未平 runner → 忽略新 edge;只有全 SL 清零後同日可再入(∴ 多空 n 可以唔同,實測 >70 = 34/35)。
- **Gap guard**:edge 只有效當 `slot−1` 存在於 recorded slots(斷線後第一個 slot 唔算 off→on)。
- **穩定幣剔除**:`STABLE_BASES`(USDC/FDUSD/TUSD/DAI/…)跳過。

型別改動:`StratTrade` = `{ sym, side, entryTs, entry, fills: Fill[], roi, open }`(roi 為保證金單位);`StratSide` = `{ long, short, skippedLong, skippedShort }`;`longStats`/`shortStats` → `sideStats`。UI(`StrategyView.tsx`):多空各自欄、n 顯示 `N` 或 `N/M`、明細 4 個 block(⚡多/⚡空/>70多/>70空)每筆列 fill tags(TP1/TP2/SL/收盤/持倉中)+ ROI%、方法行改寫。CLI `backtest --pnl` **不受影響**(另一套 1H close-to-close 近似,caveat 已聲明,無 bracket 模型)。

驗證:`npm run typecheck` 乾淨;`npm run test-strategy` **20/20 PASS**(+1.40 winner、−1.00 SL、0.00 TP1-then-SL、+0.75 TP2-then-SL、short 鏡像路徑 +1.40、非鏡像、持倉阻再入、SL 後再入、gap guard、穩定幣剔除、open mark、skipped);`eval-rec` evalCore 未掂故邏輯不變;live dev-run 策略 tab 實測上述數字 + 明細無 USDC、無重複入場(除 SL 後)、fill tags 正確。

## Amendment — 2026-07-06(用戶指示:加「+200% 全出」出場模式)

第二個出場模式 `StratMode = 'allout'`,同一批 ⚡/>70 訊號、同一 20x 括號,唯一分別:
- **單一 TP**:幣價 ±10%(= 保證金 +200%)一次全出,冇 TP1 partial、冇 runner;fill kind `allout`(UI 標「全出」)。
- **首訊號 = 開倉時點**:每幣每日只入第一個訊號,SL 後**不**重入(ladder 模式 SL 後可重入,呢度唔准 — busyUntil 恆為 Infinity)。
- SL 照舊幣價 ∓5% 爆倉式清零(20x 之下呢個唔係選擇,係物理);未觸發嘅倉日終平。

UI:策略 tab 頂加 toggle(階梯出場 TP1/TP2 | +200% 全出(首訊號)),兩個 mode 同一次 parse 各起一份報表即時切換,方法行文字跟 mode 換。驗證:typecheck 乾淨;`test-strategy` **25/25 PASS**(新 fixture G:+2.00 單一全出、無 TP1 partial、fill kind、−1.00 爆倉、SL 後不重入);preview 實測 toggle 兩邊數字真係唔同(07-06 當日 >70 n:ladder 77/80 vs allout 75 — 首訊號 dedupe 生效)。
