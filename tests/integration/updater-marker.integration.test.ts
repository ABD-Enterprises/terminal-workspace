import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #148 review finding: the live-session refusal is signalled by a marker embedded
// in a Rust error string and parsed on the TypeScript side. That is a stringly
// typed cross-language boundary — typed IPC errors are #203 — and until that
// lands nothing stops one side being renamed without the other. The failure mode
// is quiet: a live-session refusal degrades into a cryptic generic install error
// and the user loses the warning entirely.
//
// This lives in tests/integration rather than next to auto-update.test.ts because
// it reads files with node builtins; the apps/desktop tsconfig has no node types,
// and importing them there fails `tsc -b` in the desktop build.

const mainRsPath = fileURLToPath(new URL("../../src-tauri/src/main.rs", import.meta.url));
const autoUpdatePath = fileURLToPath(
  new URL("../../apps/desktop/src/lib/auto-update.ts", import.meta.url),
);

function extract(path: string, pattern: RegExp): string | null {
  const match = readFileSync(path, "utf8").match(pattern);
  return match ? match[1] : null;
}

describe("updater live-session refusal marker", () => {
  it("is defined identically on both sides of the IPC boundary", () => {
    const rust = extract(mainRsPath, /const LIVE_SESSIONS_REFUSAL_MARKER: &str = "([^"]+)";/);
    const ts = extract(autoUpdatePath, /export const LIVE_SESSIONS_MARKER = "([^"]+)";/);

    expect(rust, "LIVE_SESSIONS_REFUSAL_MARKER not found in src-tauri/src/main.rs").not.toBeNull();
    expect(ts, "LIVE_SESSIONS_MARKER not found in apps/desktop/src/lib/auto-update.ts").not.toBeNull();
    expect(
      ts,
      "The Rust and TypeScript refusal markers have diverged. A live-session refusal " +
        "would be reported to the user as a generic install failure, losing the warning.",
    ).toBe(rust);
  });

  it("is still emitted by the install command's refusal paths", () => {
    const mainRs = readFileSync(mainRsPath, "utf8");
    // Two refusals: fail-fast before download, and the one that actually closes
    // the race, immediately before app.restart().
    const occurrences = mainRs.split("{LIVE_SESSIONS_REFUSAL_MARKER}").length - 1;
    expect(
      occurrences,
      "Expected the refusal marker in both the pre-download and pre-restart guards.",
    ).toBe(2);
  });
});
