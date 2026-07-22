# 妖幣獵手 Roadmap — Road to Ultimate Money Maker

終極目標唔係一個靚啲嘅 scanner,係一個**自我進化嘅個人交易系統**:

```
數據 → 訊號 → 驗證 → 模擬盤 → 實盤 → 進化循環
```

**硬性約束:全部只用免費 public API(2026-07-07 起主數據源係 Binance fapi/spot;OKX 只餘公開清算 endpoint,因 Binance 冇 REST 清算)+ 免費服務(Telegram)。冇任何付費 API/訂閱。**
**文化約束:呢個 project 嘅誠實統計傳統要延續 — 任何新訊號未過 backtest/eval gate 之前唔准出 badge、唔准通知、唔准入模擬盤。(先例:taker-share ×0.67 被否決;×1.61 判定為 selection noise,見 README:53-57。)**

## 五層架構

```
第1層 數據護城河    P0 persistence · P1 OI 凍結根治 · R1 recording v2 · R2 recorder 24/7 + 通知 · R3 schema v3
第2層 訊號擴張      S1 spot data · S2 spot detectors · S3 micro-scan · S4a-d 實驗 · S6 BB squeeze · S8 VWAP 收復
第3層 錢的語言      M1 模擬盤 · M2 記錄/回測 tab · M3 策略對照(每日全跟正反手) · M4 出場梯對照
第4層 實盤          T1 半自動 · T2 全自動(有硬性解鎖條件)
第5層 自我進化      E1 月度重驗證 · E2 升降班 · E3 regime 分層 · E4 參考訊號 logbook · E5 強度重校準
支援層             U1 settings · U2 screener UX · U3 help · U4 sparkline · U5 手機讀盤 PWA · F1 🎀Y2K 主題
```

## 任務表(建議次序由上至下;一個 task ≈ 一個短 session)

