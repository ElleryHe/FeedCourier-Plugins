#!/usr/bin/env node
/**
 * Zero-dependency FeedCourier Plugin Marketplace validator & index builder (Node.js 24+ ESM).
 *
 * Discovers:
 *   1. Built-in Rust plugins:  plugins/builtin/<id>/manifest.json
 *   2. Single-file JS plugins: plugins/<channels|processors>/<id>/<version>/plugin.js
 *
 * Usage:
 *   node scripts/build-index.mjs                # Validate all plugins and write index.json
 *   node scripts/build-index.mjs --check        # Validate schema + plugins without writing
 *   node scripts/build-index.mjs --verify-index # Also verify committed index.json is up to date
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCHEMA_PATH = join(REPO_ROOT, "schema", "manifest.schema.json");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");
const TEMPLATES_DIR = join(REPO_ROOT, "templates");
const INDEX_PATH = join(REPO_ROOT, "index.json");

const ID_REGEX = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const ICON_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ALLOWED_HOST_REGEX =
  /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const BLOCKED_ALLOWED_HOSTS = new Set([
  "169.254.169.254",
  "100.100.100.200",
  "0.0.0.0",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

const VALID_PLUGIN_ROOT_DIRS = new Set(["builtin", "channels", "processors"]);
const JS_KIND_DIRS = new Map([
  ["channels", "channel"],
  ["processors", "processor"],
]);

const FORBIDDEN_BOA_PATTERNS = [
  { re: /(?<!\.)\bimport\b/, reason: "static/dynamic `import` statements are forbidden in single-file plugin.js" },
  { re: /\bnew\s+URL\s*\(/, reason: "`new URL(...)` is unavailable in Boa sandbox; use pure JS parsing" },
  { re: /\bURLSearchParams\b/, reason: "`URLSearchParams` is unavailable in Boa sandbox" },
  { re: /(?<!\.)\bBuffer\b/, reason: "`Buffer` is unavailable in Boa sandbox; use `fc.*` helpers" },
  { re: /\bTextEncoder\b/, reason: "`TextEncoder` is unavailable in Boa sandbox; use `fc.utf8ByteLength`/`fc.truncateUtf8Bytes`" },
  { re: /\bTextDecoder\b/, reason: "`TextDecoder` is unavailable in Boa sandbox" },
  { re: /\bAbortSignal\b/, reason: "`AbortSignal` is unavailable in Boa sandbox; use `fc.fetch({ timeoutMs })`" },
  { re: /\bAbortController\b/, reason: "`AbortController` is unavailable in Boa sandbox" },
  { re: /(?<!\.)\brequire\s*\(/, reason: "`require(...)` is forbidden in single-file plugin.js" },
  { re: /(?<!\.)\bprocess\b/, reason: "`process` is unavailable in Boa sandbox" },
  { re: /(?<!\.)\bconsole\b/, reason: "`console` is unavailable in Boa sandbox" },
  { re: /(?<!\.)\bfetch\s*\(/, reason: "global `fetch(...)` is unavailable in Boa sandbox; use `fc.fetch(...)`" },
];

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const VERIFY_INDEX = args.has("--verify-index");

for (const arg of args) {
  if (arg !== "--check" && arg !== "--verify-index") {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

function toPosixPath(relPath) {
  return relPath.split("\\").join("/");
}

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read ${label} (${filePath}): ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${filePath}): ${err.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strip JS comments, regex literals, and string/template literal contents while preserving
 * line breaks, so static sandbox checks do not false-trigger on comments or error strings
 * and cannot be bypassed by quotes inside regex literals.
 */
function stripJsCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const len = src.length;
  let lastSig = "";

  while (i < len) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < len && src[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      out += " ";
      continue;
    }

    // Regex literal (when `/` follows start, operator, punctuator, or expression-prefix keyword)
    if (
      ch === "/" &&
      (lastSig === "" ||
        "=(,[!&|?:;{}~^+-*%<>".includes(lastSig) ||
        /\b(?:return|throw|case|in|of|typeof|void|delete|else|do)\s*$/.test(out))
    ) {
      out += "/re/";
      i++;
      let inClass = false;
      while (i < len && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "[") {
          inClass = true;
        } else if (src[i] === "]") {
          inClass = false;
        } else if (src[i] === "/" && !inClass) {
          i++;
          while (i < len && /[a-z]/i.test(src[i])) i++;
          break;
        }
        i++;
      }
      lastSig = ")";
      continue;
    }

    // Single or double quoted string (single-line in JS unless line-continued with `\`)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += quote;
      i++;
      while (i < len && src[i] !== quote && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < len) {
          if (src[i + 1] === "\n") out += "\n";
          i += 2;
          continue;
        }
        i++;
      }
      if (i < len && src[i] === quote) {
        out += quote;
        i++;
      }
      lastSig = quote;
      continue;
    }

    // Template literal (preserve `${ ... }` expressions while stripping literal text)
    if (ch === "`") {
      out += "`";
      i++;
      while (i < len && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            out += src[i];
            i++;
          }
          continue;
        }
        if (src[i] === "\n") out += "\n";
        i++;
      }
      if (i < len) {
        out += "`";
        i++;
      }
      lastSig = "`";
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) {
      lastSig = ch;
    }
    i++;
  }
  return out;
}

function checkJsSourceSandboxCompliance(source, label, errors) {
  const stripped = stripJsCommentsAndStrings(source);
  for (const rule of FORBIDDEN_BOA_PATTERNS) {
    if (rule.re.test(stripped)) {
      errors.push(`${label}: ${rule.reason}`);
    }
  }
}

function validateHttpsUrl(value, fieldName, errors) {
  if (typeof value !== "string") {
    errors.push(`"${fieldName}" must be a string`);
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`"${fieldName}" must be a valid HTTPS URL (got ${JSON.stringify(value)})`);
    return;
  }
  if (parsed.protocol !== "https:") {
    errors.push(`"${fieldName}" must use https:// scheme (got ${JSON.stringify(value)})`);
  }
  if (!parsed.hostname) {
    errors.push(`"${fieldName}" must include a valid hostname (got ${JSON.stringify(value)})`);
  }
  if (parsed.username || parsed.password) {
    errors.push(`"${fieldName}" must not contain embedded credentials`);
  }
}

function validateAllowedHosts(hosts, errors) {
  if (!Array.isArray(hosts)) {
    errors.push(`"allowed_hosts" must be an array`);
    return;
  }
  const seen = new Set();
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    if (typeof host !== "string") {
      errors.push(`"allowed_hosts[${i}]" must be a string`);
      continue;
    }
    const match = ALLOWED_HOST_REGEX.exec(host);
    if (!match) {
      errors.push(
        `"allowed_hosts[${i}]" must be a normalized lowercase hostname or '*.example.com' without scheme, port, or path (got ${JSON.stringify(host)})`,
      );
      continue;
    }
    if (BLOCKED_ALLOWED_HOSTS.has(host)) {
      errors.push(`"allowed_hosts[${i}]" must not include cloud metadata or unspecified host ${JSON.stringify(host)}`);
      continue;
    }
    if (seen.has(host)) {
      errors.push(`"allowed_hosts" must not contain duplicate host ${JSON.stringify(host)}`);
    }
    seen.add(host);
  }
}

