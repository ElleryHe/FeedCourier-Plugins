/**
 * FeedCourier Plugin API v1 TypeScript Definitions
 *
 * Single-file ES Modules executed synchronously inside FeedCourier's embedded
 * pure-ECMAScript (ES2024) sandbox. Do NOT use `import`, `new URL`, `Buffer`,
 * `TextEncoder`, `AbortSignal`, `fetch`, `console`, or `async/await` in plugin.js.
 */

export type PluginKind = "channel" | "processor";
export type PluginCategory =
  | "links"
  | "content"
  | "media"
  | "delivery"
  | "analytics"
  | "security"
  | "other";
export type PluginHook = "on_render" | "on_ingest" | "on_delivered";
export type PluginPermission = "network";

export interface LocalizedText {
  en: string;
  zh?: string;
}

export interface JsonSchemaObject {
  type?: string;
  required?: string[];
  properties?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PluginCapabilities {
  supports_html?: boolean;
  max_text_len?: number;
  [key: string]: unknown;
}

export interface PluginMeta {
  /** Globally unique plugin ID matching `^[a-z0-9][a-z0-9_-]{1,63}$`. */
  id: string;
  /** Human-readable display name (2–80 chars). */
  name: string;
  /** SemVer 2.0.0 release version matching the directory name. */
  version: string;
  /** Plugin API version; must be `"1"`. */
  api_version: "1";
  /** `"channel"` for delivery channels, `"processor"` for render/delivery hooks. */
  kind: PluginKind;
  /** Minimum compatible FeedCourier core version (SemVer 2.0.0). */
  min_core: string;
  /** Marketplace filtering category. */
  category: PluginCategory;
  /** Lucide icon slug (e.g. `"bell"`, `"send"`, `"link"`, `"sparkles"`). */
  icon: string;
  /** English string or `{ en, zh }` localized summary. */
  description: string | LocalizedText;
  /** HTTPS documentation or homepage URL. */
  homepage: string;
  /** HTTPS source repository URL. */
  repository: string;
  /** Normalized lowercase `host[:port]` entries allowed for `fc.fetch` by default. */
  allowed_hosts: string[];
  /** Lifecycle hooks implemented by processor plugins (`[]` for channel plugins). */
  hooks: PluginHook[];
  /** Declared permissions (`["network"]` when calling `fc.fetch`). */
  permissions: PluginPermission[];
  /** Account-level configuration JSON Schema (`kind: "channel"`). */
  account_schema?: JsonSchemaObject;
  /** Destination-level configuration JSON Schema (`kind: "channel"`). */
  destination_schema?: JsonSchemaObject;
  /** Instance/provider configuration JSON Schema (`kind: "processor"`). */
  instance_schema?: JsonSchemaObject;
  /** Per-route configuration JSON Schema (`kind: "processor"`). */
  route_option_schema?: JsonSchemaObject;
  /** Optional channel adapter capabilities metadata. */
  capabilities?: PluginCapabilities;
}

export interface FcFetchRequest {
  /** HTTP method (default `"GET"`). */
  method?: string;
  /** Target `http://` or `https://` URL (checked against SSRF guard & allowed hosts). */
  url: string;
  /** Optional request headers. */
  headers?: Record<string, string>;
  /** Optional UTF-8 request body string. */
  body?: string;
  /** Optional per-request timeout in milliseconds (capped by host policy). */
  timeoutMs?: number;
}

export interface FcFetchResponse {
  /** HTTP status code (e.g. 200, 429, 503). */
  status: number;
  /** `true` when `status >= 200 && status < 300`. */
  ok: boolean;
  /** Response headers with lowercase keys. */
  headers: Record<string, string>;
  /** UTF-8 response body text. */
  body: string;
}

export interface FcHostApi {
  /** Synchronous SSRF-protected HTTP client (does not follow redirects). Throws Error on network/timeout/policy failure. */
  fetch(req: FcFetchRequest): FcFetchResponse;
  /** Compute SHA-256 digest of UTF-8 `input` (`enc`: `"hex"` default, `"base64"`, or `"base64url"`). */
  sha256(input: string, enc?: "hex" | "base64" | "base64url"): string;
  /** Compute lowercase hex MD5 digest of UTF-8 `input`. */
  md5(input: string): string;
  /** Compute HMAC-SHA256 digest (`enc`: `"hex"` default, `"base64"`, or `"base64url"`). */
  hmacSha256(message: string, secret: string, enc?: "hex" | "base64" | "base64url"): string;
  /** Encode UTF-8 string to standard Base64. */
  base64Encode(input: string): string;
  /** Decode standard Base64 string to UTF-8. */
  base64Decode(input: string): string;
  /** Encode UTF-8 string to URL-safe Base64 without padding. */
  base64UrlEncode(input: string): string;
  /** Return exact UTF-8 byte length of `input`. */
  utf8ByteLength(input: string): number;
  /** Truncate `input` on Unicode scalar value boundaries to strictly `<= maxBytes` UTF-8 bytes. */
  truncateUtf8Bytes(input: string, maxBytes: number): string;
  /** Convert HTML markup into clean plain text. */
  htmlToText(html: string): string;
  /** Current Unix timestamp in whole seconds. */
  unixNow(): number;
  /** Generate a random UUID v4 string. */
  uuid(): string;
}

declare global {
  /** Host-injected FeedCourier sandbox utility API. */
  // eslint-disable-next-line no-var
  var fc: FcHostApi;
}

export interface MediaItem {
  kind: string;
  url: string;
  mime_type?: string;
  caption?: string;
}

export interface EntryPayload {
  title: string | null;
  url: string | null;
  summary_text: string | null;
  plain_text: string;
  content_html: string | null;
  author: string | null;
  published_at: number | null;
  /** Formatted `"YYYY-MM-DD HH:MM"` timestamp in the route's timezone. */
  published_local: string | null;
  media: MediaItem[];
}

export interface FeedPayload {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  favicon_url: string | null;
}

export interface RoutePayload {
  id: number;
  name: string;
  locale: string;
  timezone: string;
}

export interface ValidateContext {
  scope: "account" | "destination" | "instance" | "route";
  config: Record<string, unknown>;
}

export type ValidateResult =
  | { ok: true; normalized_config: Record<string, unknown> }
  | { ok: false; error: string };

export interface TestContext {
  scope: "account" | "destination" | "instance";
  locale?: string;
  account?: Record<string, unknown>;
  destination?: Record<string, unknown>;
  instance?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export type TestResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export interface DeliverContext {
  idempotency_key: string;
  task_id?: number;
  attempt?: number;
  account: Record<string, unknown>;
  destination: Record<string, unknown>;
  entry: EntryPayload;
  feed: FeedPayload;
  route: RoutePayload;
  checkpoint: unknown | null;
}

export type DeliverResult =
  | {
      outcome: "delivered";
      status_code?: number;
      external_id?: string;
      diagnostic?: string;
      checkpoint?: unknown;
    }
  | {
      outcome: "retry";
      status_code?: number;
      retry_after_secs?: number;
      diagnostic?: string;
      checkpoint?: unknown;
    }
  | {
      outcome: "deferred";
      status_code?: number;
      next_window_at?: number;
      retry_after_secs?: number;
      diagnostic?: string;
      checkpoint?: unknown;
    }
  | {
      outcome: "permanent_failure";
      status_code?: number;
      diagnostic?: string;
      checkpoint?: unknown;
    };

export interface OnRenderContext {
  idempotency_key: string;
  plugin_id: string;
  instance_config: Record<string, unknown> | null;
  route_option: Record<string, unknown>;
  entry: {
    title: string | null;
    url: string | null;
    summary_text: string | null;
    content_html: string | null;
    author: string | null;
    published_at: number | null;
  };
  feed: FeedPayload;
  route: RoutePayload;
  write_cache: boolean;
}

export type OnRenderResult =
  | {
      outcome?: "continue";
      primary_link?: string | null;
      content_html?: string | null;
      warnings?: string[];
    }
  | {
      outcome: "retry";
      retry_after_secs?: number;
      diagnostic?: string;
    };

export interface OnDeliveredContext {
  event: "on_delivered";
  idempotency_key: string;
  payload: Record<string, unknown>;
}

export interface OnDeliveredResult {
  ok?: boolean;
  warnings?: string[];
}

export interface ChannelPluginModule {
  meta: PluginMeta;
  validate?(ctx: ValidateContext): ValidateResult;
  test?(ctx: TestContext): TestResult;
  deliver(ctx: DeliverContext): DeliverResult;
}

export interface ProcessorPluginModule {
  meta: PluginMeta;
  validate?(ctx: ValidateContext): ValidateResult;
  test?(ctx: TestContext): TestResult;
  onRender?(ctx: OnRenderContext): OnRenderResult;
  onDelivered?(ctx: OnDeliveredContext): OnDeliveredResult;
}
