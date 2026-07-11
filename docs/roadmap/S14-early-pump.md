# S14 — 早期拉盤 initiation(backtest-gated)

**層級**: 第2層 訊號擴張 · **工作量**: M · **依賴**: R1、S4d(lead 指標)· **來源**: 2026-07-08 /loop 用戶投訴「⚡ 每次 fire 價已升,太遲」

> ## ⚠️ 2026-07-08 大幅下修 → recording-only(badge/通知 OFF)
> 6-agent 對抗式覆核(wf_d905ce0e-c65)否決咗原本嘅強 claim。**原「×1.73、勝 ⚡、早 6.5h」大部分係假象:**
> - **baseline 唔 state-matched(FLAW/high)**:×1.73 對嘅係 unconditional baseline。用 state-matched baseline(同樣 upper-range/貼高 geometry,但冇 volume trigger),真.**增量 lift 只有 ×1.03-1.10**。~95% 嘅「edge」係「揀啲已經貼近高位、上緊嘅幣」呢個 geometry,唔係 microstructure 預測力。crypto-only headline ×1.60 vs ×1.42。
> - **lead 6.5h 係 24h 窗假象(FLAW/high)**:null 率已經 37.7%,44% 只係 ×1.17 ambient;要求同一個 move(價冇跌穿 entry)confirm 率跌到 8.6%、中位 lead 塌到 **~1.2h**。
> - **expectancy ~0(FLAW/high)**:meanMFE 6.3% 係 peak-excursion 唔係利潤;median retH **−0.63%**,真實 +10/−5 TP/SL 計費後 **−0.38%/單**,正 mean 靠 1-3 隻 outlier(BEAT 一隻 = 89% grand total)。**係 ranking filter,唔係進場 edge。**
> - lookahead **冇問題**(HOLDS,leak-sensitivity + causality control 驗過);survivorship 細 caveat(21% 係代幣化股票,拉高 ratio);overfit 重跑 reproduces 但我**測錯 robustness 旋鈕**(测咗 inert 嘅 below-high-MAX,漏咗 load-bearing 嘅 below-high-MIN;全鬆角落 ×1.20)。
> **結論:唔過誠實 gate(×1.61 selection-noise 先例)。`EARLY_PUMP_SHIPPED=false`,冇 badge、冇通知。detectEarlyPump 仍計 + 錄(idx24),留俾 corrected(state-matched)重測。詳見底部「對抗式覆核」。**

## zh-HK TL;DR
⚡ = breakout confirmation,要 `close > 24h base high`,定義上係「已經升穿阻力先響」→ 太遲(S4d 量到:⚡ fire 之後 0/43 仲升到 +10%,lead 無得計)。S14 喺**突破之前**捉拉盤 initiation:價喺 24h 區間上半、貼近但未破高、第一腳放量、升緊但唔垂直。5m Vision harness 實測:**lift ×1.73(vs ⚡-breakout ref ×1.38),中位早 ⚡ 6.5 鐘 fire,meanMFE 更高**,而且過齊三關(robustness / 增量 ablation)+ 兩個月各自企穩。呢個係「更早偵測」嘅實證答案。

## Detector 定義(凍結 — 同 backtest5m `signalEarlyAt` 一致)
5m bar i(需 i≥289):
- `hi24,lo24` = 前 24h(288 bars,不含當前)最高 high / 最低 low。
- **未破高**:`below% = (hi24/close − 1)×100 ∈ [2, 12]`(價喺高位下方 2-12%,仲未突破)。
- **markup 半區**:`pos = (close−lo24)/(hi24−lo24) ≥ 0.5`(上半,離開咗 base 底)。
- **升緊**:`close > close[i−12]`(過去 1 鐘上)。
- **anti-chase**:`ret4 = (close/close[i−4]−1)×100 ∈ (0, 5]`(升但唔垂直)。
- **第一腳量**:`volZ(i, 288) ≥ 1.5`。
- (可選,--metrics)`taker ≥ X`、OI 過去 1 鐘上 — 未測,留待 live-era metrics。

## Gate 結果(5m Binance Vision,89 幣,2026-05+06,+10%/24h,baseline 9.3%)

