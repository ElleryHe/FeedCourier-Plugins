/**
 * FeedCourier HTTP Bridge Channel Plugin Template (Protocol v1)
 * Zero external dependencies — requires Node.js 24+.
 *
 * Implements:
 *   - HMAC-SHA256 verification (`X-FeedCourier-Timestamp`, `X-FeedCourier-Signature`, ±300s window)
 *   - GET  /manifest
 *   - POST /validate
 *   - POST /test
 *   - POST /deliver
 *   - GET  /healthz (unauthenticated liveness probe)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const SIGNATURE_WINDOW_SECS = 300;
export const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MiB

export const DEFAULT_MANIFEST = {
  id: "channel-template",
  name: "Channel Template",
  version: "0.3.1",
  api_version: "1",
  kind: "channel",
  runtime: "bridge",
  min_core: "0.3.1",
  category: "delivery",
  icon: "send",
  description:
    "Zero-dependency Node.js 24 starter template for building custom FeedCourier HTTP Bridge channel plugins.",
  homepage: "https://feedcourier.ellery.me/plugins/bridge-channels",
  hooks: [],
  permissions: ["network"],
  account_schema: {
    type: "object",
    required: ["endpoint_url"],
    properties: {
      endpoint_url: {
        type: "string",
        format: "uri",
        title: "Endpoint URL",
        placeholder: "https://hooks.example.com/ingest",
        description: "Target HTTPS endpoint receiving notifications.",
      },
      api_token: {
        type: "string",
        format: "password",
        title: "API Token (Optional)",
        description: "Optional bearer token sent in the Authorization header.",
      },
    },
  },
  destination_schema: {
    type: "object",
    required: ["channel"],
    properties: {
      channel: {
        type: "string",
        title: "Target Channel / Room",
        placeholder: "general",
        description: "Logical destination identifier forwarded to your upstream.",
      },
    },
  },
  capabilities: {
    supports_html: false,
    max_text_len: 4096,
  },
};

/**
 * Compute `v1=<hex(HMAC-SHA256(secret, "{timestamp}.{body}"))>`.
 */
