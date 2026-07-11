# Baseline audit — unconditional lift inflates every breakout detector (2026-07-08)

**來源**:S14 對抗式覆核揭發「unconditional baseline 會虛高任何 location/geometry-conditioned detector」。順藤摸瓜查埋已 ship 嘅 ⚡/增/擴,發現同一個病。**呢個係 methodology finding,唔係即刻降 ship 嘅指令 — flag 俾用戶 + E1/E5。**

## 做咗乜
`backtest.ts` 加 `--matched`:baseline 唔再係「所有 bar」,而係「**收破 24h 高 + volZ≥volz**」嘅 bar(⚡/增/擴 共用嘅突破 geometry,冇任何 OI condition)。咁樣 lift 就量到 detector 嘅 **OI condition 喺「突破」之上加咗幾多增量**,而唔係連突破本身嘅 geometry 一齊袋。

## 結果(150 小型幣 v5,+15%/24h)

| detector | OI 條件 | unconditional lift | **state-matched lift** | 突破命中率改善 |
|---|---|---|---|---|
| 「收破高帶量」本身 | — | (基準) | 22.9%/22.8% hit(= ×2.2 over 10.4% 隨機)| — |
| **擴** virgin V2 | OI 擴張、零 flush | ×3.11 | **×1.41** | 22.9% → 32.3%(+9.4pp,實在)|
| **增** rebuild R1 | OI 縮完重建 | ×2.64 | **×1.20** | 22.9% → 27.4%(+4.5pp,邊際)|
| **⚡** flushBreakout | OI 仍 flushed | ×1.30 | ×0.59* | 22.8% → 13.5%(**負** — flush 揀到差嘅突破)|

\* ⚡ 破嘅係 close-based base-high、`--matched` 用 high-based 24h-high,ⓘ ⚡ 唔係 brokeHigh24OnVol 嚴格子集,所以 ×0.59 係近似;方向(flush 條件拖低突破質素)同 E1 ⚡ ×2.04→×1.28 轉弱一致。增/擴 嘅 matched 係乾淨嘅(佢哋字面上就係 `close>hi24 & volZ`)。

## 誠實解讀(兩個 lift 都有效,問唔同問題)
- **Unconditional lift**(×1.3-3.1):「值唔值得望呢隻幣 vs 隨機一刻?」→ 全部 YES。呢個係「surfacing/排序」價值,冇錯,但**大部分係『收破 24h 高帶量』呢個共用 geometry(~×2.2)**,唔係 detector 獨有嘅 OI 條件。
- **State-matched lift**(擴 ×1.41 / 增 ×1.20 / ⚡ ×0.59):「OI 條件喺一眾突破入面揀得好唔好?」→ **擴 有實在增量(+9.4pp),增 邊際(+4.5pp),⚡ 負(flush 揀到較差突破)**。
- 排序合理:**OI 擴張(擴)> OI 重建(增)> 突破平均 > OI flushed(⚡)**。OI 條件真係有分辨力、方向啱,但**增量幅度細**,而 ⚡ 嘅 flush 係反向 filter。

## 對「偵測更早」嘅意義
突破 geometry(~×2.2)先係真.workhorse;OI 條件只係細修飾。**S14 想喺突破之前 fire → 丟咗個 workhorse,淨返弱增量(×1.03-1.10)**,正正解釋到點解 pre-breakout detection 咁難。要贏,新訊號要證明喺 state-matched baseline 上有增量,唔係喺 unconditional 上靚。

## 建議(唔自動執行 — 用戶/E1/E5 decide)
1. **E1 以後同時 report unconditional + matched lift**;matched 先係「我個特殊條件有冇用」嘅誠實數字。
2. **E5 強度重校準**:唔好照 headline lift 加權;用 incremental(matched)edge。擴 > 增 排序可保留,但 ⚡ 嘅 flush 增量要覆核(可能係 negative)。
3. **唔建議即刻降 ⚡/增/擴 ship**:佢哋 unconditional 仍 net-positive(surfacing 有用),擴 matched ×1.41 實在。但 ⚡ 值得認真 E1 覆核(matched 負 + E1 ×1.28)。呢個係用戶級決定,同通知升班一樣要人手拍板。
4. `--matched` 已入 harness,隨時複核。

