# 妖幣獵手 Roadmap — Road to Ultimate Money Maker

終極目標唔係一個靚啲嘅 scanner,係一個**自我進化嘅個人交易系統**:

```
數據 → 訊號 → 驗證 → 模擬盤 → 實盤 → 進化循環
```

**硬性約束:全部只用免費嘅 OKX public API + 免費服務(Telegram)。冇任何付費 API/訂閱。**
**文化約束:呢個 project 嘅誠實統計傳統要延續 — 任何新訊號未過 backtest/eval gate 之前唔准出 badge、唔准通知、唔准入模擬盤。(先例:taker-share ×0.67 被否決;×1.61 判定為 selection noise,見 README:53-57。)**

## 五層架構

```
第1層 數據護城河    P0 persistence · R1 recording v2 · R2 recorder 24/7 + 通知
第2層 訊號擴張      S1 spot data · S2 spot detectors · S3 micro-scan · S4a-d 實驗
第3層 錢的語言      M1 模擬盤 · M2 記錄/回測 tab · M3 策略對照(每日全跟正反手)
第4層 實盤          T1 半自動 · T2 全自動(有硬性解鎖條件)
第5層 自我進化      E1 月度重驗證 · E2 升降班 · E3 regime 分層
支援層             U1 settings · U2 screener UX · U3 help · U4 sparkline · F1 🎀Y2K 主題
```

## 任務表(建議次序由上至下;一個 task ≈ 一個短 session)

| # | ID | 名稱 | 層 | 量 | 依賴 | Spec | 狀態 |
|---|----|------|----|----|------|------|------|
| 1 | P0 | 持久化根治(修 PIN + 護 OI warmup) | 1 | M | — | [P0](docs/roadmap/P0-persistence.md) | ✅ 2026-07-04 |
| 2 | R1 | Recording schema v2 + recorder 24/7 | 1 | M | P0 | [R1](docs/roadmap/R1-recording-v2.md) | ✅ 2026-07-04 |
| 3 | R2 | 閂 app 通知(Telegram + toast)+ 設定 tab | 1 | S/M | P0,R1 | [R2](docs/roadmap/R2-notifications.md) | ✅ 2026-07-04 |
| 4 | S1 | Spot 基礎數據(bulk 現貨量+基差) | 2 | S | R1 | [S1](docs/roadmap/S1-spot-data.md) | ✅ 2026-07-04 |
| 5 | M1 | 模擬盤 engine(⚡→虛擬倉→P&L) | 3 | M | P0 | [M1](docs/roadmap/M1-paper-trading.md) | ✅ 2026-07-04 |
| 6 | M3 | 策略對照 tab(每日全跟 ⚡/>70 正反手)+ CLI 歷史 P&L | 3 | M | R1 | [M3](docs/roadmap/M3-strategy-report.md) | ✅ 2026-07-04 |
| 7 | S5 | 跨源聯合解讀(已錄現貨欄位量 lift) | 2 | S | S1 | [S5](docs/roadmap/S5-cross-interpret.md) | ✅ 2026-07-05 |
| 8 | S2 | 現貨拉盤三 detector(backtest-gated) | 2 | M | S1 | [S2](docs/roadmap/S2-spot-detectors.md) | ✅ 2026-07-05 (2/3;現貨帶動 shipped ×1.79) |
| 9 | S3 | Micro-scan(候選幣 75s 複查) | 2 | S | R2 | [S3](docs/roadmap/S3-micro-scan.md) | ☐ |
| 10 | M2 | 記錄/回測 tab(日誌+lift+回放+replay) | 3 | L | R1,M1(M3 已備 endpoint/evalCore) | [M2](docs/roadmap/M2-history-tab.md) | ☐ |
| 11 | S4a | 常規 LS ratio 收集 | 2 | S | R1 | [S4a](docs/roadmap/S4a-routine-ls.md) | ☐ |
| 12 | S4b | Orderbook 失衡記錄 | 2 | S/M | R1 | [S4b](docs/roadmap/S4b-orderbook.md) | ☐ |
| 13 | S4c | WS 大單監察(pinned 幣) | 2 | M | R2 | [S4c](docs/roadmap/S4c-ws-trades.md) | ☐ |
| 14 | S4d | 訊號延遲分析(lead time) | 2 | S | R1+數據 | [S4d](docs/roadmap/S4d-latency-eval.md) | ☐ |
| 15 | E3 | BTC regime 標記 | 5 | S | R1 | [E3](docs/roadmap/E3-regime.md) | ☐ |
| 16 | E1 | 月度重驗證 checklist | 5 | S | R1 | [E1](docs/roadmap/E1-revalidation.md) | ☐(每月行) |
| 17 | E2 | 訊號升降班制度 | 5 | S | E1×2月 | [E2](docs/roadmap/E2-promote-demote.md) | ☐ |
| 18 | T1 | 實盤半自動(/confirm 落單) | 4 | M | **M1 一個月正 P&L** | [T1](docs/roadmap/T1-live-semiauto.md) | 🔒 |
| 19 | T2 | 實盤全自動(硬風控) | 4 | M | **T1 一個月無事故** | [T2](docs/roadmap/T2-live-auto.md) | 🔒 |
| — | U1 | ⚙️ Settings + 匯出備份 | 支 | S/M | P0 | [U1](docs/roadmap/U1-settings-export.md) | ☐ 隨時 |
| — | U2 | Screener 排序/篩選/sticky | 支 | S | — | [U2](docs/roadmap/U2-screener-ux.md) | ☐ 隨時 |
| — | U3 | Help modal + 首次導覽 | 支 | S | — | [U3](docs/roadmap/U3-onboarding.md) | ☐ 隨時 |
| — | U4 | 幣名旁 24h 走勢縮圖 | 支 | S | — | [U4](docs/roadmap/U4-sparkline.md) | ✅ 2026-07-04 |
| — | F1 | 🎀 Y2K girly pixel 主題 | 支 | M | P0 | [F1](docs/roadmap/F1-y2k-theme.md) | ☐ 隨時 |

