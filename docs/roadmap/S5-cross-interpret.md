# S5 — 跨源聯合解讀 (cross-source joint reads)

**層:** 2(訊號擴張) · **量:** S · **依賴:** S1(現貨欄位已入 recording) · **狀態:** ☐

## 點解做

而家 `src/lib/interpret.ts` 27 個 detector 全部各自讀一片數據、獨立開火;`analyze.ts` 個 strength 分數融合嘅只係原始 metric,唔係 detector 結果。**唯一嘅跨源解讀係 蓄 早期蓄力,而佢淨係用喺一個 setup。** 用戶想要嘅係「多過一項數據一齊解讀」,呢個係真正空白。

最抵切入點:S1 已經令 recorder 每個 sweep 錄低 `spotVol24h`(idx19)同 `basisPct`(idx20),但**冇任何 detector 用過**。即係有兩個跨源讀法可以即刻喺**已錄數據**上量 lift,零新 fetch、零 rubik 壓力。

目標係將而家 inference-only 嘅 `spot-led-breakout`([interpret.ts:404-413](../../src/lib/interpret.ts))— 用「OI 平坦」當「現貨帶動」嘅純估 — 升級成用**真實現貨數據**嘅跨源讀法。**本 spec 只做 P0(量度),唔出 badge。**

## 一個必須知嘅現實

設計時容易假設 `oi4h` 有錄低 — **冇**。`RecCoin`([recording.ts:13-40](../../src/lib/recording.ts))得 `oiUsd`(idx2 絕對值)同 `oiDropPct`(idx18),**冇 `oi4h`**。所以喺已錄數據上,兩個讀法要**略走 OI-flat 條件**,只用單行有嘅欄位。呢個係 approximation,eval 版 ≠ 未來 live detector 版(live 版喺 `buildCtx` 有真 `oi4h`)。步驟 3 會 append `oi4h`,等未來數據夠先對齊。

## 兩個跨源讀法(P0 eval 版)

- **現貨真帶動 organic-spot-lift**(bull):`ret4h ≥ 2%` AND `basisPct ≤ 0`(現貨 ≥ 永續)AND `spotVol24h ≥ vol24h`(現貨量壓過永續)AND `buyShare4h > 0.55`。→ 真係現貨扛住嘅升,可信。
- **純槓桿虛火 leverage-only-froth**(warn):`funding ≥ 0.01%` AND `basisPct ≥ +0.1%`(永續溢價)AND `spotVol24h < 0.5 × vol24h`(現貨缺席)。→ 冇現貨托、脆弱。

> **null 處理:** `basisPct` / `spotVol24h` 為 `null`(純永續幣)或 row 太短(v1 舊 row)→ **return false,唔准 throw**。~150/353 隻純永續冇現貨,會靜靜跳過 → 覆蓋率要當偏差報。

## 步驟(可執行)

### 步驟 1 — 擴 `F` map · `src/lib/evalCore.ts:12`
由:
```ts
export const F = { SYM: 0, PRICE: 1, STR: 5, FB: 7, EA: 8 } as const;
```
改成:
```ts
export const F = {
  SYM: 0, PRICE: 1, FUND: 3, STR: 5, FB: 7, EA: 8,
  VOL24H: 9, RET4H: 11, BUYSHARE: 13, SPOTVOL: 19, BASIS: 20,
} as const;
```
(單位:FUND idx3 funding %,RET4H idx11 %,BASIS idx20 %,BUYSHARE idx13 0..1,VOL24H idx9 / SPOTVOL idx19 USD — 全部同 `buildScanRecord` [recording.ts:78-101](../../src/lib/recording.ts) 一致。)

### 步驟 2 — 加兩個 STATES · `scripts/eval-recordings.ts:100`
喺 `STATES` array 現有 4 個 entry 之後加(單行 predicate,**唔使**改 `risingEdges` 簽名):
```ts
{ key: 'organic-spot-lift', on: (r) => {
    const basis = r[F.BASIS] as number | null;
    const spotVol = r[F.SPOTVOL] as number | null;
    if (basis == null || spotVol == null) return false;
    return (r[F.RET4H] as number) >= 2 && basis <= 0 &&
           spotVol >= (r[F.VOL24H] as number) && (r[F.BUYSHARE] as number) > 0.55;
  } },
{ key: 'leverage-only-froth', on: (r) => {
    const basis = r[F.BASIS] as number | null;
    const spotVol = r[F.SPOTVOL] as number | null;
    if (basis == null || spotVol == null) return false;
    return (r[F.FUND] as number) >= 0.01 && basis >= 0.1 &&
           spotVol < 0.5 * (r[F.VOL24H] as number);
  } },
```

