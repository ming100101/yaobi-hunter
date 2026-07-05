# U4 — 幣名旁 24h 走勢縮圖(sparkline)

**層級**: 支援層 · **工作量**: S · **依賴**: 無

## zh-HK TL;DR
Screener 每行加一個細 SVG 縮圖,顯示過去 24 小時價格走勢(一條線,升綠跌紅)。**零額外 API call**:sweep 本身已經逐幣砌好 48h 5m candles,只係 `toLite()` 掉咗佢哋 — 而家抽 48 個 close 留低就得。

## Context (verified facts)
- Sweep 逐幣組裝 full `Coin`(48h 5m candles),再由 `toLite()` 投影成 `CoinLite` 並棄掉 series(`src/data/okx.ts:390-420`;`change24h` 已經用 `n-289` 做 24h 參考點,同一個 window)。**唔使加任何 fetch。**
- Demo mode 同樣行 `toLite`(`src/data/scan.ts:73` `demo.coins.map(toLite)`),所以縮圖喺 demo 都自動有。
- Screener row:`src/components/ScreenerList.tsx` — `Row` 組件(45-125),columns 幣種|階段|強度|1h|OI 4h|Funding|24h量|風險;header 喺 200-209。
- Grid:`theme.css:606-614` — `.scr-head/.scr-row` `grid-template-columns: 1.3fr 0.9fr 1.7fr 0.85fr 0.85fr 1fr 1.05fr 0.7fr`,`min-width: 780px`,外層 `.table-card` 有 `overflow-x: auto`。
- 上次成功 scan 以 `CoinLite[]` 存 IndexedDB(`cache.ts:144-150`,key `scan`)— 舊 cache 冇 spark field,啟動時要 graceful fallback,下次 sweep 自動補齊。
- JSONL recording 用顯式 tuple 揀 field(`src/lib/recording.ts:70-96`)— 加 field 落 `CoinLite` 唔會影響 recording,**亦唔准加落去**(見陷阱)。

## Design (decided)
- `CoinLite` 加 optional field:
```ts
spark?: number[]; // 24h closes @ 30-min resolution (~48 pts), 5 sig figs
```
  Optional 係為咗舊 IndexedDB cache 同舊 recorded data 照 typecheck。
- 取樣:最後 289 支 5m bar(同 `change24h` 一致),每 6 支取一個 close(30 分鐘解像度),尾點必定係最新 close。`toPrecision(5)` 縮 JSON 體積(kv `scan` cache 全市場 +~355×48 個數字,約百幾 KB,IndexedDB 冇問題)。
- 新組件 `src/components/Sparkline.tsx`:純 SVG polyline,64×20,min/max normalize,升(尾 ≥ 頭用 `change24h >= 0` 判斷)`stroke: var(--up)`、跌 `var(--down)`,`strokeWidth 1.5`。全部顏色行 CSS variable(F1 主題日後直接食到)。
- 擺位:**新窄 column**,插喺 幣種 同 階段 之間,header 叫「24h」。sym cell 已經好迫(pin 掣 + symbol + /USDT + ⚡/蓄/T10 badges),唔好再塞嘢入去。
- Cell 加 `title={`24h ${fmtPct(c.change24h)}`}` tooltip。冇 spark(舊 cache)→ 顯示 `<span className="muted">—</span>`。

## Steps

### 1. `src/types.ts` — CoinLite 加 field
`spark?: number[];` 放喺 `lastPrice` 附近,連同一行註釋(來源 + 解像度)。

### 2. `src/data/okx.ts` — toLite 抽 spark
`toLite` 上面加 helper,`toLite` return object 加 `spark: sparkOf(coin.candles)`:
```ts
// 24h close sparkline @ 30-min resolution — the sweep already has the full
// series here; keep ~48 points so the screener can draw a trend thumbnail
function sparkOf(candles: Candle[]): number[] {
  const win = candles.slice(Math.max(0, candles.length - 289));
  const pts: number[] = [];
  for (let i = 0; i < win.length; i += 6) pts.push(win[i].close);
  const last = win[win.length - 1].close;
  if (pts[pts.length - 1] !== last) pts.push(last);
  return pts.map((v) => Number(v.toPrecision(5)));
}
```
(記得 import `Candle` type 如未有。)

### 3. 新組件 `src/components/Sparkline.tsx`
```tsx
import { memo } from 'react';

// tiny 24h trend thumbnail for a screener row; pure SVG, colors via CSS vars
function Sparkline({ pts, up }: { pts?: number[]; up: boolean }) {
  if (!pts || pts.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min; // 0 → flat series; norm() then centers on the mid-line
  const W = 64, H = 20, PAD = 1.5;
  const norm = (v: number) => (range ? (v - min) / range : 0.5); // 0 = low, 1 = high, flat = mid
  const points = pts
    .map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(PAD + (1 - norm(v)) * (H - PAD * 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={up ? 'var(--up)' : 'var(--down)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default memo(Sparkline);
```
`memo` 係值得嘅:sweep 期間每個 batch 都重 render 全 list,但 `CoinLite` object(同 `spark` array reference)喺同一次 sweep 內唔變,memo 令 355 個 SVG 唔使重砌。

