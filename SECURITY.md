# Security policy

## Supported version

Security fixes are made against the latest public Beta release only.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when
it is available. Do not include a real Telegram Bot Token, Chat ID, local
backup, or recording file in a public issue.

Include the affected version, Windows version, impact, and the smallest safe
set of reproduction steps. Replace all credentials and personal identifiers
with obvious placeholders.

## Credential safety

- Yaobi Hunter does not require exchange API keys.
- Telegram credentials are stored locally and should be rotated immediately if
  they are exposed.
- Download releases only from this repository's GitHub Releases page.
- Verify the published SHA-256 checksum before running a downloaded build.
