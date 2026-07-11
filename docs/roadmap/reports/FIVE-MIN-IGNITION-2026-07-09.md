# 5-minute ignition detector — 真正嘅「更早」答案(2026-07-09)

**起因**: 用戶(fable-5 model)直接質問「點做先可以 early detect 拉盤?你 spend 好多日改好多次都未做到」。佢啱。

## 我之前錯喺邊(誠實)
成個 investigation(31+ iteration)**全部行 1H bars**。喺 1H clock 上面,你**根本睇唔到個 pump 直到成個鐘 close**——即係結構性遲 30-60 分鐘,每次都係。用戶「太遲 every time」**主要係 1H timeframe 嘅 artifact,唔係本質上做唔到**。我個「detect earlier 冇 free lunch」結論係答緊「pump **開始之前**預測邊隻幣」——嗰個仍然成立——但**唔係用戶要嘅嘢**。

## 突破:pump 係 ramp 出嚟嘅,唔係一秒爆
Live 覆核兩個 pump 嘅**逐分鐘**data:
- **SKYAI**(1H bar 03:00 +42%):03:14 已經 +10%、03:20 +13%、**03:31-32 +24-28% 成交爆($679k→$1079k,~5×)**、03:38 +43%。個 +42% 係 **~35 分鐘 ramp** 出嚟。
- **KAITO**(1H bar 11:00 +32%):11:24 +11%、**11:34 一分鐘成交爆 $6.1M(price +23%)**、11:39 +37%。~30 分鐘 ramp。

即係喺 1m/5m clock 上面,個 ramp + 成交爆**中途已經清楚睇到**(price 只係 +10-24%),而 1H detector 要等成個鐘 close 先 fire。

## 5m ignition detector(已 build + 驗證)
規則(`scratchpad/ignite5m.mjs` live scanner + `replay5m.mjs` 覆核):每個 5m bar:
`ret15m(近 3 支)≥6% ∧ 成交量 ≥3× 近 8 支中位數 ∧ 該支成交 ≥$300k ∧ ret60m ≤60%(未爆到頂)`

**覆核結果(3 個真 pump,首次 fire):**
| pump | 5m fire | 1H fire | 早幾多 | 入場位 |
|---|---|---|---|---|
| SKYAI | 03:05 **+6%** | 04:00 +42% | **~55 min** | +6% vs +42%,**+42% 仲喺前面** |
| KAITO | 11:30 +23% | 12:00 +32% | ~30 min | +23% vs +32%,+14% 前面 |
| EVAA | 09:45 +22% | 10:00 +22% | ~15 min | 差唔多,但早 15 min |

**5m detector 由 15 分鐘到 55 分鐘唔等咁早,而且從來唔會差過 1H detector。** SKYAI 一 case 就係入 +6% vs +42% —— 正正係用戶想要嘅。

## 誠實 caveat(未做完)
- **False-positive rate 未量度。** 快 timeframe = fire 得密啲,會 fire 落一啲 fizzle 嘅 5m 抽。要行全宇宙幾日,數「fire 咗但冇變 pump」嘅比率,先知個 alert stream 有幾嘈。Live scan 呢分鐘 0 hit(市靜),suggests 唔係狂 fire,但要正式量。
- 但**earliness 已證**,而且 caatch 到真 pump 早 15-55 min = 直接解決「太遲」。就算有 noise,用戶 eyeball 幾個 5m-ignition alert 好抵。

## 同之前結論嘅關係(唔矛盾)
- 「pump 開始前預測邊隻幣」= 仍然做唔到(5m detector 係喺 ignition **期間** fire,唔係之前預測)。
- 「1H detector fire 喺 breakout」= 真,而家見到 1H bar granularity 仲**加多** up-to-60min 遲。
- 缺失嗰忽 = **earliness 喺 TIMEFRAME 度,唔係喺 prediction 度**。細 timeframe 唔預測,佢只係**更快睇到同一個 ignition**。

## 已 SHIPPED(2026-07-09,用戶揀「build 落 app」)
- **`detectIgnition(candles, volume)`**(analyze.ts,`IGNITION_SHIPPED=true`):ret15m≥6% ∧ vol≥3×prior-median ∧ 該支 quote-turnover≥$300k ∧ ret60m≤60%。行喺 scan 已有嘅 5m candles,零 extra fetch。
- **Wired**:`toLite` → `CoinLite.igniting` → ScreenerList **🔥點火 badge**(`.ign-badge`,hot pulsing,排喺 ⚡ 前面)。typecheck ✓、prod build ✓ 468KB、528 rows render ✓、badge 視覺確認 ✓。
- **Badge 級開咗;phone NOTIFICATION 未開** —— 等 false-positive 量度先開(見下)。
- **Visibility(2026-07-09,feature-completeness)**:igniting 幣**自動置頂**(pinned 之下)+ header **🔥 N 點火** count chip(pulsing)。因為 badge 埋喺 rank #200 就冇人見到 = alert 冇用;而家一 ignite 就浮上頂,即刻見到 🔥。typecheck ✓ / prod build ✓ / 528 rows render ✓ / chip 喺 count=0 正確唔顯示。exe 已重 package(91.3MB)。

