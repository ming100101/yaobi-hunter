# Ignition study — 「偵測更早」嘅實測定案(EVAA → ignition detector → 6-skeptic 對抗驗證)

**日期**: 2026-07-08 · **性質**: 完整 backtest + 對抗驗證(6 skeptic panel,全部自己跑 harness 覆核)· **結果**: 唔 ship 任何 auto badge/通知(照 IRON RULE),但**有一個可行 deliverable**(ignition watchlist lane)+ 一個**精確定位嘅 open problem**
**Harness**: `scripts/backtest.ts` 加咗 `--mode ignition`(raw 1H pop ≥ignRet% ∧ volZ≥volz,冇 24h-high break / 冇 OI flush / 冇 base)+ `--dump-signals`(per-signal [runup%,mfe%] for conditional analysis)。全部 typecheck 綠。

## 起點:EVAA case 提出嘅假設

EVAA(2026-07-07,+136%/24h,+210% low→peak)靜默 grind 33h 後 07-07 09:00 raw 點火(+22.6%/h,vol 10×),嗰刻仲有 +84% 前面。假設:**fire 喺 raw 價+量點火 = 最早,早過 ⚡ flush / 擴增 OI 確認(佢哋結構上下游)。** 呢個 study 就係 backtest 呢個假設。

## 實測(single ~30d window, ~283 coins, 1H)

### Grid(target 15 / horizon 24,全部 --matched)
- **ign r5 v1.5**:n=795 · lift **×0.81** · captures 34% · runup 16.4% · meanRet +0.5%
- 加 ignRet(8/12/15/20/25)→ **fire 更遲**(captures 34%→21%,runup 16%→70%)兼 **蝕錢**(meanRet 掉到 −11~−14% = 買緊爆升 candle 嘅頂之後冧)
- 加 volz(到 z≥10)→ lift 死守 ×0.90,captures 31%,冇改善
- **REF ⚡ breakout**:captures 36% · lift ×0.37(flush = 負 filter,一致)
- **REF B2 boarding**:captures 44% · lift **×1.37** · meanRet +2.37%

### Robustness(target×horizon 9 cells,--matched)
- **B2**:lift **×1.37–1.94 全 9 cell** · captures 37–55% · meanRet 全正
- **ign r5**:lift **×0.70–0.86 全 9 cell(冇一個 >1)** · captures 28–40%(每個 cell 都低過 B2)· meanRet ~0
- 連 ign r1(任何細細 up-candle 帶量):captures 38%,lift ×0.85 —— **即係最早可能嘅 fire 都贏唔到 B2。**

### Conditional captures(按 eventual move = runup+mfe 分桶)
- **B2 幾乎淨係喺細 move fire**:114/123 fire 喺 <30% 桶;big 桶得 2,huge 桶 0。horizon 拉到 96h 都只係 2→5 big、huge 永遠 0 → **B2 結構上捉唔到大妖幣**(佢 anti-chase cap 排斥垂直爆拉)。
- **Ignition 會喺大 move fire**:71 big+huge(h96 更去到 135),但 raw detector 冇 aggregate lift。

## 6-skeptic 對抗驗證(全部 NUANCES,冇 FLIPS,冇 clean-SOUND)

每個 skeptic 自己跑 harness 覆核,結論係:**核心方向啱,但我初稿有兩個要修正嘅錯**。

