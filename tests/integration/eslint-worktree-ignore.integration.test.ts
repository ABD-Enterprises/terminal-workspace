import { mkdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// #267: `orc claim <id>` creates a full second checkout at `.worktrees/orc-<id>/`,
// tsconfig.json included. eslint walks the filesystem rather than asking git, so
// the existing .gitignore entry does not reach it — typescript-eslint then finds
// two candidate tsconfigRootDirs and fails to PARSE every TypeScript file in the
// repo. Measured: 536 parse errors with one worktree live, 807 with two, on a
// tree whose actual changes were clean.
//
// This drives eslint's real file enumeration over a scratch directory shaped
// like a worktree, because the cheaper signals are both misleading here:
// `isPathIgnored` disagrees with what the CLI actually does for these paths, and
// a source grep for the pattern string would not have caught that a bare
// directory name behaves differently from the `/**` form.

const PROBE_DIR = ".worktrees/eslint-ignore-probe/apps/desktop/src";
const PROBE_FILE = `${PROBE_DIR}/probe.ts`;

describe("#267: eslint ignores orc worktree checkouts", () => {
  it("enumerates no files from inside .worktrees", async () => {
    const { ESLint } = await import("eslint");
    await mkdir(PROBE_DIR, { recursive: true });
    // Deliberately something eslint would flag if it ever looked: an unused
    // binding plus an explicit `any`. A clean probe file could pass by luck.
    await writeFile(PROBE_FILE, "const unusedProbe: any = 1;\n", "utf8");

    try {
      const eslint = new ESLint();

      // eslint refuses a glob that resolves entirely to ignored files, and says
      // so. That refusal is the assertion: the probe file exists and matches the
      // glob, so the only way here is for the ignore to have taken effect.
      await expect(eslint.lintFiles([".worktrees/**/*.ts"])).rejects.toThrow(
        /All files matched by '\.worktrees\/\*\*\/\*\.ts' are ignored/
      );
    } finally {
      await rm(".worktrees/eslint-ignore-probe", { recursive: true, force: true });
    }
  });

  it("still enumerates the real checkout", async () => {
    // Guards against "fixing" this with an over-broad ignore.
    const { ESLint } = await import("eslint");
    const eslint = new ESLint();

    const results = await eslint.lintFiles(["apps/desktop/src/lib/api.ts"]);

    expect(results).toHaveLength(1);
    expect(results[0]?.errorCount).toBe(0);
  });
});