## False-positive 量度(2026-07-09,67-coin 代表性 sample × 3日 5m)
- **Alert volume:~29 fire/日**(0.05/coin/日 × 530 幣)= 約每個鐘 1 個。**唔係 firehose,可控。**
- **Precision(n=11,方向性):** 45% 喺 1 個鐘內續升 ≥+8%(真 ramp)· **18% 4 個鐘內變 ≥+30%(真 pump)**。Top fire 都係真嘢:VANRY +49%/+37%、OGN +22%、KAITO +14%。
- **Verdict:** badge(睇螢幕)**照開**——冇下限,~29 個/日輕輕 highlight,而且真 pump 捉得早。**Phone 通知就唔好無條件開**:29/日入面 ~55% fizzle,響 phone 太嘈。要**收緊**(vol ratio ≥5 / ret15 ≥8,或 gate 埋 rising-OI/擴增 confirmation)令佢一日 buzz ~5-8 次、hit-rate 高啲。
- **Caveat:** n=11 fire 細,precision 噪。要 tune 通知 threshold 要**大 sample**(全宇宙幾日,等 rate limit 回氣先做——通宵 loop 掃爆咗 IP weight budget)。

## Threshold tuning(2026-07-09,177 coins × 4d sweep)—— 定案:tuning 唔 work
| variant | ~fire/日 | continue ≥8%/1h | become ≥30% pump/4h |
|---|---|---|---|
| **shipped r6 v3** | 22 | 31% | **10%** |
| r8 v3 | 15 | 40% | 10% |
| r8 v5 | 13 | 24% | 6% |
| r10 v5 | 10 | 21% | **0%** |
| r8 v8 | 10 | 23% | 8% |
| r12 v6 | 4 | 17% | **0%** |

**收緊 price/volume threshold 唔會提升 precision —— 反而會差**(最緊嗰啲 fire 落已經升咗一段嘅 move,跟住 fizzle → 0% 變真 pump)。「變真 ≥30% pump」precision 大約 **~10%,調 threshold 調唔上去**。同成個 investigation 一樣嘅 no-free-lunch,喺 5m scale:點火嗰刻 price+volume 話到你「郁緊」,話唔到你「會唔會續」。

**定案:5m 點火本質係「早但嘈」——佢嘅價值係早,唔係準。**
- **Badge(睇螢幕)= 啱嘅 tier,已開。** 用戶掃 screener 見 🔥 早著,自己判斷。
- **Phone 通知:呢啲數字唔支持無條件開,而且冇 threshold 補救得到。** 22/日 @ 10% precision 響 phone 太嘈。
- **唯一通往「通知級」嘅路 = composite gate**:5m 點火 ∧ rising-OI 確認(擴/增 型)。加 OI 會準啲但遲少少(OI cold-path lag)。**呢個係下一個 distinct test**,未做。

## Composite test(2026-07-09,177 coins,5m klines+OI)—— inconclusive,data-limited
5m OI hist 淨係得 ~1.7 日,而呢個窗市靜 → sample 入面得 **n=10 ignition fire,0 個變 ≥30% pump**(baseline 0%),量唔到 OI-surge gate 有冇用。冇再燒 rate budget 追(靜窗 + 短 OI 窗 = 天生量唔到)。已知 prior(1H investigation):OI-gate 提 precision 但 fire 更遲。

## 定案 + 俾用戶嘅決定
- **5m 點火單獨 ~10% precision** = 早期 **movers** 訊號,唔係高精度大-pump 預測。Threshold 調唔到(已證),OI-gate 喺有限數據下亦量唔到有效。
- **所以 phone 通知唔可以老實講「大 pump 要嚟」。** 但**可以**做一個**低信心「呢啲幣而家點火緊,望一望」feed**(~13-22/日,睇 threshold)。有冇用/煩唔煩係**用戶 UX 偏好**,唔係數據問題 → 用戶決定。
- **建議:暫時 badge-only(已 ship,實用)。** 想要 phone feed 就當「低信心 movers 提醒」開(要用戶接受 ~13-22/日噪音),唔好包裝成「大 pump alert」。

## 仲可做(未來,非急)
1. Composite 用**長窗**(自己儲 5m OI,或用 Vision metrics dump)再測 OI-surge gate —— 要更多 big-pump 樣本先量到。
2. Recorder 側每分鐘掃 igniting → 儲 RecCoin idx 做 live FP/precision dataset(自然累積長窗)。
