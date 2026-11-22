# Contributing to FeedCourier-Plugins

Thank you for contributing a plugin listing to the **FeedCourier Plugin Marketplace**!

## Requirements

1. **Protocol v1 Compatibility**: Manifests must declare `"api_version": "1"` and satisfy [`schema/manifest.schema.json`](./schema/manifest.schema.json).
2. **Unique Identifier & Filename**:
   - Choose a lowercase kebab-case `id` matching `^[a-z0-9][a-z0-9-]{1,47}$`.
   - Save the manifest at `registry/<id>.json` (the filename must exactly match `manifest.id`).
3. **Kind Selection**:
   - `"builtin"` is reserved for first-party plugins compiled into `ElleryHe/FeedCourier`.
   - Use `"external"` for open-source third-party plugins targeting Protocol v1, or `"coming_soon"` for planned community listings.
4. **Open-Source License**: Listed plugins must be released under `AGPL-3.0` or another OSI-approved open-source license, with a public HTTPS `repository` and `homepage`.
5. **Security & SSRF Disclosure**:
   - Declare `"network"` in `permissions` whenever the plugin makes outbound HTTP requests.
   - Disclose contacted domains or user-configured self-hosted endpoints in your PR description.
   - Plugins must never bypass FeedCourier's SSRF guard (`SSRF_ALLOWLIST`) or leak provider secrets in API/MCP responses.

## Submitting a Pull Request

1. Fork this repository and create a branch from `main`.
2. Add or update `registry/<your-plugin-id>.json`.
3. Validate locally with Node.js 24+:
   ```bash
   node scripts/build-index.mjs --check
   ```
4. **Do not commit manual edits to `index.json`** in plugin-submission PRs. Once your PR is merged, `.github/workflows/build-index.yml` automatically rebuilds and commits `index.json` on `main`.
5. Complete the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md` and open a pull request.

## License

By submitting a pull request to this repository, you agree to license your contribution under **AGPL-3.0** as described in [`LICENSE`](./LICENSE).