## 完整審計 — all detectors × targets(2026-07-08 補完,150 幣 v5,horizon 24)

state-matched 增量 lift(分母 = 收破 24h 高帶量,無 OI 條件),三個 target 一致:

| detector | uncond @10/15/20 | **matched @10/15/20** | 判定 |
|---|---|---|---|
| **擴 virgin V2** | ×2.45 / 3.11 / 3.57 | **×1.31 / 1.41 / 1.43** | **真.增量,穩定** — 全 suite 唯一清楚贏過 naive 突破 |
| **增 rebuild R1** | ×2.14 / 2.64 / 3.03 | ×1.15 / 1.20 / 1.21 | 邊際(啱啱過 ×1.15 floor) |
| **⚡ breakout** | ×0.97 / 1.30 / 1.38 | ×0.52 / 0.59 / 0.55\* | **負增量\*** — flush 揀到差過平均嘅突破 |
| **D3 squeeze** | ×1.29 / 1.32 / 1.44 | ×0.69 / 0.59 / 0.57\*\* | **負增量\*\*** — squeeze 突破跑輸 generic |
| **B2 boarding** | ×1.65 / 1.42 / 1.26 | **×1.89 / 1.73 / 1.99**\*\*\* | **真.增量(正面驚喜)** — 深跌(≥48-bar 跌穿 EMA50)後收復,beat generic EMA20 reclaim |
| **現貨帶動 spot-pump** | ×1.56 / 1.50 / 1.70 | **×0.86 / 0.71 / 0.66** | **負增量** — spot-vol/basis/oi 冇 beat「spot 幣升緊 2%」嘅 momentum |

**排序(誠實 incremental edge):B2(×1.7-2.0,真但樣本細)> 擴(×1.3-1.4,真穩)> 增(×1.2,邊際)> spot-pump(×0.7,負)≈ D3(×0.6,負)≈ ⚡(×0.5,負)。**

**淨結論 — 分化,唔係一竹篙,但一半 detector 嘅特殊條件冇加值:**
- **真.增量(keep):擴(OI 擴張)、B2(深跌收復)** — 機制唔同,兩個都實在。
- **邊際:增(OI 重建 ×1.2)。**
- **負增量(特殊條件冇 beat 底層 geometry,值得 review):⚡(flush)、D3(squeeze)、spot-pump(spot-led 論)。** 呢三個嘅 unconditional lift 全部係「底層 momentum/突破 geometry」貢獻,佢哋各自嘅「特殊論」喺 Binance 冇兌現。
- **共通教訓:大部分 detector 嘅 edge 係底層 geometry(突破帶量 / 升緊 / 收復),特殊條件多數係細修飾或反效果。E5 強度公式要用 incremental(matched)edge 加權,唔好當 headline lift 係 detector 本事。**

**重要 caveat(唔可以照住個表就降 detector):**
- \* **⚡ close-vs-high confound 已收乾淨(2026-07-08 補測 `--matched-close`)。** 用 ⚡ 自己嘅 close-based 24h 高做 matched baseline(= ⚡ 幾何減 flush),⚡ matched = **×0.53 / 0.60 / 0.57**,同 high-based ×0.52-0.59 **幾乎一樣**。即係定義錯配唔係解釋 → **flush 條件真係揀差突破:破 24h 收盤高帶量嘅 bar 中,OI 仍 flushed 嗰啲命中率(17%)大約係 generic 突破(33%)嘅一半。** confound-free,三 target 一致,兼夾 E1 ×1.28。**⚡ 「縮倉突破/quiet accumulation」核心假設喺 Binance 數據唔成立 — flush 係負 filter。**
- \*\* D3 破嘅係 setup-range 高(緊、近),`--matched` 用 24h 高 — 同樣唔完全 apples-to-apples。D3 本來 ship 就係 ×1.42 邊際。
- \*\*\* B2 用自己幾何做 matched(`emaReclaimOnVol`:EMA20 收復 + anti-chase + volZ,冇 48-below-EMA50 深跌條件)。matched ×1.7-2.0 = 深跌後收復真加值。但 **baseN 得 495(generic reclaim 稀有)+ signal n=68** → 方向可信,magnitude 噪,唔好當精確。
- 現貨帶動 spot-pump:用 `spotUpEnvelope`(spot 幣 ret4h≥2%,冇 spot-vol/basis/oi)做 matched — background 補數。
- 全部一窗(150 幣,~37d Binance,一個 regime)。matched baseline 係 sparse(baseN ~2500)。

