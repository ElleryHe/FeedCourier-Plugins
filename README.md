# FeedCourier Plugins Registry

Official plugin marketplace registry, **Plugin Protocol v1** schemas, and reference HTTP Bridge channel plugins for **[FeedCourier](https://github.com/ElleryHe/FeedCourier)** (`v0.3.0+`).

**English** | [简体中文](./README.zh-CN.md) | [FeedCourier Docs](https://feedcourier.ellery.me/plugins/)

---

## How the Marketplace Index Works

1. Each plugin listing lives as an individual JSON file under [`registry/<id>.json`](./registry/) conforming strictly to [`schema/manifest.schema.json`](./schema/manifest.schema.json) (JSON Schema Draft 2020-12, Plugin Protocol `api_version: "1"`).
2. Out-of-process **HTTP Bridge Plugins** (`runtime: "bridge"`, `FeedCourier >= 0.3.1`) follow [`schema/bridge-protocol.schema.json`](./schema/bridge-protocol.schema.json) (`GET /manifest`, `POST /validate`, `POST /test`, `POST /deliver`, `POST /hooks/on_render`, `POST /hooks/on_delivered`, HMAC-SHA256 signed with a `±300s` replay window).
3. On every pull request, GitHub Actions validates all manifests (`node scripts/build-index.mjs --check`) and runs the zero-dependency Node.js 24 bridge test suite (`node --test channels/*/*.test.mjs`).
4. When merged to `main`, GitHub Actions automatically rebuilds and commits [`index.json`](./index.json). Running FeedCourier instances fetch it with a 6-hour cache and an offline snapshot fallback.

## Repository Layout

```text
schema/manifest.schema.json          # Draft 2020-12 JSON Schema for Plugin Protocol v1 manifests
schema/bridge-protocol.schema.json   # HTTP Bridge Protocol v1 wire request/response schemas
registry/link-rewrite.json           # Built-in Link Rewrite (YOURLS) processor plugin
registry/ntfy.json                   # Reference ntfy Push HTTP Bridge channel plugin
channels/channel-template/           # Zero-dependency Node.js 24 starter kit + Dockerfile + tests
channels/ntfy/                       # Reference ntfy channel bridge implementation + Dockerfile + tests
scripts/build-index.mjs              # Zero-dependency Node.js 24+ validator & index builder
index.json                           # Aggregated marketplace index (auto-generated on main)
.github/workflows/validate.yml       # PR manifest validation & channel bridge unit tests
.github/workflows/build-index.yml    # Automatic index.json rebuild on push to main
```

## Plugin Runtimes (Protocol v1)

- **Built-in (`runtime: "builtin"`, `v0.3.0+`)**: First-party Rust plugins compiled into the FeedCourier binary (such as `link-rewrite`).
- **HTTP Bridge (`runtime: "bridge"`, `v0.3.1+`)**: Out-of-process sidecar / microservice containers implementing custom **Channel Plugins** (`kind: "channel"`, `/deliver`) or **Processor Plugins** (`kind: "processor"`, `on_render` / `on_delivered`). Register your bridge URL and shared HMAC secret directly in FeedCourier WebUI → **Plugins → Add Bridge Plugin** — only the registered `host:port` is contacted directly without relaxing `SSRF_ALLOWLIST`.

## Local Validation & Tests

Requires **Node.js 24+** (zero external npm dependencies):

```bash
# Validate schemas and all registry/*.json files
node scripts/build-index.mjs --check

# Rebuild index.json locally and verify freshness
node scripts/build-index.mjs && node scripts/build-index.mjs --check --verify-index

# Run reference bridge plugin unit tests
node --test channels/*/*.test.mjs
```

## Submitting a Plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [FeedCourier Plugin Development Guide](https://feedcourier.ellery.me/plugins/development) for full submission requirements.

## License

Licensed under the **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))**, matching the core FeedCourier repository.
