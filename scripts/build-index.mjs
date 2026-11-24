#!/usr/bin/env node
/**
 * Zero-dependency FeedCourier Plugin Marketplace validator & index builder (Node.js 24+ ESM).
 *
 * Usage:
 *   node scripts/build-index.mjs           # Validate all registry/*.json and write index.json
 *   node scripts/build-index.mjs --check   # Validate schema + all registry/*.json without writing
 *   node scripts/build-index.mjs --verify-index # Also verify committed index.json matches registry/
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCHEMA_PATH = join(REPO_ROOT, "schema", "manifest.schema.json");
const BRIDGE_SCHEMA_PATH = join(REPO_ROOT, "schema", "bridge-protocol.schema.json");
const REGISTRY_DIR = join(REPO_ROOT, "registry");
const INDEX_PATH = join(REPO_ROOT, "index.json");

const ID_REGEX = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const VERIFY_INDEX = args.has("--verify-index");

for (const arg of args) {
  if (arg !== "--check" && arg !== "--verify-index") {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
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

function validateHttpsUrl(value, fieldName, errors) {
  if (typeof value !== "string") {
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

function validateManifestAgainstSchema(manifest, fileName, schema) {
  const errors = [];

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["Manifest root must be a JSON object"];
  }

  const requiredFields = Array.isArray(schema.required) ? schema.required : [];
  const props = schema.properties ?? {};

  for (const field of requiredFields) {
    if (!(field in manifest)) {
      errors.push(`Missing required field "${field}"`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(manifest)) {
      if (!(key in props)) {
        errors.push(`Unexpected property "${key}" (additionalProperties is false)`);
      }
    }
  }

  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in manifest)) {
      continue;
    }
    const val = manifest[key];

    if (propSchema.type === "string") {
      if (typeof val !== "string") {
        errors.push(`"${key}" must be a string`);
        continue;
      }
      if (typeof propSchema.minLength === "number" && val.length < propSchema.minLength) {
        errors.push(`"${key}" must be at least ${propSchema.minLength} characters`);
      }
      if (typeof propSchema.maxLength === "number" && val.length > propSchema.maxLength) {
        errors.push(`"${key}" must be at most ${propSchema.maxLength} characters`);
      }
      if ("const" in propSchema && val !== propSchema.const) {
        errors.push(`"${key}" must equal ${JSON.stringify(propSchema.const)} (got ${JSON.stringify(val)})`);
      }
      if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(val)) {
        errors.push(
          `"${key}" must be one of [${propSchema.enum.join(", ")}] (got ${JSON.stringify(val)})`,
        );
      }
      if (typeof propSchema.pattern === "string") {
        const re = new RegExp(propSchema.pattern);
        if (!re.test(val)) {
          errors.push(`"${key}" does not match required pattern ${propSchema.pattern} (got ${JSON.stringify(val)})`);
        }
      }
    } else if (propSchema.type === "array") {
      if (!Array.isArray(val)) {
        errors.push(`"${key}" must be an array`);
        continue;
      }
      if (typeof propSchema.minItems === "number" && val.length < propSchema.minItems) {
        errors.push(`"${key}" must contain at least ${propSchema.minItems} item(s)`);
      }
      if (propSchema.uniqueItems) {
        const seen = new Set();
        for (const item of val) {
          const sig = JSON.stringify(item);
          if (seen.has(sig)) {
            errors.push(`"${key}" must not contain duplicate items (${sig})`);
          }
          seen.add(sig);
        }
      }
      const itemSchema = propSchema.items;
      if (itemSchema) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (itemSchema.type === "string" && typeof item !== "string") {
            errors.push(`"${key}[${i}]" must be a string`);
            continue;
          }
          if (Array.isArray(itemSchema.enum) && !itemSchema.enum.includes(item)) {
            errors.push(
              `"${key}[${i}]" must be one of [${itemSchema.enum.join(", ")}] (got ${JSON.stringify(item)})`,
            );
          }
        }
      }
    } else if (propSchema.type === "object") {
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        errors.push(`"${key}" must be a JSON object`);
      }
    }
  }

  // Channel plugins implement /deliver and may declare an empty hooks array;
  // builtin and processor plugins must declare at least one hook.
  if (
    (manifest.kind === "builtin" || manifest.kind === "processor") &&
    Array.isArray(manifest.hooks) &&
    manifest.hooks.length === 0
  ) {
    errors.push(`"hooks" must contain at least 1 hook for kind "${manifest.kind}"`);
  }

  // Explicit semantic checks in addition to JSON Schema assertions.
  if (typeof manifest.id === "string") {
    if (!ID_REGEX.test(manifest.id)) {
      errors.push(`"id" must match ${ID_REGEX} (got ${JSON.stringify(manifest.id)})`);
    }
    const expectedFile = `${manifest.id}.json`;
    if (fileName !== expectedFile) {
      errors.push(`Filename "${fileName}" must match manifest id ("${expectedFile}")`);
    }
  }

  if (typeof manifest.version === "string" && !SEMVER_REGEX.test(manifest.version)) {
    errors.push(`"version" must be valid SemVer 2.0.0 (got ${JSON.stringify(manifest.version)})`);
  }
  if (typeof manifest.min_core === "string" && !SEMVER_REGEX.test(manifest.min_core)) {
    errors.push(`"min_core" must be valid SemVer 2.0.0 (got ${JSON.stringify(manifest.min_core)})`);
  }

  validateHttpsUrl(manifest.homepage, "homepage", errors);
  validateHttpsUrl(manifest.repository, "repository", errors);

  return errors;
}

function canonicalizeManifest(manifest) {
  const out = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    api_version: manifest.api_version,
    kind: manifest.kind,
  };
  if (typeof manifest.runtime === "string") {
    out.runtime = manifest.runtime;
  }
  out.min_core = manifest.min_core;
  out.category = manifest.category;
  out.icon = manifest.icon;
  out.description = manifest.description;
  out.homepage = manifest.homepage;
  out.repository = manifest.repository;
  if (typeof manifest.image === "string") {
    out.image = manifest.image;
  }
  if (typeof manifest.compose_snippet === "string") {
    out.compose_snippet = manifest.compose_snippet;
  }
  out.hooks = manifest.hooks;
  out.permissions = manifest.permissions;
  return out;
}

function main() {
  const schema = readJsonFile(SCHEMA_PATH, "manifest schema");
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(
      `Expected Draft 2020-12 schema in schema/manifest.schema.json (got ${JSON.stringify(schema.$schema)})`,
    );
  }
  if (existsSync(BRIDGE_SCHEMA_PATH)) {
    const bridgeSchema = readJsonFile(BRIDGE_SCHEMA_PATH, "bridge protocol schema");
    if (bridgeSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(
        `Expected Draft 2020-12 schema in schema/bridge-protocol.schema.json (got ${JSON.stringify(bridgeSchema.$schema)})`,
      );
    }
  }

  if (!existsSync(REGISTRY_DIR)) {
    throw new Error(`Registry directory not found: ${REGISTRY_DIR}`);
  }

  const entries = readdirSync(REGISTRY_DIR, { withFileTypes: true });
  const jsonFiles = [];
  const allErrors = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      allErrors.push(`registry/${entry.name}: only .json manifest files are permitted in registry/`);
      continue;
    }
    jsonFiles.push(entry.name);
  }

  jsonFiles.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (jsonFiles.length === 0) {
    allErrors.push("registry/ must contain at least one plugin manifest");
  }

  const manifests = [];
  const seenIds = new Map();

  for (const fileName of jsonFiles) {
    const filePath = join(REGISTRY_DIR, fileName);
    let manifest;
    try {
      manifest = readJsonFile(filePath, `registry/${fileName}`);
    } catch (err) {
      allErrors.push(err.message);
      continue;
    }

    const errors = validateManifestAgainstSchema(manifest, basename(filePath), schema);
    if (errors.length > 0) {
      for (const msg of errors) {
        allErrors.push(`registry/${fileName}: ${msg}`);
      }
      continue;
    }

    if (seenIds.has(manifest.id)) {
      allErrors.push(
        `registry/${fileName}: duplicate plugin id "${manifest.id}" (already defined in registry/${seenIds.get(manifest.id)})`,
      );
      continue;
    }

    seenIds.set(manifest.id, fileName);
    manifests.push(canonicalizeManifest(manifest));
  }

  if (allErrors.length > 0) {
    console.error("Plugin registry validation failed:");
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Deterministic ASCII sort by plugin ID.
  manifests.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
  const nextPluginsJson = JSON.stringify(manifests);

  if (VERIFY_INDEX) {
    if (!existingIndex || existingIndex.schema_version !== 1 || existingPluginsJson !== nextPluginsJson) {
      console.error(
        "index.json is out of date with registry/*.json. Run `node scripts/build-index.mjs` to rebuild it.",
      );
      process.exit(1);
    }
  }

  if (CHECK_ONLY) {
    console.log(
      `OK: validated ${manifests.length} plugin manifest(s) against schema/manifest.schema.json.`,
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
    plugins: manifests,
  };

  writeFileSync(INDEX_PATH, `${JSON.stringify(indexDoc, null, 2)}\n`, "utf-8");
  console.log(
    `Built index.json with ${manifests.length} plugin(s) (generated_at: ${generatedAt}).`,
  );
}

main();