## 「有幾遲」+ edge 兩維 — 建設性答案(2026-07-08 補)

`backtest.ts` 加咗 `runup`(entry vs 前 24h 低)+ 「captures = MFE-after / (runup-before + MFE-after)」= fire 嗰刻仲有幾多 % move 喺前面(越高越早)。target 15/h24,150 幣:

| detector | matched 增量 edge | run-up before | upside after | **captures(越高越早)** |
|---|---|---|---|---|
| **B2 boarding** | **×1.7-2.0** | 5% | 4% | **46%(最早)** |
| ⚡ breakout | ×0.5(負) | 6% | 4% | 40% |
| 擴 virgin | ×1.4 | 19% | 8% | 30%(最遲) |
| 增 rebuild | ×1.2 | 15% | 6% | 29% |

**排序穩健**(2026-07-08 驗證,5 個 target×horizon config 全部一致):B2 46-54% > ⚡ 40-45% > 擴 30-33% ≈ 增 29-38%。captures 對 target 不變(只隨 horizon 升),所以「B2 最早」唔係單一 config 假象。

**兩個發現:**
1. **全部 detector 都遲**(捉到 29-46% move)— 證實用戶「太遲」投訴。任何一個 fire 之前,54-71% move(由近低)已經行咗。冇 magic。
2. **B2 = 「更早 + 真 edge」sweet spot。** B2(深跌後收復)fire 得最早(捉 46%,run-up 前只 5%,因為佢買反彈接近底)**兼且** matched edge 最強(×1.7-2.0)。⚡ 都早(40%)但 flush 係負 filter。擴/增 edge 真/邊際但**fire 最遲**(捉 30%,要 OI 重建/擴張 + 破 24h 高,已經行咗一大截)。

**→ 對用戶「點樣早 D 入」嘅建設性答案:睇/加權 B2(深跌收復)多過 增/擴。** B2 買深跌反彈,倉位最早、edge 最實。代價:(a)接刀風險(買 dump 反彈);(b)樣本細(n=70)。想要「最實 edge」= 擴,但佢遲。⚡ 早但 flush 拖低質素。**冇一個完美,但 B2 係「更早」呢個目標下最好嗰個。**

### ⚠️ 但 B2 而家係 detail-only — 想做 LIVE alert 嘅 path(2026-07-08 測)

**點解 B2 detail-only:唔係純決定,係數據限制。** B2 要 **~100 1H bars(≈4 日)**——EMA50 warm(~50)+ 48-below-EMA50 + cross bar,`computeBoardingB2` 喺 `H < 100` 直接 return null(interpret.ts:556)。但 scan 得 48h(~48 1H bars)→ B2 只喺**詳情頁**(fetchLiveCoin 攞長 series)行,scan/recorder 行唔到 → **冇 badge、冇通知**。即係用戶「最早+有 edge」嗰個 detector 埋咗喺詳情頁,平時見唔到!

> **修正(2026-07-08 iter22):係 100 bars,唔係 25 日。** 之前寫「~25 日 1H」係誤導 —— 25 日只係 `fetchLiveCoin` **啱啱好** attach 嘅長度(limit 600),唔係 detector 需求。B2 個 lookback window 只係最後 100 bars。呢個令**所有** live path 都比原本寫嘅平:per-coin fetch 係 `limit=100`(Binance weight **1**),唔係 600-bar 大 pull。

**測試 scan-tier B2**(`backtest.ts --bd-scan`:EMA20 + N-below-EMA20,scan 48h 算得):
- frozen params(below24)matched ×1.52 / captures 48% → **有 edge 兼最早**。
- **但 robustness 敗**:below-window ±25% → below-18 塌到 **×0.92**(< baseline),below-30 ×1.49(n32 細)。volz 穩(×1.53-1.54)。below-window fragile = 照 IRON RULE **唔可以 ship**。
- meanRet 亦薄(+0.47% vs detail-tier +3.05%)。

