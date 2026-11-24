# Contributing to FeedCourier-Plugins

Thank you for contributing a plugin to the **FeedCourier Plugin Marketplace**!

## Requirements for Single-File JS Plugins (`Plugin API v1`)

1. **Directory Layout**:
   - Channel plugins live under `plugins/channels/<id>/<semver>/plugin.js`.
   - Processor plugins live under `plugins/processors/<id>/<semver>/plugin.js`.
   - Choose a globally unique lowercase `id` matching `^[a-z0-9][a-z0-9_-]{1,63}$`.
   - Include `README.md` and `README.zh-CN.md` at `plugins/<kind>/<id>/`, and `CHANGELOG.md` beside every `plugin.js`.
2. **Sandbox & Pure ECMAScript Compliance**:
   - **Zero `import` statements** (static or dynamic) — each release is a single self-contained ES Module.
   - **Synchronous execution only** — do not use `async`/`await` or return Promises.
   - Use standard ES2024 built-ins plus `globalThis.fc` (`fc.fetch`, `fc.base64Encode`, `fc.truncateUtf8Bytes`, `fc.utf8ByteLength`, `fc.sha256`, `fc.hmacSha256`, `fc.md5`, `fc.htmlToText`, `fc.unixNow`, `fc.uuid`).
   - Do **not** rely on Node.js or WHATWG Web APIs (`new URL`, `Buffer`, `TextEncoder`, `AbortSignal`, `fetch`, `console`, `process`).
3. **Metadata & Schemas**:
   - Export `meta` with `"api_version": "1"`, valid SemVer `version` and `min_core`, `allowed_hosts` (normalized lowercase `host[:port]` strings without wildcards), and JSON Schemas (`account_schema`/`destination_schema` or `instance_schema`/`route_option_schema`).
   - Mark all secret fields (tokens, passwords, device keys) with `"format": "password"`.
   - See [`docs/plugin-api/v1.md`](./docs/plugin-api/v1.md) and [`templates/`](./templates/).
4. **Unit Tests**:
   - Add zero-dependency tests under `tests/<id>.test.mjs` covering `validate`, `test`, happy-path execution, UTF-8 truncation, error/retry status mapping, and network failure handling.
5. **Immutable Releases**:
   - Once a `<semver>` directory has been published on `main`, submit updates in a new SemVer directory instead of modifying previous versions.

## Submitting a Pull Request

1. Fork this repository and create a branch from `main`.
2. Add your plugin files and unit tests.
3. Validate locally with Node.js 24+:
   ```bash
   node scripts/build-index.mjs --check
   node --test tests/*.test.mjs
   ```
4. **Do not commit manual edits to `index.json`** in plugin-submission PRs. Once merged, `.github/workflows/build-index.yml` automatically rebuilds and commits `index.json` on `main`.
5. Complete the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md` and open a pull request.

## License

By submitting a pull request to this repository, you agree to license your contribution under **AGPL-3.0** as described in [`LICENSE`](./LICENSE).
