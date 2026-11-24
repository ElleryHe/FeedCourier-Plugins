/**
 * FeedCourier Processor Plugin Starter Template (Plugin API v1)
 *
 * Demonstrates a pure-ECMAScript `on_render` processor plugin that strips
 * common tracking query parameters (utm_*, fbclid, gclid) from `entry.url`.
 *
 * Rules for single-file JS plugins running in FeedCourier's embedded ES2024 sandbox:
 *   - Zero `import` statements.
 *   - Synchronous execution only (no `async`/`await`).
 *   - Pure ECMAScript + `globalThis.fc` only (no `new URL`, `Buffer`, `console`, `fetch`).
 */

const DEFAULT_STRIP_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

export const meta = {
  id: "utm-strip-example",
  name: "UTM Cleaner Example",
  version: "0.3.1",
  api_version: "1",
  kind: "processor",
  min_core: "0.3.1",
  category: "links",
  icon: "sparkles",
  description: {
    en: "Starter processor plugin template that removes tracking query parameters from outgoing article links during on_render.",
    zh: "在 on_render 阶段移除文章链接中常见追踪查询参数的处理插件参考模板。",
  },
  homepage: "https://feedcourier.ellery.me/plugins/js-plugins",
  repository: "https://github.com/ElleryHe/FeedCourier-Plugins/tree/main/templates",
  allowed_hosts: [],
  hooks: ["on_render"],
  permissions: [],
  instance_schema: {
    type: "object",
    properties: {
      extra_params: {
        type: "string",
        title: "Extra Query Parameters (Optional)",
        placeholder: "ref,spm",
        description: "Comma-separated additional query parameter names to remove.",
      },
    },
  },
  route_option_schema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        title: "Enable UTM Cleaner",
        default: true,
      },
    },
  },
};

function stripTrackingParams(rawUrl, blockedSet) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  const qIdx = trimmed.indexOf("?");
  if (qIdx === -1) return trimmed;

  const hashIdx = trimmed.indexOf("#", qIdx);
  const base = trimmed.slice(0, qIdx);
  const query = hashIdx === -1 ? trimmed.slice(qIdx + 1) : trimmed.slice(qIdx + 1, hashIdx);
  const fragment = hashIdx === -1 ? "" : trimmed.slice(hashIdx);

  const kept = [];
  const pairs = query.split("&");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    const key = (eqIdx === -1 ? pair : pair.slice(0, eqIdx)).toLowerCase();
    if (!blockedSet.has(key)) {
      kept.push(pair);
    }
  }

  return kept.length > 0 ? `${base}?${kept.join("&")}${fragment}` : `${base}${fragment}`;
}

export function validate(ctx) {
  const config = ctx?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, error: "config must be a JSON object" };
  }
  if (ctx.scope === "instance") {
    const extra =
      typeof config.extra_params === "string"
        ? config.extra_params
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .join(",")
        : "";
    return { ok: true, normalized_config: extra ? { extra_params: extra } : {} };
  }
  return { ok: true, normalized_config: config };
}

export function test() {
  return { ok: true, message: "UTM Cleaner processor ready (no network access required)" };
}

export function onRender(ctx) {
  const rawUrl = ctx?.entry?.url;
  if (!rawUrl) {
    return { outcome: "continue" };
  }

  const blocked = new Set(DEFAULT_STRIP_PARAMS);
  const extra =
    typeof ctx?.instance_config?.extra_params === "string"
      ? ctx.instance_config.extra_params
      : "";
  if (extra) {
    const parts = extra.split(",");
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i].trim().toLowerCase();
      if (k) blocked.add(k);
    }
  }

  const cleaned = stripTrackingParams(rawUrl, blocked);
  if (cleaned && cleaned !== rawUrl) {
    return { outcome: "continue", primary_link: cleaned };
  }
  return { outcome: "continue" };
}