| 指標 | 早期 initiation | ⚡-breakout ref | 判定 |
|---|---|---|---|
| lift | **×1.73** | ×1.38 | 過 ×1.3 ✓,且勝過突破 |
| lift @+15% | ×1.82 | ×1.53 | ✓ |
| meanMFE | 6.3% | 5.8% | 捉多啲上升 ✓ |
| meanRet@24h | +0.18% | +0.08% | 薄(同 S9/S13 家族)|
| **lead vs ⚡** | **中位早 6.5h**(44% 之後有突破確認) | — | 命中用戶要求 ✓ |

**Robustness(±25%,base ×1.73)**:belowHighMax 9/15 → ×1.73/×1.73;posMin 0.375/0.625 → ×1.43/×2.12(單調,越貼 markup 越高);volz 1.125/1.875 → ×1.63/×1.76;ret4cap 3.75/6.25 → ×1.69/×1.74。**全部 ≥ ×1.43,遠過 ×1.15 floor** — 比 S8 穩好多。

**增量 ablation(命門)**:剝走 pre-breakout 結構(band+pos)→ **×1.08(塌返 baseline)**;band-only ×1.24、pos-only ×1.12、兩者合 ×1.73 = **super-additive**。→「上半區貼高未破」呢個結構帶真資訊,唔係 momentum 換皮。**過關**(S8 VWAP 正正喺呢關敗)。

**時序穩定 + OOS(三個獨立月,每月各自過關且勝突破):**

| 月 | early lift | breakout lift | early meanRet |
|---|---|---|---|
| 2026-04(**OOS**,調參冇用過)| **×1.99** | ×1.42 | +1.35% |
| 2026-05 | ×1.99 | ×1.30 | +0.43% |
| 2026-06 | ×1.51 | ×1.49 | +0.02% |
| 05+06 合 | ×1.73 | ×1.38 | +0.18% |

Out-of-sample 2026-04 唔單止企穩,仲係最強(×1.99,meanRet +1.35%,meanMFE 8.1%)— 冇 overfit 跡象。

## 為何 live 都會更早(唔止 backtest)
Live scan 本身用 5m base grid(BASE_BARS=576=48h 5m);⚡ detector 卻聚合到 1H 先判,so 生產上都遲。S14 喺**原生 5m grid** 行(24h=288 bars,喺 576 base 入面),零新 fetch,so 生產上真係早過 ⚡。

## Steps(過 gate 後先做 live;未做)
1. `indicators`/`analyze.ts`:`detectEarlyPump(candles5m, volume5m, oi?)` 喺 5m base grid 實現上面定義(唔聚合)。純函數,同 detectFlushBreakout 同 shape。
2. `types` + `toLite` + `recording`:加 `earlyPump` flag(sparse sweep-meta 或 CoinLite bool),**recording-only** 先。
3. Screener:加「早」badge(info/bull tone,priority 唔僭越 ⚡)。
4. **通知**:🔒 唔准即開 — 要 E1 用 live-era(Binance 07-07 後)recordings 覆一個窗 + E2 升班先可以 Telegram。理由:5m Vision 窗係 05/06,同 live 窗唔同源期;鐵律要 live-era 覆核先升通知(增/擴 先例)。

## Acceptance
- [x] 三關(lift ≥×1.3 / robustness >×1.15 / 增量 ablation)5m Vision 過齊。
- [x] 兩個月時序各自企穩。
- [x] Out-of-sample(2026-04)確認 ×1.99(vs unconditional baseline — 但見下:呢個數字受 baseline flaw 影響)。
- [x] Live 5m 實現(`detectEarlyPump` analyze.ts)+ recording(RecCoin idx24, schema v4)。Fidelity 逐 bar 對齊 harness(AVAX/ARB/APT/ATOM/AAVE 9/17/17/14/15 一致)。**Badge/通知 OFF(EARLY_PUMP_SHIPPED=false,對抗式下修)。**
- [ ] ~~升通知~~ **凍結**:先要(a)harness 加 state-matched baseline mode,(b)真.增量 lift 對 state-matched ≥ ×1.3 + robustness(測 below-high-MIN 同全鬆角落)+ 正 after-fee expectancy OOS,先至有得傾。而家未過。