function parseDescription(desc, errors) {
  if (typeof desc === "string") {
    if (desc.length < 10 || desc.length > 280) {
      errors.push(`"description" string must be 10–280 characters`);
    }
    return { en: desc, i18n: { en: desc } };
  }
  if (isPlainObject(desc)) {
    for (const key of Object.keys(desc)) {
      if (key !== "en" && key !== "zh") {
        errors.push(`"description" contains unsupported locale key ${JSON.stringify(key)}`);
      }
    }
    if (typeof desc.en !== "string" || desc.en.length < 10 || desc.en.length > 280) {
      errors.push(`"description.en" must be a string of 10–280 characters`);
    }
    if ("zh" in desc && (typeof desc.zh !== "string" || desc.zh.length < 4 || desc.zh.length > 280)) {
      errors.push(`"description.zh" must be a string of 4–280 characters`);
    }
    const i18n = { en: typeof desc.en === "string" ? desc.en : "" };
    if (typeof desc.zh === "string") {
      i18n.zh = desc.zh;
    }
    return { en: i18n.en, i18n };
  }
  errors.push(`"description" must be a string or localized { en, zh } object`);
  return { en: "", i18n: { en: "" } };
}

function validateMetaObject(meta, schema, { expectedId, expectedVersion, expectedKind, runtime }) {
  const errors = [];

  if (!isPlainObject(meta)) {
    return { errors: ["Manifest/meta root must be a plain object"], description: null };
  }

  const requiredFields = Array.isArray(schema.required) ? schema.required : [];
  const props = schema.properties ?? {};

  for (const field of requiredFields) {
    if (!(field in meta)) {
      errors.push(`Missing required field "${field}"`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(meta)) {
      if (!(key in props)) {
        errors.push(`Unexpected property "${key}"`);
      }
    }
  }

  if (typeof meta.id !== "string" || !ID_REGEX.test(meta.id)) {
    errors.push(`"id" must match ${ID_REGEX} (got ${JSON.stringify(meta.id)})`);
  } else if (expectedId && meta.id !== expectedId) {
    errors.push(`"id" (${JSON.stringify(meta.id)}) must match directory name "${expectedId}"`);
  }

  if (typeof meta.name !== "string" || meta.name.length < 2 || meta.name.length > 80) {
    errors.push(`"name" must be a string of 2–80 characters`);
  }

  if (typeof meta.version !== "string" || !SEMVER_REGEX.test(meta.version)) {
    errors.push(`"version" must be valid SemVer 2.0.0 (got ${JSON.stringify(meta.version)})`);
  } else if (expectedVersion && meta.version !== expectedVersion) {
    errors.push(
      `"version" (${JSON.stringify(meta.version)}) must match version directory "${expectedVersion}"`,
    );
  }

  if (meta.api_version !== "1") {
    errors.push(`"api_version" must equal "1" (got ${JSON.stringify(meta.api_version)})`);
  }

  const validKinds = props.kind?.enum ?? ["builtin", "channel", "processor"];
  if (typeof meta.kind !== "string" || !validKinds.includes(meta.kind)) {
    errors.push(`"kind" must be one of [${validKinds.join(", ")}] (got ${JSON.stringify(meta.kind)})`);
  } else if (expectedKind && meta.kind !== expectedKind) {
    errors.push(`"kind" must equal "${expectedKind}" for this directory (got ${JSON.stringify(meta.kind)})`);
  }

  if ("runtime" in meta) {
    if (meta.runtime !== runtime) {
      errors.push(`"runtime" must equal "${runtime}" (got ${JSON.stringify(meta.runtime)})`);
    }
  } else if (runtime === "builtin") {
    errors.push(`"runtime" must be explicitly set to "builtin" for built-in plugins`);
  }

  if (typeof meta.min_core !== "string" || !SEMVER_REGEX.test(meta.min_core)) {
    errors.push(`"min_core" must be valid SemVer 2.0.0 (got ${JSON.stringify(meta.min_core)})`);
  }

  const validCategories = props.category?.enum ?? [];
  if (typeof meta.category !== "string" || !validCategories.includes(meta.category)) {
    errors.push(
      `"category" must be one of [${validCategories.join(", ")}] (got ${JSON.stringify(meta.category)})`,
    );
  }

  if (typeof meta.icon !== "string" || !ICON_REGEX.test(meta.icon)) {
    errors.push(`"icon" must match ${ICON_REGEX} (got ${JSON.stringify(meta.icon)})`);
  }

  const description = parseDescription(meta.description, errors);

  validateHttpsUrl(meta.homepage, "homepage", errors);
  validateHttpsUrl(meta.repository, "repository", errors);
  validateAllowedHosts(meta.allowed_hosts, errors);

  const validHooks = props.hooks?.items?.enum ?? ["on_render", "on_ingest", "on_delivered"];
  if (!Array.isArray(meta.hooks)) {
    errors.push(`"hooks" must be an array`);
  } else {
    const seenHooks = new Set();
    for (let i = 0; i < meta.hooks.length; i++) {
      const h = meta.hooks[i];
      if (typeof h !== "string" || !validHooks.includes(h)) {
        errors.push(`"hooks[${i}]" must be one of [${validHooks.join(", ")}] (got ${JSON.stringify(h)})`);
      }
      if (seenHooks.has(h)) {
        errors.push(`"hooks" contains duplicate entry ${JSON.stringify(h)}`);
      }
      seenHooks.add(h);
    }
    if ((meta.kind === "builtin" || meta.kind === "processor") && meta.hooks.length === 0) {
      errors.push(`"hooks" must contain at least 1 hook for kind "${meta.kind}"`);
    }
  }

  const validPermissions = props.permissions?.items?.enum ?? ["network"];
  if (!Array.isArray(meta.permissions)) {
    errors.push(`"permissions" must be an array`);
  } else {
    const seenPerms = new Set();
    for (let i = 0; i < meta.permissions.length; i++) {
      const p = meta.permissions[i];
      if (typeof p !== "string" || !validPermissions.includes(p)) {
        errors.push(
          `"permissions[${i}]" must be one of [${validPermissions.join(", ")}] (got ${JSON.stringify(p)})`,
        );
      }
      if (seenPerms.has(p)) {
        errors.push(`"permissions" contains duplicate entry ${JSON.stringify(p)}`);
      }
      seenPerms.add(p);
    }
  }

  for (const objField of [
    "account_schema",
    "destination_schema",
    "instance_schema",
    "route_option_schema",
    "capabilities",
  ]) {
    if (objField in meta && !isPlainObject(meta[objField])) {
      errors.push(`"${objField}" must be a JSON object`);
    }
  }

  return { errors, description };
}

function parseSemver(version) {
  const m = SEMVER_REGEX.exec(version);
  if (!m) {
    throw new Error(`Invalid SemVer: ${version}`);
  }
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
    patch: Number.parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

function compareSemverDesc(aStr, bStr) {
  const a = parseSemver(aStr);
  const b = parseSemver(bStr);

  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  if (a.patch !== b.patch) return b.patch - a.patch;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return -1; // stable > prerelease
  if (bPre.length === 0) return 1;

  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    if (i >= aPre.length) return 1;
    if (i >= bPre.length) return -1;
    const ai = aPre[i];
    const bi = bPre[i];
    if (ai === bi) continue;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) return Number.parseInt(bi, 10) - Number.parseInt(ai, 10);
    if (aNum) return 1; // numeric < non-numeric
    if (bNum) return -1;
    return ai < bi ? 1 : -1;
  }
  return 0;
}

