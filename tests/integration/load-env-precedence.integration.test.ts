import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// MAINT-2 (#481): the loader exported a key only when it was still empty and
// read .env.shared before .env, so a key present in both files could never take
// the .env value — even though docs/development.md, docs/release.md and
// docs/operations.md all say that .env overrides the shared defaults.
//
// The loader derives both file paths from the directory it lives in, so the
// test copies it into a temporary root with its own .env.shared and .env. The
// repository's own env files are never read and never touched.

const loaderSource = fileURLToPath(new URL("../../scripts/load-env.sh", import.meta.url));

const PROBED_KEYS = [
  "TERMSNIP_TEST_SHARED",
  "TERMSNIP_TEST_OVERRIDDEN",
  "TERMSNIP_TEST_LOCAL",
  "TERMSNIP_TEST_BLANK",
  "TERMSNIP_TEST_QUOTED",
  "TERMSNIP_UI_PORT",
] as const;

const UNSET = "__unset__";

const createdRoots: string[] = [];

afterAll(() => {
  for (const root of createdRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A temporary root holding a copy of the loader and its own env files. */
function makeRoot(shared: string | null, local: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "load-env-"));
  createdRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(loaderSource, join(root, "scripts", "load-env.sh"));
  if (shared !== null) {
    writeFileSync(join(root, ".env.shared"), shared);
  }
  if (local !== null) {
    writeFileSync(join(root, ".env"), local);
  }
  return root;
}

/**
 * Source the loader in a child shell and read back the variables it exported.
 * The child environment is built from scratch so an inherited TERMSNIP_ENV_LOADED
 * (which makes the loader a no-op) or an inherited TERMSNIP_* value cannot
 * decide the outcome.
 */
function load(root: string, processEnv: Record<string, string> = {}): Record<string, string> {
  const prints = PROBED_KEYS.map((key) => `printf '${key}=%s\\n' "\${${key}-${UNSET}}"`).join("\n");
  const result = spawnSync("bash", ["-c", `source "$1"\n${prints}`, "bash", join(root, "scripts", "load-env.sh")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...processEnv },
  });

  if (result.status !== 0) {
    throw new Error(`loader exited with ${result.status}: ${result.stderr}`);
  }

  const values: Record<string, string> = {};
  for (const line of result.stdout.split("\n")) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf("=");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

describe("scripts/load-env.sh precedence (#481)", () => {
  it("lets .env override .env.shared for a key present in both files", () => {
    const root = makeRoot(
      "TERMSNIP_TEST_OVERRIDDEN=from-shared\nTERMSNIP_TEST_SHARED=shared-only\n",
      "TERMSNIP_TEST_OVERRIDDEN=from-local\n",
    );

    const values = load(root);

    expect(values.TERMSNIP_TEST_OVERRIDDEN).toBe("from-local");
    expect(values.TERMSNIP_TEST_SHARED).toBe("shared-only");
  });

  it("lets an exported shell variable win over both files", () => {
    const root = makeRoot("TERMSNIP_TEST_OVERRIDDEN=from-shared\n", "TERMSNIP_TEST_OVERRIDDEN=from-local\n");

    const values = load(root, { TERMSNIP_TEST_OVERRIDDEN: "from-process" });

    expect(values.TERMSNIP_TEST_OVERRIDDEN).toBe("from-process");
  });

  it("exports a key that only .env mentions", () => {
    const root = makeRoot("TERMSNIP_TEST_SHARED=shared-only\n", "TERMSNIP_TEST_LOCAL=local-only\n");

    expect(load(root).TERMSNIP_TEST_LOCAL).toBe("local-only");
  });

  it("treats a blank value as a placeholder rather than an override", () => {
    const root = makeRoot("TERMSNIP_TEST_BLANK=from-shared\n", "TERMSNIP_TEST_BLANK=\n");

    expect(load(root).TERMSNIP_TEST_BLANK).toBe("from-shared");
  });

  it("never reads the repository's own env files", () => {
    // The repository's .env.shared sets TERMSNIP_UI_PORT=5173; a value that only
    // the temporary copy provides proves the repository's files were not read.
    const root = makeRoot("TERMSNIP_UI_PORT=9999\n", null);

    expect(load(root).TERMSNIP_UI_PORT).toBe("9999");
  });

  it("still parses comments, export prefixes, quotes and blank lines", () => {
    const root = makeRoot(
      "# a comment\n\nTERMSNIP_TEST_QUOTED=\"quoted value\"\nnot-an-assignment\n9INVALID=skipped\n",
      "export TERMSNIP_TEST_QUOTED='single quoted'\n",
    );

    const values = load(root);

    expect(values.TERMSNIP_TEST_QUOTED).toBe("single quoted");
    expect(values.TERMSNIP_TEST_QUOTED).not.toBe(UNSET);
  });

  it("exports nothing when neither file exists", () => {
    const root = makeRoot(null, null);

    const values = load(root);

    for (const key of PROBED_KEYS) {
      expect(values[key]).toBe(UNSET);
    }
  });
});