### 4. `src/components/ScreenerList.tsx` — 加 column
- Header(200-209):`<span>幣種</span>` 之後插 `<span>24h</span>`。
- `Row`:`.sym` span 之後插:
```tsx
<span className="spark-cell" title={`24h ${fmtPct(c.change24h)}`}>
  <Sparkline pts={c.spark} up={c.change24h >= 0} />
</span>
```

### 5. `theme.css` — grid 加一格
- Line 609:`grid-template-columns: 1.3fr 72px 0.9fr 1.7fr 0.85fr 0.85fr 1fr 1.05fr 0.7fr;`(9 columns)
- 同一 block `min-width: 780px` → `860px`(`.table-card` 的 `overflow-x: auto` 會照顧窄屏)。
- 加:
```css
.spark-cell { display: flex; align-items: center; }
.spark { display: block; opacity: 0.9; }
```

## Verification
1. `npm run typecheck` clean。
2. Dev run(preview):每行幣名右邊有縮圖,升幣綠線跌幣紅線,tooltip 顯示 24h %;⚡ filter、pin、點行開 detail 全部照舊。
3. 舊 cache fallback:DevTools → Application → IndexedDB 睇 `scan` key(或臨時將 `c.spark` 換成 `undefined`)→ cell 顯示「—」不 crash;sweep 完成後縮圖出現。
4. 橫向 scroll:窗口縮窄至 <860px,header 同 row 對齊冇走位。
5. Sweep 時長同之前一樣(~1.5-4.5min)— 呢個 feature 冇任何網絡 I/O。

## Acceptance
- [x] 每行 24h sparkline,升綠跌紅,零額外 API call。
- [x] 舊 cache / demo / missing spark 三種情況都唔 crash。
- [x] 9-column grid 對齊,橫向 scroll 正常,typecheck clean。

## 陷阱 / Do-NOT
- **Do NOT 為縮圖加任何 fetch**(例如逐幣 `/market/candles`)— 全市場 355 幣會多幾百個 request/sweep,直接違反免費 API 約束。數據一定係由 `toLite` 順手留低。
- **Do NOT 將 `spark` 加落 recording tuple**(`recording.ts` `buildScanRecord`)— JSONL 每 sweep 會脹幾百 KB,而 5m 系列 recorder 本身已經記(R1)。
- Do NOT 掂 search tab(`.sr-row`,theme.css:249)— `SearchHit` 冇 candle 數據,out of scope。
- Do NOT 用 chart library — 一條 polyline 唔值一個 dependency。
- 唔好加 animation/transition 落條線 — 每 15 分鐘 sweep 更新一次,動畫只會令 batch update 時成個 list 郁。
- U2(sortable columns)未做:如果 U2 已經 landed 而 grid 有變,以現場 code 為準,停低報告唔好自己估(執行守則 #4)。

## Results (2026-07-04)
實裝完成,5 個檔案照 spec 改(`types.ts`/`okx.ts`/`Sparkline.tsx`/`ScreenerList.tsx`/`theme.css`),recording tuple、search tab、package.json 全部冇掂,零額外 fetch。

實測(dev preview,LIVE OKX 全市場 sweep):
- `npm run typecheck` clean(改前改後各行一次)。
- 舊 cache fallback:reload 舊 `scan` cache,**353 行全部顯示「—」零 crash**,tooltip 仍正確顯示 24h %(spark undefined 都行到)。
- 新 sweep:縮圖逐 batch 出現,sweep 到 358 幣中途已見 **176 條 SVG(125 升綠 / 51 跌紅)**,全部 49 點(48 取樣 + 尾點強制最新 close)。
- 方向 / 顏色驗證:+76.66% 幣 firstY 18.5→lastY 1.5(底升到頂)`var(--up)`;-15.68% 幣 firstY 1.5→lastY 16.2(頂跌到底)`var(--down)`。y-flip + 升綠跌紅正確。
- 9-column header/grid/row cell 三者對齊(幣種|24h|階段|強度|1h|OI4h|Funding|24h量|風險),窄屏靠 `.table-card` overflow-x scroll。
- Sweep 時長無變(feature 零網絡 I/O)。

**一處偏離 spec 原碼(已同步返呢份 spec 嘅 Step 3):** 對抗式 review 驗出原 `span = max - min || 1` 寫法喺 flat series(所有取樣 close 相等,例如近錨定幣)會將條線釘落**底邊**(y=18.5),同碼上註釋 + spec 第 57 行寫明嘅「horizontal mid-line」意圖相反。改用 `norm(v) = range ? (v-min)/range : 0.5`,flat series 已驗證置中(`[5,5,5,5]` → 全部 y=10.0),升/跌方向不變。純 cosmetic、in-scope(`Sparkline.tsx`),忠於 spec 本身寫低嘅意圖。
