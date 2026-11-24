# FeedCourier ntfy Push Channel Plugin

Official reference HTTP Bridge channel plugin (`Plugin Protocol v1`) for delivering FeedCourier articles to **[ntfy.sh](https://ntfy.sh)** or a self-hosted ntfy server.

- Zero external npm dependencies (Node.js 24+ `node:http`, `node:crypto`, built-in `fetch`).
- Account fields: `server_url` (required, default `https://ntfy.sh`), `access_token` (optional bearer token).
- Destination fields: `topic` (required), `priority` (`min` / `low` / `default` / `high` / `urgent`), `tags` (comma-separated).
- Automatic retry mapping: `429` (honors `Retry-After`) and `5xx` → `retry`; `4xx` → `permanent_failure`.

## Docker Compose

```yaml
services:
  feedcourier-ntfy:
    image: ghcr.io/elleryhe/feedcourier-plugin-ntfy:latest
    # Or build directly from source:
    # build: ./channels/ntfy
    environment:
      BRIDGE_SECRET: "replace-with-strong-secret"
      PORT: "8787"
    restart: unless-stopped
```

Register `http://feedcourier-ntfy:8787` and your `BRIDGE_SECRET` in FeedCourier WebUI → **Plugins → Add Bridge Plugin**, then create an **ntfy Push** channel account under **Channels**.

To migrate the sidecar address or rotate `BRIDGE_SECRET` later without deleting existing channels or routes, use **Plugins → Edit Connection** (`PATCH /api/v1/plugins/ntfy`), which verifies the new connection with a live signed `GET /manifest` probe before saving.

## Run Tests

```bash
node --test ntfy.test.mjs
```
