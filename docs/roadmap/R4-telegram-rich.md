# R4 — Telegram 訊號卡升級(詳細內容 + K 線圖附件)

**層級**: 第1層 數據護城河(通知支線,R2 延伸) · **工作量**: M · **依賴**: R2

## zh-HK TL;DR
而家 ⚡ Telegram 通知係一句短文字。升級做「訊號卡」:老詹式排版嘅詳細內容(價格、強度、regime、亮緊嘅 shipped 讀數、TP 梯、oi4h/funding/量Z)+ **附 48h K 線 PNG**(標 entry 線 + EMA20)。圖片生成用**純 JS PNG encoder(Node 內置 zlib deflate,零新依賴、零外部服務)** — 唔用 quickchart 呢類第三方(免費約束照過,但數據唔出街 + 唔靠人哋 uptime)。**觸發範圍唔變:照舊只有 ⚡**(rising edge + 現有 per-coin cooldown)— 邊個訊號有資格出通知係 E2 升降班嘅事,R4 只升級「內容」,唔升級「邊個可以嘈你」。

## Context (verified facts)
- 通知路徑:`scripts/notifyHeadless.ts` `sendTelegram`(bot API sendMessage)+ `notifyFlushBreakouts`;recorder 喺 sweep(recorder.ts:81)同 micro-scan(:108)兩處呼叫,傳 **CoinLite**。
- K 線數據:兩個呼叫點上游都有 **full Coin**(sweep onBatch 個 batch、micro-scan 個 fired: Coin[])— 但 toLite 之後 candles 冇咗。要喺 toLite 之前抽 candles 傳落 notify。
- 卡片素材全部現成:CoinLite 有 strength/regime/oi4h(+oiTrusted)/funding/volZ/riskFlags/signals;ExitPlan 喺 Coin.plan;shipped 讀數(⚡/壓縮突破/上車位/現貨帶動)interpret 計到。
- Telegram bot API:`sendPhoto` 收 multipart/form-data 上載(photo ≤10MB,caption ≤1024 字);現有 `sendTelegram` 係 JSON sendMessage — 要加一個 multipart helper。
- 老詹卡格式(E4 method map):價格/TP1-3(+10/25/50)/硬SL(−15)/出場比例/核心一句/風險一句 — 排版參考,唔係照抄佢啲百分比(我哋 TP 梯用自己 ExitPlan,A 梯為主,B 梯註腳)。

## Design (decided)
1. **PNG 渲染器 `scripts/chartPng.ts`(純函數,零依賴)**:RGBA buffer 畫 48h×15m 蠟燭(綠紅)、EMA20 線、entry 虛線、右軸 4-5 個價位 label(5×7 bitmap 數字,唔使字體庫);`zlib.deflateSync` 包 PNG chunks(IHDR/IDAT/IEND + CRC32)。目標 ~800×400,<100KB。
2. **`notifyHeadless.ts` 加 `sendTelegramPhoto(token, chatId, png: Buffer, caption)`**(multipart);失敗 fallback 現有文字 sendMessage(通知永遠唔准因為圖而斷)。
3. **卡片文字(caption,≤1024)**:標題 ⚡ 縮倉突破 $SYM · 強度 N · regime;價格 + entry(plan.kind 註明係回調/突破位);TP1-3 + SL(A 梯)+ 一行 B 梯註腳;亮緊嘅其他 shipped 讀數(壓縮突破/上車位/現貨帶動,各附 lift 數);oi4h(滯後就標)/funding/量Z;riskFlags 有就列。所有數字同 detail 頁同源 — **唔准另計一套**。
4. **線程 candles**:recorder 兩個呼叫點喺 toLite 前抽 `{candles, plan}` 塞入 notify 參數(新 optional 參數,App 側 toast 路徑唔受影響)。
5. `--test-notify` 升級:砌合成 48h 蠟燭發一張真 photo,驗證 multipart + 渲染。

