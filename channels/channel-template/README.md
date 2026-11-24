# FeedCourier Channel Bridge Template (Node.js 24, Zero Dependencies)

A minimal, zero-dependency starter kit for writing out-of-process **FeedCourier HTTP Bridge Channel Plugins** (`Plugin Protocol v1`, `FeedCourier >= 0.3.1`).

## Features Included

- Uses strictly built-in Node.js 24 modules (`node:http`, `node:crypto`) — no `package.json` or `npm install` needed.
- Constant-time HMAC-SHA256 verification (`X-FeedCourier-Timestamp`, `X-FeedCourier-Signature`) with a `±300s` replay window.
- Implements all four required endpoints:
  - `GET /manifest`
  - `POST /validate`
  - `POST /test`
  - `POST /deliver`
- Includes `mapUpstreamStatusToOutcome()` to map upstream `2xx` / `429` (`Retry-After`) / `5xx` / `4xx` responses cleanly to FeedCourier's outbox outcomes.

## Quick Start

```bash
# Run unit tests
node --test server.test.mjs

# Start locally
BRIDGE_SECRET="change-me-strong-secret" PORT=8787 node server.mjs
```

## Docker Compose

```yaml
services:
  my-channel-bridge:
    build: ./channels/channel-template
    environment:
      BRIDGE_SECRET: "change-me-strong-secret"
      PORT: "8787"
    restart: unless-stopped
```

Register `http://my-channel-bridge:8787` and the same `BRIDGE_SECRET` inside FeedCourier WebUI → **Plugins → Add Bridge Plugin**.
