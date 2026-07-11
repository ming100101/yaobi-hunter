# 妖幣獵手 · Yaobi Hunter

Yaobi Hunter is a Windows-first cryptocurrency perpetual-futures scanner for spotting unusual price, open-interest, volume, funding, and spot-flow behaviour across the Binance USDT perpetual market.

It includes a live desktop dashboard, Telegram alerts, a 24/7 background recorder, signal history, strategy evaluation, and detailed multi-timeframe charts.

> Educational market-analysis software only. It does not place trades and is not financial advice.

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
- Opens any row into a detailed TradingView-style chart view.
- Records completed scans as local JSONL files for later replay and evaluation.
- Runs as a standalone Windows executable with an optional background recorder.

## Main tabs

| Tab | Purpose |
| --- | --- |
| **掃描** | Live market screener, sorting, filters, signal badges, pins, and scan progress. |
| **搜尋** | Search the full Binance perpetual universe and open any coin on demand. |
| **推送** | Monitor coins successfully pushed through Telegram over the last 24 hours or 7 days. |
| **策略** | Review recorded strategy performance and signal evidence. |
| **記錄** | Replay historical scans, inspect signal events, and view the paper-trade journal. |
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

Only alerts that Telegram confirms as successfully delivered are added to the **推送** monitor. Failed delivery attempts are not shown as pushes.

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
| `npm run recorder` | Start the headless 15-minute recorder. |
| `npm run eval-rec` | Evaluate recorded signals and forward returns. |
| `npm run backtest` | Run the hourly historical signal harness. |
| `npm run backtest5m` | Run the 5-minute Binance Vision harness. |
| `npm run test-paper` | Test paper-trading state logic. |
| `npm run test-strategy` | Test strategy-report calculations. |
| `npm run test-signal-log` | Test signal-log behaviour. |
| `npm run test-regime` | Test market-regime handling. |

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
