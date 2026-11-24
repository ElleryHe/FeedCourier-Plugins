import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createNtfyBridgeServer,
  MAX_NTFY_TEXT_LEN,
  normalizeServerUrl,
  signRequest,
  truncateUtf8Bytes,
  validateNtfyConfig,
} from "./server.mjs";

const SECRET = "unit-test-ntfy-secret";

async function signedPost(baseUrl, path, bodyObj) {
  const raw = Buffer.from(JSON.stringify(bodyObj), "utf8");
  const ts = Math.floor(Date.now() / 1000);
  const sig = signRequest(SECRET, ts, raw);
  const resp = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FeedCourier-Timestamp": String(ts),
      "X-FeedCourier-Signature": sig,
      "X-FeedCourier-Plugin-Id": "ntfy",
    },
    body: raw,
  });
  return { status: resp.status, json: await resp.json() };
}

describe("ntfy channel bridge plugin", () => {
  let server;
  let baseUrl;
  let nextMockResp = () =>
    new Response(JSON.stringify({ id: "ntfy-id-001" }), { status: 200 });
  const captured = [];

  before(async () => {
    server = createNtfyBridgeServer({
      secret: SECRET,
      fetchImpl: async (url, init) => {
        captured.push({ url, init });
        return nextMockResp(url, init);
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("validates account and destination configs", () => {
    assert.equal(
      validateNtfyConfig({ scope: "account", config: { server_url: "https://ntfy.sh/" } })
        .normalized_config.server_url,
      "https://ntfy.sh",
    );
    assert.equal(
      validateNtfyConfig({ scope: "account", config: { server_url: "ftp://bad" } }).ok,
      false,
    );
    assert.equal(
      validateNtfyConfig({
        scope: "destination",
        config: { topic: "rss_alerts-1", priority: "high", tags: "rss, news" },
      }).normalized_config.tags,
      "rss,news",
    );
    assert.equal(
      validateNtfyConfig({ scope: "destination", config: { topic: "../escape" } }).ok,
      false,
    );
  });

  it("delivers notification with Title, Click, Priority, Tags, and Bearer auth", async () => {
    captured.length = 0;
    nextMockResp = () =>
      new Response(JSON.stringify({ id: "msg-abc" }), { status: 200 });

    const res = await signedPost(baseUrl, "/deliver", {
      idempotency_key: "key-1",
      task_id: 10,
      attempt: 1,
      account: { server_url: "https://ntfy.example.com", access_token: "tk_secret123" },
      destination: { topic: "my-feed", priority: "high", tags: "newspaper,rss" },
      entry: {
        title: "Release v0.3.1",
        url: "https://example.com/v0.3.1",
        plain_text: "Bridge plugins are live!",
      },
      feed: { id: 1, title: "FeedCourier", url: "https://example.com/rss" },
      route: { id: 2, name: "Releases", timezone: "UTC" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.outcome, "delivered");
    assert.equal(res.json.external_id, "msg-abc");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, "https://ntfy.example.com/my-feed");
    assert.equal(captured[0].init.headers.Authorization, "Bearer tk_secret123");
    assert.equal(captured[0].init.headers.Click, "https://example.com/v0.3.1");
    assert.equal(captured[0].init.headers.Priority, "high");
    assert.equal(captured[0].init.headers.Tags, "newspaper,rss");
    assert.equal(captured[0].init.body, "Bridge plugins are live!");
  });

  it("maps 429 and 5xx to retry and 403 to permanent_failure", async () => {
    const basePayload = {
      idempotency_key: "key-2",
      task_id: 11,
      attempt: 1,
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
      entry: { title: "Ping", plain_text: "Body" },
      feed: { id: 1, title: "F", url: "https://example.com/rss" },
      route: { id: 1, name: "R", timezone: "UTC" },
    };

    nextMockResp = () =>
      new Response("rate limited", { status: 429, headers: { "Retry-After": "25" } });
    const r429 = await signedPost(baseUrl, "/deliver", basePayload);
    assert.equal(r429.json.outcome, "retry");
    assert.equal(r429.json.retry_after_secs, 25);

    nextMockResp = () => new Response("server down", { status: 503 });
    const r503 = await signedPost(baseUrl, "/deliver", basePayload);
    assert.equal(r503.json.outcome, "retry");

    nextMockResp = () => new Response("forbidden", { status: 403 });
    const r403 = await signedPost(baseUrl, "/deliver", basePayload);
    assert.equal(r403.json.outcome, "permanent_failure");
  });

  it("supports /test for account health and destination push", async () => {
    nextMockResp = () => new Response(JSON.stringify({ healthy: true }), { status: 200 });
    const acctRes = await signedPost(baseUrl, "/test", {
      scope: "account",
      account: { server_url: "https://ntfy.example.com" },
    });
    assert.equal(acctRes.status, 200);
    assert.equal(acctRes.json.ok, true);

    nextMockResp = () => new Response(JSON.stringify({ id: "test-1" }), { status: 200 });
    const destRes = await signedPost(baseUrl, "/test", {
      scope: "destination",
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
    });
    assert.equal(destRes.status, 200);
    assert.equal(destRes.json.ok, true);
  });

  it("truncates long multibyte UTF-8 bodies to <= 4096 bytes without corruption", async () => {
    captured.length = 0;
    nextMockResp = () => new Response(JSON.stringify({ id: "zh-1" }), { status: 200 });

    const longChinese = "测".repeat(2000); // 6000 UTF-8 bytes
    const res = await signedPost(baseUrl, "/deliver", {
      idempotency_key: "key-zh",
      task_id: 20,
      attempt: 1,
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
      entry: { title: "Chinese", plain_text: longChinese },
      feed: { id: 1, title: "F", url: "https://example.com/rss" },
      route: { id: 1, name: "R", timezone: "UTC" },
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.outcome, "delivered");
    const sent = captured[0].init.body;
    assert.equal(Buffer.byteLength(sent, "utf8"), 4095);
    assert.ok(Buffer.byteLength(sent, "utf8") <= MAX_NTFY_TEXT_LEN);
    assert.equal(sent.length, 1365);
    assert.equal(Buffer.from(sent, "utf8").toString("utf8"), sent);
    assert.equal(sent.includes("\uFFFD"), false);
  });

  it("does not split UTF-16 surrogate pairs at the 4096-byte boundary", async () => {
    captured.length = 0;
    nextMockResp = () => new Response(JSON.stringify({ id: "emoji-1" }), { status: 200 });

    const emojiBoundary = "a".repeat(4094) + "🚀"; // 4094 + 4 = 4098 UTF-8 bytes
    const direct = truncateUtf8Bytes(emojiBoundary, MAX_NTFY_TEXT_LEN);
    assert.equal(Buffer.byteLength(direct, "utf8"), 4094);
    assert.equal(direct, "a".repeat(4094));
    assert.equal(Buffer.from(direct, "utf8").toString("utf8"), direct);
    assert.equal(direct.isWellFormed(), true);

    const exactFit = truncateUtf8Bytes("a".repeat(4092) + "🚀", MAX_NTFY_TEXT_LEN);
    assert.equal(Buffer.byteLength(exactFit, "utf8"), 4096);
    assert.equal(exactFit.endsWith("🚀"), true);
    assert.equal(exactFit.isWellFormed(), true);

    const res = await signedPost(baseUrl, "/deliver", {
      idempotency_key: "key-emoji",
      task_id: 21,
      attempt: 1,
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
      entry: { title: "Emoji", plain_text: emojiBoundary },
      feed: { id: 1, title: "F", url: "https://example.com/rss" },
      route: { id: 1, name: "R", timezone: "UTC" },
    });

    assert.equal(res.status, 200);
    const sent = captured[0].init.body;
    assert.ok(Buffer.byteLength(sent, "utf8") <= MAX_NTFY_TEXT_LEN);
    assert.equal(Buffer.from(sent, "utf8").toString("utf8"), sent);
    assert.equal(sent.isWellFormed(), true);
  });

  it("hardens server_url by rejecting embedded credentials and stripping query/hash", () => {
    assert.equal(normalizeServerUrl("https://user:pass@ntfy.sh"), null);
    assert.equal(normalizeServerUrl("https://user@ntfy.sh"), null);
    assert.equal(
      validateNtfyConfig({ scope: "account", config: { server_url: "https://user:pass@ntfy.sh" } })
        .ok,
      false,
    );
    assert.equal(normalizeServerUrl("https://ntfy.sh/?foo=1#frag"), "https://ntfy.sh");
    assert.equal(
      validateNtfyConfig({ scope: "account", config: { server_url: "https://ntfy.sh/?foo=1#frag" } })
        .normalized_config.server_url,
      "https://ntfy.sh",
    );
  });

  it("passes redirect: error to fetchImpl on /deliver and /test", async () => {
    captured.length = 0;
    nextMockResp = () => new Response(JSON.stringify({ id: "redir-1" }), { status: 200 });

    await signedPost(baseUrl, "/deliver", {
      idempotency_key: "key-redir",
      task_id: 22,
      attempt: 1,
      account: { server_url: "https://ntfy.example.com" },
      destination: { topic: "alerts" },
      entry: { title: "Redir", plain_text: "Body" },
      feed: { id: 1, title: "F", url: "https://example.com/rss" },
      route: { id: 1, name: "R", timezone: "UTC" },
    });
    assert.equal(captured[0].init.redirect, "error");

    captured.length = 0;
    nextMockResp = () => new Response(JSON.stringify({ healthy: true }), { status: 200 });
    await signedPost(baseUrl, "/test", {
      scope: "account",
      account: { server_url: "https://ntfy.example.com" },
    });
    assert.equal(captured[0].init.redirect, "error");
  });

  it("returns HTTP 502 (not 500) on /test account health check network/timeout errors", async () => {
    nextMockResp = () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    };
    const res = await signedPost(baseUrl, "/test", {
      scope: "account",
      account: { server_url: "https://ntfy.example.com" },
    });
    assert.equal(res.status, 502);
    assert.equal(res.json.ok, false);
    assert.match(res.json.error, /ntfy health check failed/);
  });
});