## 陷阱 / Do-NOT
- **未 live-era 覆核唔准出通知** — 單一 harness 窗(05/06)過關 ≠ 可自動響 phone;要 E1/E2。誠實文化(×1.61 selection-noise 教訓)。
- meanRet 薄:lift 係排序/precision 訊號,**唔係已證嘅自動進場 edge**,申報同 S9/S13 一致(唔准淨靠佢入模擬盤自動倉)。
- Live 實現要同 harness 定義逐條對(eval≠live 風險,⚡/S2 先例)— 用 forced-positive fixture 驗。
- posMin 收緊到 0.625 lift ×2.12 好誘人,但 n 減半(926)— 唔准睇完結果先揀最靚 cell(overfit);ship 用凍結 0.5,收緊留做 E5 setup 分層。

## Results block
- 5m Vision 05+06:lift ×1.73(vs breakout ×1.38),lead 中位 6.5h,meanMFE 6.3%。
- OOS 2026-04:early ×1.99 / breakout ×1.42(81 幣,8 未上市略過)。
- 三關 + 三月時序 + OOS 全過。
- **Live 已上(2026-07-08,recording-only + 「早」badge,通知未開)**:
  - `detectEarlyPump`(analyze.ts,native 5m)· `toLite` 填 `CoinLite.earlyPump` · RecCoin idx24(schema **v4**)· evalCore `F.EARLY`+「早 earlyPump」state(E1 可 eval)· ScreenerList「早」badge(僅 pre-breakout,未 ⚡/增/擴 時顯示)。
  - **Fidelity 逐 bar 對齊**:AVAX/ARB/APT/ATOM/AAVE live=harness = 9/17/17/14/15 完全一致。
  - Live 覆蓋率:528 幣 sweep,earlyPump fired **1(0.2%,LUNA)** — 選擇性正常(唔係 noise);record **v=4**、row length 25、LUNA idx24=1 確認端到端寫盤。
  - 通知**未接**:recorder 嘅 notifyFlushBreakouts/notifyClassEdges 冇加 earlyPump;rich-card 觸發亦冇。要 E1 用 live-era v4 recordings 覆一個窗 + E2 先開 Telegram。
- Harness code:`scripts/backtest5m.ts` `--exp early|breakout` + `--early-*` knobs + lead 量度。Fidelity 測:`scripts/test-early.ts`、`scripts/test-early-live.ts`。

## 對抗式覆核(2026-07-08,6-agent workflow wf_d905ce0e-c65)— 判定:下修 recording-only

6 個獨立 skeptic,每個攻一個潛在方法學漏洞,讀 code + 跑 harness。逐項:

| 維度 | 判定 | 重點 |
|---|---|---|
| lookahead | ✅ HOLDS | 無 future-data leak。leak-sensitivity control(注入 1-bar peek → ×2.06)+ causality control(強制 1-bar lag → ×1.65 只微跌)證明冇偷睇未來。live twin 逐 bar 對齊(15 幣 257,583 決策 bar,0 mismatch)。 |
| **baseline-fairness** | **❌ FLAW/high** | ×1.73 對 unconditional baseline。state-matched(pos≥0.5 + below-high geometry,冇 vol trigger)baseline = 14.65%,真.**增量 lift ×1.03-1.10**。geometry table:pos×距高 已解釋大部分。cooled signal(16.16%)vs un-cooled full-predicate state(22.16%)= ×0.73。 |
| **lead-metric** | **❌ FLAW/high** | 「44%/6.5h」係 24h 窗假象。null 率 37.7%(44% = ×1.17 ambient);horizon scaling 顯示 lead 隨窗長成比例大 = 「終會有突破」唔係 front-run;same-move constraint → 8.6% confirm、中位 **1.2h**。 |
| **expectancy** | **❌ FLAW/high** | meanMFE = peak-excursion(含 look-ahead)≠ 利潤。median retH **−0.63%**,43.6% 為正;+10/−5 TP/SL 計 0.1% fee 後 **−0.38%/單**(breakout ref 一樣 −0.33%,係 fixed-exit 結構病)。正 mean 靠 top-1 BEAT(89% grand total),drop top-3 → −0.19%。lift ×1.73→drop top-5 ×1.44 = ranking 訊號,同利潤脫鈎。OOS 4月(牛)TP/SL +0.87%/單 = regime-dependent。 |
| survivorship | ⚠️ caveat/low | 窗內 0 中途下市(delisting 偏差 ≈ 0)。但 21% 係代幣化股票,base 率低一半 → 拉高 ratio;crypto-only ×1.60 vs ×1.42(相對 edge 1.13× 唔係 1.22×)。structure ablation 喺 crypto-only 仍 hold(×1.60 vs ×1.07 stripped)。 |
| overfit-rerun | ⚠️ caveat/low | 三關 reproduces to 2dp。但**測錯旋鈕**:below-high-**MAX**(测咗)近乎 inert(×1.731/1.732);below-high-**MIN**(漏咗)先係 load-bearing(=0 → ×1.12,±25% sweep ×1.49-1.96);全 5 旋鈕同時鬆 → ×1.20(< 1.3 claim)。方向仍 >1.0。 |