點解咁排:P0 止血(port 漂移搞到 PIN 同 48h OI warmup 一齊冇);R1 越早改 schema,累積嘅可用數據越多(複利);M1 提早做 — 即刻開始將 ⚡ 嘅 lift 轉譯成錢單位嘅證據,係 T1 嘅一個月倒數起點;M3 跟住 — 用已錄數據答「全跟正反手賺蝕幾多」,recordings 越積越有用;S 系列擴訊號(S5 排最前 — 零新 fetch,淨用 S1 已錄嘅現貨欄位跨源量 lift,越早開始 recordings 越有統計力);M2 要 R1 嘅數據先有嘢睇;T 系列被解鎖條件鎖住,冇得跳級;U/F 係「唞氣位」,邊個 session 得閒邊個做。

## 執行守則(俾執行呢啲 spec 嘅 model — READ THIS FIRST)

1. **先讀完成份 spec 先開波。** Spec 已包含 file:line 引用、code sketch、schema、驗證步驟 — 唔需要自己再探索或設計。
2. **順步驟做。** 每步指明檔案同函數。跳步 = 出 bug。
3. **每個驗證步驟都要真係行。** `npm run typecheck` 係最低要求;spec 列嘅 dev-run/CLI 驗證照做,結果寫入 summary。
4. **卡住或現實同 spec 唔符 → 停低報告,唔准即興。** 例:行數對唔上(檔案改咗)→ 講出嚟等人 update spec,唔好自己估。
5. **只准掂 spec 範圍內嘅檔案。** 唔好順手 reformat、rename、「改善」其他嘢。
6. **訊號紀律:** 新 detector 未過 spec 寫明嘅 backtest/eval gate,只可以 recording-only,唔准 badge/通知/模擬盤。
7. **UI 文字保持 zh-TW。** 數字聲明(lift、樣本數)要同 README/analyze.ts 註釋一致。
8. **免費約束:** 唔准引入任何付費 API、key-required 數據源(T1/T2 嘅用戶自己 OKX key 除外)。
9. 完成後:剔返上面個表嘅 ☐,一句 summary 寫低實測數字(sweep 時長、lift 結果等)貼喺 spec 底部嘅 results block。

## 而家已有嘅(唔使重做)

15 分鐘全市場掃描(355 幣 ~4.5min 冷 / ~1.5min 暖)、⚡ 縮倉突破(backtest ×2.04)、蓄 早期蓄力(watchlist ×1.03-1.24)、27 個解讀 detector、CLI backtest harness(`npm run backtest`)、JSONL recorder + eval(`npm run recorder` / `eval-rec`)、exe 打包、app 開住時嘅 Windows 通知。詳見 [README.md](README.md)。

強度與階段為示範性評分。模擬盤與實盤模組屬個人工具。Not financial advice.