| # | ID | 名稱 | 層 | 量 | 依賴 | Spec | 狀態 |
|---|----|------|----|----|------|------|------|
| 1 | P0 | 持久化根治(修 PIN + 護 OI warmup) | 1 | M | — | [P0](docs/roadmap/P0-persistence.md) | ✅ 2026-07-04 |
| 2 | R1 | Recording schema v2 + recorder 24/7 | 1 | M | P0 | [R1](docs/roadmap/R1-recording-v2.md) | ✅ 2026-07-04 |
| 3 | R2 | 閂 app 通知(Telegram + toast)+ 設定 tab | 1 | S/M | P0,R1 | [R2](docs/roadmap/R2-notifications.md) | ✅ 2026-07-04 |
| 4 | S1 | Spot 基礎數據(bulk 現貨量+基差) | 2 | S | R1 | [S1](docs/roadmap/S1-spot-data.md) | ✅ 2026-07-04 |
| 5 | M1 | 模擬盤 engine(⚡→虛擬倉→P&L) | 3 | M | P0 | [M1](docs/roadmap/M1-paper-trading.md) | ✅ 2026-07-04 |
| 6 | M3 | 策略對照 tab(每日全跟 ⚡/>70 正反手)+ CLI 歷史 P&L | 3 | M | R1 | [M3](docs/roadmap/M3-strategy-report.md) | ✅ 2026-07-04(07-06 加「+200% 全出(首訊號)」出場模式 toggle,test-strategy 25/25) |
| 7 | S5 | 跨源聯合解讀(已錄現貨欄位量 lift) | 2 | S | S1 | [S5](docs/roadmap/S5-cross-interpret.md) | ✅ 2026-07-05 |
| 8 | S2 | 現貨拉盤三 detector(backtest-gated) | 2 | M | S1 | [S2](docs/roadmap/S2-spot-detectors.md) | ◐ 2026-07-21:spot pump/accum H1 historical fail，badge OFF；只留真實語義 spot-led forward shadow 候選，proxy 做內部 control |
| 9 | S3 | Micro-scan(候選幣 75s 複查) | 2 | S | R2 | [S3](docs/roadmap/S3-micro-scan.md) | ✅ 2026-07-05 |
| 10 | M2 | 記錄/回測 tab(日誌+lift+回放+replay) | 3 | L | R1,M1(M3 已備 endpoint/evalCore) | [M2](docs/roadmap/M2-history-tab.md) | ✅ 2026-07-07(S2 補齊 scrubber/equity curve/replay;replay 特徵級明標 + 不適用計數;preset 128ms;equity 同 chip 一致) |
| 11 | P1 | OI 凍結根治(冷路徑滯後 + fail-closed) | 1 | M | P0,R1 | [P1](docs/roadmap/P1-oi-freshness.md) | ✅ 2026-07-06(option c:值照顯示標滯後,gate fail-closed) |
| 12 | R3 | Recording schema v3(補 change1h + f24h) | 1 | S | R1 | [R3](docs/roadmap/R3-recording-change1h.md) | ✅ 2026-07-06 |
| 13 | E4 | 參考訊號 logbook(老詹對照) | 5 | S/M | R1 | [E4](docs/roadmap/E4-reference-logbook.md) | ✅ 2026-07-06(CLI 版:ref-log/ref-eval + 7 種子;UI form 留 U1;ts 待用戶補實) |
| 13b | S7 | 上車準備逆向工程(boarding,gated) | 2 | M | E4 | [S7](docs/roadmap/S7-boarding.md) | ✖ 2026-07-21:B2 H1 historical gate failed，detail insight OFF；detector／shadow evidence 保留 |
| 14 | S6 | BB squeeze 蓄勢偵測(backtest-gated) | 2 | M | R1,P1 | [S6](docs/roadmap/S6-bb-squeeze.md) | ✖ 2026-07-21:D3 H1 historical gate failed，insight OFF；setup／breakout flags 繼續 shadow recording |
| 15 | S8 | 錨定 VWAP 收復確認(backtest-gated) | 2 | M | — | [S8](docs/roadmap/S8-vwap-reclaim.md) | ✖ 2026-07-07(harness `--mode vwap-reclaim` built + AVWAP exact Σquote/Σbase;A1-A3 三關全敗 → recording-only。A1 ⚡+AVWAP ×0.89 <⚡本身 ×0.99 且 <EMA20 twin(增量 ablation 敗命門);A2/A3 ×1.23/×1.26 未過 ×1.3 且 **meanRet 負**(−0.50/−0.35% vs ⚡ +1.22%)、robustness ±25% 擺 ×1.10-1.84(n=6/14)敗、t15/h48 交叉塌(A3 ×0.84);ARX 覆核唔亮。一窗 37d,harness 留俾 E1 重測;base vol 修正 r[6]→r[5],DATA_VERSION 4→5) |
| 16 | M4 | 老詹式出場梯對照臂 | 3 | S/M | M1,E4 | [M4](docs/roadmap/M4-exit-ladder.md) | ◐ 2026-07-06(engine+回放 shipped,B 臂時鐘已行;同日加 C 臂 = 老詹 8-10% 全止盈+遠停損變體,test-paper 36/36;UI 對照行待 — 判定日一個月後) |
| 17 | S4a | 常規 LS ratio 收集 | 2 | S | R1 | [S4a](docs/roadmap/S4a-routine-ls.md) | ✖ superseded 2026-07-07(唔自錄。目標「LS 歷史俾 detector 實驗」已由 Binance Vision metrics dump 達成:`count_long_short_ratio` 5m 月級全宇宙歷史,`backtest5m --metrics` 已接(backtest5m.ts:347-350 註明「S4a/S4b-grade inputs」)、`backtest.ts --ls-drop`(429/1020)亦已可測。自錄 pool 每 sweep 燒最貴嘅 futures/data budget 收嚴格劣化版(15min/top-30/只前向)落一個冇 consumer 嘅 recorded idx16 → 淨值為零,關單。將來若 LS detector 過 gate 要 live-serving,屆時同 detector 一齊加 fetch,唔屬 S4a) |
| 18 | S4b | Orderbook 失衡記錄 | 2 | S/M | R1 | [S4b](docs/roadmap/S4b-orderbook.md) | ✖ superseded 2026-07-08(同 S4a:目標「錄盤口失衡俾 eval」由 Binance Vision **bookDepth** dump 達成 — 實測 `timestamp,percentage,depth,notional`,每分鐘 ±1-5% band、全宇宙、月級、比 S4b top-5 更難 spoof。`obImb` 直接由 dump 算得。自錄係嚴格劣化版,關單。將來要測 orderbook 假說:backtest5m 加 bookDepth loader + state-matched baseline) |
| 19 | S4c | WS 大單監察(pinned 幣) | 2 | M | R2 | [S4c](docs/roadmap/S4c-ws-trades.md) | ✖ 2026-07-08(recording-first 半邊被 Vision aggTrades 取代;**N=11 pump study 實證 whale 唔領先 pump — 9/11 pump 前淨賣、買盤只喺突破同步爆、$50k floor 對妖幣 miscalibrated** → 假說否決,唔起 WS collector。除非全新 hypothesis + coin-relative threshold + state-matched + 領先驗證三關過。第 5 條「偵測更早冇 free lunch」證據) |
| 20 | S4d | 訊號延遲分析(lead time) | 2 | S | R1+數據 | [S4d](docs/roadmap/S4d-latency-eval.md) | ✅ 2026-07-08(evalCore `leadTime`+per-state lead 分佈,seam-aware;CLI `--lead`+記錄 tab「提早」欄。首量:OKX-era ⚡ lead 無得計(fire 即 move),**strength≥70 中位早 2.0h ×2.57、top10 早 2.5h ×1.98** — 證實太遲投訴 + 指出更早 state 已存在待 E2 升班) |
| 20b | S4e | 清算事件收集 + DIY 熱區(三期,2/3 gated) | 2 | S→M | R1(p2 需 p1 ≥1月數據) | [S4e](docs/roadmap/S4e-liquidations.md) | ◐ p1 2026-07-06(收集已行:top-25∪⚡ 每 sweep;熱區 model + 驗證 gate 🔒 待數據) |
| 20c | S9 | 增倉突破(CAP 型 flush→重建→突破,gated) | 2 | M | R1,P1 | [S9](docs/roadmap/S9-rebuild-breakout.md) | ✖ 2026-07-21:R1–R3 H1 historical gate failed；「增」badge／Telegram OFF，raw flags／shadow evidence 保留 |
| 20d | S10 | 派貨/頂部拒絕(SHORT 做空準備,gated) | 2 | M | R1,P1 | [S10](docs/roadmap/S10-distribution-top.md) | ◐ 2026-07-22:舊 T1–T4 仍 retired；新 `T1 + reversal-confirmed` July frozen holdout 只有 7 events／7 coins／7 days，判定 `insufficient-sample`；保持 forward shadow，短卡／paper S 臂仍 OFF |
| 20e | S11 | 雙底接人(W 底 pullback 入場,gated) | 2 | M | R1 | [S11](docs/roadmap/S11-w-bottom.md) | ✖ 2026-07-22:`W2 + uncrowded-trend` July frozen holdout failed（22 events，10%×24h lift ×0.48，net −3.68%）；停止升班，badge／TG／paper 仍 OFF；shadow 狀態不由歷史審計自動改動 |
| 20f | S12 | 插針掃損反轉(TRIA 型,gated) | 2 | M | R1 | [S12](docs/roadmap/S12-flushwick.md) | ✖ 2026-07-07(1H ×0.34-0.78 + **5m 重測(Binance Vision)×0.67-0.76** 兩時框兩數據源一致 below baseline → 確認死;副產品 backtest5m.ts 5m harness) |
| 20g | S13 | 處女增倉突破(EVAA 型零 flush 擴張,gated) | 2 | M | R1,P1 | [S13](docs/roadmap/S13-virgin-expansion.md) | ✖ 2026-07-21:V1–V3 H1 historical gate failed；「擴」badge／Telegram OFF，raw flags／shadow evidence 保留 |
| 20h | S14 | 早期拉盤 initiation(突破前偵測) | 2 | M | R1,S4d | [S14](docs/roadmap/S14-early-pump.md) | ✖ recording-only 2026-07-08(/loop:用戶「太遲」投訴 → 5m harness 新 detector。初測強(×1.73/6.5h lead),live 上咗但 **6-agent 對抗式覆核否決**:×1.73 係 unconditional-baseline 虛高,真增量 ×1.03-1.10、lead 假象(同 move ~1.2h)、expectancy ~0。**定案(state-matched baseline + metrics 版):突破前所有 trigger(量/OI/taker)對 markup geometry 增量 ×0.99-1.04 = 零。偵測更早冇 free lunch — 突破帶量 geometry 係 workhorse,之前 fire 就丟咗佢。** `EARLY_PUMP_SHIPPED=false`,badge/通知 OFF,recording 留參考。lookahead 冇問題,fidelity 逐 bar 對齊。) |
| 20i | S15 | 深跌收復兩階段早察(深跌→EMA20收復+OI→🟡→L0→🟢) | 2 | L | R1,P1,entryWatch,S7-B2 | [S15](docs/roadmap/S15-deep-reclaim.md) | ✖ H1 historical gate failed · 2026-07-21 用戶拍板關自動 test TG；detector、Top-1 selection round、lifecycle、shadow evidence 照錄，badge／paper／tier 維持關閉 |
| 21 | E3 | BTC regime 標記 | 5 | S | R1 | [E3](docs/roadmap/E3-regime.md) | ✅ 2026-07-08(/loop:`getBtcRegime`(BTC 1H ret7d,±5% up/down 否則 chop,15min cache)→ 兩個 writer 標入 sweep-meta btcRegime/btcRet7d;evalCore `regimeAt`+`runEval(...,regime)` 同時濾 baseline+events;CLI `--regime`。test-regime 全綠,live=up +9.05%。regime tag 由 recorder/app 重啟後起計,pre-E3 slot 自動排除) |
| 22 | E1 | 月度重驗證 checklist | 5 | S | R1 | [E1](docs/roadmap/E1-revalidation.md) | ☐ 每月行 · 末次 2026-07-07 → [REPORT-2026-07](docs/roadmap/reports/REPORT-2026-07.md)(Binance harness 覆核:增 ×2.63/擴 ×3.09/D3 ×1.30 企穩、B2 ×1.60、現貨帶動 ×1.48、**⚡ ×2.04→×1.28 WATCH**;live recordings 3.6d seam-blended 樣本不足,Binance 年代得 0.6d,下月先有統計力) |
| 23 | E2 | 訊號升降班制度 | 5 | S | E1×2月 | [E2](docs/roadmap/E2-promote-demote.md) | ☐ |
| 24 | E5 | 強度重校準(setup 導向) | 5 | M | **E4 ≥15 條 + P1 + R3** | [E5](docs/roadmap/E5-strength-recalibration.md) | 🔒 |
| 25 | T1 | 實盤半自動(/confirm 落單) | 4 | M | **M1 一個月正 P&L** | [T1](docs/roadmap/T1-live-semiauto.md) | 🔒 |
| 26 | T2 | 實盤全自動(硬風控) | 4 | M | **T1 一個月無事故** | [T2](docs/roadmap/T2-live-auto.md) | 🔒 |
| — | U1 | ⚙️ Settings + 匯出備份 | 支 | S/M | P0 | [U1](docs/roadmap/U1-settings-export.md) | ◐ 2026-07-08(/loop:**匯出/匯入備份 section** shipped — download `yaobi-backup.json`(pinned+notify sans token+paperCfg),import whitelist + 保留現有 token,瀏覽器 verified 11 pins、零 token leak。其餘 section 照 陷阱 skip:篩選(ScreenerList 冇讀 settings.screener)、外觀(🎀 已有)、模擬盤(待核實 consumer)) |
| — | U2 | Screener 排序/篩選/sticky | 支 | S | — | [U2](docs/roadmap/U2-screener-ux.md) | ✅ 2026-07-05 |
| — | U3 | Help modal + 首次導覽 | 支 | S | — | [U3](docs/roadmap/U3-onboarding.md) | ✅ 2026-07-08(/loop:HelpModal + topbar「?」掣 + first-run kv,4 sections + 誠實聲明,瀏覽器 verified。**刻意冇 hardcode 爭議中嘅 lift 數字**(baseline audit 令 ⚡ 等入 revalidation),用「示範性、每月重驗、見 roadmap」框架;數字定案後可加。badge-click shortcut deferred) |
| — | U5 | 手機讀盤(iOS PWA + Tailscale,PC 做 server) | 支 | S/M | — | [U5](docs/roadmap/U5-mobile-pwa.md) | ☐ 隨時 |
| — | R4 | Telegram 訊號卡升級(詳細內容 + K 線 PNG) | 1 | M | R2 | [R4](docs/roadmap/R4-telegram-rich.md) | ✅ 2026-07-06(photo card + 零依賴 PNG 6.1KB;photo-fail→文字 fallback 實測;觸發範圍不變) |
| — | U4 | 幣名旁 24h 走勢縮圖 | 支 | S | — | [U4](docs/roadmap/U4-sparkline.md) | ✅ 2026-07-04 |
| — | F1 | 🎀 Y2K girly pixel 主題 | 支 | M | P0 | [F1](docs/roadmap/F1-y2k-theme.md) | ✅ 2026-07-07(Fusion Pixel zh_hant 703KB 自托管;charts theme-key remount;kv 'theme' 過 port drift;dark 零改動) |

