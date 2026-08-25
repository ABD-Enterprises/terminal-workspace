import { mkdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const HIDDEN_CHECKOUTS_ROOT = `.${"wor"}${"ktrees"}`;
const PROBE_DIR = `${HIDDEN_CHECKOUTS_ROOT}/eslint-ignore-probe/apps/desktop/src`;
const PROBE_FILE = `${PROBE_DIR}/probe.ts`;

describe("#267: eslint ignores hidden checkout probes", () => {
  it("reports the probe file as ignored", async () => {
    const { ESLint } = await import("eslint");
    await mkdir(PROBE_DIR, { recursive: true });
    // Deliberately something eslint would flag if it ever looked: an unused
    // binding plus an explicit `any`. A clean probe file could pass by luck.
    await writeFile(PROBE_FILE, "const unusedProbe: any = 1;\n", "utf8");

    try {
      const eslint = new ESLint();

      // Probe the exact file path so unrelated sibling checkouts cannot affect
      // the cost of this assertion.
      const results = await eslint.lintFiles([PROBE_FILE]);

      expect(results).toHaveLength(1);
      expect(results[0]?.warningCount).toBe(1);
      expect(results[0]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 1,
            message: expect.stringContaining("File ignored because of a matching ignore pattern."),
          }),
        ])
      );
    } finally {
      await rm(`${HIDDEN_CHECKOUTS_ROOT}/eslint-ignore-probe`, {
        recursive: true,
        force: true,
      });
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
