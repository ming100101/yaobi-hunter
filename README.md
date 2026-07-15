# 妖幣獵手 · Yaobi Hunter

Yaobi Hunter is a Windows-first cryptocurrency perpetual-futures scanner for spotting unusual price, open-interest, volume, funding, and spot-flow behaviour across the Binance USDT perpetual market.

It includes a live desktop dashboard, Telegram alerts, a 24/7 background recorder, signal history, strategy evaluation, and detailed multi-timeframe charts.

> Educational market-analysis software only. It does not place trades and is not financial advice.

[Download the latest Windows Public Beta](https://github.com/ming100101/yaobi-hunter/releases)
· [Project website](https://ming100101.github.io/yaobi-hunter/)
· [Risk disclaimer](DISCLAIMER.md)
· [Privacy](PRIVACY.md)

## Public Beta quick start

1. Download `YaobiHunter-...-windows-x64.zip` from the official
   [GitHub Releases](https://github.com/ming100101/yaobi-hunter/releases) page.
2. Compare the ZIP with the attached `SHA256SUMS.txt`.
3. Extract the entire ZIP and run `YaobiHunter.exe`.
4. Read `README-FIRST.txt` before configuring optional Telegram alerts.

The current Beta is not code-signed, so Windows SmartScreen may show an
unknown-publisher warning. Do not download builds from mirrors or Telegram
attachments. The app uses public market endpoints, does not require an
exchange API key, and has no order-placement integration.

## Highlights

- Scans the full tradeable Binance USDT perpetual universe in rolling batches.
- Ranks coins by a composite strength score and market regime.
- Detects validated signal classes such as:
  - `⚡ 縮` — flush-context breakout / 縮倉突破
  - `📈 增` — rebuilding open-interest breakout / 增倉突破
  - `🚀 擴` — virgin open-interest expansion / 處女增倉
- Sends successful signals to Telegram and optional Windows notifications.
- Keeps a dedicated **推送** monitor showing every successfully delivered Telegram coin.
- Shows pushed price, current price, return since push, 1-hour change, strength, and a green/red **24H sparkline**.
- Tracks post-push ⚡/📈/🚀 frozen structure zones with waiting, reached, and invalid states; all current rules run App-only shadow and never emit a second Telegram alert.
- Coin Detail marks real successful Telegram cards as **TG卡** at Telegram delivery time and shows only the separate **確認盤** ledger. A TG card price is always labelled **TG 卡價** and is never represented as a fill.
- Opens any row into a detailed TradingView-style chart view.
- Records completed scans as local JSONL files for later replay and evaluation.
- Runs as a standalone Windows executable with an optional background recorder.

### Paper entry and strategy review

The current paper book uses the frozen `next-closed-15m-v1@2026-07-14` policy: a completed signal scan queues an intent and the first later completed observation supplies the fill, normally 15 minutes later. Missing observations expire after 45 minutes instead of being back-filled. Signal price, fill price, delay and slippage remain in the ledger.

Legacy same-scan A/B/C books are kept as separate controls and are never mixed into the current confirmed book. The Strategy tab presents one comparison dimension at a time and keeps the dense research detail collapsed. See [`docs/roadmap/reports/PAPER-ENTRY-V2-2026-07-14.md`](docs/roadmap/reports/PAPER-ENTRY-V2-2026-07-14.md).

## Main tabs

| Tab | Purpose |
| --- | --- |
| **掃描** | Live market screener, sorting, filters, signal badges, pins, and scan progress. |
| **搜尋** | Search the full Binance perpetual universe and open any coin on demand. |
| **推送** | Monitor successfully pushed coins, 24H mini charts, and post-push entry-zone lifecycle over 24 hours or 7 days. |
| **策略** | Review recorded strategy performance and signal evidence. |
| **記錄** | Replay historical scans, compare TG-card and next-complete-15m outcomes, inspect signal events, and view the paper-trade journal. |
| **設定** | Configure Telegram, Windows notifications, cooldowns, and local backup/import. |

## Quick start for development

Requirements:

- Windows 10 or 11
- Node.js 20 or newer
- npm

```powershell
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Useful checks:

```powershell
npm run typecheck
npm run build
npm run preview
```

The browser app uses public Binance market endpoints through the local Vite proxy. No Binance API key is required.

## Build the Windows desktop app

Build the production UI and package it as a single executable:

```powershell
npm install
npm run typecheck
npm run build
node scripts\make-exe.mjs
```

Output:

```text
sea\YaobiHunter.exe
```

Run `YaobiHunter.exe` to start the local server and open the desktop dashboard. The app normally serves itself from `http://127.0.0.1:4780`; if that port is occupied, it tries the next available port up to `4790`.

## Configure Telegram alerts

1. In Telegram, open `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the Bot Token.
4. Open Yaobi Hunter → **設定**.
5. Paste the token into **Telegram Bot Token**.
6. Send any message to your new bot from Telegram.
7. Click **偵測** beside Chat ID.
8. Click **測試通知** and confirm the test message arrives.

You may also enable Windows desktop notifications and set a per-coin cooldown in hours.

The **推送後入場監察** control enables shadow collection. A candidate freezes the pre-breakout 24-hour high, 1H ATR14, entry band, invalidation, TG card price, and expiry only after Telegram confirms an ⚡/📈/🚀 card. It then evaluates completed native 15-minute candles after a 30-minute minimum wait. ⚡ uses exactly the same frozen rule, but is evaluated as its own cohort.

No class is currently promoted, so the current build records these watches in the App for further evidence but does **not** send live second-stage Telegram messages. The paired test button remains available and never creates a real watch. A class may only be reconsidered after its own 100-arrival / 40-coin / 20-UTC-day sample and robustness gates pass. See [`docs/roadmap/reports/ENTRY-WATCH-2026-06.md`](docs/roadmap/reports/ENTRY-WATCH-2026-06.md).

Only alerts that Telegram confirms as successfully delivered are added to the **推送** monitor. Notify v3 records attempt time separately from confirmed delivery time, message ID, delivery channel, class, strength and the TG card price. Failed delivery attempts are not shown as pushes and do not consume cooldown.

The **記錄 → TG 成效** section compares each class separately at 4h / 24h / 48h using two explicit references: the printed TG card price and the next complete 15-minute scan. It reports MFE, MAE, final return, threshold hit/order and coverage. A missing next slot, an internal data gap, or an unfinished horizon is shown as waiting/data insufficient and is never back-filled into a result.

The independent **深跌收復** detector is a separate, test-only two-stage market reminder. It watches completed native 15-minute candles for a 6–20% drawdown followed by a rising EMA20 reclaim and fresh contract-quantity OI recovery. A delivered early card can later receive a threaded resistance-reclaim confirmation; neither stage is connected to paper or automatic trading. The test feed is enabled by default, can be turned off in Settings to continue shadow collection, and is limited to one early card per sweep and ten successfully delivered early cards per Asia/Shanghai day. See [`docs/roadmap/reports/DEEP-RECLAIM-V0.md`](docs/roadmap/reports/DEEP-RECLAIM-V0.md) and [`docs/roadmap/reports/S15-DEEP-RECLAIM-2026-07-13.md`](docs/roadmap/reports/S15-DEEP-RECLAIM-2026-07-13.md).

Run `npm run eval-deep-selection` to audit forward Top-1 fidelity. `UNAVAILABLE` means no current-protocol OI-qualified selection round has occurred yet; `FAIL` identifies ordering, selected-watch, duplicate-content, armed-without-round or delivery-without-round drift and exits non-zero.

## Ultimate Money Maker v1 research layer

The Strategy tab is now an evidence-first **Strategy Lab**. It ranks nothing by
20x ROI or one-off MFE. Each strategy has its own sparse candidate/outcome audit
stream, next-native-15m execution, 30 bps plus actual funding, 60 bps stress,
coverage, drawdown and promotion decision. B2, ordinary EMA20 reclaim, B2 plus
quantity OI, organic-spot v0 and true spot-led v1 run as forward shadow research;
none sends Telegram or opens a live trade.

The recorder maintains a separate atomic 140-bar hourly market store. Only
completed, contiguous clock-aligned bars can fire `boarding-b2-v1`; a new store
is seeded in bounded batches and never backfills a shadow trade. The fixed
`balanced-v1` paper policy is unleveraged and caps risk at 0.5% per trade, 20%
notional per coin, four positions and 2% total open risk, with a -1.5% UTC daily
stop and a persistent 10% drawdown lock.

The current April-June replay is in
[`docs/roadmap/reports/UMM-V1-HISTORICAL.md`](docs/roadmap/reports/UMM-V1-HISTORICAL.md).
It is deliberately a gate report rather than a profitability claim.

The matched spot/perp replay is in
[`docs/roadmap/reports/UMM-SPOT-LED-V1.md`](docs/roadmap/reports/UMM-SPOT-LED-V1.md).
Recording v7 keeps perp and spot taker-buy shares as separate fields; `spot-led-v1`
fails closed unless the completed-bar spot value is available.

## Run continuously in the background

The control script installs two per-user Startup launchers without administrator access:

- Yaobi Hunter desktop app
- 24/7 headless market recorder and notifier

From PowerShell in the project directory:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 install
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 resume
```

Optional desktop KILL and RESUME shortcuts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 shortcuts
```

Control commands:

```powershell
# Show app, recorder, auto-start, and kill-switch state
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 status

# Stop all Yaobi processes and keep them off after reboot
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 kill

# Clear the kill switch and start the app plus recorder
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 resume

# Remove Startup launchers
powershell -ExecutionPolicy Bypass -File scripts\yaobi-ctl.ps1 uninstall
```

The master kill switch is `%LOCALAPPDATA%\YaobiHunter\KILL`. While it exists, background jobs remain disabled, including after Windows restarts.

## Local data

Yaobi Hunter keeps its runtime data on the local machine:

| Data | Location |
| --- | --- |
| Settings, pins, notification config, cooldowns, and warm OI state | `%LOCALAPPDATA%\YaobiHunter\kv.json` |
| Daily scan and notification records | `%LOCALAPPDATA%\YaobiHunter\recordings\YYYY-MM-DD.jsonl` |
| Atomic active post-push watch state | `%LOCALAPPDATA%\YaobiHunter\entry-watch.json` |
| Atomic completed 1H market store | `%LOCALAPPDATA%\YaobiHunter\market-1h.json` |
| Active strategy shadow candidates | `%LOCALAPPDATA%\YaobiHunter\strategy-shadow.json` |
| Server-owned Strategy Lab summary | `%LOCALAPPDATA%\YaobiHunter\strategy-lab.json` |
| Master stop marker | `%LOCALAPPDATA%\YaobiHunter\KILL` |

The Telegram Bot Token is sensitive. Do not commit `kv.json`, paste the token into issues, or share it in screenshots. Use **設定 → 匯出備份** when moving user settings to another installation.

## Data sources and behaviour

- Futures market data: Binance public Futures endpoints.
- Spot confirmation data: Binance public Spot endpoints.
- Liquidation collection: OKX public liquidation-order data, used by the headless recorder because Binance no longer provides the equivalent public REST feed.
- Scan cadence: aligned to rolling 15-minute sweeps.
- Coin detail refresh: live background refresh while the detail view remains open.
- Offline handling: the last good cached scan is retained; a seeded demo dataset is available when live data cannot be reached.

The app normalises Binance multiplier symbols such as `1000PEPE` so prices and labels remain understandable at the individual-coin level.

## Project structure

```text
src/
  components/       React screens, tables, charts, settings, and push monitor
  data/             Binance/OKX clients, scanning, cache, and mock data
  lib/              Analysis, signals, recording, notification, and evaluation logic
  App.tsx            Main application state and routing
  theme.css          Shared theme and component styling

scripts/
  recorder.ts        24/7 headless scanner and notifier
  notifyHeadless.ts  Telegram/Windows delivery and successful-push logging
  entryWatchFile.ts  Atomic recorder-owned post-push watch persistence
  deepReclaimFile.ts Atomic two-stage deep-reclaim watch persistence
  deepReclaimRuntime.ts Deep-reclaim scan, quota, delivery, and confirmation runtime
  server.cjs         Local server embedded in the Windows executable
  make-exe.mjs       Windows single-executable packager
  yaobi-ctl.ps1      Auto-start, status, kill, resume, and uninstall controls
  backtest*.ts       Historical research harnesses

docs/                Roadmap and research notes
sea/                 Generated desktop executable and SEA build files
dist/                Generated production web bundle
```

Important UI files:

- `src/components/ScreenerList.tsx` — main scanner table and 24H sparklines
- `src/components/PushWatchView.tsx` — Telegram push-price monitor
- `src/components/CoinDetail.tsx` — detailed coin view
- `src/components/ChartPanels.tsx` — synced price, OI, funding, and strength charts
- `src/components/SettingsView.tsx` — notification configuration and backups

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run typecheck` | Run TypeScript checks without emitting files. |
| `npm run build` | Build the production web bundle. |
| `npm run preview` | Preview the production bundle. |
| `npm run test:all` | Run every deterministic unit/integration test script used by CI. |
| `npm run package:windows` | Typecheck, build, package, checksum, and stage a Windows release ZIP. |
| `npm run recorder` | Start the headless 15-minute recorder. |
| `npm run eval-rec` | Evaluate recorded signals and forward returns. |
| `npm run backtest` | Run the hourly historical signal harness. |
| `npm run backtest5m` | Run the 5-minute Binance Vision harness. |
| `npm run backtest-umm` | Replay the fixed UMM v1 B2/control definitions with actual funding and write the gate report. |
| `npm run cache-spot5m` | Cache multiplier-aware Binance Vision spot 5m months for matched research. |
| `npm run backtest-spot-led` | Compare momentum, frozen organic proxy and true spot-led with the common evaluator. |
| `npm run test-strategy-lab` | Test causal next-open execution, costs, coverage, ordering and promotion gates. |
| `npm run test-boarding-b2` | Test the single shared completed-1H B2 definition. |
| `npm run test-hourly-market` | Test 1H seeding, 5m clock aggregation, gaps and atomic restart state. |
| `npm run test-portfolio-paper` | Test balanced-v1 sizing, exposure caps, daily stop and drawdown lock. |
| `npm run test-strategy-shadow` | Test organic/true spot shadow semantics and fail-closed inputs. |
| `npm run test-paper` | Test paper-trading state logic. |
| `npm run test-strategy` | Test strategy-report calculations. |
| `npm run test-strategy-ui` | Guard the simplified Strategy and paper-trade interface. |
| `npm run eval-paper-entry` | Compare frozen immediate and next-observation entry mechanisms without parameter search. |
| `npm run test-signal-log` | Test signal-log behaviour. |
| `npm run test-regime` | Test market-regime handling. |
| `npm run entry-watch` | Rebuild the frozen post-push historical gate and controls. |
| `npm run deep-reclaim` | Run the cache-only deep-reclaim research and promotion gate. |
| `npm run test-deep-reclaim` | Test the deep-reclaim detector and state machine. |
| `npm run test-deep-reclaim-runtime` | Test quota, delivery, restart, and threaded confirmation behaviour. |
| `npm run test-oi-quantity` | Test quantity-OI storage, as-of lookup, and recording compatibility. |
| `npm run test-research-gate` | Test deterministic matched-lift, purged walk-forward, and block-bootstrap guardrails. |
| `npm run test-entry-watch` | Test the post-push state machine and atomic persistence. |
| `npm run test-notify-entry` | Test Telegram threading, cooldown, retry, v3 provenance, and delivered/watchable separation. |
| `npm run test-push-watch` | Test push/watch JSONL compatibility, statuses, matching, and distance display data. |
| `npm run test-signal-events` | Test v1/v2/v3 signal parsing, symbol filtering, strict next-slot coverage, MFE/MAE, and target ordering. |

Most research commands accept extra flags after `--`, for example:

```powershell
npm run backtest -- --mode breakout --target 15 --horizon 24
npm run eval-rec -- --json
```

## Development notes

- The working market series uses 5-minute base candles and aggregates them for 15m, 1h, and 4h views.
- Full scan rows use a compact `CoinLite` representation; complete series are loaded on demand for detail views.
- Recording formats are append-only and backward-readable so older local evidence remains usable.
- Signal promotion is evidence-gated. Experimental detectors may be recorded for evaluation without appearing as live badges or alerts.
- Generated folders such as `dist/`, `sea/`, and `scripts/.build/` should be rebuilt after relevant source changes.

## Troubleshooting

### The app stays on loading

- Confirm internet access to Binance public endpoints.
- Check whether a firewall or regional restriction is blocking the requests.
- Wait for the rolling scan to finish its first batches.
- Run the desktop health check by opening `http://127.0.0.1:4780/__yaobi_ping__`.

### Telegram test fails

- Confirm the Bot Token was copied without spaces.
- Send a message to the bot before using **偵測**.
- Check that the detected Chat ID is correct.
- Ensure the background recorder is running with `yaobi-ctl.ps1 status`.

### Background jobs return after reboot

Use `yaobi-ctl.ps1 kill`. Closing only the app window does not disable the installed Startup recorder.

### The push monitor is empty

- It only shows Telegram deliveries confirmed as successful.
- Choose **7日** to widen the time range.
- Ensure the recorder is running and Telegram is configured.
- Current-price and sparkline fields appear after that symbol is included in the live scan cache.

## Disclaimer

Cryptocurrency derivatives are high risk. Signal labels, strength scores, backtests, paper trades, and interpretation text are analytical aids only. Historical lift does not guarantee future performance. Verify data independently and make your own risk decisions.
