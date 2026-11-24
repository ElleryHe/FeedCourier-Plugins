import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createBridgeServer,
  mapUpstreamStatusToOutcome,
  signRequest,
  verifySignature,
} from "./server.mjs";

const SECRET = "unit-test-template-secret";

async function signedRequest(baseUrl, method, path, bodyObj) {
  const raw = bodyObj !== undefined ? Buffer.from(JSON.stringify(bodyObj), "utf8") : Buffer.alloc(0);
  const ts = Math.floor(Date.now() / 1000);
  const sig = signRequest(SECRET, ts, raw);
  const resp = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(bodyObj !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-FeedCourier-Timestamp": String(ts),
      "X-FeedCourier-Signature": sig,
      "X-FeedCourier-Plugin-Id": "channel-template",
    },
    body: bodyObj !== undefined ? raw : undefined,
  });
  return { status: resp.status, json: await resp.json() };
}

describe("channel-template bridge", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createBridgeServer({ secret: SECRET });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("verifies HMAC signatures and enforces ±300s window", () => {
    const body = Buffer.from('{"a":1}');
    const now = 1_700_000_000;
    const sig = signRequest(SECRET, now, body);
    assert.equal(verifySignature(SECRET, String(now), sig, body, now).ok, true);
    assert.equal(verifySignature(SECRET, String(now), sig, body, now + 300).ok, true);
    assert.equal(verifySignature(SECRET, String(now), sig, body, now + 301).ok, false);
    assert.equal(verifySignature("wrong", String(now), sig, body, now).ok, false);
  });

  it("rejects unsigned requests with 401", async () => {
    const resp = await fetch(`${baseUrl}/manifest`);
    assert.equal(resp.status, 401);
  });

  it("serves /manifest, /validate, /test, and /deliver", async () => {
    const m = await signedRequest(baseUrl, "GET", "/manifest");
    assert.equal(m.status, 200);
    assert.equal(m.json.id, "channel-template");
    assert.equal(m.json.kind, "channel");
    assert.equal(m.json.api_version, "1");

    const bad = await signedRequest(baseUrl, "POST", "/validate", {
      scope: "account",
      config: { endpoint_url: "ftp://invalid" },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.ok, false);

    const ok = await signedRequest(baseUrl, "POST", "/validate", {
      scope: "account",
      config: { endpoint_url: "https://hooks.example.com/in/" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.normalized_config.endpoint_url, "https://hooks.example.com/in");

    const testRes = await signedRequest(baseUrl, "POST", "/test", {
      scope: "destination",
      account: { endpoint_url: "https://hooks.example.com/in" },
      destination: { channel: "alerts" },
    });
    assert.equal(testRes.status, 200);
    assert.equal(testRes.json.ok, true);

    const deliverRes = await signedRequest(baseUrl, "POST", "/deliver", {
      idempotency_key: "abc1234567890000",
      task_id: 1,
      attempt: 1,
      account: { endpoint_url: "https://hooks.example.com/in" },
      destination: { channel: "alerts" },
      entry: { title: "Hello RSS", plain_text: "Body" },
      feed: { id: 1, title: "Demo", url: "https://example.com/rss" },
      route: { id: 1, name: "Default", timezone: "UTC" },
      checkpoint: null,
    });
    assert.equal(deliverRes.status, 200);
    assert.equal(deliverRes.json.outcome, "delivered");
  });

  it("maps upstream HTTP status codes accurately", () => {
    assert.equal(mapUpstreamStatusToOutcome(200).outcome, "delivered");
    const rl = mapUpstreamStatusToOutcome(429, "45", "slow down");
    assert.equal(rl.outcome, "retry");
    assert.equal(rl.retry_after_secs, 45);
    assert.equal(mapUpstreamStatusToOutcome(503, null, "down").outcome, "retry");
    assert.equal(mapUpstreamStatusToOutcome(400, null, "bad").outcome, "permanent_failure");
  });
});
