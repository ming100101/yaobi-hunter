# Contributing

Yaobi Hunter is a Windows-first public Beta. Small, reviewable changes with a
clear reason and test evidence are welcome.

## Before opening a change

1. Do not commit Telegram credentials, local backups, recordings, market-data
   caches, or generated executables.
2. Keep strategy rules causal: use only data known at the decision time.
3. Do not describe a backtest, paper trade, score, or signal as guaranteed
   profit or financial advice.
4. Preserve backward reading of existing local schemas unless a migration is
   explicitly included.

## Local checks

```powershell
npm install
npm run typecheck
npm run build
npm run test-strategy-lab
npm run test-signal-events
npm run test-notify-entry
```

For detector or execution-policy changes, include the relevant causal replay,
cost assumptions, sample coverage, and failure cases in the pull request.
