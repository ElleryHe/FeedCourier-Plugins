# FeedCourier Plugins Registry

Official plugin marketplace registry and Protocol v1 manifest schema for **[FeedCourier](https://github.com/ElleryHe/FeedCourier)** (`v0.3.0+`).

**English** | [简体中文](./README.zh-CN.md) | [FeedCourier Docs](https://feedcourier.ellery.me/plugins/)

---

## How the Marketplace Index Works

1. Each plugin listing lives as an individual JSON file under [`registry/<id>.json`](./registry/) conforming strictly to [`schema/manifest.schema.json`](./schema/manifest.schema.json) (JSON Schema Draft 2020-12, Plugin Protocol `api_version: "1"`).
2. On every pull request, GitHub Actions runs `node scripts/build-index.mjs --check` to validate manifests, ID uniqueness, SemVer syntax, and HTTPS URLs.
3. When a pull request is merged to `main`, GitHub Actions automatically runs `node scripts/build-index.mjs` and commits the aggregated [`index.json`](./index.json).
4. Running **FeedCourier** instances fetch `https://raw.githubusercontent.com/ElleryHe/FeedCourier-Plugins/main/index.json` through the SSRF-protected HTTP client (cached in memory for 6 hours, overridable via `PLUGIN_INDEX_URL`), falling back to the compiled-in snapshot (`src/plugins/market_snapshot.json`) in air-gapped environments. The **[FeedCourier documentation site](https://feedcourier.ellery.me/plugins/)** loads the same index at build time.

## Repository Layout

```text
schema/manifest.schema.json       # Draft 2020-12 JSON Schema for Plugin Protocol v1
registry/link-rewrite.json        # First-party Link Rewrite (YOURLS) plugin manifest
scripts/build-index.mjs           # Zero-dependency Node.js 24+ validator & index builder
index.json                        # Aggregated marketplace index (auto-generated on main)
.github/workflows/validate.yml    # PR manifest validation workflow
.github/workflows/build-index.yml # Automatic index.json rebuild on push to main
```

## Phase 1 vs. Phase 2 Plugin Model

- **Phase 1 (`v0.3.0`)**: First-party plugins (such as `link-rewrite`, `kind: "builtin"`) compile directly into the single FeedCourier binary while sharing the stable Protocol v1 manifest schema, SQLite storage (`plugins`, `plugin_instances`, `plugin_link_cache`), and `on_render` hook lifecycle. Third-party plugins (`kind: "external"` or `"coming_soon"`) can already be listed for discovery with links to their documentation and repositories.
- **Phase 2 (Planned)**: Sandboxed third-party WASM/Extism runtime executing Protocol v1 hooks (`on_render`, `on_ingest`, `on_delivered`) under explicit capability grants.

## Local Validation

Requires **Node.js 24+** (zero external npm dependencies):

```bash
# Validate schema and all registry/*.json files (same check run on PRs)
node scripts/build-index.mjs --check

# Rebuild index.json locally
node scripts/build-index.mjs

# Verify index.json matches registry/*.json
node scripts/build-index.mjs --check --verify-index
```

## Submitting a Plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [FeedCourier Plugin Development Guide](https://feedcourier.ellery.me/plugins/development) for full submission requirements.

## License

Licensed under the **GNU Affero General Public License v3.0 ([AGPL-3.0](./LICENSE))**, matching the core FeedCourier repository.
