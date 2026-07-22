# S4e — 清算事件收集 + DIY 清算熱區(三期,phase 2/3 gated)

**層級**: 第2層 訊號擴張(S4 數據收集系)· **工作量**: phase 1 S / phase 2-3 M · **依賴**: R1(phase 2 另需 phase 1 ≥1 個月數據)

## zh-HK TL;DR
Coinglass 式清算 heatmap 唔係數據,係模型輸出 — 佢哋用 OI+假設槓桿倍數估算清算價堆積區,API 收費(免費約束否決),爬圖又脆又違精神。但**原始清算事件**免費攞到(2026-07-06 已實測)。三期走:**phase 1** recorder 每 sweep 收 candidate 幣嘅真實爆倉事件(OKX public endpoint;破產價/USD 名義值/方向)落 recordings — ground truth,遲開錄一日蝕一日;**phase 2** 用已錄 OI+價格起 DIY 熱區 model,用真實 bkPx 倒推有效槓桿做校準;**phase 3** 驗證 gate —「真實爆倉量有幾多 % print 喺預測熱帶內 vs 隨機帶 baseline」計 lift,唔過 gate 熱區永遠唔上 UI、更加唔准做訊號。

## Context (verified facts, 2026-07-06 實測)
- **OKX endpoint 用得**:`GET /api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly={BASE}-USDT&limit=100` 免 key;details[] 有 `bkPx`(破產價)/`sz`(張)/`posSide`(long/short)/`side`/`ts`。**必須逐 uly 查**(冇 uly/instFamily 回 code 50015)→ 全市場 355 幣一次過查唔現實,candidate-tier 先啱(同 S2 spot-fetch 同款邏輯)。
- **sz 單位係張(contracts)**:USD = sz × ctVal × bkPx。ctVal 由 `/api/v5/public/instruments?instType=SWAP` bulk 攞(BTC-USDT-SWAP ctVal=0.01 BTC,ctType linear;實測換算 $6-$12.6K 全部合理)。ctVal 係逐 instrument 固定值,可以長 cache。
- **Binance `!forceOrder@arr` WS** 免 key connect 到(實測 20s connected),但官方文檔明言**每 symbol 每秒最多推一單** → cascade 量系統性低估。留返 S4c WS infra 一齊做;phase 1 唔用。
- **data.binance.vision 冇 liquidation dump**(實測 S3 listing:futures/um/daily 得 aggTrades/bookDepth/bookTicker/klines/metrics/premiumIndexKlines/trades)→ **冇歷史可補**,開錄先有數據(R1 複利邏輯)。
- **Recording 讀家全部安全**:evalCore.ts:35 `if (rec.type) continue`、oiStore backfill 同款 — 新 line type 唔會炸舊讀家(加行前已核實)。
- **15 分鐘解像度限制**:sweep 內開平倉互相抵銷只見淨 OI 變化 → phase 2 model 先天糊化,phase 3 報告要誠實計入。
- **P1 教訓遺傳**:凍路徑 OI 滯後幾小時 → phase 2 歸因只可以用 warm-store 幣。

## Design (decided)

### Phase 1 — 事件收集(本 session)
1. `src/data/okx.ts` + `fetchLiquidations(baseUrl, base, sinceTs)`:單頁(最新 ~100 單)、filter ts > sinceTs、USD-ized、`dir` 0=多單被斬(強制賣)/ 1=空單被斬(強制買,由 posSide 定,fallback side);ctVal map 一次 bulk instruments fetch,cache 6h。
2. `src/lib/recording.ts` + `LiqRecord` line type:`{type:'liq', v:1, slot, ts, cands, ev}`;`ev` sym → `[[tsMs, bkPx, usd, dir01], ...]` sparse(冇事件嘅幣唔佔位);`cands` 記低今 sweep 查咗邊啲幣(coverage:「冇事件」≠「冇查」)。
3. `scripts/recorder.ts` sweep 尾:candidates = strength top-25 ∪ 本 sweep ⚡ 幣;`mapPool` conc 4 / spacing 150ms(endpoint 40req/2s,25 幣 ~1.2s,好鬆);module-level `lastLiqTs` per-coin dedupe,restart 後 fallback `now − 15min`(唔倒灌舊事件);成塊 best-effort try/catch,**唔准搞冧 sweep**。

### Phase 2 — DIY 熱區 model(🔒 鎖:phase 1 錄滿 ≥1 個月)
對每個 warm-store 幣嘅每 sweep OI 淨增 ΔOI@P,按槓桿 tier(10/25/50/100x)投影 liq 價 P×(1∓1/lev);tier 權重唔准靠估 — 由已錄 bkPx 對照事發前價格路徑倒推有效槓桿分佈做校準;OI 淨減按比例衰減未觸發堆積;輸出 detail chart 熱帶 overlay,**必須標明「估算」**。單一交易所視角(OKX-only)同 15min 糊化係已知限制,寫入 overlay 嘅 help text。