**淨結論 + path 俾用戶(唔自動做):**
1. **detail-tier B2 穩健**(S7 shipped ×2.04 全 robust ≥×1.40)但**要 100 1H bars**。
2. **scan-tier B2(48h 快approximation)有 edge 但 robustness 敗** → 要再調 / 換 def 先過 gate。
3. 三條 path 去「LIVE 最早 alert」,由平到貴:
   - **(c) recordings warm-store —— 推薦,零 extra fetch(2026-07-08 iter22 新發現)。** Recordings 每 15-min slot 存每幣 `price`(idx1,recording.ts:14)。~4 日 recordings = ~400 slots/幣 → 逢第 4 個 slot(hour-aligned,slot=`floor(ts/15min)`)抽出 → **砌返 100 個 hourly closes**,recorder 側直接跑穩健 detail-tier B2,**唔使多做一個 live fetch**。正正係 OI warm-store 個 backfill pattern。Warmup ~4 日(或 recordings 已夠 4 日就即刻得)。**陷阱**:slot 有窿(幣唔喺某 sweep / recorder down)會搞亂 EMA → 要 forward-fill 或要求 ≥95% slot 覆蓋先信;呢個係 1H 重建近似(eval≠live 先例,同 ⚡/S2 一樣)。實作 = recorder 側算 B2 + 新 RecCoin idx(如 idx25 boardingB2Live)+ schema bump,**eval-first(IRON RULE),badge 後過 gate 先開**。
   - **(b) scan-tier deep-reclaim** —— 快但而家 robustness 敗(below-window fragile),要換 def 先過 gate。harness `--bd-scan` 已備。
   - **(a) per-sweep 1H fetch** —— 每幣 fetch `limit=100` 1H(weight 1,唔係之前寫嘅貴 600-pull),跑穩健 detail-tier B2。~528 幣 × weight 1 = ~528 weight/sweep extra(cap 2400/min,可行但食 budget)。比 (c) 貴,but 冇 4 日 warmup。

   三條都係用戶級決定(成本 vs 樣本細 n=70 vs 接刀風險)。**我建議 (c)** —— 零 fetch、用最穩嗰個 detector、只係要 recorder 側加邏輯 + 一次 schema bump。

**畀用戶嘅淨建議(唔自動執行):**
1. **擴 + B2 保留** — 兩個都有真.增量(擴 ×1.3-1.4 穩;B2 ×1.7-2.0 但樣本細)。全 suite 最實嘅兩個,機制唔同(OI 擴張 vs 深跌收復)。
2. **增 觀察** — OI-rebuild 增量邊際(×1.2),但仍 >1,unconditional 強,keep 住等 E1。
3. **⚡ — confound-free 證實 flush 係負 filter(高信心)。** 三個獨立證據:(a)close-based matched ×0.53-0.60(乾淨,flush 令命中率減半);(b)high-based matched ×0.52-0.59;(c)E1 unconditional ×2.04→×1.28。**⚡ 「flushed OI 時突破」嘅 edge 喺 Binance 唔存在,甚至反向。** 但 **降 ⚡ 係用戶級大決定**(flagship + A/B/C ⚡-only 係 T1 paper 時鐘可比性基礎),我唔自動降。畀用戶嘅選項:(i)降 ⚡ tier / 移走 flush 條件;(ii)⚡ 冇 flush = generic 突破(×2.2),但咁就同 增/擴 重疊;(iii)當 regime artifact,等 E1 多幾個窗確認先郁。**強烈建議用戶朝早睇呢個 finding。**
4. **D3 squeeze — 觀察偏負** — matched ×0.6(有 setup-vs-24h-high caveat),本來 ship 就邊際(×1.42)。想乾淨判要為 D3 整 setup-range-high envelope。
5. **spot-pump — 觀察偏負** — matched ×0.66-0.86(vs「spot 幣 ret4h≥2%」),spot-vol/basis/oi 冇加值。unconditional ×1.5-1.7 全係「spot 幣升緊」momentum。同 ⚡ 一樣要 review 特殊論。

## Caveats（原始 +15% 表）
- 單一窗(150 幣,近 37d Binance)。matched baseline 係 sparse event(baseN 2533 vs 120107),樣本夠但仍一個 regime。
- ⚡ 近似問題見上;想乾淨要為 ⚡ 整一個 close-based-basehigh 版 matched(留待,已列入建議)。
