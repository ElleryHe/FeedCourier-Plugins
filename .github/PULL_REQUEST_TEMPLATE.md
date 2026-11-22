## Plugin Submission

- **Plugin ID**: `<!-- lowercase kebab-case matching registry/<id>.json -->`
- **Plugin Name**:
- **Kind**: `external` / `coming_soon` / `builtin`
- **Repository URL**: `https://...`
- **Homepage / Docs URL**: `https://...`
- **License**: `<!-- e.g., AGPL-3.0, MIT, Apache-2.0 -->`
- **Tested FeedCourier Core Version (`min_core`)**: `<!-- e.g., 0.3.0 -->`

## Summary

<!-- Briefly explain what this plugin does, which hooks it uses, and what problem it solves. -->

## Security & SSRF Disclosure

- **Declared `permissions`**: `<!-- e.g., [] or ["network"] -->`
- **External hosts / APIs contacted** (if `"network"` is declared): `<!-- list domains or note self-hosted user-configured endpoints -->`
- **Credential handling**: `<!-- confirm secrets are stored via FeedCourier encrypted instance config and redacted in API/MCP responses -->`
- **SSRF compliance**: `<!-- confirm all outbound HTTP requests go through FeedCourier's SSRF-protected client and honor SSRF_ALLOWLIST -->`

## Submission Checklist

- [ ] Plugin `id` is globally unique, matches `^[a-z0-9][a-z0-9-]{1,47}$`, and matches `registry/<id>.json`
- [ ] Manifest validates cleanly against `schema/manifest.schema.json` (`node scripts/build-index.mjs --check` passes)
- [ ] `api_version` is `"1"`, `version` and `min_core` are valid SemVer 2.0.0, and `homepage` / `repository` use `https://`
- [ ] Plugin repository uses `AGPL-3.0` or an OSI-approved open-source license
- [ ] Security, credential handling, and SSRF outbound network usage are disclosed above
- [ ] Tested against the declared `min_core` version of FeedCourier
- [ ] Do **not** manually edit `index.json` in this PR (GitHub Actions rebuilds `index.json` automatically after merge to `main`)
