# Historical evidence remediation — 2026 H1

- Discovery：2026-01、2026-02、2026-03
- Validation：2026-04、2026-05、2026-06
- 失敗項目：30；角色修正：7；真正 entry candidates：23
- Validation pass：2；validation fail：0；train 無候選：21

## 規則

- 原 H1 audit 同失敗分類保持不變；v2 係新研究 cohort。
- 只使用 decision timestamp 已完成 bar、as-of OI／funding 同當時 BTC regime。
- 五個 broad hypotheses 預先固定；2026-01 至 03 只用作 discovery，2026-04 至 06 只驗證一次。
- Validation 失敗後不得再用同一 H1 validation months 調門檻。
- Ranking、control、setup 不再錯當獨立 entry strategy。

## 結果

| 項目 | 角色 | 狀態 | 選定 filter | Train | Validation | 建議 |
|---|---|---|---|---|---|---|
| ⚡ 縮倉突破 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| 蓄 早期累積 setup | `setup` | `role-corrected` | — | — | — | 保留 setup／armed evidence，等獨立 confirmation。 |
| D3 squeeze breakout | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| B2 EMA20 reclaim | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| R1 增倉突破 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| R2 淨增倉 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| R3 funding-cap rebuild | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| V1 處女擴張 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| V2 處女增倉突破 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| V3 funding-cap virgin | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S10 T1 雙頂拒絕 | `entry` | `validation-pass` | reversal-confirmed | 39 events · 1.48× · 2.46% | 48 events · 1.63× · 2.90% · 2/3 月 | 只加入 v2 shadow cohort；仍需 forward confirmation，唔開 badge／TG／paper。 |
| S10 T2 新高背離 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S10 T3 climax rejection | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S10 T4 funding stall | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S11 W1 雙底 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S11 W2 spring | `entry` | `validation-pass` | uncrowded-trend | 86 events · 1.57× · 0.71% | 73 events · 1.69× · 2.23% · 3/3 月 | 只加入 v2 shadow cohort；仍需 forward confirmation，唔開 badge／TG／paper。 |
| S11 W3 OI-confirmed | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S14 early pump | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| Spot pump | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| Spot accumulation | `setup` | `role-corrected` | — | — | — | 保留 setup／armed evidence，等獨立 confirmation。 |
| Leverage froth control | `control` | `role-corrected` | — | — | — | 保留作 veto／baseline。 |
| UMM EMA20 reclaim control | `control` | `role-corrected` | — | — | — | 保留作 veto／baseline。 |
| UMM B2 | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| UMM B2 quantity-OI challenger | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| S15 deep reclaim quantity-OI armed | `setup` | `role-corrected` | — | — | — | 保留 setup／armed evidence，等獨立 confirmation。 |
| S15 deep reclaim confirmed | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| Entry-watch R1 breakout retest | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| Entry-watch V2 breakout retest | `entry` | `no-train-candidate` | — | — | — | 固定 v2 hypotheses 喺 discovery 已不足；維持退休。 |
| Strength ≥70 crossing | `ranking` | `role-corrected` | — | — | — | 保留排序用途，禁止當 entry。 |
| 全市場 Top 10 entry | `ranking` | `role-corrected` | — | — | — | 保留排序用途，禁止當 entry。 |

## 邊界

- 任何 validation-pass 只可進入 shadow cohort，唔會自動重開 live surface。
- Telegram delivery、runtime selection、paper fill 同真實 slippage 仍然只可 forward 記錄。
- 本研究唔會覆寫 immutable H1 audit，亦唔會清除原 detector recordings。
