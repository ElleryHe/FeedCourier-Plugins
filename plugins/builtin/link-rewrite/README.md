# Link Rewrite (YOURLS)

Built-in FeedCourier processor plugin (`runtime: "builtin"`, `kind: "builtin"`) compiled directly into the FeedCourier binary (`v0.3.0+`).

**English** | [简体中文](./README.zh-CN.md) | [Documentation](https://feedcourier.ellery.me/plugins/link-rewrite)

## Features

- Rewrites outgoing article primary links and HTML links via one or more self-hosted **YOURLS** short-link providers during the `on_render` hook.
- Built-in SQLite short-link cache so repeated deliveries reuse shortened URLs without redundant API calls.
- Per-provider domain exclusion lists and optional **strict mode** (retry delivery if shortening fails instead of falling back to the original URL).
- Works transparently with built-in channels (Telegram, Email, Notion) as well as JS channel plugins (`ntfy`, `bark`, etc.).

## Usage

Enable **Link Rewrite (YOURLS)** in FeedCourier WebUI → **Plugins**, configure one or more YOURLS provider instances, and attach the desired provider to individual routes.
