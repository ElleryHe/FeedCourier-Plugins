## Plugin Submission

- **Plugin ID**: `<!-- lowercase id matching plugins/<channels|processors>/<id>/ -->`
- **Plugin Name**:
- **Version**: `<!-- SemVer 2.0.0 matching <version>/ directory -->`
- **Kind**: `channel` / `processor`
- **Homepage / Docs URL**: `https://...`
- **License**: `<!-- e.g., AGPL-3.0, MIT, Apache-2.0 -->`
- **Minimum FeedCourier Core (`min_core`)**: `<!-- e.g., 0.3.1 -->`

## Summary

<!-- Briefly explain what this plugin does, how notifications/content are formatted, and what problem it solves. -->

## Security & Network Disclosure

- **Declared `permissions`**: `<!-- e.g., [] or ["network"] -->`
- **Declared `allowed_hosts`**: `<!-- list normalized host[:port] entries (e.g., ["api.day.app"]) -->`
- **Self-hosted server support**: `<!-- describe any user-configured server_url / endpoint fields -->`
- **Credential handling**: `<!-- confirm secrets declare format: "password" in schema and are never leaked in diagnostics -->`

## Submission Checklist

- [ ] Plugin is a self-contained single-file ES Module (`plugin.js`) with **zero `import` statements**
- [ ] Uses pure ECMAScript + `globalThis.fc` only (no `new URL`, `Buffer`, `AbortSignal`, `fetch`, `console`, `async`/`await`)
- [ ] Includes `README.md`, `README.zh-CN.md`, and `<version>/CHANGELOG.md`
- [ ] Unit tests added under `tests/<id>.test.mjs` and pass via `node --test tests/*.test.mjs`
- [ ] Passes `node scripts/build-index.mjs --check` locally
- [ ] Do **not** manually edit `index.json` in this PR (GitHub Actions rebuilds `index.json` automatically on merge to `main`)
