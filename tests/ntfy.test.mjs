import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as ntfy from "../plugins/channels/ntfy/0.3.1/plugin.js";

function truncateUtf8Bytes(input, maxBytes) {
  const text = String(input ?? "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let out = "";
  let used = 0;
  for (const ch of text) {
    const bytes = Buffer.byteLength(ch, "utf8");
    if (used + bytes > maxBytes) break;
    out += ch;
    used += bytes;
  }
  return out;
}

function createMockFc({ fetchHandler, nowSecs = 1_764_023_400 } = {}) {
  return {
    fetch(req) {
      return fetchHandler(req);
    },
    sha256(str, enc = "hex") {
      return createHash("sha256").update(String(str), "utf8").digest(enc);
    },
    md5(str) {
      return createHash("md5").update(String(str), "utf8").digest("hex");
    },
    hmacSha256(msg, secret, enc = "hex") {
      return createHmac("sha256", String(secret)).update(String(msg), "utf8").digest(enc);
    },
    base64Encode(str) {
      return Buffer.from(String(str), "utf8").toString("base64");
    },
    base64Decode(str) {
      return Buffer.from(String(str), "base64").toString("utf8");
    },
    base64UrlEncode(str) {
      return Buffer.from(String(str), "utf8").toString("base64url");
    },
    utf8ByteLength(str) {
      return Buffer.byteLength(String(str), "utf8");
    },
    truncateUtf8Bytes,
    htmlToText(html) {
      return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    },
    unixNow() {
      return nowSecs;
    },
    uuid() {
      return randomUUID();
    },
  };
}

describe("ntfy single-file JS channel plugin (Plugin API v1)", () => {
  const captured = [];
  let nextResponse;
  let originalFc;

  beforeEach(() => {
    captured.length = 0;
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ntfy-default-id" }),
    });
    originalFc = globalThis.fc;
    globalThis.fc = createMockFc({
      fetchHandler(req) {
        captured.push(req);
        return nextResponse(req);
      },
    });
  });

  afterEach(() => {
    globalThis.fc = originalFc;
  });

  it("exports valid Plugin API v1 meta", () => {
    assert.equal(ntfy.meta.id, "ntfy");
    assert.equal(ntfy.meta.version, "0.3.1");
    assert.equal(ntfy.meta.api_version, "1");
    assert.equal(ntfy.meta.kind, "channel");
    assert.equal(ntfy.meta.min_core, "0.3.1");
    assert.deepEqual(ntfy.meta.allowed_hosts, ["ntfy.sh"]);
    assert.deepEqual(ntfy.meta.permissions, ["network"]);
    assert.equal(ntfy.meta.capabilities.max_text_len, 4096);
  });

  it("validates and hardens account and destination configs", () => {
    const okAccount = ntfy.validate({
      scope: "account",
      config: { server_url: "HTTPS://NTFY.SH/?foo=1#frag", access_token: "  tk_abc123  " },
    });
    assert.equal(okAccount.ok, true);
    assert.deepEqual(okAccount.normalized_config, {
      server_url: "https://ntfy.sh",
      access_token: "tk_abc123",
    });

    const subPathAccount = ntfy.validate({
      scope: "account",
      config: { server_url: "https://push.example.com:8443/ntfy///" },
    });
    assert.equal(subPathAccount.ok, true);
    assert.equal(subPathAccount.normalized_config.server_url, "https://push.example.com:8443/ntfy");

    assert.equal(
      ntfy.validate({ scope: "account", config: { server_url: "ftp://ntfy.sh" } }).ok,
      false,
    );
    assert.equal(
      ntfy.validate({ scope: "account", config: { server_url: "https://user:pass@ntfy.sh" } }).ok,
      false,
    );
    assert.equal(
      ntfy.validate({ scope: "account", config: { server_url: "https://user@ntfy.sh" } }).ok,
      false,
    );
    assert.equal(
      ntfy.validate({ scope: "account", config: { server_url: "https://ntfy.sh:99999" } }).ok,
      false,
    );
    assert.equal(
      ntfy.validate({
        scope: "account",
        config: { server_url: "https://ntfy.sh", access_token: "tk_bad\r\nX-Injected: 1" },
      }).ok,
      false,
    );

    const okDest = ntfy.validate({
      scope: "destination",
      config: { topic: "rss_alerts-1", priority: "high", tags: " newspaper , rss " },
    });
    assert.equal(okDest.ok, true);
    assert.deepEqual(okDest.normalized_config, {
      topic: "rss_alerts-1",
      priority: "high",
      tags: "newspaper,rss",
    });

    assert.equal(
      ntfy.validate({ scope: "destination", config: { topic: "../escape" } }).ok,
      false,
    );
    assert.equal(
      ntfy.validate({ scope: "destination", config: { topic: "alerts", priority: "invalid" } }).ok,
      false,
    );
  });

  it("tests account health (/v1/health) and destination push, catching network throws", () => {
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ healthy: true }),
    });
    const acctOk = ntfy.test({
      scope: "account",
      account: { server_url: "https://ntfy.example.com/", access_token: "tk_test" },
    });
    assert.equal(acctOk.ok, true);
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].url, "https://ntfy.example.com/v1/health");
    assert.equal(captured[0].headers.Authorization, "Bearer tk_test");

    nextResponse = () => {
      throw new Error("connection refused");
    };
    const acctErr = ntfy.test({
      scope: "account",
      account: { server_url: "https://ntfy.example.com" },
    });
    assert.equal(acctErr.ok, false);
    assert.match(acctErr.error, /ntfy health check failed/);

    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ id: "test-msg-1" }),
    });
    const destOk = ntfy.test({
      scope: "destination",
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
    });
    assert.equal(destOk.ok, true);
    assert.equal(captured[2].method, "POST");
    assert.equal(captured[2].url, "https://ntfy.example.com/alerts");
  });

  it("delivers notification with Title, Click, Priority, Tags, Bearer auth, and RFC 2047 non-ASCII titles", () => {
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ id: "msg-abc" }),
    });

    const res = ntfy.deliver({
      idempotency_key: "key-1",
      account: { server_url: "https://ntfy.example.com", access_token: "tk_secret123" },
      destination: { topic: "my-feed", priority: "high", tags: "newspaper,rss" },
      entry: {
        title: "Release v0.3.1",
        url: "https://example.com/v0.3.1",
        summary_text: "Short summary",
        plain_text: "JS plugins are live!",
        content_html: null,
        author: "Ellery",
        published_at: 1_764_023_400,
        published_local: "2026-11-25 06:30",
        media: [],
      },
      feed: {
        id: 1,
        title: "FeedCourier",
        url: "https://example.com/rss",
        site_url: "https://example.com",
        favicon_url: null,
      },
      route: { id: 2, name: "Releases", locale: "en", timezone: "UTC" },
      checkpoint: null,
    });

    assert.equal(res.outcome, "delivered");
    assert.equal(res.external_id, "msg-abc");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, "https://ntfy.example.com/my-feed");
    assert.equal(captured[0].headers.Authorization, "Bearer tk_secret123");
    assert.equal(captured[0].headers.Title, "[FeedCourier] Release v0.3.1");
    assert.equal(captured[0].headers.Click, "https://example.com/v0.3.1");
    assert.equal(captured[0].headers.Priority, "high");
    assert.equal(captured[0].headers.Tags, "newspaper,rss");
    assert.equal(captured[0].body, "JS plugins are live!");

    // Non-ASCII title with embedded CRLF must be sanitized and RFC 2047 Base64-encoded.
    captured.length = 0;
    ntfy.deliver({
      idempotency_key: "key-zh-title",
      account: { server_url: "https://ntfy.sh" },
      destination: { topic: "news" },
      entry: {
        title: "中文标题\r\n注入测试",
        url: "https://example.com/zh",
        summary_text: null,
        plain_text: "正文内容",
        content_html: null,
        author: null,
        published_at: null,
        published_local: null,
        media: [],
      },
      feed: { id: 1, title: "科技周刊", url: "https://example.com/rss", site_url: null, favicon_url: null },
      route: { id: 1, name: "R", locale: "zh", timezone: "Asia/Shanghai" },
      checkpoint: null,
    });
    const encodedTitle = captured[0].headers.Title;
    assert.match(encodedTitle, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    const decoded = Buffer.from(encodedTitle.slice(10, -2), "base64").toString("utf8");
    assert.equal(decoded, "[科技周刊] 中文标题 注入测试");
    assert.equal(/[\r\n]/.test(encodedTitle), false);
  });

  it("truncates long multibyte UTF-8 and emoji bodies to <= 4096 bytes without corruption", () => {
    const longChinese = "测".repeat(2000); // 6000 UTF-8 bytes
    ntfy.deliver({
      idempotency_key: "key-zh",
      account: { server_url: "https://ntfy.sh" },
      destination: { topic: "alerts" },
      entry: {
        title: "Chinese",
        url: null,
        summary_text: null,
        plain_text: longChinese,
        content_html: null,
        author: null,
        published_at: null,
        published_local: null,
        media: [],
      },
      feed: { id: 1, title: "F", url: "https://example.com/rss", site_url: null, favicon_url: null },
      route: { id: 1, name: "R", locale: "zh", timezone: "UTC" },
      checkpoint: null,
    });

    const sentZh = captured[0].body;
    assert.equal(Buffer.byteLength(sentZh, "utf8"), 4095);
    assert.equal(sentZh.length, 1365);
    assert.equal(sentZh.includes("\uFFFD"), false);
    assert.equal(sentZh.isWellFormed(), true);

    captured.length = 0;
    const emojiBoundary = "a".repeat(4094) + "🚀"; // 4094 + 4 = 4098 bytes
    ntfy.deliver({
      idempotency_key: "key-emoji",
      account: { server_url: "https://ntfy.sh" },
      destination: { topic: "alerts" },
      entry: {
        title: "Emoji",
        url: null,
        summary_text: null,
        plain_text: emojiBoundary,
        content_html: null,
        author: null,
        published_at: null,
        published_local: null,
        media: [],
      },
      feed: { id: 1, title: "F", url: "https://example.com/rss", site_url: null, favicon_url: null },
      route: { id: 1, name: "R", locale: "en", timezone: "UTC" },
      checkpoint: null,
    });

    const sentEmoji = captured[0].body;
    assert.equal(Buffer.byteLength(sentEmoji, "utf8"), 4094);
    assert.equal(sentEmoji, "a".repeat(4094));
    assert.equal(sentEmoji.isWellFormed(), true);
  });

  it("maps 429 (with Retry-After), 5xx, 4xx, and network errors accurately", () => {
    const baseCtx = {
      idempotency_key: "key-status",
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
      entry: {
        title: "Ping",
        url: null,
        summary_text: null,
        plain_text: "Body",
        content_html: null,
        author: null,
        published_at: null,
        published_local: null,
        media: [],
      },
      feed: { id: 1, title: "F", url: "https://example.com/rss", site_url: null, favicon_url: null },
      route: { id: 1, name: "R", locale: "en", timezone: "UTC" },
      checkpoint: null,
    };

    nextResponse = () => ({
      status: 429,
      ok: false,
      headers: { "retry-after": "25" },
      body: "rate limited",
    });
    const r429 = ntfy.deliver(baseCtx);
    assert.equal(r429.outcome, "retry");
    assert.equal(r429.retry_after_secs, 25);

    nextResponse = () => ({
      status: 503,
      ok: false,
      headers: {},
      body: "service unavailable",
    });
    const r503 = ntfy.deliver(baseCtx);
    assert.equal(r503.outcome, "retry");

    nextResponse = () => ({
      status: 403,
      ok: false,
      headers: {},
      body: "forbidden",
    });
    const r403 = ntfy.deliver(baseCtx);
    assert.equal(r403.outcome, "permanent_failure");

    nextResponse = () => {
      throw new Error("ETIMEDOUT");
    };
    const rNet = ntfy.deliver(baseCtx);
    assert.equal(rNet.outcome, "retry");
    assert.match(rNet.diagnostic, /ETIMEDOUT/);

    nextResponse = () => {
      throw new Error("SSRF_BLOCKED: Host '169.254.169.254' is blocked");
    };
    const rSsrf = ntfy.deliver(baseCtx);
    assert.equal(rSsrf.outcome, "permanent_failure");
    assert.match(rSsrf.diagnostic, /SSRF_BLOCKED/);
  });
});