## Steps
1. `chartPng.ts`:PNG encoder(CRC32 表 + IHDR/IDAT/IEND)+ 蠟燭/線/虛線/bitmap 數字繪圖;純函數 `renderCandlePng(candles, {entry, emaPeriod}) → Buffer`。
2. `notifyHeadless.ts`:multipart `sendTelegramPhoto` + 卡片文字組裝 `buildSignalCard(lite, plan, extras)`;photo 失敗 → 文字 fallback。
3. `recorder.ts`:兩個 notify 呼叫點傳 full-Coin 抽出嘅 candles/plan。
4. `--test-notify` 走新路徑;實測收圖。
5. R2 cooldown/設定照用;README 通知段更新。

## Verification
- typecheck;`npm run recorder -- --test-notify` 電話收到合成 K 線圖 + 卡片文字。
- PNG 喺 Windows 相簿/TG 內開得(CRC 啱);<100KB。
- 迫一個 photo-fail(斬 token 尾)→ 文字 fallback 照到。
- 下一個真 ⚡ 通知:圖 + 卡,數字同 app detail 頁一致。

## 陷阱 / Do-NOT
- **唔准擴觸發範圍**:壓縮突破/上車位加入通知 = E2 升降班決定,唔係 R4 順手做。
- **唔准用外部圖表服務**(quickchart 等)— 零依賴本地渲染,通知鏈唔可以多一個外部單點。
- Photo 失敗一定要 fallback 文字 — 通知可靠性 > 靚。
- Caption 1024 上限:內容按優先級裁,TP/SL 永遠保留。
- bitmap 數字唔好貪靚引字體庫 — native deps(canvas/sharp)喺 Windows 打包 exe 係地雷。

## Results (2026-07-06)

- **Shipped**:`scripts/chartPng.ts`(純 JS PNG encoder,CRC32+deflateSync,RGB color-type 2;800×400,15m×192 蠟燭 + EMA20 + entry 虛線 + 5×7 bitmap 右軸價位,theme.css 色);`notifyHeadless.ts` 加 `sendTelegramPhoto`(FormData/Blob multipart,Node ≥18 內置)+ `buildSignalCard`(caption ≤1024,按 dropRank 裁,TP/SL/標題永留)+ `notifyFlushBreakouts` optional `rich` 參數;recorder 兩個呼叫點(sweep onBatch、micro-scan fired)喺 toLite 前抽 `{candles, plan, insights: interpret(c)}`。
- **同源保證**:caption 數字全部嚟自 CoinLite/ExitPlan/interpret Insight 原物件;同時亮 lift 數用 regex 由 insight.detail(detail 頁同一串字)抽出,冇第二套數。zh 標籤(突破位/回調位/收復位、蓄力/拉升/出貨)係由 CoinDetail/RegimeTag 鏡抄(唔 import .tsx 免拖 React 入 recorder bundle),有註釋提醒同步。
- **實測**:`npm run recorder -- --test-notify` → 合成 48h 蠟燭 photo card 實收(telegram ok:true,toast ok:true);**PNG 6.1KB**(<100KB 目標),Windows 相簿開得(CRC 啱),蠟燭/EMA/entry 線/軸 label 目測全對。
- **Fallback 實測**:斬 token 尾 → sendTelegramPhoto 回 `{ok:false, error:"Unauthorized"}` 唔 throw;empty-candles 迫 render throw → notifyFlushBreakouts 真路徑 fallback 文字卡照送(oiTrusted:false 都試埋,(滯後) tag 有出)。測試用 TESTFB cooldown 條目已清返。
- **範圍**:觸發照舊只有 ⚡ rising edge + cooldown;R2 設定/cooldown 冇郁;app 側 toast 路徑冇郁;typecheck 過,recorder esbuild bundle 過。
- **注**:B2 上車位 read 需要 long 1H series(detail-view only),recorder coin 冇 → 同時亮實際上得壓縮突破/現貨帶動兩種;B 梯註腳鏡 lib/paper LADDERS.B(+10/+25/+50 · SL −15 · 30/30/35 留5% · TP1 後保本)。
