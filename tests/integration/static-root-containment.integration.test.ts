import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePathInsideRoot } from "../../apps/desktop/server/backend-paths.mjs";

// #152(d): the static handler tested containment with
// `targetPath.startsWith(distRoot)`. That is a STRING prefix, not a path one, so
// a sibling directory whose name merely begins with the same characters passed:
// with a root of `/app/dist`, `/app/dist-evil/secret.txt` starts with
// `/app/dist` and was served.
//
// The first test below is the demonstration — it runs the OLD predicate and
// shows it accepting the sibling — so the bug is recorded as a fact rather than
// only described in a comment.

const ROOT = join(sep, "app", "dist");

/** The predicate exactly as it was, kept so the flaw stays demonstrable. */
function oldPrefixPredicate(root: string, targetPath: string) {
  return targetPath.startsWith(root);
}

describe("#152(d): static root containment", () => {
  it("the old string-prefix check accepted a sibling directory", () => {
    const sibling = join(sep, "app", "dist-evil", "secret.txt");

    expect(oldPrefixPredicate(ROOT, sibling)).toBe(true);
    // And the replacement refuses it.
    expect(resolvePathInsideRoot(ROOT, join("..", "dist-evil", "secret.txt"))).toBeNull();
  });

  it("serves ordinary files under the root", () => {
    expect(resolvePathInsideRoot(ROOT, "/index.html")).toBe(join(ROOT, "index.html"));
    expect(resolvePathInsideRoot(ROOT, "/assets/app.js")).toBe(join(ROOT, "assets", "app.js"));
  });

  it("allows the root itself", () => {
    // join(root, "/") normalizes with a trailing separator. Harmless for stat,
    // and unreachable in production anyway: serveStatic rewrites "/" to
    // "/index.html" before calling this. Asserted as-is rather than papered
    // over, so the behaviour is recorded rather than assumed.
    expect(resolvePathInsideRoot(ROOT, "/")).toBe(`${ROOT}${sep}`);
    expect(resolvePathInsideRoot(ROOT, "/index.html")).toBe(join(ROOT, "index.html"));
  });

  it("refuses traversal out of the root", () => {
    expect(resolvePathInsideRoot(ROOT, "/../etc/passwd")).toBeNull();
    expect(resolvePathInsideRoot(ROOT, "/../..")).toBeNull();
    expect(resolvePathInsideRoot(ROOT, "/assets/../../dist-evil/x")).toBeNull();
  });

  it("refuses a sibling whose name merely extends the root's", () => {
    // The whole point: `dist-evil` is not inside `dist`, however much the
    // strings overlap.
    expect(resolvePathInsideRoot(ROOT, "/../dist-evil")).toBeNull();
    expect(resolvePathInsideRoot(ROOT, "/../distraction/app.js")).toBeNull();
  });

  it("keeps a nested path that merely looks like a sibling", () => {
    // `dist/dist-evil` IS inside the root and must still be served — the fix
    // must not over-reject on the same name appearing deeper.
    expect(resolvePathInsideRoot(ROOT, "/dist-evil/app.js")).toBe(
      join(ROOT, "dist-evil", "app.js")
    );
  });
});