export function signRequest(secret, timestampSecs, bodyBuf) {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestampSecs}.`);
  mac.update(bodyBuf);
  return `v1=${mac.digest("hex")}`;
}

/**
 * Verify FeedCourier bridge HMAC signature within ±300 seconds using constant-time comparison.
 */
export function verifySignature(
  secret,
  timestampHeader,
  signatureHeader,
  rawBody,
  nowSecs = Math.floor(Date.now() / 1000),
) {
  if (!secret || typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
    return { ok: false, reason: "Missing authentication headers" };
  }
  const ts = Number.parseInt(timestampHeader.trim(), 10);
  if (!Number.isFinite(ts) || String(ts) !== timestampHeader.trim()) {
    return { ok: false, reason: "Invalid X-FeedCourier-Timestamp header" };
  }
  if (Math.abs(nowSecs - ts) > SIGNATURE_WINDOW_SECS) {
    return { ok: false, reason: "Request timestamp outside ±300s replay window" };
  }
  const expected = signRequest(secret, ts, rawBody);
  const actual = signatureHeader.trim();
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "Invalid HMAC signature" };
  }
  return { ok: true };
}

/**
 * Parse HTTP Retry-After header (delta-seconds or HTTP-date) into positive seconds.
 */
export function parseRetryAfterSecs(header) {
  if (!header) return undefined;
  const trimmed = String(header).trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number.parseInt(trimmed, 10);
    return secs > 0 ? secs : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = Math.ceil((dateMs - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

/**
 * Map an upstream HTTP status code into a Protocol v1 `/deliver` response payload.
 */
export function mapUpstreamStatusToOutcome(status, retryAfterHeader, bodyPreview = "") {
  const snippet = String(bodyPreview).slice(0, 240);
  if (status >= 200 && status < 300) {
    return { outcome: "delivered" };
  }
  if (status === 429) {
    return {
      outcome: "retry",
      retry_after_secs: parseRetryAfterSecs(retryAfterHeader) ?? 60,
      diagnostic: `Upstream rate limited (429)${snippet ? `: ${snippet}` : ""}`,
    };
  }
  if (status >= 500) {
    return {
      outcome: "retry",
      retry_after_secs: parseRetryAfterSecs(retryAfterHeader),
      diagnostic: `Upstream server error (${status})${snippet ? `: ${snippet}` : ""}`,
    };
  }
  return {
    outcome: "permanent_failure",
    diagnostic: `Upstream rejected request (${status})${snippet ? `: ${snippet}` : ""}`,
  };
}

function isValidHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      throw Object.assign(new Error("Request body exceeds 1 MiB limit"), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Build a Protocol v1 HTTP Bridge server.
 * Fork and customize `manifest`, `validate`, `test`, and `deliver` for your own channel!
 */
export function createBridgeServer({
  secret,
  manifest = DEFAULT_MANIFEST,
  validate = defaultValidate,
  test = defaultTest,
  deliver = defaultDeliver,
} = {}) {
  if (!secret) {
    throw new Error("BRIDGE_SECRET is required");
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/healthz") {
        return sendJson(res, 200, { ok: true, id: manifest.id, version: manifest.version });
      }

      const rawBody = await readBody(req);
      const auth = verifySignature(
        secret,
        req.headers["x-feedcourier-timestamp"],
        req.headers["x-feedcourier-signature"],
        rawBody,
      );
      if (!auth.ok) {
        return sendJson(res, 401, { ok: false, error: auth.reason });
      }

      if (req.method === "GET" && url.pathname === "/manifest") {
        return sendJson(res, 200, manifest);
      }

      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "Method not allowed" });
      }

      let payload;
      try {
        payload = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      }

      if (url.pathname === "/validate") {
        const result = await validate(payload);
        return sendJson(res, result.ok ? 200 : 400, result);
      }
      if (url.pathname === "/test") {
        const result = await test(payload);
        return sendJson(res, result.ok ? 200 : 502, result);
      }
      if (url.pathname === "/deliver") {
        const result = await deliver(payload);
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { ok: false, error: `Unknown endpoint: ${url.pathname}` });
    } catch (err) {
      const status = err?.statusCode ?? 500;
      return sendJson(res, status, { ok: false, error: err?.message ?? "Internal error" });
    }
  });
}

function defaultValidate({ scope, config }) {
  if (!config || typeof config !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  if (scope === "account") {
    const endpoint = String(config.endpoint_url ?? "").trim();
    if (!isValidHttpUrl(endpoint)) {
      return { ok: false, error: "endpoint_url must be a valid http(s) URL" };
    }
    return {
      ok: true,
      normalized_config: {
        ...config,
        endpoint_url: endpoint.replace(/\/+$/, ""),
      },
    };
  }
  if (scope === "destination") {
    const channel = String(config.channel ?? "").trim();
    if (!channel) {
      return { ok: false, error: "channel must not be empty" };
    }
    return { ok: true, normalized_config: { ...config, channel } };
  }
  return { ok: true, normalized_config: config };
}

async function defaultTest({ scope, account, destination }) {
  if (scope === "account") {
    return {
      ok: true,
      message: `Template account ready (${account?.endpoint_url ?? "unconfigured"})`,
    };
  }
  return {
    ok: true,
    message: `Template destination "${destination?.channel ?? "default"}" verified`,
  };
}

async function defaultDeliver({ idempotency_key, entry, destination }) {
  // Replace this stub with your real upstream API call and map status codes using
  // `mapUpstreamStatusToOutcome(resp.status, resp.headers.get("retry-after"), text)`.
  return {
    outcome: "delivered",
    external_id: `tpl-${String(idempotency_key).slice(0, 12)}`,
    diagnostic: `Delivered "${entry?.title ?? "(Untitled)"}" to ${destination?.channel ?? "default"}`,
  };
}

// Start HTTP server only when executed directly (`node server.mjs`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.BRIDGE_SECRET?.trim();
  if (!secret) {
    console.error("Error: BRIDGE_SECRET environment variable must be set.");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createBridgeServer({ secret });
  server.listen(port, host, () => {
    console.log(`[${DEFAULT_MANIFEST.id}] bridge listening on http://${host}:${port}`);
  });
}