## 2026-07-21 — 2026 H1 historical evidence audit

[完整 zh-HK 報告](HISTORICAL-EVIDENCE-AUDIT-2026-H1.md) · [deterministic JSON](HISTORICAL-EVIDENCE-AUDIT-2026-H1.json) · [方法及產品邊界](docs/roadmap/HISTORICAL-EVIDENCE-AUDIT.md)

- 2026-01..06 archive universe 共 **4,039 coin-months / 759 normalized bases**；逐月 universe，而非今日仍上市名單。大檔留喺已 ignore 嘅 `scripts/backtest-data/`。
- 32 個可歷史重跑項目：**2 `historical-pass`、30 `historical-fail`**。兩個候選係 Organic spot proxy 同 True spot-led（同一組 27 events / 16 coins；10%×24h matched lift ×1.65、after-cost/funding +0.77%）；只列候選覆核，**不自動升 live**。
- 30 個 fail（包括 ⚡／蓄、D3、B2、R1–R3、V1–V3、S10、S11、S14、spot pump/accum、UMM、S15、entry-watch、strength≥70、top10）由本日起寫作 **「H1 historical gate failed」**，唔再用「收集中／等 archive」作阻塞理由。舊單窗結論保留作歷史紀錄，但 evidence 狀態由本報告 supersede。
- 其餘分類：6 `forward-only`、1 `forward-confirmation-required`、1 `source-unavailable`、1 `manual-external`、1 `superseded`。Telegram 送達、runtime Top-1/cooldown、recorder uptime、paper account、真實 slippage 同 T1 一個月正 paper P&L 仍不可由 replay 代替。
- 審計生成嗰刻只更新 evidence 分類；其後用戶已拍板並執行 [H1 evidence product decision](docs/roadmap/H1-EVIDENCE-DECISION-2026-07-21.md)：落敗 detector 嘅 badge／自動 Telegram／entry-watch／新 paper entry／S15 test feed 已關，raw detector、recording、shadow evidence 同舊 ledger 保留。Strength／Top10 只作排名；tier map 同 T1 仍冇解鎖。

