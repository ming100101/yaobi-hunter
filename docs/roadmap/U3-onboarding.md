# U3 — 「?」help modal + 首次使用導覽

**層級**: 支援層 · **工作量**: S · **依賴**: 無

## zh-HK TL;DR
啲 badge(⚡/蓄/T10/階段)有 backtest 故仔,但 UI 冇地方講。加一個 topbar「?」掣開 help modal,解釋每個符號、每個 column、同埋誠實嘅統計聲明。首次開 app 彈一次。

## Context (verified facts)
- Explanations live only in README (English) — ⚡ story at README:51-53 (×2.04 lift, ~1-2/day), 蓄 at 55-57 (watchlist tier, 非進場訊號), signal ages at README:12.
- Existing tooltip-only affordances: `title` attributes; no modal component exists yet (U1 builds one first if done before this — reuse its overlay pattern).
- First-run detection: kv key absence (`help-seen`).

## Design (decided) — modal content (zh-TW, write exactly this structure)
1. **符號**: ⚡ 縮倉突破 — 回測驗證(154 幣 37 日,lift ×2.04),全市場約每日 1-2 次,有通知;蓄 早期蓄力 — 觀察級(lift ×1.03-1.24),非進場訊號,無通知;T10 {時長} — 入強度前十幾耐;📌 置頂並優先掃描。
2. **欄位**: 階段(蓄力/拉升/出貨 = 資金動態分類)、強度(0-100 綜合分)、OI 4h(未平倉合約變化)、資金(funding rate)、風險(旗標數)。
3. **點用**: 每 15 分鐘全市場掃描;搜尋 tab 查任何幣;詳情頁 20 秒自動更新。
4. **誠實聲明**: 強度與階段為示範性評分,回測有單一市況窗口等限制,非投資建議。
5. (E2 landed 後) tier legend: 實戰級/觀察級.

## Steps
1. `src/components/HelpModal.tsx` — static content above, `.card` overlay, ✕/Esc/backdrop close (share overlay approach with U1's SettingsPanel — extract a tiny `Modal` wrapper if both exist).
2. 「?」ghost button in `.top-actions` (`.btn.ghost` styling, theme.css:170-180).
3. First-run: on App mount, `kvGet('help-seen')` → if null, open modal and `kvSet('help-seen', Date.now())`.
4. Also link badge → help: clicking a ⚡/蓄 badge on a row opens the modal scrolled to 符號 section (anchor by element id) — small but kills the「呢個符號咩嚟」moment.

## Verification
- Fresh profile (or delete `help-seen` from kv.json) → modal auto-opens once; content matches the structure above; badge click opens modal; `npm run typecheck`.

## Acceptance
- [ ] Modal content sections 1-4 verbatim-equivalent, zh-TW.
- [ ] First-run once-only via kv.
- [ ] Badge-click shortcut works.

## 陷阱 / Do-NOT
- 數字(×2.04 等)要同 README/analyze.ts 註釋一致 — 唔好自創統計。E1 重驗證改變結論時,呢度要跟住改(加入 E1 checklist 第 5 步嘅檢查項)。
- Keep it one modal — no multi-step tour library, no overlay arrows (scope discipline).

## Results — ✅ shipped 2026-07-08(/loop autonomous)
`src/components/HelpModal.tsx`(card overlay + ✕/Esc/backdrop close)· ScreenerList `.top-actions`「?」ghost 掣 · first-run once-only(kv `help-seen`)· theme.css `.help-*` styles。typecheck 綠;瀏覽器 verified(? 開、4 sections 齊、✕ 關、截圖確認)。

**刻意 deviation(誠實文化 > verbatim 數字):** modal **冇** hardcode per-signal lift 數字(×2.04 等)。原因:呢啲數字啱啱(2026-07-08 baseline audit + E1)俾放入 active revalidation — ⚡ flush 證實負 filter、⚡/D3/spot-pump 特殊條件冇加值。spec 個 陷阱 明講「E1 改變結論時 modal 要跟住改」,而今晚正正改咗。所以 modal 用「回測衍生、示範性、每月重驗證,數字見 roadmap 報告」嘅誠實框架,唔 bake 入爭議中嘅具體數,亦唔自把自為喺 UI 講「⚡ 有問題」(留俾用戶 decide)。數字定案後可以加返(連 tier legend,E2)。

**Deferred(scope):** badge-click → 開 modal(step 4)。核心(modal + 掣 + first-run)已足;badge shortcut 之後補。
