# E2 — 訊號升降班制度:tier 規則 + 點樣喺 code 度反映

**層級**: 第5層 自我進化 · **工作量**: S · **依賴**: E1 報告開始有(≥2 個月數據)

## zh-HK TL;DR
訊號分三個 tier:**live**(有 badge、有通知、模擬盤會開倉)、**watchlist**(細 badge、無通知,例如而家嘅 蓄)、**retired**(照計照記錄,UI 唔顯示)。每月按 E1 數據用固定 rules 升降班,rules 寫死喺呢度,唔准每月即興。

## Tier rules (fixed)
| 動作 | 條件(全部要成立) |
|---|---|
| 升上/留喺 **live** | trailing-60d eval-rec lift(24h, target 10%)≥ ×1.3;events ≥ 20;M1 有數據時該訊號開倉淨 P&L ≥ 0 |
| 降去 **watchlist** | lift < ×1.15 連續兩個月報告,或 paper P&L 明顯負(< −2R/月 連續兩月) |
| 降去 **retired** | lift < ×1.0 連續兩個月,或 events 長期 < 5/月(訊號死咗) |
| watchlist → live | 同「升上 live」條件,另加robustness:兩個唔同 target(10%/15%)都 ≥ ×1.25 |
| retired → watchlist | lift 回到 ≥ ×1.2 兩個月 |

新 detector(S2/S4 系列)出生即 **recording-only**(連 watchlist 都唔係),先過 backtest gate(S2 準則)入 watchlist,再行上表入 live。

## Code representation (implement once)
`src/lib/signalTiers.ts`:
```ts
export type SignalTier = 'live' | 'watchlist' | 'retired' | 'recording';
export const SIGNAL_TIERS: Record<string, SignalTier> = {
  flushBreakout: 'live',      // ⚡ — ×2.04 backtest, README:53
  earlyAccum: 'watchlist',    // 蓄 — ×1.03-1.24, README:55-57
  // S2/S4 detectors register here as they land, starting 'recording'
};
```
Consumers switch on tier: screener badge rendering (`ScreenerList.tsx`), notify paths (`notify.ts`, R2 helper — only `live` notifies), M1 paper open rule (only `live` opens positions), insight priority (watchlist → info tone only). Each月 E2 change = a one-line PR editing this map, citing the E1 report.

## Steps
1. Create `signalTiers.ts` with the current two entries.
2. Refactor the four consumer sites to read the map instead of hardcoding (search for `flushBreakout` usages in UI/notify/paper).
3. Add tier legend to the U3 help modal content (「⚡ 實戰級 / 蓄 觀察級」).

## Acceptance
- [ ] Tier map is the single switch — demoting ⚡ to watchlist in a scratch edit removes its notification + paper-open in one line.
- [ ] Monthly tier changes traceable: map edits reference REPORT-YYYY-MM.

## 陷阱 / Do-NOT
- Rules change = edit THIS spec first, with reasoning — never adjust thresholds ad-hoc in a monthly review.
- 降班唔刪 code — retired signals keep computing + recording (免費數據,可能翻生)。