### 步驟 3(建議,低風險)— append `oi4h` 做 idx21 · `src/lib/recording.ts`
淨係為咗**未來**令 eval 對齊 live detector(P1),P0 量度用唔到,想要最細 PR 可以跳過。
- Schema 註解([recording.ts:13-16](../../src/lib/recording.ts))加 `21 oi4hPct`。
- `RecCoin` tuple 尾加多一個 `number,`(oi4h 恒為 number,唔 nullable)。
- `buildScanRecord`([recording.ts:100](../../src/lib/recording.ts))喺 `fixN(f?.basisPct, 3),` 之後加:
  ```ts
  fix(c.oi4h, 2), // idx21 — 令未來 eval 可加返 OI-flat gate 對齊 live detector
  ```
- **唔改**前 21 個位;`v` 保持 `2`(append 由 `recCoinField` 嘅 length 檢查 backward-compatible)。

### 步驟 4 — 量度
```sh
npm run eval-rec -- --json
npm run eval-rec -- --json --target 15
```
睇 `states["organic-spot-lift"]` / `states["leverage-only-froth"]` 對 `baseline` 嘅 `h24.hit` lift、`events`、`h4`/`h24`。

## Gate(過咗先可以講 P1 出 badge)

- 24h rising-edge lift **≥ ×1.3**,而且每個 threshold **±25% sweep 之下 lift 仍 > ×1.15**(手動改 predicate 常數重跑)。
- 報 **coverage**:幾多 % 幣有非 null 現貨(~202/353,偏向大幣,要明講)。
- 報 **coins-firing**:唔係一隻幣重複開火(per-coin clustering 係已知盲點;`risingEdges` 只 dedup 同一 symbol 嘅連續持續,唔 dedup 開完停完再開)。
- Threshold **事先 pre-register**,唔准睇完 eval 再回頭調(×1.61 selection-noise 教訓,見 [README:57](../../README.md))。

## Do-NOT

- 唔准出 badge / 通知 / 入模擬盤(P0 純量度)。
- P0 唔准掂 `interpret.ts` / `analyze.ts` / UI(除咗步驟 3 個 recording append)。
- eval predicate 未有 idx21 數據之前,**唔准**加 OI-flat gate(而家冇 oi4h,加咗係假)。
- null 欄位 return false,唔准 throw。
- 唔准 reformat / rename 順手改其他嘢。

## 驗證

- `npm run typecheck` 要過。
- `npm run eval-rec -- --json` 要正常出到兩個新 state,有 `events` 同 `h4`/`h24`。
- **樣本會好細:** S1 喺 2026-07-04 先落,帶現貨欄位嘅 recordings 由嗰日先開始累積,所以 `events` 細係正常 —— 呢步係**驗機制,唔係出統計**(同其他 recording-only 項一樣,越積越有力)。
- 完成後喺 `ROADMAP.md` 剔返 S5 個 ☐,下面 results block 貼實測數字。

## 後續 gated 路線(唔喺本 spec 做,只點名)

- **P1** — 過 gate 先:`buildCtx` 加 `Ctx.basisPct` / `Ctx.spotVolRatio`(由 `Coin.basisPct` / `Coin.spotVol24h`,S1 已喺 `Coin`),用**真 oi4h** 加返 OI-flat,把讀法落做 `DETECTORS` closure,priority 排 < flush-breakout(10)/early-accum(8),擺喺 `SHIPPED = false` 後面。要 `backtest.ts` 另一數據源交叉確認先真出 badge。
- **P2** — 推廣 蓄 ls-drop 讀法(retail-capitulate-into-strength):`backtest.ts` 加 `--mode joint-cap`(ls-drop + rs-min 唔要 flush gate),production 保持 recording-only 直到 S4a 有非候選 LS 覆蓋。
- **P3** — regime 條件化:等 E3 落咗 `btcRegime` sweep-meta tag,對已過 gate 嘅讀法做 regime-split STATES,對 **regime-matched baseline** 比較,封頂 3 regime,唔准 cross-product。
- **訊號分歧** contradiction-suppress:純顯示、唔使 gate,獨立做個細 U-item(跨家族一 bull 一 bear 同時著 → 中性提示),唔混入 S5。

