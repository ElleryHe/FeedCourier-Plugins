# ntfy Push

Official single-file JavaScript channel plugin (`Plugin API v1`, `runtime: "js"`) for delivering FeedCourier RSS articles to **[ntfy.sh](https://ntfy.sh)** or a self-hosted ntfy server.

**English** | [简体中文](./README.zh-CN.md) | [Plugin API v1](../../../docs/plugin-api/v1.md)

## Features

- Zero external services or Docker sidecars required — installs with one click from the FeedCourier Plugin Marketplace and runs inside FeedCourier's sandboxed JS runtime.
- **Account fields**: `server_url` (required, default `https://ntfy.sh`), `access_token` (optional `Bearer` token for protected topics).
- **Destination fields**: `topic` (required), `priority` (`min`, `low`, `default`, `high`, `urgent`), `tags` (comma-separated emoji/tag slugs).
- **Hardened delivery**:
  - Strict `server_url` normalization (rejects embedded credentials, strips query/hash).
  - Automatic RFC 2047 UTF-8 Base64 encoding for non-ASCII `Title` headers.
  - Code-point-safe UTF-8 byte truncation (`<= 4096` bytes) without corrupting CJK text or emoji.
  - `Click` header automatically forwards `entry.url` (compatible with `link-rewrite`).
  - Automatic retry mapping: `429` (honors `Retry-After`) and `5xx` → `retry`; `4xx` → `permanent_failure`.

## Allowed Hosts

- Default allowed host: `ntfy.sh`
- Self-hosted ntfy servers are allowed automatically when configured in the channel account's `server_url` (still protected by FeedCourier's SSRF guard).

## Installation

1. Open FeedCourier WebUI → **Plugins → Marketplace**.
2. Click **Install** on **ntfy Push**.
3. Create an **ntfy Push** account under **Channels**, add a destination topic, and bind it to your routes.
