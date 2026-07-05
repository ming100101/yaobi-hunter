# S1 — Spot 基礎數據層:一個 bulk request 攞齊全市場現貨量 + 基差

**層級**: 第2層 訊號擴張 · **工作量**: S · **依賴**: R1 (recording v2 已預留 idx 19/20)

## zh-HK TL;DR
成個 app 而家完全冇 fetch 現貨數據 — 要偵測「莊家用 SPOT 拉盤」第一步係攞到現貨數。呢個 spec 每 sweep 加一個 bulk spot tickers request(全部幣一次過),即刻有齊:每隻幣嘅現貨 24h 成交量、現貨最新價、同 perp 嘅基差(basis)。零 per-coin 成本,rate limit 冇壓力。

## Context (verified facts)
- `src/data/okx.ts` has zero spot endpoints today. Perp bulk tickers: `getAllTickers()` (okx.ts:101-106) fetches `/api/v5/market/tickers?instType=SWAP` with a 60s module-level cache — copy this pattern exactly.
- Perp instId format `BASE-USDT-SWAP`; spot instId is `BASE-USDT` (strip the `-SWAP` suffix). Not every perp base has a spot pair — missing → null fields.
- `CoinLite` is defined at `src/types.ts:100-116`; built by `toLite()` (okx.ts:389-410). R1 added `CoinLite.feat`.
- Recording v2 reserved idx 19 `spotVol24h` and idx 20 `basisPct` as null — this spec fills them (`src/lib/recording.ts`, `buildScanRecord`).
- Rate limit: `/market/tickers` is 20 req/2s per IP — we add ONE call per sweep (and reuse the 60s cache), irrelevant.
- The detail header stats grid is in `src/components/CoinDetail.tsx` (`dh-badges`, styled in theme.css:794-820).

## Design (decided)
- New fields on `CoinLite`: `spotVol24h: number | null` (USD), `basisPct: number | null` where `basisPct = (perpLast / spotLast - 1) * 100`. Positive basis = perp premium (期貨較貴,槓桿主導); negative = spot premium(現貨主導/搶現貨).
- Fetched once per sweep in `runRollingScan` (alongside `fetchBulkOi`, okx.ts:452-455) into a `Map<base, {last, volUsd}>` passed down to where `toLite` is called (or applied to the batch after `toLite` — pick whichever touches fewer lines; the map lookup is by `coin.symbol`).

## Steps

### 1. `getSpotTickers()` in `src/data/okx.ts`
Place next to `getAllTickers` (line 101). Same 60s cache pattern, own cache variable:
```ts
let spotTickersCache: { at: number; rows: Map<string, { last: number; volUsd: number }> } | null = null;

export async function getSpotTickers(baseUrl: string): Promise<Map<string, { last: number; volUsd: number }>> {
  if (spotTickersCache && Date.now() - spotTickersCache.at < 60_000) return spotTickersCache.rows;
  const rows = await okxGet(baseUrl, '/api/v5/market/tickers?instType=SPOT');
  const map = new Map<string, { last: number; volUsd: number }>();
  for (const r of rows) {
    const instId: string = r.instId;             // e.g. "DOGE-USDT"
    if (!instId.endsWith('-USDT')) continue;
    const base = instId.slice(0, -'-USDT'.length);
    const last = Number(r.last);
    const volUsd = Number(r.volCcy24h);          // volCcy24h on -USDT pairs is quote (USDT) volume
    if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(volUsd)) continue;
    map.set(base, { last, volUsd });
  }
  spotTickersCache = { at: Date.now(), rows: map };
  return map;
}
```
Sanity note baked into verification: confirm `volCcy24h` on SPOT tickers is quote-currency volume by comparing BTC-USDT's value against a known ~$X B figure; if it is base-currency volume use `volCcy24h * last` instead. Decide by looking at the actual number, then leave a one-line comment stating which it was.

### 2. Wire into the sweep (`runRollingScan`, okx.ts:436+)
- After the `fetchBulkOi` block (~line 452): `const spot = await getSpotTickers(base).catch(() => new Map());`
- Where each batch's coins are converted (`toLite` call site inside the scan loop or in the App/recorder callbacks): set
```ts
const s = spot.get(lite.symbol);
lite.spotVol24h = s ? Math.round(s.volUsd) : null;
lite.basisPct = s && s.last > 0 ? Number(((lite.lastPrice / s.last - 1) * 100).toFixed(3)) : null;
```
Preferred: do this INSIDE `runRollingScan` right after building the batch (single place serves both browser + recorder). `toLite` itself keeps its `(coin: Coin)` signature — add the two fields as optional on CoinLite (`spotVol24h?: number | null; basisPct?: number | null`) and default them `null` in `toLite`.

### 3. Recording v2 hookup (`src/lib/recording.ts`)
In `buildScanRecord`, replace the idx-19/20 placeholders with `c.spotVol24h ?? null` and `c.basisPct ?? null`.

