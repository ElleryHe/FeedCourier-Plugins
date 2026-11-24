# 0.3.1

- Migrated `ntfy` from the legacy out-of-process HTTP Bridge sidecar to a single-file ES Module (`plugin.js`, Plugin API v1) running directly inside FeedCourier's sandboxed JS runtime.
- Preserved all hardening rules: strict `server_url` normalization (rejects embedded credentials, strips query/fragment and trailing slashes), RFC 2047 UTF-8 Base64 `Title` encoding for non-ASCII titles, code-point-safe `<= 4096` UTF-8 byte truncation, and `429` (`Retry-After`) / `5xx` / `4xx` retry mapping.