**淨結論:** S14 唔係「勝 ⚡、早 6.5h」嘅強 detector。真身 = 一個**弱 ranking/location filter**(揀貼近 24h 高、上緊、放量嘅幣),對 unconditional 有 ×1.6-1.7 ranking value(同 現/擴/增 tier 類近),但**真.增量預測力得 ×1.03-1.10、同一 move 只早 ~1.2h、expectancy ~0(靠 outlier)**。對用戶「早 D 入場」嘅目標,基本上唔 deliver 一個可交易 edge。照 ×1.61 selection-noise 先例 → **badge/通知 OFF,recording-only**。

**如果要救 S14(將來):**(1)`backtest5m` 加 state-matched baseline mode(sample 同 geometry envelope、冇 vol trigger 嘅 bar 做分母)→ report 真.增量 lift;(2)robustness 改測 below-high-MIN + 全鬆角落;(3)ship gate 改成「state-matched 增量 lift ≥×1.3 + after-fee TP/SL expectancy 正 OOS(drop top-3)」;(4)lead 用 same-move 定義。過晒先再講 badge。

## 定案(2026-07-08)— 「偵測更早」冇 free lunch ✖

`backtest5m` 加咗 `--matched`(state-matched baseline = 同 early geometry envelope、冇 vol/OI/taker trigger)。試埋 metrics 版(突破前 OI 上升 + taker-buy 主導)對 state-matched baseline 嘅**增量** lift(2026-06,+10%/24h,baseN 43121):

| 早期 trigger | state-matched 增量 lift |
|---|---|
| volZ only(metrics-free) | **×0.99**(volume 對 geometry 零增量) |
| + OI 上升 | ×1.02 |
| + taker-buy ≥0.55 | ×1.01 |
| + OI 上升 **兼** taker-buy | **×1.04** |

**結論:突破前所有 trigger(量、OI、taker)對「已經喺 markup geometry(貼高、上緊)」呢個狀態,增量幾乎係零(×0.99-1.04)。** markup geometry 本身就係全部訊號,microstructure trigger 加唔到嘢。夾埋 baseline audit(突破帶量 geometry 係 ×2.2 workhorse,喺突破前 fire 就丟咗個 workhorse),**earliness-vs-edge tradeoff 係 fundamental**:

- 真.pump 訊號 = 「收破 24h 高帶量」(~×2.2 over 隨機)— 但定義上喺突破嗰刻先 fire。
- 突破**之前**只捉到「貼高、上緊」嘅 geometry(~×1.5-1.7 unconditional),而**冇任何 trigger 對呢個 geometry 有增量**。
- 所以「比突破更早、又有真.edge」嘅訊號,用現有數據/訊號**造唔到**。

**對用戶投訴嘅完整答案:** ⚡/增/擴 嘅「收破高帶量」已經係最早嘅**可靠** trigger;再早就淨係「望住貼近高位、上緊嘅幣」(= screener 高 strength / top10;S4d 量到「早 ~2h」但嗰個 lead 都係 geometry 唔係 predictive edge)。冇一個訊號可以喺 pump 前幾鐘可靠 fire 兼有可交易 edge。呢個係誠實嘅定案,唔係「未搵到」。S14 detector ✖(recording 留參考,badge/通知 OFF)。