1. **Bucketing 係 tautology(我初稿錯):** captures = 1 − runup/M,而 M 就係分桶軸 → 大桶 captures 高係數學必然,唔係「更早」嘅證據。Back-solve:ignition 喺大 move **其實 fire 得更遲**(絕對 lateness 11→31→59→72%)。**所以「ignition 喺大 move 更早 / EVAA 代表咗嗰桶」呢句要 DROP。** B2 少 fire 大 move **唔係** base-rate artifact(binomial p=0.0009)。
2. **B2 對大妖幣真係盲**(robust 跨 horizon;B2 top-MFE 幣同 ignition huge 幣零重疊)。措辭修正:B2 講「小-中 bounce detector」,big-桶 count 要標明 horizon。
3. **「冇 fire-time 分辨器」我講得太死:** causal OI-expansion gate(OI 6-bar 升 ≥X%)recover lift ×1.13→1.44、big-mover precision 7%→24-56%,robust。**但**每 notch 令 fire 更遲(runup 16%→54%)兼 medRet 負 → **OI 係滯後確認,唔係更早偵測**(正正係用戶「太遲」個病)。asymmetric payoff(正 skew)真但 pre-cost、靠 tail,唔 shippable。
4. **決定性 control:** 喺真.早(runup<15%)fire 嗰刻,big-rate 冧到 **0.6%(3/485)** vs runup≥15% 嘅 13.6%;runup 0-10% 帶 0.0% big。→ **當你真係早,冇任何 fire-time feature 分到「將會爆」定「小 wiggle」。「冇 free lunch」成立,而家精確定位喺決策邊界。** 唯一弱 prior:coin turnover(Q1 1.2%→Q4 12.8% big-rate,免費數據有)但唔 shippable(Q4 都 87% 唔 big)。
5. **冇 distorting bug。** runup 誠實(未收 pop candle 唔可以 fire;pre-pop open 入會 71% captures 但唔可實現)。「volume 幫倒忙」真(唔係 noise)。B2 +2.37% meanRet **係 tail/regime 脆**(top-3 幣 = 78% 利潤,中位 trade ~平)→ meanRet「edge」要 down-weight,但 B2 嘅 **lift + 95% 小-bounce 結構** 成立。
6. **(HIGH)Category error —— 最重要修正:** 用 aggregate lift 排 B2 vs ignition 係**錯**,佢哋 target **唔同嘅 move class**。Ignition 係**成個 research program 入面唯一 flag 到用戶想追嗰班大妖幣嘅嘢**(71 vs B2 嘅 2)。B2 嘅 ×1.37/+2.37% 全部賺喺 <30% bounce(用戶唔 care 嗰班)。Ignition 嘅 ×0.81 假設咗盲目 auto-entry,但用戶係**人 + phone screener**:per-fire 45.6% 到 ≥30%、1-in-11 到 ≥80%,~27 fire/日(~2.4 big/日)= 可用嘅低信心 **watchlist**,唔係 noise。**「unsolved」照做 = flag 零個大 mover = 維持現狀(「太遲 every time」),正正係用戶想逃離嗰個。**

## v3 定案(對抗驗證後)

**兩件事,要分開講:**

1. **Auto-entry 早入 = 證實做唔到(hard no,量到喺決策邊界)。** 喺真.早 fire 點(runup<15%),大妖幣可預測性冧到 0.6%。所有加 precision 嘅分辨器(OI expansion ×1.13-1.44)都係靠 **fire 更遲**(runup→54%)+ 負 carry 換返嚟。→ **你冇得 auto-trade 個 pump 喺佢真正起飛前。** 呢個係硬 no-free-lunch,而家有數據釘死喺決策邊界,唔係「未搵到」。

2. **但用戶唔係 auto-trade,係人睇 screener → 當 ALERT/watchlist 就有嘢做。** Ignition 係**唯一** flag 到大妖幣班(71 vs 2)兼**最早可 fire 嗰個 bar**。~2.4 big/日、1-in-11,係可用嘅「睇咗先決定」watchlist。B2 係好嘅**小-bounce** detector(唔係用戶目標)。

**Monday deliverable(建議,唔自動做):ignition WATCHLIST lane** —— raw +5% 帶量、低信心、人手二次過濾。**唔係** auto-entry、**唔係** notification-grade badge(×0.81 照 IRON RULE 禁止升通知)。B2 就照佢本身做半自動 entry 用(小-中 bounce)。

**Open problem(精確定位)→ iter24 已解,見下面 v4。** 有冇一個**人-proxy 二次 filter**(fresh high / 現貨帶動 / turnover)可以將大妖幣 base rate 由 8.9% 抬到 ~20-30% 而 fire ≤~5/日?

## v4 定案(iter24)—— 人-proxy 二次 filter 全部測完:**冇早期 filter,連 watchlist 個希望都證偽**

