#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const packageManager = String(packageJson.packageManager ?? "pnpm");
const [, pinnedVersion] = packageManager.split("@");
const args = process.argv.slice(2);

const candidates = [
  { command: "pnpm", args, versionArgs: ["--version"] },
  { command: "corepack", args: ["pnpm", ...args], versionArgs: ["pnpm", "--version"] },
  pinnedVersion
    ? { command: "npx", args: ["--yes", `pnpm@${pinnedVersion}`, ...args] }
    : { command: "npx", args: ["--yes", "pnpm", ...args] },
];

for (const candidate of candidates) {
  // A globally installed pnpm can be a different major that ignores project
  // settings. Only use it (or corepack) when it resolves the declared version.
  if (pinnedVersion && candidate.versionArgs) {
    const version = spawnSync(candidate.command, candidate.versionArgs, {
      cwd: rootDir,
      encoding: "utf8",
    });
    if (version.status !== 0 || version.stdout.trim() !== pinnedVersion) {
      continue;
    }
  }
  const result = spawnSync(candidate.command, candidate.args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error?.code === "ENOENT") {
    continue;
  }

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 0);
}

console.error("Unable to find pnpm, corepack, or npx in this environment.");
process.exit(1);
