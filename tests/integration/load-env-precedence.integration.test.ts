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
  // Probed because the loader must not touch the sourcing shell's variables.
  "key",
] as const;

const UNSET = "__unset__";

/**
 * The interpreters the loader is checked under.
 *
 * `bash` is whatever `#!/usr/bin/env bash` resolves to, which is the
 * interpreter the release scripts that source the loader actually run. On
 * macOS `/bin/bash` is the stock 3.2 build, and it is checked too: a construct
 * that only newer bash accepts would pass CI (where `bash` is 5.x) and break a
 * stock macOS, and this loader is the one script every release script sources.
 */
function interpreters(): string[] {
  const found = new Set<string>();
  for (const candidate of ["bash", "/bin/bash"]) {
    try {
      const probe = spawnSync(candidate, ["-c", "exit 0"], { encoding: "utf8" });
      if (probe.error === undefined && probe.status === 0) {
        found.add(candidate);
      }
    } catch {
      // Not available on this platform.
    }
  }
  return [...found];
}

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
function load(
  root: string,
  processEnv: Record<string, string> = {},
  interpreter = "bash",
): Record<string, string> {
  const prints = PROBED_KEYS.map((key) => `printf '${key}=%s\\n' "\${${key}-${UNSET}}"`).join("\n");
  const result = spawnSync(interpreter, ["-c", `source "$1"\n${prints}`, "bash", join(root, "scripts", "load-env.sh")], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...processEnv },
  });

  if (result.status !== 0) {
    throw new Error(`loader exited with ${result.status} under ${interpreter}: ${result.stderr}`);
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

  it("leaves the sourcing shell's own variables alone", () => {
    // The loader's working variables must not land in the sourcing shell's
    // namespace. The previous loader declared them local; a loader that used a
    // top-level loop variable named `key` would replace a caller's own
    // exported `key` with the name of the last env file key it read — which
    // also breaks the guarantee that the real process environment wins.
    const root = makeRoot("AAA=1\nBBB=2\n", null);

    const values = load(root, { key: "caller-value" });

    expect(values.key).toBe("caller-value");
  });

  it("resolves the same way under every available interpreter", () => {
    // `#!/usr/bin/env bash` picks whatever bash is first on PATH, and on macOS
    // that is not the stock /bin/bash. A construct only newer bash accepts
    // would pass CI and break a stock macOS, so the precedence is pinned under
    // each interpreter that exists here.
    const root = makeRoot(
      "TERMSNIP_TEST_SHARED=shared-only\nTERMSNIP_TEST_OVERRIDDEN=from-shared\n",
      "TERMSNIP_TEST_OVERRIDDEN=from-local\nTERMSNIP_TEST_LOCAL=local-only\n",
    );

    const results = interpreters().map((interpreter) => ({
      interpreter,
      values: load(root, {}, interpreter),
    }));

    expect(results.length).toBeGreaterThan(0);
    for (const { interpreter, values } of results) {
      expect(values.TERMSNIP_TEST_OVERRIDDEN, interpreter).toBe("from-local");
      expect(values.TERMSNIP_TEST_LOCAL, interpreter).toBe("local-only");
      expect(values.TERMSNIP_TEST_SHARED, interpreter).toBe("shared-only");
    }
  });
});
