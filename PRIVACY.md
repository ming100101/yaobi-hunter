# Privacy

Last updated: 2026-07-15

Yaobi Hunter has no Yaobi Hunter account, analytics service, advertising SDK,
or project-operated cloud database. The Windows app serves its interface from
your own computer and stores settings and research records under:

```text
%LOCALAPPDATA%\YaobiHunter
```

## Network connections

The app can connect directly to public market-data endpoints operated by
Binance and OKX. If you enable Telegram notifications, it sends the configured
message and chat details to the Telegram Bot API. Those services have their
own privacy terms and may receive normal connection information such as your
IP address.

No exchange API key is required. The app does not contain an order-placement
integration.

## Sensitive local data

Your Telegram Bot Token, Chat ID, preferences, cooldown state, recordings, and
strategy research are stored locally. Treat exported backups and `kv.json` as
sensitive. Do not attach them to public issues or share screenshots containing
credentials.

Uninstalling the executable does not automatically remove local research data.
Delete `%LOCALAPPDATA%\YaobiHunter` yourself if you want to remove it.

## Website

The project landing page is a static GitHub Pages site. GitHub may process
visitor data according to GitHub's own privacy statement. The project does not
add separate analytics or tracking cookies to that page.