`--dump-signals` 加咗 fire-time features(symbol/t/freshHighH/turnoverUsdM/distE20/spotLead,全部 causal 喺 fire bar 計)。逐個 filter 測 + **控制 runup**(最關鍵):

**Raw filter scan(睇落有希望,但係陷阱):**
- turnover≥$50M → bigRate 8.9%**→23.4%**(×2.63)@4.5 fire/日;≥$100M→30.8%@2.5/日 —— **睇落好正**。
- freshHigh 弱(×1.3-1.8);**spotLead(現貨帶動)反而 HURTS(bigRate 6.4%,×0.72)** —— 大妖幣係 **perp-driven squeeze,唔係現貨帶動**,呢個假設對大 pump 死。得 28% 幣有現貨,對 perp-only 妖幣更加冇用。

**控制 runup(釘死係咪 lateness confound)—— 決定性:**
| runup band | overall bigRate | turn<50 | turn≥50 | turn≥100 |
|---|---|---|---|---|
| 0-10% | 0% | 0% | 0% | 0% |
| 10-20% | 2% | 2% | 2% | 5%(n21 噪) |
| 20-35% | 9% | 9% | 9% | 8% |
| 35-60% | 27% | **31%** | 24% | 24% |
| 60%+ | 71% | 25%(n4) | 77% | 80% |

**同一 runup band 入面,turnover 零分辨力**(2%=2%、9%=9%、35-60 band 高 turnover 仲 LOWER)。turnover 個「lift」100% 係因為佢揀到高-runup(更遲)嘅 fire,唔係預測。**全 feature 早段控制**(runup 0-15% 同 15-30%,即「更早」真正住嗰度):turnover / freshHigh / distE20 / spotLead **全部 flat**(0-15 band:所有 feature 1%/1%;15-30 band:~4%/~4%)。

**→ bigRate ≡ f(runup) —— 純粹係「已經升咗幾多」嘅函數。免費 1H feature set 入面,喺你真正早(runup<30%)嗰刻,冇任何 fire-time feature 分到「將會爆」定「wiggle」。呢個係 feature-level proof(控制咗 lateness),唔係「未搵到」。** 方法上乾淨:同一 runup band 入面「big」= 大嘅 **forward** MFE,所以呢個係真.forward 預測測試,唔係 tautology。

**v3 個「turnover watchlist」= 海市蜃樓。** 佢「準」淨係因為佢淨係揀已經 +30-45% 嘅幣(遲),唔係早。想準就一定遲,呢個 trade-off 冇得破。

### 咁「更早」到底有咩實質答案(唔係純負面)
1. **接受 coincident 偵測係物理極限。** 「pump 緊」呢個資訊,喺 price+volume 見到之前根本唔存在(feature-level 證實)。**破位帶量嗰一刻 = 任何人可以誠實 fire 嘅最早點。** 用戶期望「價升之前 fire」= 攞免費數據冇嘅資訊。
2. **但用戶「太遲 every time」有一部分係可修嘅 pipeline lag。** ⚡ 要 flush-reclaim geometry(中段先成形)+ 你 OI reconstruction 有 cold-path lag(記憶:ARX/EPIC)→ 你實際 fire 點喺 raw 破位**下游**。**實質改善 = 將 alert trigger 由 ⚡-flush/OI-確認 換做 raw ignition 破位(最早誠實點)+ 即時、齊全(唔好漏)。** 呢個唔會令你「pump 前」入到,但會刮返 pipeline 度嗰段可避免嘅遲。
3. **想要「可預測」= 去 B2 個 small-bounce class**(佢真係 predictable,×1.37),但嗰個唔係大妖幣。兩者只能二揀一:predictable-but-small(B2)vs big-but-only-coincident(ignition 破位)。