function requirePluginReadmes(pluginDir, relLabel, errors) {
  for (const readmeName of ["README.md", "README.zh-CN.md"]) {
    const p = join(pluginDir, readmeName);
    if (!existsSync(p)) {
      errors.push(`${relLabel}: missing required ${readmeName}`);
    } else if (!readFileSync(p, "utf-8").trim()) {
      errors.push(`${relLabel}: ${readmeName} must not be empty`);
    }
  }
}

async function discoverBuiltinPlugins(schema, allErrors, seenIds) {
  const builtinRoot = join(PLUGINS_DIR, "builtin");
  if (!existsSync(builtinRoot)) {
    return [];
  }

  const results = [];
  const entries = readdirSync(builtinRoot, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      allErrors.push(`plugins/builtin/${entry.name}: expected plugin directory`);
      continue;
    }

    const pluginId = entry.name;
    const pluginDir = join(builtinRoot, pluginId);
    const relLabel = `plugins/builtin/${pluginId}`;
    const manifestPath = join(pluginDir, "manifest.json");

    requirePluginReadmes(pluginDir, relLabel, allErrors);

    if (!existsSync(manifestPath)) {
      allErrors.push(`${relLabel}: missing required manifest.json`);
      continue;
    }

    let manifest;
    try {
      manifest = readJsonFile(manifestPath, `${relLabel}/manifest.json`);
    } catch (err) {
      allErrors.push(err.message);
      continue;
    }

    const { errors, description } = validateMetaObject(manifest, schema, {
      expectedId: pluginId,
      expectedVersion: null,
      expectedKind: "builtin",
      runtime: "builtin",
    });

    if (errors.length > 0) {
      for (const msg of errors) {
        allErrors.push(`${relLabel}/manifest.json: ${msg}`);
      }
      continue;
    }

    if (seenIds.has(manifest.id)) {
      allErrors.push(
        `${relLabel}: duplicate plugin id "${manifest.id}" (already defined in ${seenIds.get(manifest.id)})`,
      );
      continue;
    }
    seenIds.set(manifest.id, relLabel);

    results.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      api_version: manifest.api_version,
      kind: "builtin",
      runtime: "builtin",
      min_core: manifest.min_core,
      category: manifest.category,
      icon: manifest.icon,
      description: description.en,
      description_i18n: description.i18n,
      homepage: manifest.homepage,
      repository: manifest.repository,
      hooks: manifest.hooks,
      permissions: manifest.permissions,
      allowed_hosts: [],
      latest: manifest.version,
      versions: [],
    });
  }

  return results;
}