### 4. UI: basis in detail header (`src/components/CoinDetail.tsx`)
Add one stat cell to the `dh-badges` grid: label `基差`, value `{basisPct >= 0 ? '+' : ''}{basisPct.toFixed(2)}%`, tone: `up` class when ≤ 0 (spot premium = bullish for spot-led thesis), `muted` otherwise, `—` when null. The grid is `grid-template-columns: repeat(6, auto)` (theme.css:794-798) — bump to 7 or let it wrap; check on a 1280px window.

## Verification
1. `npm run typecheck` clean.
2. `npm run dev` → after first sweep batch, pick BTC/ETH in the screener → detail header shows 基差 within ±0.3% (sane for majors). A pure-perp meme coin without a spot listing shows `—`.
3. Recording line (today's JSONL) → idx 19/20 populated for majors, null for spot-less coins.
4. Rate-limit check: console shows no new 429 warnings (`okxGet` logs them, okx.ts:39).
5. The `volCcy24h` sanity note from step 1 resolved and commented.

## Acceptance checklist
- [x] One extra request per sweep total (60s-cached), not per coin.
- [x] `spotVol24h`/`basisPct` on the coin, in recordings, and 基差 in detail header. (see reconciliation: fields live on `Coin` + `CoinLite.feat`, not top-level `CoinLite`.)
- [x] Coins without a spot pair degrade to null/— everywhere (no NaN in UI or JSONL).

## 陷阱 / Do-NOT
- Do NOT fetch per-coin spot data here (klines/taker flow are S2's candidate-only job) — this spec is deliberately the free bulk layer.
- Do NOT compute basis from mismatched snapshots taken minutes apart: perp `lastPrice` comes from the coin's own candles at batch time while spot comes from the sweep-start ticker — acceptable for a 0.1%-scale metric, but note it; if the basis of majors looks systematically off by >0.5%, switch the perp side to the perp ticker map (`getAllTickers`) captured at the same moment as `getSpotTickers`.
- Do NOT break demo mode: `mockData.ts` coins get `spotVol24h/basisPct` undefined → all consumers must handle null.
- OKX spot tickers include non-USDT quotes — the `-USDT` suffix filter matters (BTC-USDC would corrupt the map key).

## Results — ✅ 2026-07-04
Bulk spot layer shipped. `volCcy24h` sanity resolved: probed live — OKX SPOT `volCcy24h` **is** quote (USD) volume (BTC-USDT `volCcy24h` ≈ `vol24h×last` ≈ $0.36B), used directly (comment in `getSpotTickers`). 302 `-USDT` spot pairs vs 358 scanned perps → ~150 pure-perp/tokenized-stock listings get null.

Verification (all pass): `npm run typecheck` clean. `scripts/test-spot.ts` — live `getSpotTickers('https://www.okx.com')` returns 302 pairs; recording serialization asserts idx 19 = rounded spotVol, idx 20 = basisPct (3dp), both null when the coin has no spot pair. Live dev-run (LIVE·OKX): detail-header 基差 shows **ETH −0.05%** (within ±0.3% for a major). Live recording (today's JSONL, sweep 11:04:23): **BTC [spotVol $359.5M, basis −0.052%], ETH [$170.8M, −0.056%], LAB [null,null]**, 202/353 coins carry spot. No 429s on `/market/tickers` (the spot endpoint) — S1 adds one 60s-cached request/sweep.

Files: `src/data/okx.ts` (`getSpotTickers` + `spotFields`; wired into `runRollingScan` + `fetchLiveCoin`; `toLite` copies to `feat`), `src/types.ts` (`Coin.spotVol24h/basisPct`), `src/components/CoinDetail.tsx` (基差 stat cell, `up` tone when basis ≤ 0), `src/theme.css` (`dh-badges` 6→7 cols), `scripts/test-spot.ts`. `src/lib/recording.ts` unchanged — R1 already reads `feat` idx 19/20.

**Spec reconciliation (spec predates R1's final schema):** R1 reserved `spotVol24h`/`basisPct` under `CoinLite.feat` (not top-level) and already wired `recording.ts` to read them there, so Step 3 was already done. Rather than add top-level `CoinLite` fields, S1 mirrors the existing `oiUsd` pattern: fields on `Coin`, copied into `feat` by `toLite`. The detail view (Step 4) uses the full `Coin` (not `CoinLite`), so `fetchLiveCoin` also computes basis from the cached spot map — the spec's Step 4 assumed basis was already present. No behavioural change vs the spec's intent; only the field location differs.

**Note (not S1):** the master KILL switch (`%LOCALAPPDATA%/YaobiHunter/KILL`) is present, so the headless recorder refuses to run (verified: "KILL file present — recorder stopping"). While it's set, no background recordings/paper accrue — the T1 countdown only advances while the app is open. Left untouched.