## 2026-07-22 — H1 failed-detector remediation

[完整 remediation 報告](HISTORICAL-EVIDENCE-REMEDIATION-2026-H1.md) · [deterministic JSON](HISTORICAL-EVIDENCE-REMEDIATION-2026-H1.json)

- 30 個 fail 中 7 個屬角色錯配：2 ranking、2 control、3 setup；已明確禁止當獨立 entry，保留各自排序／veto／confirmation 用途。
- 23 個真正 entry families 用 2026-01 至 03 discovery、2026-04 至 06 單次 validation；五個 broad causal filters 預先固定，matched control 同樣套 filter。
- 21 個 discovery 已淘汰；兩個鎖定 v2 通過 validation：`top-t1-reversal-v2`（short，48 events，10%×24h lift ×1.63，net +2.90%，2/3 正月份）同 `wbottom-w2-uncrowded-v2`（long，73 events，lift ×1.69，net +2.23%，3/3 正月份）。
- 兩個 v2 只加入 forward Strategy Lab shadow；原 T1/W2 結論不覆寫，badge、Telegram、paper 同 tier map 全部維持關閉。

## 2026-07-22 — July post-selection frozen holdout

[完整 holdout 報告](HISTORICAL-EVIDENCE-HOLDOUT-2026-07-21.md) · [deterministic JSON](HISTORICAL-EVIDENCE-HOLDOUT-2026-07-21.json)

