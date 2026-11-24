/**
 * FeedCourier Reference HTTP Bridge Channel Plugin: ntfy Push (Protocol v1)
 * Zero external dependencies — requires Node.js 24+.
 *
 * Account config:     { server_url (required), access_token? }
 * Destination config: { topic (required), priority?, tags? }
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const SIGNATURE_WINDOW_SECS = 300;
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_NTFY_TEXT_LEN = 4096;

const VALID_PRIORITIES = new Set(["min", "low", "default", "high", "urgent"]);
const TOPIC_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const NTFY_MANIFEST = {
  id: "ntfy",
  name: "ntfy Push",
  version: "0.3.1",
  api_version: "1",
  kind: "channel",
  runtime: "bridge",
  min_core: "0.3.1",
  category: "delivery",
  icon: "bell",
  description:
    "Deliver RSS articles as push notifications to ntfy.sh or self-hosted ntfy servers with topic, priority, tags, click URL, and optional bearer token authentication.",
  homepage: "https://feedcourier.ellery.me/plugins/bridge-channels",
  hooks: [],
  permissions: ["network"],
  account_schema: {
    type: "object",
    required: ["server_url"],
    properties: {
      server_url: {
        type: "string",
        format: "uri",
        title: "ntfy Server URL",
        default: "https://ntfy.sh",
        placeholder: "https://ntfy.sh",
        description: "Base URL of ntfy.sh or your self-hosted ntfy server.",
      },
      access_token: {
        type: "string",
        format: "password",
        title: "Access Token (Optional)",
        placeholder: "tk_...",
        description: "Optional ntfy access token sent as Authorization: Bearer <token>.",
      },
    },
  },
  destination_schema: {
    type: "object",
    required: ["topic"],
    properties: {
      topic: {
        type: "string",
        title: "Topic",
        placeholder: "feedcourier-alerts",
        description: "ntfy topic name (letters, digits, hyphens, underscores).",
      },
      priority: {
        type: "string",
        title: "Priority",
        enum: ["min", "low", "default", "high", "urgent"],
        default: "default",
        description: "Notification priority level.",
      },
      tags: {
        type: "string",
        title: "Tags (Optional)",
        placeholder: "newspaper,rss",
        description: "Comma-separated ntfy emoji shortcodes or tag labels.",
      },
    },
  },
  capabilities: {
    supports_html: false,
    max_text_len: MAX_NTFY_TEXT_LEN,
  },
};

export function signRequest(secret, timestampSecs, bodyBuf) {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestampSecs}.`);
  mac.update(bodyBuf);
  return `v1=${mac.digest("hex")}`;
}

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
  const expected = Buffer.from(signRequest(secret, ts, rawBody), "utf8");
  const actual = Buffer.from(signatureHeader.trim(), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "Invalid HMAC signature" };
  }
  return { ok: true };
}

function parseRetryAfterSecs(header) {
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

function normalizeServerUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    return null;
  }
  return parsed.toString().replace(/\/+$/, "");
}

function sanitizeHeaderValue(value, maxLen = 256) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function validateNtfyConfig({ scope, config }) {
  if (!config || typeof config !== "object") {
    return { ok: false, error: "config must be a JSON object" };
  }
  if (scope === "account") {
    const normalizedUrl = normalizeServerUrl(config.server_url);
    if (!normalizedUrl) {
      return { ok: false, error: "server_url must be a valid http:// or https:// URL" };
    }
    const normalized = { server_url: normalizedUrl };
    if (typeof config.access_token === "string" && config.access_token.trim()) {
      normalized.access_token = config.access_token.trim();
    }
    return { ok: true, normalized_config: normalized };
  }
  if (scope === "destination") {
    const topic = String(config.topic ?? "").trim();
    if (!TOPIC_RE.test(topic)) {
      return {
        ok: false,
        error: "topic must be 1–128 characters of ASCII letters, digits, '-' or '_'",
      };
    }
    const priority = String(config.priority ?? "default").trim() || "default";
    if (!VALID_PRIORITIES.has(priority)) {
      return {
        ok: false,
        error: `priority must be one of: ${Array.from(VALID_PRIORITIES).join(", ")}`,
      };
    }
    const normalized = { topic, priority };
    if (typeof config.tags === "string" && config.tags.trim()) {
      normalized.tags = config.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(",");
    }
    return { ok: true, normalized_config: normalized };
  }
  return { ok: true, normalized_config: config };
}

function buildNtfyAuthHeaders(account) {
  const headers = {};
  if (typeof account?.access_token === "string" && account.access_token.trim()) {
    headers.Authorization = `Bearer ${account.access_token.trim()}`;
  }
  return headers;
}

export async function publishToNtfy(fetchImpl, { account, destination, title, body, clickUrl }) {
  const serverUrl = normalizeServerUrl(account?.server_url);
  const topic = String(destination?.topic ?? "").trim();
  if (!serverUrl || !TOPIC_RE.test(topic)) {
    return {
      outcome: "permanent_failure",
      diagnostic: "Invalid ntfy server_url or topic configuration",
    };
  }

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    ...buildNtfyAuthHeaders(account),
  };
  const cleanTitle = sanitizeHeaderValue(title, 200);
  if (cleanTitle) {
    // Use RFC 2047 UTF-8 Base64 encoding when non-ASCII characters are present in Title header.
    headers.Title = /^[\x20-\x7E]+$/.test(cleanTitle)
      ? cleanTitle
      : `=?UTF-8?B?${Buffer.from(cleanTitle, "utf8").toString("base64")}?=`;
  }
  if (clickUrl && /^https?:\/\//i.test(String(clickUrl).trim())) {
    headers.Click = sanitizeHeaderValue(clickUrl, 1024);
  }
  if (destination?.priority && VALID_PRIORITIES.has(String(destination.priority))) {
    headers.Priority = String(destination.priority);
  }
  if (typeof destination?.tags === "string" && destination.tags.trim()) {
    headers.Tags = sanitizeHeaderValue(destination.tags, 256);
  }

  const textBody = String(body ?? "").trim().slice(0, MAX_NTFY_TEXT_LEN) || cleanTitle || "New item";

  let resp;
  try {
    resp = await fetchImpl(`${serverUrl}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: textBody,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      outcome: "retry",
      diagnostic: `ntfy network error: ${err?.message ?? String(err)}`,
    };
  }

  const rawText = await resp.text().catch(() => "");
  if (resp.status >= 200 && resp.status < 300) {
    let externalId;
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed?.id === "string") externalId = parsed.id;
    } catch {
      // Plain text OK
    }
    return {
      outcome: "delivered",
      ...(externalId ? { external_id: externalId } : {}),
    };
  }
  if (resp.status === 429) {
    return {
      outcome: "retry",
      retry_after_secs: parseRetryAfterSecs(resp.headers?.get?.("retry-after")) ?? 60,
      diagnostic: `ntfy rate limited (429): ${rawText.slice(0, 200)}`,
    };
  }
  if (resp.status >= 500) {
    return {
      outcome: "retry",
      retry_after_secs: parseRetryAfterSecs(resp.headers?.get?.("retry-after")),
      diagnostic: `ntfy server error (${resp.status}): ${rawText.slice(0, 200)}`,
    };
  }
  return {
    outcome: "permanent_failure",
    diagnostic: `ntfy rejected delivery (${resp.status}): ${rawText.slice(0, 200)}`,
  };
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

export function createNtfyBridgeServer({ secret, fetchImpl = globalThis.fetch } = {}) {
  if (!secret) {
    throw new Error("BRIDGE_SECRET is required");
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/healthz") {
        return sendJson(res, 200, { ok: true, id: NTFY_MANIFEST.id, version: NTFY_MANIFEST.version });
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
        return sendJson(res, 200, NTFY_MANIFEST);
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
        const result = validateNtfyConfig(payload);
        return sendJson(res, result.ok ? 200 : 400, result);
      }

      if (url.pathname === "/test") {
        if (payload.scope === "account") {
          const serverUrl = normalizeServerUrl(payload.account?.server_url);
          if (!serverUrl) {
            return sendJson(res, 400, { ok: false, error: "Invalid server_url" });
          }
          const healthResp = await fetchImpl(`${serverUrl}/v1/health`, {
            method: "GET",
            headers: buildNtfyAuthHeaders(payload.account),
            signal: AbortSignal.timeout(8_000),
          });
          if (!healthResp.ok) {
            return sendJson(res, 502, {
              ok: false,
              error: `ntfy /v1/health returned HTTP ${healthResp.status}`,
            });
          }
          return sendJson(res, 200, { ok: true, message: `ntfy server ${serverUrl} reachable` });
        }

        const testRes = await publishToNtfy(fetchImpl, {
          account: payload.account,
          destination: payload.destination,
          title: "FeedCourier Test Notification",
          body: `Connectivity verified for topic "${payload.destination?.topic ?? ""}".`,
          clickUrl: "https://feedcourier.ellery.me",
        });
        if (testRes.outcome === "delivered") {
          return sendJson(res, 200, {
            ok: true,
            message: `Test push sent to ntfy topic "${payload.destination?.topic}"`,
          });
        }
        return sendJson(res, 502, { ok: false, error: testRes.diagnostic ?? "ntfy test failed" });
      }

      if (url.pathname === "/deliver") {
        const entry = payload.entry ?? {};
        const feedTitle = payload.feed?.title ? `[${payload.feed.title}] ` : "";
        const title = `${feedTitle}${entry.title ?? "(Untitled)"}`;
        const body = entry.plain_text || entry.summary_text || entry.title || "";
        const result = await publishToNtfy(fetchImpl, {
          account: payload.account,
          destination: payload.destination,
          title,
          body,
          clickUrl: entry.url,
        });
        return sendJson(res, 200, result);
      }

      return sendJson(res, 404, { ok: false, error: `Unknown endpoint: ${url.pathname}` });
    } catch (err) {
      return sendJson(res, err?.statusCode ?? 500, {
        ok: false,
        error: err?.message ?? "Internal error",
      });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.BRIDGE_SECRET?.trim();
  if (!secret) {
    console.error("Error: BRIDGE_SECRET environment variable must be set.");
    process.exit(1);
  }
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createNtfyBridgeServer({ secret });
  server.listen(port, host, () => {
    console.log(`[${NTFY_MANIFEST.id}] bridge listening on http://${host}:${port}`);
  });
}
