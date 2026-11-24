# FeedCourier Plugins Marketplace

Official single-file JavaScript plugin marketplace, **Plugin API v1** specification, and built-in plugin catalog for **[FeedCourier](https://github.com/ElleryHe/FeedCourier)** (`v0.3.1+`).

**English** | [简体中文](./README.zh-CN.md) | [Plugin API v1](./docs/plugin-api/v1.md) | [Marketplace Spec](./docs/marketplace.md)

---

## Highlights

- **Single-file JS Plugins (`plugin.js`)**: Every channel or processor plugin release is a self-contained ES Module executed synchronously inside FeedCourier's embedded pure-ECMAScript sandbox (`globalThis.fc`) — **no Docker sidecars, no external Node.js daemon, one-click install from WebUI**.
- **SHA-256 Verified Releases**: [`scripts/build-index.mjs`](./scripts/build-index.mjs) validates every plugin, enforces zero-import & sandbox compliance, computes exact UTF-8 `sha256` checksums, and builds [`index.json`](./index.json).
- **Zero-dependency Tooling & Tests**: Validation, index generation, and unit tests run natively on **Node.js 24+** with zero npm dependencies.

## Official Plugins

| Plugin | Kind | Runtime | Description |
| --- | --- | --- | --- |
| [**Bark Push**](./plugins/channels/bark/) | `channel` | `js` | Push RSS article summaries to iOS/macOS via Bark (`api.day.app` or self-hosted) in Telegram Compact Card style |
| [**ntfy Push**](./plugins/channels/ntfy/) | `channel` | `js` | Deliver RSS articles as push notifications to `ntfy.sh` or self-hosted ntfy servers |
| [**Link Rewrite (YOURLS)**](./plugins/builtin/link-rewrite/) | `builtin` | `builtin` | Rewrite outgoing article links via self-hosted YOURLS providers with SQLite caching |

## Repository Structure

```text
plugins/
  builtin/link-rewrite/              # Built-in Rust plugin manifest & docs
  channels/ntfy/0.3.1/plugin.js      # Official ntfy Push channel plugin
  channels/bark/0.3.1/plugin.js      # Official Bark Push channel plugin (Compact Card style)
docs/
  marketplace.md                     # Marketplace architecture & index.json format
  plugin-api/v1.md                   # Plugin API v1 documentation
  plugin-api/v1.d.ts                 # TypeScript ambient definitions for globalThis.fc & hooks
templates/
  channel-plugin.example.js          # Single-file channel plugin starter template
  processor-plugin.example.js        # Single-file processor plugin starter template
schema/manifest.schema.json          # Draft 2020-12 JSON Schema for plugin meta & manifests
scripts/build-index.mjs              # Zero-dependency validator & index.json builder
tests/                               # Node.js 24 unit tests with faithful mock globalThis.fc
index.json                           # Generated marketplace index (auto-updated on main)
```

## Local Validation & Testing

Requires **Node.js 24+** (zero external npm packages):

```bash
# Validate schema, plugin sources, exports, and templates
node scripts/build-index.mjs --check

# Rebuild index.json and verify freshness
node scripts/build-index.mjs && node scripts/build-index.mjs --check --verify-index

# Run unit tests
node --test tests/*.test.mjs
```

## Contributing a Plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md), [`docs/plugin-api/v1.md`](./docs/plugin-api/v1.md), and starter templates in [`templates/`](./templates/).

## License

Licensed under the **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))**, matching the core FeedCourier repository.