async function discoverJsPlugins(kindDir, expectedKind, schema, allErrors, seenIds) {
  const rootDir = join(PLUGINS_DIR, kindDir);
  if (!existsSync(rootDir)) {
    return [];
  }

  const results = [];
  const pluginDirs = readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const pluginEntry of pluginDirs) {
    if (!pluginEntry.isDirectory()) {
      allErrors.push(`plugins/${kindDir}/${pluginEntry.name}: expected plugin directory`);
      continue;
    }

    const pluginId = pluginEntry.name;
    const pluginDir = join(rootDir, pluginId);
    const relPluginLabel = `plugins/${kindDir}/${pluginId}`;

    if (!ID_REGEX.test(pluginId)) {
      allErrors.push(`${relPluginLabel}: directory name must match ${ID_REGEX}`);
      continue;
    }

    requirePluginReadmes(pluginDir, relPluginLabel, allErrors);

    const children = readdirSync(pluginDir, { withFileTypes: true }).filter(
      (e) => !e.name.startsWith("."),
    );
    const versionDirs = [];
    for (const child of children) {
      if (child.isDirectory()) {
        versionDirs.push(child.name);
      } else if (child.name !== "README.md" && child.name !== "README.zh-CN.md") {
        allErrors.push(
          `${relPluginLabel}/${child.name}: unexpected file at plugin root (expected README.md, README.zh-CN.md, or SemVer version directories)`,
        );
      }
    }

    if (versionDirs.length === 0) {
      allErrors.push(`${relPluginLabel}: must contain at least one SemVer version directory`);
      continue;
    }

    const parsedVersions = [];
    for (const versionName of versionDirs) {
      const relVerLabel = `${relPluginLabel}/${versionName}`;
      if (!SEMVER_REGEX.test(versionName)) {
        allErrors.push(`${relVerLabel}: version directory name must be valid SemVer 2.0.0`);
        continue;
      }

      const verDir = join(pluginDir, versionName);
      const pluginJsPath = join(verDir, "plugin.js");
      const changelogPath = join(verDir, "CHANGELOG.md");

      if (!existsSync(pluginJsPath)) {
        allErrors.push(`${relVerLabel}: missing required plugin.js`);
        continue;
      }
      if (!existsSync(changelogPath)) {
        allErrors.push(`${relVerLabel}: missing required CHANGELOG.md`);
        continue;
      }

      const rawBytes = readFileSync(pluginJsPath);
      const sourceText = rawBytes.toString("utf-8");
      const changelogText = readFileSync(changelogPath, "utf-8").trim();
      if (!changelogText) {
        allErrors.push(`${relVerLabel}/CHANGELOG.md: must not be empty`);
      }

      const sourceErrors = [];
      checkJsSourceSandboxCompliance(sourceText, `${relVerLabel}/plugin.js`, sourceErrors);
      if (sourceErrors.length > 0) {
        allErrors.push(...sourceErrors);
        continue;
      }

      const sha256 = createHash("sha256").update(rawBytes).digest("hex");

      let mod;
      try {
        mod = await import(pathToFileURL(pluginJsPath).href);
      } catch (err) {
        allErrors.push(`${relVerLabel}/plugin.js: failed to import ES module: ${err.message}`);
        continue;
      }

      if (!mod || !("meta" in mod)) {
        allErrors.push(`${relVerLabel}/plugin.js: must export \`meta\``);
        continue;
      }

      const { errors, description } = validateMetaObject(mod.meta, schema, {
        expectedId: pluginId,
        expectedVersion: versionName,
        expectedKind,
        runtime: "js",
      });

      if (expectedKind === "channel") {
        if (typeof mod.deliver !== "function") {
          errors.push(`channel plugin must export a \`deliver(ctx)\` function`);
        }
        if ("validate" in mod && typeof mod.validate !== "function") {
          errors.push(`exported \`validate\` must be a function`);
        }
        if ("test" in mod && typeof mod.test !== "function") {
          errors.push(`exported \`test\` must be a function`);
        }
      } else if (expectedKind === "processor") {
        const hasRender = typeof mod.onRender === "function";
        const hasDelivered = typeof mod.onDelivered === "function";
        if (!hasRender && !hasDelivered) {
          errors.push(`processor plugin must export \`onRender(ctx)\` and/or \`onDelivered(ctx)\``);
        }
      }

      if (errors.length > 0) {
        for (const msg of errors) {
          allErrors.push(`${relVerLabel}/plugin.js: ${msg}`);
        }
        continue;
      }

      parsedVersions.push({
        meta: mod.meta,
        description,
        version: versionName,
        min_core: mod.meta.min_core,
        path: toPosixPath(relative(REPO_ROOT, pluginJsPath)),
        sha256,
        changelog_path: toPosixPath(relative(REPO_ROOT, changelogPath)),
        changelog: changelogText,
      });
    }

    if (parsedVersions.length === 0) {
      continue;
    }

    if (seenIds.has(pluginId)) {
      allErrors.push(
        `${relPluginLabel}: duplicate plugin id "${pluginId}" (already defined in ${seenIds.get(pluginId)})`,
      );
      continue;
    }
    seenIds.set(pluginId, relPluginLabel);

    parsedVersions.sort((a, b) => compareSemverDesc(a.version, b.version));
    const latest = parsedVersions[0];

    results.push({
      id: latest.meta.id,
      name: latest.meta.name,
      version: latest.meta.version,
      api_version: latest.meta.api_version,
      kind: latest.meta.kind,
      runtime: "js",
      min_core: latest.meta.min_core,
      category: latest.meta.category,
      icon: latest.meta.icon,
      description: latest.description.en,
      description_i18n: latest.description.i18n,
      homepage: latest.meta.homepage,
      repository: latest.meta.repository,
      hooks: latest.meta.hooks,
      permissions: latest.meta.permissions,
      allowed_hosts: latest.meta.allowed_hosts,
      latest: latest.version,
      versions: parsedVersions.map((v) => ({
        version: v.version,
        min_core: v.min_core,
        path: v.path,
        sha256: v.sha256,
        changelog_path: v.changelog_path,
        changelog: v.changelog,
      })),
    });
  }

  return results;
}