### Caveats(要老實)
1H bars;single 37d window。**iter25-26 補測咗 order-book microstructure + trade-level taker CVD(見下)** → 依家 price/vol/OI/spot/turnover/structure/**order-book depth/逐筆 taker flow** 全部 feature class 測晒。仲未測(genuine unknowns,唔係免費/易攞):full L2 queue dynamics、上新幣 metadata / 社交 / on-chain。所以精確講:「**喺所有測過嘅免費數據下**,大 pump 早期偵測證實做唔到」。

## v5(iter25)—— order-book microstructure(最後一個免費 frontier)測咗 → **null**

用 Binance Vision `bookDepth` dump(免費、±0.2-5% depth、~25s snapshot)。Pilot:**26 個「早 fire(runup 10-36)但變大 pump(eventual 80-163%)」嘅 fire**(呢 26 個係 runup<40 大 fire 嘅**全populations**,唔係 sample)+ 52 個 runup-matched 對照 dud。78/78 dump 全部攞到。逐個 fire 算 causal order-book feature(ignition bar 前一個鐘 + 最後 15 分鐘 approach):

| feature | BIG med | DUD med | AUC(big>dud) |
|---|---|---|---|
| preImbN(±1% bid-imbalance,前一小時) | 0.525 | 0.531 | 0.40 |
| preImbF(±5% imbalance) | 0.559 | 0.595 | 0.37 |
| apprImbN(最後 15min 近觸 imbalance) | 0.515 | 0.527 | 0.39 |
| ignImbF(ignition 小時 ±5%) | 0.541 | 0.564 | 0.35 |
| askPull(最後 15min 賣單縮/前段) | 0.976 | 0.947 | 0.53 |
| imbTrend(bid 壓力上升) | 0.003 | 0.013 | 0.46 |

**全部 AUC ≈ 0.35-0.53,冇一個 feature 顯示大-pump fire 有更 bullish 嘅 order book。** 兩個「≤0.38」係**倒轉**方向(大 fire 反而**輕微**冇咁 bid-heavy —— 弱、n細、唔係買訊號)。ask 冇縮(askPull ~0.95-0.98 兩邊)、imbalance 冇升趨勢差異。

**→ 定案:displayed order-book depth imbalance/thinning 喺 ignition 點對「將會爆大」冇 forward 分辨力(controlled on runup)。**

## v6(iter26)—— trade-level taker CVD(最後一個 flow frontier)測咗 → **null**,搜索完結

用 `/fapi/v1/aggTrades`(REST,windowed 到 ignition 前一個鐘,免費、逐筆)。同一 pilot,算 pre-ignition taker flow(`m=false`=taker buy):

| feature | BIG med | DUD med | AUC(big>dud) |
|---|---|---|---|
| buyRatio(taker 買佔比,前一小時) | 0.504 | 0.526 | 0.42 |
| cvdNorm(normalized CVD) | 0.008 | 0.052 | 0.42 |
| trend(approach 15min − early 30min 買壓) | −0.065 | −0.006 | 0.39 |

**全部 AUC 0.39-0.42,冇分辨(輕微倒轉,同 order-book 一致)。** 更關鍵:**~45% 大 fire 喺 pre-ignition 一小時得 <30 筆成交**(silent base,好似 EVAA 靜默 grind)→ 嗰啲根本冇 pre-pump flow 可以偵測,by construction 冇得早。usable 14 big / 21 dud(n細、噪,但方向同所有其他 null 一致)。

### 🏁 搜索完結 —— 免費數據所有 feature class 測晒
price/vol(1H)· OI · spot-lead · turnover · fresh-high/structure · **order-book depth** · **逐筆 taker CVD** —— 加埋之前 whale N=11、S14 5m。**冇一個喺早段(runup<30%)分到大 pump vs wiggle。** 「pump 前」偵測 = 攞免費數據冇嘅資訊,唔係調參。**下一步唔係再搵早訊號(搜索完結),係實作決定:**(A) alert 換去 raw ignition 破位刮 pipeline lag;(B) B2 live small-bounce(task_fe4924ac)。兩個都係用戶拍板。

### v7(iter28)—— cross-window 複製:核心 null 過第二個獨立窗/regime ✅
最大 caveat 係「single 37d 窗」。用 standalone script(唔掂 harness)喺**獨立早窗(~04-17→05-25,530 perp,972 fire,312 幣)**重跑同一 ignition 邏輯:

| 指標 | 主窗(06-06→07-08) | 第二窗(04-17→05-25) |
|---|---|---|
| captures% | 34% | **33%** |
| medRunup | 16.4% | **15.1%** |
| bigRate by runup band | 0/2/9/27/71% | **1/1/7/28/79%** |
| 早段(0-15/15-30)feature 分辨(turn/freshHigh/distE20) | 全 flat | **全 flat**(turn 1%=1%、4%=4%) |

**`bigRate ≡ f(runup)` 同「早段冇 fire-time feature 分到大 pump」兩個 load-bearing 結論喺兩個獨立 regime 都成立 → 唔係單窗 artifact。** distE20 喺 15-30 band 有個細 wobble(2%/7%,n小)= 老 lateness confound,兩窗一致,唔係早訊號。**Limits(縮窄後):** 依然係 free 1H/microstructure(full-L2 queue / metadata / 社交 / on-chain 未掂);兩窗都係 2026 同一年,冇跨年/跨大 bull-bear。但兩個獨立窗 + 6+ 條 feature-class null,結論好穩。

## ⭐ v8(iter29)—— 用戶「⚡ 太遲」投訴嘅**真.答案**(6-skeptic 驗證 + 自己覆核)

追問「⚡ fire 嘅 timing」時撞到一個更根本嘅嘢,經 6-skeptic panel + 親自 harness 覆核:

**1. ⚡ 唔係「太遲」—— 係喺大妖幣身上「靜咗」(categorically SILENT)。** 38 個大 pump 幣(eventual≥80%,detector-agnostic denominator 覆核過一樣),⚡ fires-on 10/38(26%),但**有 forward upside 嗰啲得 1/38(3%)**;喺 ≥80% target,⚡ sigHit = 0.0000。即係大妖幣爆嗰陣,⚡ 多數**根本冇 fire**。

**2. 但你冇 miss 佢哋 —— 你個 app 已經捉緊(擴/增,唔係 ⚡)。** 親自覆核每個 shipped detector 對呢 38 個大 pump 嘅覆蓋:

| detector | fires-on | catches-with-forward-upside |
|---|---|---|
| ⚡ breakout(縮倉+蓄勢) | 10/38(26%) | **1/38(3%)** 靜 |
| 增 rebuild-R1(×2.60) | 32/38(84%) | 14/38(37%) |
| **擴 virgin-V2(×2.76)** | **37/38(97%)** | **30/38(79%)** |
| **增 ∪ 擴** | **37/38(97%)** | (只 miss SIREN) |

**擴(rising-OI 無-tight-base 突破)一個就 fire-on 97%、有 forward upside 79%,而且係 badged + 高精度(×2.76)。大妖幣覆蓋根本已經 solved,靠擴/增。**

**3. 機制修正(推翻通宵一個 belief)—— iter30 親自 decomposition 確認 ✅:** ⚡ 排斥大 pump + 拖負 lift 嘅係 **tight-base(蓄勢 ≤6%/24h)gate**,**唔係 flush**。親跑 matched decomposition(inflect+funding OFF,只變 flush/base,baseline = plain breakout;robust 過 target 10/15/20):

| config | lift(t15) | 覆蓋 fires |
|---|---|---|
| flush-only(flush8, wide base) | **×1.07**(微正) | 595 |
| tight-base-only(no flush, base6) | **×0.40**(強負) | 1852 |
| ⚡(flush + tight-base) | ×0.49 | 297 |

**flush 係微正(×1.07),tight-base 先係 ×0.5 個 negative filter。** 之前通宵講「flush 係 negative filter」係 **misattribute**,而家親自證實。**可行 implication:一個「flush 但冇 tight-base」版本嘅 ⚡ 會同時更準(×1.07 vs ×0.49)兼捉多 2×(595 vs 297 fire)** —— 即係 drop tight-base gate 就直接改善 ⚡ 對大 pump 嘅覆蓋 + 精度。但 ⚡ 係 T1 paper 時鐘基礎,郁佢斷 A/B/C comparability → **用戶拍板**(呢個係目前最具體嘅 ⚡ 改善建議)。

### → 真.可行答案(修正咗我初稿嘅兩個錯)
- **大妖幣睇擴/增,唔好淨睇 ⚡。** 你「太遲 every time」大機會係盯住 ⚡(佢對大 pump 靜),但擴/增 其實 fire 緊(97%)。可能係 UI/注意力問題多過 detector 問題。
- **⭐ 而且擴/增 fire 喺大 pump 嗰陣,一半個(巨大)move 仲喺前面 —— 唔係「太遲」!** iter31 量度 captures% ON 大-pump catches:**擴 captures 49%(medRunup 60%,medMfe 仲有 +57%)· 增 captures 62%(medMfe +74%)· ignition 57%**。即係擴/增 fire 落大妖幣嗰刻,通常仲有 +57-74% 升幅喺前面 —— genuinely actionable。(aggregate captures ~30% 係俾細 move 拉低;大 pump 因為 move 大,絕對前路多。)**所以「換去睇擴/增」係實質解決方案,唔係搪塞:佢哋捉到大 pump 兼且捉得夠早(一半前面)。**
- **擴/增 已經係最早誠實點。** 佢哋 fire 喺 breakout-on-volume(captures ~30%),而「早過呢個」成個 study 證實做唔到。所以就算擴/增 都覺「遲」= 垂直 pump 嘅本質,唔係 detector 壞。
- **⚡ 嘅 tight-base gate 值得 review:** 佢令 ⚡ 對大 pump 盲,而且 matched lift ≤1(拖負)。但 ⚡ 係 flagship + T1 paper 時鐘基礎,郁佢會斷 A/B/C comparability → 用戶級決定,唔自動郁。
- **我初稿(v4-v6)講「加 raw-ignition lane」係 over-engineered:** ignition = 22/日 firehose、1-in-11、冇 in-day ranker(≈ 睇 gainers tab),而且擴/增 已經覆蓋。**唔使加 lane。**

### 全 suite detector map(iter32)—— 每個 detector 實際捉乜(38 大 pump 為準)
| detector | fires | catch-fwd(大 pump 有前路) | captures%(大 pump) | 角色 |
|---|---|---|---|---|
| **擴 virgin-V2** | 511 | **30/38(79%)** | 49% | **大妖幣主力**(覆蓋最闊) |
| **增 rebuild-R1** | 386 | 14/38(37%) | **62%** | 大妖幣,更早但較窄 |
| D3 squeeze | 1435 | 16/38(42%) | 63% | 早但**嘈**(1435 fire) |
| 現貨帶動 spot | 992 | 9/38(24%) | 86%(n細) | 受現貨覆蓋限制 |
| **B2 boarding** | 123 | 2/38(5%) | 93% | **細 bounce**(好早,但唔捉大 pump) |
| **⚡ breakout** | 124 | **1/38(3%)** | (n=1) | 對大 pump 靜(niche 縮倉 setup) |

**Map 淨結論:大妖幣 → 睇擴(闊)+ 增(早);細 bounce → B2;D3 早但嘈;⚡ 對大 pump 基本靜。** 增 比擴 fire 得早(captures 62% vs 49%)但窄(37% vs 79%)→ **睇埋兩個最好**(增 捉早嗰啲,擴 捉闊)。

## 保留低嘅 harness 資產
- `--mode ignition`(+ `--ign-ret`)、`--dump-signals`(iter24 加咗 per-signal fire-time features:sym/t/runup/mfe/freshHighH/turnoverUsdM/distE20/spotLead,全 causal):validated,可重用。
- ⚠️ **技術債:`scripts/backtest.ts` 而家係 de-typed reconstruction**(header comment 有解:之前 accidental `git checkout` clobber 咗 uncommitted typed source,由 built .mjs 砌返)。邏輯 byte-faithful(B2 ×1.38 / ignition 799 覆核過),tsc 過(esbuild strip types),但**冇晒 TypeScript 類型**。將來要 re-type 返先有 type safety。iter24 嘅 edit 照 de-typed style 寫。

## Caveats
Single ~30d window(一個 regime);signals 按幣 cluster;MFE 用 intra-bar high(樂觀 vs 真 fill,冇費用)。所有結論係「呢個窗 + 免費 1H 數據」下嘅,方向強(6 個獨立 skeptic 自跑覆核一致),但 magnitude 有噪。**零 code ship 去 production,零假訊號上 phone。**
