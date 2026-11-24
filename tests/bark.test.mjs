import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as bark from "../plugins/channels/bark/0.3.1/plugin.js";

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

describe("bark single-file JS channel plugin (Plugin API v1)", () => {
  const captured = [];
  let nextResponse;
  let originalFc;

  beforeEach(() => {
    captured.length = 0;
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: 200, message: "success", timestamp: 1_764_023_400 }),
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

  it("exports valid Plugin API v1 meta with password-masked device_key", () => {
    assert.equal(bark.meta.id, "bark");
    assert.equal(bark.meta.version, "0.3.1");
    assert.equal(bark.meta.api_version, "1");
    assert.equal(bark.meta.kind, "channel");
    assert.deepEqual(bark.meta.allowed_hosts, ["api.day.app"]);
    assert.equal(bark.meta.destination_schema.properties.device_key.format, "password");
    assert.equal(bark.meta.capabilities.max_text_len, 2400);
  });

  it("validates account and destination configs cleanly", () => {
    const okAcct = bark.validate({
      scope: "account",
      config: { server_url: "https://api.day.app/?a=1#b" },
    });
    assert.equal(okAcct.ok, true);
    assert.deepEqual(okAcct.normalized_config, { server_url: "https://api.day.app" });

    const okAuth = bark.validate({
      scope: "account",
      config: {
        server_url: "https://bark.example.com/",
        username: " alice ",
        password: "secret",
      },
    });
    assert.equal(okAuth.ok, true);
    assert.deepEqual(okAuth.normalized_config, {
      server_url: "https://bark.example.com",
      username: "alice",
      password: "secret",
    });

    // Reject partial Basic Auth credentials and embedded URL credentials.
    assert.equal(
      bark.validate({
        scope: "account",
        config: { server_url: "https://bark.example.com", username: "alice" },
      }).ok,
      false,
    );
    assert.equal(
      bark.validate({
        scope: "account",
        config: { server_url: "https://user:pass@bark.example.com" },
      }).ok,
      false,
    );

    const okDest = bark.validate({
      scope: "destination",
      config: {
        device_key: "  MyBarkDeviceKey123  ",
        group: " Tech News ",
        level: "timeSensitive",
        sound: "minuet",
        send_icon: true,
      },
    });
    assert.equal(okDest.ok, true);
    assert.deepEqual(okDest.normalized_config, {
      device_key: "MyBarkDeviceKey123",
      group: "Tech News",
      level: "timeSensitive",
      sound: "minuet",
      send_icon: true,
    });

    // Reject pasting a full Bark URL into device_key.
    assert.equal(
      bark.validate({
        scope: "destination",
        config: { device_key: "https://api.day.app/MyBarkDeviceKey123/" },
      }).ok,
      false,
    );
    assert.equal(
      bark.validate({
        scope: "destination",
        config: { device_key: "validKey", level: "loud" },
      }).ok,
      false,
    );
  });

  it("tests account (/ping) and destination (/push) with optional Basic Auth", () => {
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ code: 200, message: "pong" }),
    });
    const acctRes = bark.test({
      scope: "account",
      account: {
        server_url: "https://bark.example.com/",
        username: "admin",
        password: "pw",
      },
    });
    assert.equal(acctRes.ok, true);
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].url, "https://bark.example.com/ping");
    assert.equal(
      captured[0].headers.Authorization,
      `Basic ${Buffer.from("admin:pw").toString("base64")}`,
    );

    nextResponse = () => {
      throw new Error("ECONNREFUSED");
    };
    const acctFail = bark.test({
      scope: "account",
      account: { server_url: "https://bark.example.com" },
    });
    assert.equal(acctFail.ok, false);
    assert.match(acctFail.error, /Bark health check failed/);

    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ code: 200, message: "success" }),
    });
    const destRes = bark.test({
      scope: "destination",
      account: { server_url: "https://api.day.app" },
      destination: { device_key: "abc123key", level: "active" },
    });
    assert.equal(destRes.ok, true);
    assert.equal(captured[2].method, "POST");
    assert.equal(captured[2].url, "https://api.day.app/push");
    const sentPayload = JSON.parse(captured[2].body);
    assert.equal(sentPayload.device_key, "abc123key");
    assert.equal(sentPayload.title, "FeedCourier Test Notification");
  });

  it("formats Telegram Compact Card style payload with metadata footer, URL, and HTTPS icon", () => {
    const res = bark.deliver({
      idempotency_key: "bark-1",
      account: { server_url: "https://api.day.app" },
      destination: {
        device_key: "dev_key_001",
        level: "timeSensitive",
        sound: "chime",
        send_icon: true,
      },
      entry: {
        title: "FeedCourier v0.3.1 Introduces JS Plugins",
        url: "https://feedcourier.ellery.me/blog/v0.3.1",
        summary_text: "Single-file ES Module plugins now run inside an embedded sandbox.\n\n\nNo sidecar needed.",
        plain_text: "Fallback text",
        content_html: null,
        author: "Alice",
        published_at: 1_764_023_400,
        published_local: "2026-11-25 06:30",
        media: [],
      },
      feed: {
        id: 7,
        title: "Hacker News",
        url: "https://news.ycombinator.com/rss",
        site_url: "https://news.ycombinator.com",
        favicon_url: "https://news.ycombinator.com/favicon.ico",
      },
      route: { id: 1, name: "Tech", locale: "en", timezone: "Asia/Shanghai" },
      checkpoint: null,
    });

    assert.equal(res.outcome, "delivered");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, "https://api.day.app/push");
    assert.equal(captured[0].headers["Content-Type"], "application/json; charset=utf-8");

    const body = JSON.parse(captured[0].body);
    assert.equal(body.device_key, "dev_key_001");
    assert.equal(body.title, "FeedCourier v0.3.1 Introduces JS Plugins");
    assert.equal(body.subtitle, "Hacker News · Alice");
    assert.equal(body.group, "Hacker News");
    assert.equal(body.level, "timeSensitive");
    assert.equal(body.sound, "chime");
    assert.equal(body.url, "https://feedcourier.ellery.me/blog/v0.3.1");
    assert.equal(body.icon, "https://news.ycombinator.com/favicon.ico");
    assert.equal(
      body.body,
      "Single-file ES Module plugins now run inside an embedded sandbox.\n\nNo sidecar needed.\n\n— Hacker News · Alice · 2026-11-25 06:30",
    );
  });

  it("omits duplicate summary matching the title (Telegram Compact Card behavior) and respects send_icon=false", () => {
    bark.deliver({
      idempotency_key: "bark-dedupe",
      account: { server_url: "https://api.day.app" },
      destination: { device_key: "dev_key_001", group: "CustomGroup", send_icon: false },
      entry: {
        title: "Breaking: Release v0.3.1!",
        url: "https://example.com/release",
        summary_text: "  breaking: release v0.3.1  ",
        plain_text: "breaking: release v0.3.1",
        content_html: null,
        author: "Bob",
        published_at: 1_764_023_400,
        published_local: "2026-11-25 06:30",
        media: [],
      },
      feed: {
        id: 2,
        title: "Changelog",
        url: "https://example.com/rss",
        site_url: null,
        favicon_url: "https://example.com/icon.png",
      },
      route: { id: 1, name: "R", locale: "en", timezone: "UTC" },
      checkpoint: null,
    });

    const payload = JSON.parse(captured[0].body);
    assert.equal(payload.group, "CustomGroup");
    assert.equal(payload.icon, undefined);
    assert.equal(payload.body, "— Changelog · Bob · 2026-11-25 06:30");
  });

  it("falls back to htmlToText and safely truncates multibyte CJK + emoji bodies within 2400 UTF-8 bytes while preserving footer", () => {
    const longHtml = `<p>${"摘要内容🚀 ".repeat(400)}</p>`;
    bark.deliver({
      idempotency_key: "bark-trunc",
      account: { server_url: "https://api.day.app" },
      destination: { device_key: "dev_key_001" },
      entry: {
        title: "深度技术周报",
        url: "https://example.com/weekly",
        summary_text: null,
        plain_text: "",
        content_html: longHtml,
        author: "张三",
        published_at: 1_764_023_400,
        published_local: "2026-11-25 06:30",
        media: [],
      },
      feed: {
        id: 3,
        title: "极客观察",
        url: "https://example.com/rss",
        site_url: null,
        favicon_url: "http://insecure.example.com/favicon.ico",
      },
      route: { id: 1, name: "R", locale: "zh", timezone: "Asia/Shanghai" },
      checkpoint: null,
    });

    const payload = JSON.parse(captured[0].body);
    // HTTP (non-HTTPS) favicon must NOT be sent as icon.
    assert.equal(payload.icon, undefined);
    assert.ok(Buffer.byteLength(payload.body, "utf8") <= 2400);
    assert.equal(payload.body.isWellFormed(), true);
    assert.equal(payload.body.includes("\uFFFD"), false);
    assert.ok(payload.body.endsWith("\n\n— 极客观察 · 张三 · 2026-11-25 06:30"));
  });

  it("maps HTTP 429/5xx/4xx, Bark JSON error codes, and network throws accurately", () => {
    const baseCtx = {
      idempotency_key: "bark-err",
      account: { server_url: "https://api.day.app" },
      destination: { device_key: "dev_key_001" },
      entry: {
        title: "Ping",
        url: null,
        summary_text: "Hello",
        plain_text: "Hello",
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
      headers: { "retry-after": "30" },
      body: "too many requests",
    });
    const r429 = bark.deliver(baseCtx);
    assert.equal(r429.outcome, "retry");
    assert.equal(r429.retry_after_secs, 30);

    nextResponse = () => ({
      status: 502,
      ok: false,
      headers: {},
      body: "bad gateway",
    });
    assert.equal(bark.deliver(baseCtx).outcome, "retry");

    nextResponse = () => ({
      status: 400,
      ok: false,
      headers: {},
      body: JSON.stringify({ code: 400, message: "failed to get device token" }),
    });
    assert.equal(bark.deliver(baseCtx).outcome, "permanent_failure");

    // HTTP 200 with Bark JSON code 404 => permanent_failure
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ code: 404, message: "device key not found" }),
    });
    assert.equal(bark.deliver(baseCtx).outcome, "permanent_failure");

    // HTTP 200 with Bark JSON code 500 => retry
    nextResponse = () => ({
      status: 200,
      ok: true,
      headers: {},
      body: JSON.stringify({ code: 500, message: "apns upstream error" }),
    });
    assert.equal(bark.deliver(baseCtx).outcome, "retry");

    // Network throw => retry
    nextResponse = () => {
      throw new Error("socket hang up");
    };
    const rNet = bark.deliver(baseCtx);
    assert.equal(rNet.outcome, "retry");
    assert.match(rNet.diagnostic, /socket hang up/);

    // SSRF policy block => permanent_failure
    nextResponse = () => {
      throw new Error("SSRF_BLOCKED: Host '169.254.169.254' is blocked");
    };
    const rSsrf = bark.deliver(baseCtx);
    assert.equal(rSsrf.outcome, "permanent_failure");
    assert.match(rSsrf.diagnostic, /SSRF_BLOCKED/);
  });
});
