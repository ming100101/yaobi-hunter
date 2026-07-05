# E1 — 每月重驗證:一條 checklist,俾任何 model 每月行一次

**層級**: 第5層 自我進化 · **工作量**: S · **依賴**: R1(數據累積中)、有 M1 更好

## zh-HK TL;DR
訊號會過期(market regime 變)。每月行一次固定 checklist:重跑 eval-rec、對比上月、出一份簡短報告。呢份 spec 本身就係嗰條 checklist — 執行 model 每月照住做,唔使諗。

## Monthly checklist (run verbatim, paste outputs into the report)
1. `npm run eval-rec -- --target 10 --json > docs/roadmap/reports/eval-YYYY-MM.json` (create `docs/roadmap/reports/` if missing)
2. `npm run eval-rec -- --target 15 --json > docs/roadmap/reports/eval15-YYYY-MM.json`
3. If S4d landed: rerun with `--lead`, note median lead per state.
4. If M1 landed: read `paper-state` from `%LOCALAPPDATA%\YaobiHunter\kv.json` → record equity, winRate, profitFactor, maxDD (30d window = ledger entries this month).
5. Write `docs/roadmap/reports/REPORT-YYYY-MM.md` (~20 lines, zh-HK):
   - 數據量:unique slots、span days、recorder uptime 觀感(有冇成日斷)
   - 每個 state(⚡/蓄/strength≥70/top10 + 任何實驗訊號)嘅 4h/24h lift 對上月變化
   - 模擬盤本月 P&L 摘要
   - E2 升降班建議(見 E2 rules)— 建議,唔係自動執行
   - 異常:429 頻率、sweep 時長回歸、缺數據日
6. Health checks: recordings dir has ~96 lines/day for the month (`ls` + line counts); scheduled task still registered (`schtasks /query /tn YaobiRecorder`).

## Automation (optional, after two manual months)
Register a monthly scheduled task that runs a script performing steps 1-4 and drafting step 5's numbers section; human (or session model) writes the judgement paragraphs.

## Acceptance
- [ ] Report file exists for the month, all sections filled, numbers pasted not paraphrased.
- [ ] Comparisons reference last month's report explicitly.

## 陷阱 / Do-NOT
- 樣本少嘅月份(⚡ events < 10)明寫「樣本不足,不作結論」— 唔好喺 noise 度讀故事。呢個 project 嘅誠實文化(README:57 嘅 ×1.61 selection-noise 教訓)要延續。
- Do NOT auto-demote/promote from this report — that's E2's rules, applied deliberately.
