# FeedCourier Plugin Marketplace Specification

The `ElleryHe/FeedCourier-Plugins` repository hosts the official plugin catalog, single-file JS plugin releases (`plugin.js`), built-in plugin metadata, and the auto-generated [`index.json`](../index.json).

## Directory Layout

```text
plugins/
  builtin/
    <id>/
      manifest.json          # Built-in Rust plugin metadata
      README.md
      README.zh-CN.md
  channels/
    <id>/
      README.md
      README.zh-CN.md
      <semver>/
        plugin.js            # Single-file ES Module (zero imports)
        CHANGELOG.md
  processors/
    <id>/
      README.md
      README.zh-CN.md
      <semver>/
        plugin.js            # Single-file ES Module (zero imports)
        CHANGELOG.md
```

## Generated `index.json` Format

`node scripts/build-index.mjs` validates all manifests and JS plugins, computes exact UTF-8 `sha256` checksums for every `plugin.js`, sorts versions in descending SemVer 2.0.0 order, and writes `index.json`:

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-25T00:00:00Z",
  "plugins": [
    {
      "id": "bark",
      "name": "Bark Push",
      "version": "0.3.1",
      "api_version": "1",
      "kind": "channel",
      "runtime": "js",
      "min_core": "0.3.1",
      "category": "delivery",
      "icon": "bell",
      "description": "English summary...",
      "description_i18n": {
        "en": "English summary...",
        "zh": "中文简介..."
      },
      "homepage": "https://feedcourier.ellery.me/plugins/js-plugins",
      "repository": "https://github.com/ElleryHe/FeedCourier-Plugins/tree/main/plugins/channels/bark",
      "hooks": [],
      "permissions": ["network"],
      "allowed_hosts": ["api.day.app"],
      "latest": "0.3.1",
      "versions": [
        {
          "version": "0.3.1",
          "min_core": "0.3.1",
          "path": "plugins/channels/bark/0.3.1/plugin.js",
          "sha256": "<64-char lowercase hex>",
          "changelog_path": "plugins/channels/bark/0.3.1/CHANGELOG.md",
          "changelog": "..."
        }
      ]
    }
  ]
}
```

## Integrity & Upgrades

- **Immutable versions**: Once a `<semver>` directory is published on `main`, ship fixes in a new SemVer directory (e.g. `0.3.2/plugin.js`) rather than mutating old releases in place.
- **SHA-256 verification**: FeedCourier downloads `path` from the marketplace raw repository, verifies its SHA-256 digest against `index.json`, and checks `api_version` + `min_core` before installing or upgrading.
- **Offline fallback**: FeedCourier bundles a snapshot of `index.json` (`src/plugins/market_snapshot.json`) so air-gapped deployments can still browse official plugin metadata.

## CI Automation

- **Pull Requests** (`.github/workflows/validate.yml`):
  - Rejects manual edits to `index.json`.
  - Runs `node scripts/build-index.mjs --check` (schema validation, zero-import & Boa-sandbox lint, dynamic ESM export check).
  - Runs `node --test tests/*.test.mjs`.
- **Merges to `main`** (`.github/workflows/build-index.yml`):
  - Rebuilds `index.json`, verifies freshness with `--check --verify-index`, and commits automatically.