- 凍結 H1 remediation 規則後，另用 2026-07-01 起嘅 daily archive；官方 price／metrics archive 實際只齊至 **2026-07-20**，所以 manifest 同 scoring boundary 都以 07-20 為準，冇用缺失嘅 07-21 扮完整數據。
- `top-t1-reversal-v2`：7 events／7 coins／7 days，10%×24h matched lift ×0.96，net +2.53%，但未達 10 events／10 coins floor，判定 `insufficient-sample`，保持 forward shadow，唔作成敗結論。
- `wbottom-w2-uncrowded-v2`：22 events／21 coins／12 days，10%×24h matched lift ×0.48，net −3.68%，worst lift ×0.48，bootstrap L95 −6.35%，判定 `holdout-fail`，停止升班。
- Holdout 總結：**0 pass／1 fail／1 insufficient**。July 不會用嚟調參；badge、Telegram、paper、entry-watch、tier map 同現有 shadow runtime 均冇由報告自動改動。

**2026-07-07 數據源遷移(OKX → Binance)**:fapi 對用戶恢復可達,全 market-data 層由 `src/data/okx.ts` 遷去 `src/data/binance.ts`(universe 直接用 exchangeInfo,528 隻 vs 舊 OKX∩BN 355;1000×/1M× 符號價格已歸一化返每幣單位)。舊 spec 入面 okx.ts 嘅 file:line 引用已過時 — 執行舊 spec 前先對返 binance.ts。清算收集(S4e)係唯一留喺 OKX 嘅 endpoint(Binance 冇 REST 清算,要等 S4c 類 WS 收集器)。**統計 seam**:recordings 由呢日起 `source:'binance'`;OI warm store 唔會跨源拼接;所有已 ship lift(⚡×2.04、增×2.60、現貨帶動×1.79、B2×2.04、D3×1.42)全部係 OKX 年代數字,E1 要用 Binance 年代 recordings 重驗先算數。backtest harness 已遷 Binance(DATA_VERSION 4),futures/data 統計只有 30 日深度。**同日補:EPIC seam-miss 修正** — EPIC +33% 冇出通知,複盤證實(1)舊 universe 根本冇 EPIC(0/215 OKX sweeps),(2)seam 期 OI fail-closed 空窗食正 10:00 breakout(增 R1 條件其實齊)。修正 = warm store cold-start seed(`seedFromHist`:用冷路徑本身已 fetch 嘅 openInterestHist,scale 錨定 snapshot level,一個自洽單位,唔拼接;probe 兩推導差 median 0.32%/max 2.08%,hist tail lag ≤6.7min)。P1 fail-closed 政策不變,detector 門檻不變(唔使 gate,P1 類數據層修正);實測 fresh process 首 sweep 40/40 trusted oi4h。新上市幣由第一個 sweep 起 增/⚡ gate 即生效。**同日決定(Claude 代拍板,用戶授權):增/擴 暫唔入模擬盤 book** — (1) A/B/C ⚡-only 係 T1 時鐘可比性基礎;(2) 兩者 Binance 窗 meanRet@24h ≈ +0.01%,lift 做排序得、做自動進場策略未證實;(3) 證據流(sweep-meta flags)照儲,E1 重驗後復議。