async function validateTemplates(allErrors) {
  if (!existsSync(TEMPLATES_DIR)) {
    return;
  }
  const files = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const file of files) {
    const filePath = join(TEMPLATES_DIR, file.name);
    const label = `templates/${file.name}`;
    const src = readFileSync(filePath, "utf-8");
    checkJsSourceSandboxCompliance(src, label, allErrors);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      if (!mod || !isPlainObject(mod.meta)) {
        allErrors.push(`${label}: template must export a plain \`meta\` object`);
      }
    } catch (err) {
      allErrors.push(`${label}: failed to import template module: ${err.message}`);
    }
  }
}

async function main() {
  const schema = readJsonFile(SCHEMA_PATH, "manifest schema");
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(
      `Expected Draft 2020-12 schema in schema/manifest.schema.json (got ${JSON.stringify(schema.$schema)})`,
    );
  }

  if (!existsSync(PLUGINS_DIR)) {
    throw new Error(`Plugins directory not found: ${PLUGINS_DIR}`);
  }

  const allErrors = [];
  const rootEntries = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter(
    (e) => !e.name.startsWith("."),
  );
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || !VALID_PLUGIN_ROOT_DIRS.has(entry.name)) {
      allErrors.push(
        `plugins/${entry.name}: unexpected entry (only builtin/, channels/, processors/ are allowed)`,
      );
    }
  }

  const seenIds = new Map();
  const plugins = [];

  plugins.push(...(await discoverBuiltinPlugins(schema, allErrors, seenIds)));
  for (const [kindDir, expectedKind] of JS_KIND_DIRS.entries()) {
    plugins.push(...(await discoverJsPlugins(kindDir, expectedKind, schema, allErrors, seenIds)));
  }

  await validateTemplates(allErrors);

  if (plugins.length === 0) {
    allErrors.push("plugins/ must contain at least one valid plugin");
  }

  if (allErrors.length > 0) {
    console.error("Plugin marketplace validation failed:");
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Deterministic ASCII sort by plugin ID.
  plugins.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let existingIndex = null;
  if (existsSync(INDEX_PATH)) {
    try {
      existingIndex = readJsonFile(INDEX_PATH, "index.json");
    } catch (err) {
      if (CHECK_ONLY || VERIFY_INDEX) {
        console.error(err.message);
        process.exit(1);
      }
    }
  }

  const existingPluginsJson =
    existingIndex && Array.isArray(existingIndex.plugins)
      ? JSON.stringify(existingIndex.plugins)
      : null;
  const nextPluginsJson = JSON.stringify(plugins);

  if (VERIFY_INDEX) {
    if (
      !existingIndex ||
      existingIndex.schema_version !== 1 ||
      existingPluginsJson !== nextPluginsJson
    ) {
      console.error(
        "index.json is out of date with plugins/. Run `node scripts/build-index.mjs` to rebuild it.",
      );
      process.exit(1);
    }
  }

  if (CHECK_ONLY) {
    console.log(
      `OK: validated ${plugins.length} plugin(s) against schema/manifest.schema.json.`,
    );
    return;
  }

  const generatedAt =
    existingIndex &&
    existingIndex.schema_version === 1 &&
    typeof existingIndex.generated_at === "string" &&
    existingPluginsJson === nextPluginsJson
      ? existingIndex.generated_at
      : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const indexDoc = {
    schema_version: 1,
    generated_at: generatedAt,
    plugins,
  };

  writeFileSync(INDEX_PATH, `${JSON.stringify(indexDoc, null, 2)}\n`, "utf-8");
  console.log(
    `Built index.json with ${plugins.length} plugin(s) (generated_at: ${generatedAt}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