### Phase 3 — 驗證 gate(🔒 鎖:phase 2 完成)
熱帶命中 lift = 真實爆倉 USD 落喺預測熱帶(佔價格軸 X%)嘅比例 ÷ 同寬隨機帶 baseline。要求 lift 顯著 >1 且 robust(帶寬 ±25% 唔反轉)。唔過 → 熱區唔上 UI,唔重試唔調參到過為止(anti-overfit)。任何由熱區衍生嘅 detector(爆倉瀦掃反轉之類)另行照舊過 backtest gate 先可以 badge/通知/模擬盤。

## Steps (phase 1)
1. `okx.ts`:`getCtValMap`(cache 6h)+ `fetchLiquidations` + export `LiqEvent`。
2. `recording.ts`:`LiqRecord` interface + `buildLiqRecord`。
3. `recorder.ts`:sweep 尾 candidate 選取 + mapPool 輪詢 + `appendRecordLine`;`lastLiqTs` dedupe。
4. 驗證(下面)+ ROADMAP 剔格 + README recorder 段加一句。

## Verification (phase 1)
- `npm run typecheck`(okx.ts/recording.ts 喺 src,真檢查)。
- Recorder 重啟後首個真 sweep:recordings 檔出現 `{type:'liq'}` 行,`cands` ~25-26 幣,`ev` 事件 USD 名義值合理(對照 OKX 網頁/API 抽查)。
- 舊讀家唔炸:`npm run eval-rec` 照行(skip liq 行)。

## 陷阱 / Do-NOT
- **唔准用 Coinglass/Hyblock API(收費)或者爬佢哋個圖** — 免費約束 + 通知鏈唔可以靠人哋 uptime。
- **Phase 2/3 唔准跳**:熱區未過 phase 3 gate 唔准上 UI;上到 UI 都必須標「估算」— 佢係 model 唔係 data。
- Binance WS 每 symbol 1/s cap — 第時用嗰陣唔准當完整 cascade 量嚟統計。
- liq 行係 recorder-only(browser writer 冇呢啲 fetch,同 spotSignals 一樣)。
- 15min 解像度糊化 + OKX 單一交易所視角要喺 phase 3 報告誠實寫明,唔准淨報靚數。
- `limit` 參數對 details 數目似乎冇約束力(實測 limit=3 回 48 條)— 唔好依賴佢,靠 ts filter。

## Results — phase 1 (2026-07-06)

- **Shipped**:`okx.ts` `fetchLiquidations` + `getCtValMap`(instruments bulk,cache 6h)+ export `LiqEvent`;`recording.ts` `LiqRecord`/`buildLiqRecord`;`recorder.ts` sweep 尾 top-25∪⚡ mapPool(conc 4 / 150ms)輪詢 + `lastLiqTs` dedupe(restart fallback now−15min)。
- **直測 fetch**:BTC 24h 1040 單 / ETH 1485 單,USD 名義值 $6-$12.6K 級全部合理,long/short 方向兩邊都有。註:endpoint 實際回傳深度遠超一頁 100(BTC 一 request 攞到 24h+),ts filter 係真正邊界。
- **真 sweep 驗證**:recorder 重啟(PID 16972,同時食埋 R4 photo card)後首 sweep 即出 `{type:"liq"}` 行 — cands 25 幣,PYTH 1 單空爆 + BILL 10 單多爆($9-$3,158),slot 1981471。
- **舊讀家唔炸**:`eval-rec` 照行(206 slots,lift 表正常,liq 行被 `type` skip);typecheck 過。
- **dedupe 實證**:連續兩個真 sweep(slot 1981471/1981472),PYTH 兩邊都有事件而 timestamp 零重疊(MINA 3 / PYTH 1 / EDGE 4 全新)— `lastLiqTs` 機制照設計行。
- **體積**:每 sweep 一行,cands ~250B + 事件 tuple ~30B/單;粗估安靜日 <100KB/日,爆倉日 ~1MB/日 — 可接受。
- Phase 2/3 照鎖:等 p1 錄滿 ≥1 個月先開 model,model 完先過驗證 gate。

## 2026-07-21 historical-evidence classification

`source-unavailable` for archive replay: Binance Public Data has no liquidation
archive matching the required event stream. Klines, metrics or OI must not be
used to fabricate liquidation events. Only a genuinely captured websocket/API
stream can build this evidence forward, so phase 2/3 cannot be unlocked by the
H1 backfill.
