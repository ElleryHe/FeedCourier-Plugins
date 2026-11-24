import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createNtfyBridgeServer, signRequest, validateNtfyConfig } from "./server.mjs";

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
});