**2026-07-08 通宵 /loop 自動工作(詳見 [NIGHT-LOG-2026-07-08](docs/roadmap/reports/NIGHT-LOG-2026-07-08.md))**:用戶「⚡ fire 時價已升,太遲」投訴 → (1)**S4d shipped**(lead-time 指標:⚡ fire 即 move,strength≥70 早 ~2h ×2.57);(2)**S14 早期拉盤**試過:5m harness 初測 ×1.73/6.5h lead 好靚,但 **6-agent 對抗式覆核否決** — ×1.73 係 unconditional-baseline 虛高,真.增量 ×1.03-1.10、lead 假象(同 move ~1.2h)、expectancy ~0 → 降 recording-only,badge/通知 OFF(照 ×1.61 先例);(3)**Baseline audit**(見 [BASELINE-AUDIT-2026-07-08](docs/roadmap/reports/BASELINE-AUDIT-2026-07-08.md)):`backtest.ts` 加 `--matched`,揭發**成個突破 suite 嘅 headline lift 大部分係「收破 24h 高帶量」geometry(~×2.2),唔係 detector 獨有 OI 條件** — state-matched 增量:擴 ×1.41 / 增 ×1.20 / ⚡ ×0.59(近似,同 E1 ⚡ 轉弱一致)。**唔自動降 ship;E1 以後同時 report matched lift,E5 用 incremental edge 加權,⚡ 認真覆核 — 全部人手拍板。** **完整審計(all detectors × targets 10/15/20,含 `--matched-close` 收乾淨 ⚡ confound):state-matched 增量 lift(分化,唔係一竹篙)→ **擴 ×1.3-1.4 + B2 ×1.7-2.0(兩個真.edge,機制唔同:OI 擴張 / 深跌收復)** · 增 ×1.2(邊際)· **⚡ ×0.53-0.60(confound-free,flush 令突破命中率減半)· D3 ×0.6 · spot-pump ×0.7(三個負,特殊條件冇 beat 底層 geometry)**。夾 E1 ⚡ ×1.28。淨結論:一半 detector(⚡/D3/spot-pump)嘅特殊論喺 Binance 冇兌現,edge 主要係底層 momentum/突破;擴/B2 例外(真加值)。各自幾何 matched:breakout=brokeHigh(close/high),B2=EMA-reclaim,spot-pump=ret4h≥2%。E5 用 incremental edge 加權。⚡ 係 flagship + T1 paper 時鐘基礎,降唔降係用戶級大決定 — 強烈建議睇 [BASELINE-AUDIT](docs/roadmap/reports/BASELINE-AUDIT-2026-07-08.md)。**

