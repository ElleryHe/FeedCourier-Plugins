/**
 * FeedCourier Channel Plugin Starter Template (Plugin API v1)
 *
 * Rules for single-file JS plugins running in FeedCourier's embedded ES2024 sandbox:
 *   - Zero `import` statements (self-contained single file).
 *   - Synchronous execution only (no `async`/`await`).
 *   - Pure ECMAScript + `globalThis.fc` only (no `new URL`, `Buffer`, `AbortSignal`, `fetch`, `console`).
 */

const MAX_TEXT_BYTES = 4096;
const ENDPOINT_URL_RE = /^(https?):\/\/([^/?#@\s]+)(\/[^?#\s]*)?(?:[?#].*)?$/i;
const HOST_AUTHORITY_RE =
  /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/;

export const meta = {
  id: "webhook-example",
  name: "Custom Webhook Example",
  version: "0.3.1",
  api_version: "1",
  kind: "channel",
  min_core: "0.3.1",
  category: "delivery",
  icon: "send",
  description: {
    en: "Starter template for building single-file FeedCourier JS channel plugins (Plugin API v1).",
    zh: "用于开发 FeedCourier 单文件 JS 通道插件的参考模板（Plugin API v1）。",
  },
  homepage: "https://feedcourier.ellery.me/plugins/js-plugins",
  repository: "https://github.com/ElleryHe/FeedCourier-Plugins/tree/main/templates",
  allowed_hosts: ["hooks.example.com"],
  hooks: [],
  permissions: ["network"],
  account_schema: {
    type: "object",
    required: ["endpoint_url"],
    properties: {
      endpoint_url: {
        type: "string",
        format: "uri",
        title: "Webhook Endpoint URL",
        default: "https://hooks.example.com/ingest",
        description: "Target http(s) URL that accepts JSON webhook payloads.",
      },
      api_token: {
        type: "string",
        format: "password",
        title: "Bearer Token (Optional)",
        description: "Optional Authorization bearer token.",
      },
    },
  },
  destination_schema: {
    type: "object",
    required: ["room"],
    properties: {
      room: {
        type: "string",
        title: "Target Room / Channel",
        placeholder: "general",
        description: "Logical room or channel name sent in the payload.",
      },
    },
  },
  capabilities: {
    supports_html: false,
    max_text_len: MAX_TEXT_BYTES,
  },
};

function normalizeEndpointUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed)) return null;
  const match = ENDPOINT_URL_RE.exec(trimmed);
  if (!match) return null;
  const authMatch = HOST_AUTHORITY_RE.exec(match[2]);
  if (!authMatch) return null;
  if (authMatch[2] !== undefined) {
    const port = Number.parseInt(authMatch[2], 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  }
  const cleanPath = (match[3] || "").replace(/\/+$/, "");
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${cleanPath}`;
}

function buildHeaders(account) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  const token = typeof account?.api_token === "string" ? account.api_token.trim() : "";
  if (token && !/[\r\n]/.test(token)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function validate(ctx) {
  const config = ctx?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, error: "config must be a JSON object" };
  }
  if (ctx.scope === "account") {
    const url = normalizeEndpointUrl(config.endpoint_url);
    if (!url) {
      return { ok: false, error: "endpoint_url must be a valid http(s) URL without credentials" };
    }
    const normalized = { endpoint_url: url };
    if (typeof config.api_token === "string" && config.api_token.trim()) {
      normalized.api_token = config.api_token.trim();
    }
    return { ok: true, normalized_config: normalized };
  }
  if (ctx.scope === "destination") {
    const room = String(config.room ?? "").trim();
    if (!room) return { ok: false, error: "room is required" };
    return { ok: true, normalized_config: { room } };
  }
  return { ok: true, normalized_config: config };
}

export function test(ctx) {
  const endpointUrl = normalizeEndpointUrl(ctx?.account?.endpoint_url);
  if (!endpointUrl) {
    return { ok: false, error: "Invalid endpoint_url" };
  }
  if (ctx?.scope === "account") {
    try {
      const resp = fc.fetch({
        method: "GET",
        url: endpointUrl,
        headers: buildHeaders(ctx.account),
        timeoutMs: 8000,
      });
      return resp.ok
        ? { ok: true, message: `Endpoint ${endpointUrl} reachable` }
        : { ok: false, error: `Endpoint returned HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, error: `Connectivity check failed: ${err?.message ?? String(err)}` };
    }
  }
  const res = deliver({
    idempotency_key: `test-${fc.uuid()}`,
    account: ctx?.account ?? {},
    destination: ctx?.destination ?? {},
    entry: {
      title: "FeedCourier Test Notification",
      url: "https://feedcourier.ellery.me",
      summary_text: "Webhook plugin test message.",
      plain_text: "Webhook plugin test message.",
      content_html: null,
      author: null,
      published_at: fc.unixNow(),
      published_local: null,
      media: [],
    },
    feed: { id: 0, title: "FeedCourier", url: "https://feedcourier.ellery.me", site_url: null, favicon_url: null },
    route: { id: 0, name: "Test", locale: "en", timezone: "UTC" },
    checkpoint: null,
  });
  return res.outcome === "delivered"
    ? { ok: true, message: `Test payload delivered to room "${ctx?.destination?.room ?? ""}"` }
    : { ok: false, error: res.diagnostic ?? "Test delivery failed" };
}

export function deliver(ctx) {
  const endpointUrl = normalizeEndpointUrl(ctx?.account?.endpoint_url);
  const room = String(ctx?.destination?.room ?? "").trim();
  if (!endpointUrl || !room) {
    return { outcome: "permanent_failure", diagnostic: "Missing endpoint_url or room" };
  }

  const entry = ctx?.entry ?? {};
  const payload = {
    idempotency_key: ctx?.idempotency_key ?? "",
    room,
    feed: ctx?.feed?.title ?? "",
    title: entry.title ?? "(Untitled)",
    url: entry.url ?? null,
    text: fc.truncateUtf8Bytes(entry.summary_text || entry.plain_text || "", MAX_TEXT_BYTES),
  };

  let resp;
  try {
    resp = fc.fetch({
      method: "POST",
      url: endpointUrl,
      headers: buildHeaders(ctx?.account),
      body: JSON.stringify(payload),
      timeoutMs: 15000,
    });
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.indexOf("SSRF_BLOCKED:") === 0 || msg.indexOf("PROXY_UNCONFIGURED:") === 0) {
      return { outcome: "permanent_failure", diagnostic: msg };
    }
    return { outcome: "retry", diagnostic: `Network error: ${msg}` };
  }

  if (resp.ok) {
    return { outcome: "delivered", status_code: resp.status };
  }
  if (resp.status === 429) {
    const retryAfter = Number.parseInt(resp.headers?.["retry-after"] ?? "", 10);
    return {
      outcome: "retry",
      status_code: resp.status,
      retry_after_secs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      diagnostic: `Rate limited (429): ${resp.body.slice(0, 200)}`,
    };
  }
  if (resp.status >= 500) {
    return {
      outcome: "retry",
      status_code: resp.status,
      diagnostic: `Upstream error (${resp.status}): ${resp.body.slice(0, 200)}`,
    };
  }
  return {
    outcome: "permanent_failure",
    status_code: resp.status,
    diagnostic: `Rejected (${resp.status}): ${resp.body.slice(0, 200)}`,
  };
}
