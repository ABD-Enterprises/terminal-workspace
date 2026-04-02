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
  { command: "pnpm", args },
  { command: "corepack", args: ["pnpm", ...args] },
  pinnedVersion
    ? { command: "npx", args: ["--yes", `pnpm@${pinnedVersion}`, ...args] }
    : { command: "npx", args: ["--yes", "pnpm", ...args] },
];

for (const candidate of candidates) {
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