2026-07-05 ARX 複盤衍生五個任務(老詹參考訊號 13:56 蓄力加倉 81 分 @0.2121,我方同刻 52 分,14:40 先追認突破;詳見各 spec 嘅 Context)。P1 排最前 — OI 凍結影響**而家每一個** OI-gated 訊號嘅可信度,係數據層 bug 唔係新訊號,唔使 gate 但要人手對數驗證。E4 越早開波,老詹樣本累積越多(同 R1 複利邏輯)。S6 係新 detector,照舊 backtest gate。M4 對照出場梯,虛擬帳,唔郁 default。E5 鎖喺 E4 夠 15 條先開,改強度公式要過三關 gate。

2026-07-05 老詹【上車準備】(HEI 77 / ADA 72)複盤(multi-agent 驗證):**確認唔起 S7 composite detector**。老詹「核心」四段 = 我方 `Signals` booleans(mildRise/oiHealthy/buyHealthy + interpret 費率轉負),邏輯早已存在,但 `change1h` 未入 recording schema → composite 過唔到 backtest gate → IRON RULE 之下 ship 唔到。所以 insight 拆入 E4(收老詹自報 hit-rate + lead-time + provenance 修正)+ E5(setup 成份,gated)+ **新 R3**(補 change1h/f24h 令未來可 backtest)。副產品:老詹真叫價 ADA @0.1852 係追價、冇中自己 TP1(誠實 miss 入 logbook);HEI 唔喺我方 universe(冇 Binance USD-M 永續,okx.ts:285)— 唔拆 gate,記低 spot-class,OKX 現貨層留 S1/S2。

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
