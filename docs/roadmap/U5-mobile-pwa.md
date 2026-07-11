# U5 — 手機讀盤(iOS PWA over Tailscale,PC 做 server)

**層級**: 支援層 · **工作量**: S/M(Phase 1)· **依賴**: —(exe server 已存在;owner PC 24/7 開機)

## zh-HK TL;DR
目標:iPhone 隨時隨地開個 icon 就睇到 screener/詳情/模擬盤。**唔起 native Swift app** — 免費 Apple ID sideload 每 7 日過期要重簽,正式上架要 $99/年,兩樣都同免費約束相沖;而「讀盤」呢個需求 PWA 完全滿足:Safari「加入主畫面」→ 主畫面 icon → 全螢幕開 dashboard,體驗同 app 無異,零新 codebase(而家個 React app 就係個 app)。連通用 **Tailscale 個人免費版**(WireGuard 加密私網,PC+iPhone 裝完電話喺出街都掂到屋企部機),**嚴禁 router port-forward 公網**。提醒功能唔使做 — Telegram 通知(R2)本身已經送到電話;U5 補「睇盤」嗰半。

## Context (verified facts)
- Server 而家 `server.listen(port, '127.0.0.1')`(server.cjs:517)— 電話掂唔到,要開 opt-in bind。
- Server **完全冇 auth**(kv 註釋嘅「pins」係置頂幣持久化,唔係密碼)。非 localhost 訪問必須加最低限度 token。
- Endpoints:靜態 app + GET/POST `/kv` + POST `/record` + GET `/recordings` + `/__yaobi_ping__`(單實例 guard,server.cjs:309-318)。
- 手機遠端應該係**唯讀**角色:寫入類(POST /record、POST /kv)由 PC 本地 writer 負責,remote 寫入開放會有兩個 writer 打交。

## Design (decided)
**Phase 1 — 通電話(S/M,今期範圍)**
1. **Opt-in bind**:env `YAOBI_BIND`(默認缺 = 照舊 127.0.0.1;設 IP 或 `0.0.0.0` 先開)。單實例 ping 檢查照用 127.0.0.1(server.cjs:474)。
2. **Token gate(非 localhost 請求)**:kv key `remote-token`(首次啟動自動生成,console 印一次);非 127.0.0.1 來源請求要帶 `?t=<token>` 或 header,錯 → 401。**Remote 一律唯讀**:非 localhost 嘅 POST /kv、POST /record 直接 403(app 前端 fire-and-forget 寫入失敗本身已靜默,唔會爆 UI)。
3. **Tailscale**(人手 ops,唔係 code):PC + iPhone 裝 Tailscale 免費版,電話 Safari 開 `http://<pc-magicdns>:<port>/?t=<token>`。文檔寫明:唔准 port-forward、唔准 funnel 公網。
4. **PWA 殼**:`index.html` 加 `manifest.webmanifest`(name/icons/display:standalone/theme)+ `apple-touch-icon` + viewport meta(有就檢查)。Safari 分享 →「加入主畫面」→ 完工。
5. **手機斷點快執**:iPhone viewport(~390px)行一次 screener/detail/策略 tab,只執致命 overflow(表格橫 scroll 容器、chips 摺行),**唔重寫 UI**。

**Phase 2 — 手機快覽(S,想要先做)**:輕量 `/m` 頁 — 強度 top10 + 今日訊號(⚡/壓縮突破/上車位)+ 模擬盤 A/B 臂 equity + 老詹 logbook 尾幾條。純讀 kv/recordings,一頁睇晒。

## Steps(Phase 1)
1. `server.cjs`:bind 讀 `YAOBI_BIND`;token 生成 + 檢查 middleware(localhost 豁免);remote POST 403。同步 mirror 落 vite dev plugin?唔使 — dev 模式本身 localhost 用。
2. `public/` 加 manifest + icons(現成 app icon 縮圖);`index.html` link。
3. `npm run build` + `node scripts/make-exe.mjs` 重打 exe。
4. Ops(owner):裝 Tailscale ×2、開 `YAOBI_BIND`、電話加主畫面。
5. README 加一段「手機讀盤」+ 安全警告。

## Verification
- PC 上 `curl http://127.0.0.1:<port>/kv` 照舊得(localhost 豁免)。
- 用 LAN IP 冇 token → 401;帶 token GET → 200;帶 token POST /kv → 403。
- iPhone Safari 開到 screener,加入主畫面後 icon 全螢幕開啟,盤面數字同 PC 一致。
- 閂 Tailscale 後電話掂唔到(證明冇走公網)。

## 陷阱 / Do-NOT
- **絕對唔准** router port-forward 或 Tailscale funnel 出公網 — 呢個 server 冇為公網暴露設計過。
- Token 唔係加密 — 佢係擋 LAN 內其他設備嘅門閂;傳輸加密靠 Tailscale WireGuard。
- Remote 唯讀係硬規則:兩個 writer(電話+PC)寫 kv 會互相 clobber(server.cjs 靠 atomic rename 保單 writer 假設)。
- 唔好為咗手機靚而重寫 desktop UI — Phase 1 只執致命 overflow,靚版係 Phase 2 嘅 `/m`。
- Native app 唔做,除非將來需求變成「寫操作/推送以外嘅 iOS 原生能力」— 到時先重開呢題。
