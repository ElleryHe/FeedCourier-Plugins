# Bark Push

Official single-file JavaScript channel plugin (`Plugin API v1`, `runtime: "js"`) for pushing RSS article summaries to iOS/macOS via **[Bark](https://bark.day.app/)** (`https://api.day.app` or a self-hosted Bark server).

**English** | [简体中文](./README.zh-CN.md) | [Plugin API v1](../../../docs/plugin-api/v1.md)

## Telegram Compact Card Style Formatting

Each notification is formatted for clean mobile reading:

- **Title**: Article headline (clean single line, safely truncated).
- **Subtitle**: Feed name (or `Feed · Author` when concise and distinct from the title).
- **Body**:
  - Clean article summary (`summary_text` → `plain_text` → stripped `content_html`), automatically omitted when it merely repeats the headline.
  - Compact editorial footer: `— Source · Author · YYYY-MM-DD HH:MM` (rendered in the route's timezone).
  - Strictly bounded to `<= 2400` UTF-8 bytes with code-point-safe truncation so the full JSON payload stays comfortably within APNs' 4 KB limit.
- **Tap action (`url`)**: Opens the article link directly (works seamlessly with `link-rewrite`).
- **Icon (`icon`)**: Optionally attaches the feed's HTTPS favicon.

## Configuration

- **Account fields**:
  - `server_url` (required, default `https://api.day.app`)
  - `username` & `password` (optional HTTP Basic Auth for self-hosted Bark servers)
- **Destination fields**:
  - `device_key` (required, stored encrypted at rest and masked in UI/logs)
  - `group` (optional; defaults to the Feed title)
  - `level` (`active`, `timeSensitive`, `passive`, `critical`)
  - `sound` (optional Bark sound name, e.g. `minuet`, `chime`, `alarm`)
  - `send_icon` (boolean, default `true`)

## Allowed Hosts

- Default allowed host: `api.day.app`
- Self-hosted Bark servers are allowed automatically when configured in the channel account's `server_url`.
