import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const pinnedVersion = JSON.parse(readFileSync("package.json", "utf8"))
  .packageManager.split("@")[1];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runWrapper(versions: Record<string, string | undefined>, exitCode = 0) {
  const directory = mkdtempSync(join(tmpdir(), "tw-pnpm-wrapper-"));
  temporaryDirectories.push(directory);
  for (const [command, version] of Object.entries(versions)) {
    if (version === undefined) continue;
    writeFileSync(join(directory, command), `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(${JSON.stringify(version)} + "\\n");
} else {
  process.stdout.write(JSON.stringify({ command: ${JSON.stringify(command)}, args }));
  process.exitCode = ${exitCode};
}
`, { mode: 0o755 });
  }
  return spawnSync(process.execPath, [resolve("scripts/pnpmw.mjs"), "install", "--frozen-lockfile"], {
    env: { ...process.env, PATH: directory },
    encoding: "utf8",
  });
}

describe("pinned package manager wrapper", () => {
  it("uses a matching local pnpm", () => {
    const result = runWrapper({ pnpm: pinnedVersion });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ command: "pnpm", args: ["install", "--frozen-lockfile"] });
  });

  it("skips an incompatible global pnpm and uses matching corepack", () => {
    const result = runWrapper({ pnpm: "99.0.0", corepack: pinnedVersion });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ command: "corepack", args: ["pnpm", "install", "--frozen-lockfile"] });
  });

  it("requests the exact pinned version when both installed candidates differ", () => {
    const result = runWrapper({ pnpm: "99.0.0", corepack: "98.0.0", npx: "unused" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ command: "npx", args: ["--yes", `pnpm@${pinnedVersion}`, "install", "--frozen-lockfile"] });
  });

  it("falls back to npx when neither pnpm nor corepack exists", () => {
    const result = runWrapper({ npx: "unused" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).args).toContain(`pnpm@${pinnedVersion}`);
  });

  it("preserves an install failure instead of trying a different manager", () => {
    const result = runWrapper({ pnpm: pinnedVersion, npx: "unused" }, 23);
    expect(result.status).toBe(23);
    expect(JSON.parse(result.stdout).command).toBe("pnpm");
  });
});
