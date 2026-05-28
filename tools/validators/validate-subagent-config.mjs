#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_RUNTIMES = new Set([
  "github-codex-subscription",
  "local-subagents",
  "parent-session",
  "disabled",
]);
const ALLOWED_EXCEPTIONS = new Set([
  "local-only-files",
  "secrets",
  "unpushed-worktrees",
  "cloud-runtime-unavailable",
]);
const ALLOWED_KEYS = new Set([
  "default_runtime",
  "api_billed_fallback",
  "local_only_exceptions",
]);

export function validateSubagentConfigObject(config = {}) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["config: must be an object"];
  }
  const subagents = config.subagents;
  if (subagents === undefined) return errors;
  if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) {
    return ["subagents: must be an object"];
  }
  for (const key of Object.keys(subagents)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(`subagents.${key}: unknown property`);
    }
  }
  if (
    subagents.default_runtime !== undefined &&
    !ALLOWED_RUNTIMES.has(subagents.default_runtime)
  ) {
    errors.push(
      `subagents.default_runtime: must be one of ${[...ALLOWED_RUNTIMES].join(", ")}`,
    );
  }
  if (
    subagents.api_billed_fallback !== undefined &&
    typeof subagents.api_billed_fallback !== "boolean"
  ) {
    errors.push("subagents.api_billed_fallback: must be boolean");
  }
  if (subagents.local_only_exceptions !== undefined) {
    if (!Array.isArray(subagents.local_only_exceptions)) {
      errors.push("subagents.local_only_exceptions: must be an array");
    } else {
      for (const entry of subagents.local_only_exceptions) {
        if (!ALLOWED_EXCEPTIONS.has(entry)) {
          errors.push(
            `subagents.local_only_exceptions: unsupported exception ${JSON.stringify(entry)}`,
          );
        }
      }
    }
  }
  if (
    subagents.api_billed_fallback === true &&
    config.internal_eas_repo_overrides !== true
  ) {
    errors.push(
      "subagents.api_billed_fallback: true requires documented override (internal_eas_repo_overrides=true)",
    );
  }
  return errors;
}

function findConfig(repoRoot) {
  for (const rel of [".ai/config.json", "ai/config.json"]) {
    const path = resolve(repoRoot, rel);
    if (existsSync(path)) return path;
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  let repoRoot = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo") {
      const value = args[i + 1];
      if (value && !value.startsWith("-")) {
        repoRoot = resolve(value);
        i++;
      } else {
        repoRoot = resolve(".");
      }
    }
  }
  const configPath = findConfig(repoRoot);
  if (!configPath) {
    console.log("[validate-subagent-config] SKIP: no .ai/config.json or ai/config.json found");
    return;
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error(`[validate-subagent-config] ERROR: ${configPath} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  const errors = validateSubagentConfigObject(config);
  if (errors.length) {
    for (const error of errors) console.error(`[validate-subagent-config] ERROR: ${error}`);
    process.exit(1);
  }
  console.log("[validate-subagent-config] OK");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