## Honest-stats 提醒

cross-interpretation 放大 hypothesis space,正正係 ×1.61 被否嗰種 selection-noise 溫床。守則:gate 睇 robustness 唔係 peak lift;threshold pre-register;現貨 null 覆蓋當偏差報;coins-firing 要報;`basisPct` 係單快照(sweep 起始現貨 ticker vs 永續 candle),0.1% 尺度有噪,任何 basis z-score 讀法留返 S2 basis-anomaly 做,唔喺 P0 做。

## Results(2026-07-05 執行)

```
數據:86 unique slots · ~25.25h span · 353 幣。typecheck 過。
兩個新 STATE 都正常出到(events + h4/h24,零 throw)。呢步係驗機制,唔係出統計。

--- eval-rec target +10% ---
baseline           h24 hit 1.70%  (n=29951)   |  h4 hit 0.45%
organic-spot-lift  0 events        (0 row-level match — 嚴格 AND 喺 25h 內從未成立)
leverage-only-froth 197 events / 48 distinct syms
                   h24 hit 0.0% → lift ×0.00   |  h4 hit 0.0%
                   h24 meanRet -1.53% vs baseline -0.41%(warn read 應該跑輸,方向啱)

--- eval-rec target +15% ---
baseline           h24 hit 0.97%
organic-spot-lift  0 events
leverage-only-froth h24 hit 0.0%(同上,froth 幾乎冇大升幅)

Coverage:202/353 幣(57.2%)有非 null 現貨(row-level 35.7%,現貨由 2026-07-04 先累積)。
偏向大幣 —— 當偏差報。~150 隻純永續冇現貨,靜靜 return false 跳過。
Coins-firing(froth):48 隻唔同幣開火(BICO/RVN/BAT/YFI... top ≤15 rows),
唔係一隻幣重複;per-coin clustering 係已知盲點,如實報。

--- Gate 判定 ---
未過。organic-spot-lift 0 events → 24h lift 無得計(≥×1.3 gate 不可評)。
froth 係 warn 讀法,佢嘅「lift」係反向(hit 0% vs baseline)—— 唔係 bull badge。
∴ 維持 recording-only,唔出 badge / 通知 / 模擬盤(P0 純量度,符合 spec)。
±25% robustness sweep 未做:organic 0 events 冇嘢好 sweep;threshold 全部照 spec
pre-register,冇睇完 eval 回頭調(避 ×1.61 selection-noise)。等 recordings 累積夠再評 gate。

--- 步驟 3(oi4h idx21 append)---
已加:schema 註解 21 oi4hPct、RecCoin tuple 尾 +number、buildScanRecord fix(c.oi4h,2)。
backward-compatible:on-disk rows 而家仲係 len≤21(recorder 未重跑),eval predicate 未讀
idx21,冇 OI-flat gate(冇 oi4h 數據前唔准加)。純為未來 P1 對齊 live detector。

--- 驗證 ---
3-lens 對抗式覆核(index-mapping / semantics / honest-stats-scope):
index 映射對齊 buildScanRecord + schema、basisPct 正負號同 funding ×100 percent scale
對得上、null-safety(== null 接住 null 同 undefined 短 row)、threshold 無 fishing —— 全部 CONFIRMED。
(一個 lens 誤報 scope violation:佢用 git diff 睇到成個未 commit 工作樹〔P0/R1/R2/S1/M1/M3/U4
2026-07-04 完成但未 commit〕,mtime 證實本 task 只改咗 evalCore.ts / eval-recordings.ts /
recording.ts 三個檔,09:55-09:56 —— 誤報,已否決。)
```
