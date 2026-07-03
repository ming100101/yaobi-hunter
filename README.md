# 妖幣獵手 (Yaobi Hunter)

UI for a 15-minute perp scanner, built from `yaobi-ui-spec.md`. Two views, futuristic dark-purple theme with neon-lavender (螢光淺紫) glow accents. **Pulls real OKX USDT-perp data**, with an automatic synthetic-demo fallback when the exchange is unreachable.

- **Screener list** — every scanned coin, sorted by strength. Symbol, regime tag (蓄力 / 拉升 / 出貨), strength 0-100, 1h change, OI 4h change, funding, 24h volume, risk-flag count. Auto-refreshes on the 15-min scan cadence. A LIVE · OKX / DEMO chip shows which source you're looking at.
- **Full-market rolling scan (Binance universe)** — the scan covers every OKX USDT perp whose base coin also has a Binance USD-M perp listing (~350 coins; includes Binance's tokenized-stock perps). The Binance symbol list comes from the public `data.binance.vision` S3 bucket (via the `/bnv` proxy; the live fapi API is geo-blocked, the bucket is not), normalised for Binance's 1000×/1M× multiplier prefixes and cached 24h. Coins are scanned in **pipelined** batches of 20 — the next batch's candles download while the current batch's OI (the slow pool) is in flight, so wall time collapses to roughly the OI time alone — with the list updating and re-sorting per batch and a 掃描 N/355 progress chip; a full sweep measured end-to-end at **355/355 coins in 269s (~4.5 min)**, down from 387s pre-pipeline and ~8 min before rate-limit tuning (see Rate-limit tuning below). Scan rows keep only derived metrics (`CoinLite`) — full series for ~350 coins would cost hundreds of MB — and detail views fetch the full 48h series on demand (cached in IndexedDB + memory LRU, so re-opens are instant, ~100ms).
- **Instant startup + priority refresh** — every successful live scan is persisted to IndexedDB (`src/data/cache.ts`), so the app renders the last scan immediately on launch and refreshes behind it; if OKX is unreachable the last good data is kept with a notice instead of dropping to demo. Recently-viewed coins (last 20, persisted) are fetched first in every scan, and opening a coin's detail view immediately re-fetches that one coin in the background (2-min cooldown) so what you're looking at is freshest.
- **Search tab (搜尋)** — searches **every** OKX USDT perp (~390), not just the scanned 16. Empty query shows the top 30 by 24h USD volume; typing filters instantly against a 60s-cached ticker snapshot (prefix matches rank first). Coins already in the scan carry a 掃描中 pill and open instantly from scan data; anything else is fetched on demand (48h of 5m klines + OI + funding, ~3-5s) and analyzed with the same pipeline. The search query survives opening a detail view and coming back.
- **Interpretation zone (型態解讀)** — a glowing panel at the top of every coin detail that reads the data and explains what the changes *mean*: funding cooling from 0.01% toward 0 (long-leverage froth washing out), funding flipping negative (squeeze fuel), the four OI×price quadrants, OI coiling under a flat price (pre-move accumulation), volume ignition vs climax, Bollinger squeeze, EMA crosses, breakout quality, wick rejections, and more — 27 detectors in `src/lib/interpret.ts`, each with concrete thresholds and live numbers baked into the zh-TW text. Top 6 by priority are shown, tone-tagged (bull/bear/warn/info). Educational heuristics, not investment advice.
- **Coin detail** — stacked full-width synced panels. The **price panel is a tall (520px) TradingView-style single-pane chart**: candles + EMA20/EMA50 + Bollinger + dashed entry line, with volume rendered as a quiet semi-transparent histogram overlay at the bottom of the same pane (its own hidden price scale, not a separate panel) instead of a standalone volume chart. A floating **OHLC legend** (top-left, overlaid on the canvas) shows open/high/low/close/Δ% for whatever bar the crosshair is over, falling back to the latest bar when the cursor leaves — wired via `chart.subscribeCrosshairMove` + an imperative DOM update (bypasses React re-render on every mouse-move for performance). Below: open interest, funding around a zero baseline, and the composite strength line with its threshold. Then the four core-signal pills, risk flags, and the fixed exit plan (TP1/TP2/TP3, hard SL, 5% runner). A **K-line timeframe selector (5m / 15m / 1h / 4h)** on the price panel re-aggregates all panels together, so the crosshair stays aligned. Scan metrics (強度, 1h, OI 4h, funding) are fixed to the 15-min scan and don't change with the chart timeframe.
- **Pinning (📌)** — pin any coin from the screener list, search results, or a detail view; pinned coins float to the top of the list (sorted by strength among themselves) and persist across restarts (IndexedDB). Pinned symbols are also added to scan priority, so they're fetched first every sweep.
- **Signal-age tracking** — the app remembers, per coin, when it first entered the strength top-10 and when ⚡/蓄 first fired (continuous-presence: cleared when the state turns off), shown as `T10 {age}` / age-annotated badges on list rows and detail headers. Backed by `signal-times` in IndexedDB, updated once a full sweep completes.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Live data

- **Source: OKX v5 public market data** (no API key). The Vite dev server proxies `/okx/*` → `https://www.okx.com` (see `vite.config.ts`) so browser requests stay same-origin — for a production deploy, replicate that proxy on your host.
- **Why not Binance?** Verified against Binance's own docs and live probes: every REST endpoint that carries USDT-perp data — `fapi.binance.com`, `dapi.binance.com`, and all six documented spot bases (`api.binance.com`, `api1`–`api4`, `api-gcp`) — returns HTTP 451 ("restricted location per Terms of Use 'b. Eligibility'") from this network. The only reachable Binance surfaces are `data-api.binance.vision` (market-data-only mirror, **spot only** — no perp klines, no open interest, no funding) and `data.binance.vision` bulk dumps (futures history exists there but T+1 daily zips, useless for a 15-min live scan). Since OI and funding are the scanner's core signals, spot-only Binance data can't drive this app. Bybit is likewise blocked (CloudFront 403). If you run the proxy from a region where Binance permits access, a `fapi` client can be added behind the same `ScanResult` shape.
- **Per scan:** the top coins from a curated alt/meme pool are ranked by live 24h USD volume, then for each coin the app fetches 48h of 5m klines (2 paginated calls), 5m open-interest history (rubik endpoint, strictly rate-limited → fetched single-flight with spacing), and funding-rate settlement history resampled onto the 5m grid.
- **Derived analytics** (`src/lib/analyze.ts`): the strength score, regime call, core signals, and risk flags are computed from the real series — OI momentum, trend, volume z-score, taker-side balance, range position, funding heat. The regime classifier scores 蓄力/拉升/出貨 on dynamics rather than a static position cascade, so a broad market rally doesn't read as everything "distributing". These are demo heuristics, not investment advice.
- **Fallback:** any live-fetch failure (geo-block, offline, rate limit) drops to the seeded synthetic generator with a DEMO chip and a notice banner — the UI never white-screens.

## Structure

- `src/theme.css` — every color and style token lives here (single place to retheme)
- `src/data/okx.ts` — OKX client: universe ranking, kline pagination, OI/funding resampling, throttled fetch pools, instrument search, on-demand single-coin fetch
- `src/components/SearchView.tsx` — the search tab (demo mode degrades to searching the local scan list)
- `src/data/scan.ts` — live-first loader with demo fallback
- `src/data/mockData.ts` — seeded synthetic data at a 5m base resolution, regime-shaped per coin per scan slot
- `src/lib/analyze.ts` — strength score, regime classifier, signals, risk flags from real series
- `src/lib/interpret.ts` — the pattern-interpretation library (27 detectors over funding/OI/price/volume)
- `scripts/test-interpret.ts` — headless check of the interpret pipeline against live OKX data (bundle with esbuild, run with node)
- `src/lib/aggregate.ts` — rolls the 5m base series up to the selected timeframe (OHLC / sum / last)
- `src/components/ChartPanels.tsx` — the five lightweight-charts panels (create-once, update-via-setData — see Live detail view below)
- `src/lib/chartSync.ts` — shared visible range + crosshair across stacked panels

## Live detail view

Opening a coin's detail no longer shows a frozen snapshot: while the view stays open, `src/App.tsx` refetches that coin's full series every 20s in the background (`DETAIL_LIVE_MS`, real data only — demo is static). The five chart panels (`src/components/ChartPanels.tsx`) are built as **create-once, update-via-setData**: each panel creates its chart/series exactly once when the coin is opened, and every refresh (live poll or timeframe switch) only calls `setData`/`applyOptions` on the existing objects — the chart itself is never torn down, so your pan/zoom and the cross-panel crosshair sync survive a background refresh. The visible range only resets when the *timeframe* actually changes (tracked per-panel via `useTfChanged`), not on a same-timeframe data refresh. Verified by tagging the canvas elements before a refresh cycle and confirming the same DOM nodes (not new ones) after multiple poll cycles.

## ⚡ 縮倉突破 (flush-context breakout)

The one signal in the app validated by backtest rather than intuition: OI flushed ≥8% below its 48h max + 24h close range ≤6% + neutral funding + OI turning up + a base-high break on 1H volZ ≥1.5. Backtest (154 Binance-listed small caps, 37d @1H): +15%/24h hit rate 9.1% vs 4.5% base rate (**lift ×2.04**), mean ret@24h +1.9% vs -0.2%. The quiet setup *without* the breakout trigger tested below base rate (×0.77) — the trigger carries the information. Surfaced three ways, all from one detector (`detectFlushBreakout` in `src/lib/analyze.ts`): a ⚡ badge on screener rows, a topbar toggle filtering the list to live triggers, and a top-priority 縮倉突破 insight in the detail view (with the backtest stats quoted). Expect it to be rare: ~1-2 firings per day across the whole universe.

## 蓄 早期蓄力 (early-accumulation watchlist)

The answer to "can we detect accumulation *before* the breakout": partially, and the app is honest about how partially. The quiet flush+basing setup alone backtests **below** base rate at every target/horizon tried (×0.60-0.88 — quiet coins are quiet). Adding two confirmations turns it consistently positive: **retail long/short account ratio falling ≥5% over 24h** (retail giving up) + **≥2% relative strength vs BTC** (someone supporting the price). Across four target/horizon specs: lift ×1.03-1.24, forward returns +1.1~1.3% vs -0.6~-1.4% baseline in every spec, MAE ~30% shallower. A best-spec ×1.61 did **not** survive the robustness sweep and is treated as selection noise. Accordingly this ships as **watchlist tier**: a quiet 蓄 badge on the row and an info-tone insight in the detail view — no notification, explicitly labeled 非進場訊號. Implementation is cost-aware: the cheap setup + RS checks run on data the scan already has; only survivors trigger the extra long/short-ratio fetch (BTC's 24h return is one request per sweep). Ablation also killed a plausible idea: taker buy-share during the base tested at ×0.67 — worse than nothing — and was not shipped.

## Backtest harness

`npm run backtest -- [flags]` tests the 縮倉築底 hypothesis (OI flushed + price basing + neutral funding → early pump detection) against ~30 days of real OKX 1H data across the Binance-listed small-cap universe. Data is fetched once and cached under `backtest-data/` (12h TTL, `--refresh` to refetch), so parameter sweeps re-run instantly — designed to be driven by hand or by a Claude Code agent.

- `--mode setup` (default) fires on flush+basing+funding+OI-inflection alone — tests *early* detection. `--mode breakout` additionally requires a base-high break on volume (`--volz`).
- Signal knobs: `--flush-pct 8 --flush-hours 48 --base-range 6 --base-hours 24 --neutral-funding 0.01 --inflect-hours 6`
- Ablation filters (v2 data adds taker flow, long/short ratio, and a BTC benchmark): `--taker-share 0.53` (taker buy share over the base window), `--ls-drop 5` (long/short ratio drop % over the base window), `--rs-min 2` (relative return vs BTC ≥ %)
- Outcome knobs: `--target 15` (% MFE) `--horizon 24` (hours) `--cooldown 24`
- Universe knobs: `--min-vol 2e6 --max-vol 150e6 --max-coins N`
- `--json` for machine-readable output (agents), human table otherwise.

Every run reports the signal's hit rate against the **unconditional base rate** over all bars (the lift), mean/median MFE, MAE, and fixed-horizon returns, plus printed caveats (single regime window, per-coin clustering, intra-bar MFE optimism).

## Standalone .exe (desktop app mode)

`npm run build && node scripts/make-exe.mjs [outPath]` packages the app as a single Windows executable (Node SEA): `scripts/server.cjs` serves the embedded `dist/` and proxies `/okx/*` + `/bnv/*` upstream, so the exe needs no Node install, no npm, no separate proxy.

Double-click → the console respawns itself hidden, then launches **Edge/Chrome in `--app` mode** with a dedicated profile: a standalone window with its own taskbar entry, no tabs, no URL bar. Closing the window shuts the hidden server down (a poll waits until no browser process holds the app profile — Edge's launcher exits early, so a naive child-exit check would orphan the window). Fallbacks: no Edge/Chrome found → default browser + visible console; `--console` forces the old behaviour; `--no-open` serves headless. Port 4780, auto-increments if busy. ~90 MB (embedded Node runtime); unsigned, so SmartScreen may warn on first run.

**Signal notifications**: while the app is open, each scan batch diffs for newly-fired ⚡ 縮倉突破 signals and shows a Windows toast (per-coin 6h cooldown, persisted; click opens that coin's detail). Grant the notification permission when the app window asks once. Toasts only fire while the app is running — there is no background service.

## Rate-limit tuning (documented limits × measured behaviour)

The throttle settings in `runRollingScan` (`src/data/okx.ts`) are calibrated against **both** OKX's documented per-endpoint limits and empirical probes. (The docs-v5 site is a 5 MB single-page app that defeats naive fetching — the per-endpoint numbers are there, but you have to grep the raw HTML near each endpoint's path.)

| endpoint | documented limit | our attempted rate |
|---|---|---|
| `rubik/.../open-interest-volume` | 5 req / 2s, per IP | ~1.74/s (70% of cap) |
| `market/candles` | 40 req / 2s, per IP | ~10-14/s peak |
| `public/funding-rate-history` | 10 req / 2s, per **IP + instrument** | 1 req per instrument — can't collide |

Key findings that shaped the final config:

- **OI is the long pole**, so the sweep is pipelined: the next batch's candles download while the current batch's OI pool runs, collapsing wall time to roughly the OI time alone.
- OI runs at concurrency 2 with 500ms per-worker pacing = ~70% of the documented cap, leaving headroom for the app's own detail-view live poll (1 OI request / 20s) on the same IP.
- 429s at these settings only appear when a **second instance** shares the IP (e.g. dev preview + exe scanning simultaneously); a slower 650ms pacing was tested under that double load and was strictly worse (309s vs 269s, same 429 count), so 500ms is kept. `okxGet` retries with backoff absorb multi-instance residue invisibly, and it logs a console warning on every 429/5xx so a throttle regression shows up immediately.

Measured end-to-end (full 355-coin sweep, app running concurrently): **269s**, zero coins dropped. History: ~8 min (original guess-based throttle) → 387s (probe-based single-flight) → 269s (docs + pipeline + paced concurrency).

強度與階段為示範性評分。Not financial advice.
