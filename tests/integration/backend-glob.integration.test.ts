import { describe, expect, it } from "vitest";

import { globMatches, globMatcher } from "../../apps/desktop/server/backend-glob.mjs";

// #MAINT-1: the Node half of the SSH-config Include glob matcher.
//
// The shared corpus (tests/fixtures/security-helper-conformance.json) pins
// the agreement with the Rust matcher, which is the canonical one. These cases
// cover what is specific to this side: the Unicode flags, and the pattern that
// cannot be expressed as a Unicode regex at all.

describe("#MAINT-1: the Node glob matcher follows the Rust semantics", () => {
  it("matches one code point per `?`, not one UTF-16 code unit", () => {
    // Without the `u` flag `.` consumes half of the surrogate pair, so an
    // astral filename was skipped in browser mode while native mode matched
    // it.
    expect(globMatches("a?b", "a🦀b")).toBe(true);
    expect(globMatches("a?b", "a🦀🦀b")).toBe(false);
  });

  it("matches a newline with both `*` and `?`", () => {
    // Rust's matcher has no newline exception; `.` needs the `s` flag to
    // reach the same answer.
    expect(globMatches("a*b", "a\nb")).toBe(true);
    expect(globMatches("a?b", "a\nb")).toBe(true);
  });

  it("treats `[` literally, like the Rust matcher", () => {
    expect(globMatches("[abc].conf", "[abc].conf")).toBe(true);
  });

  it("does not let an unpaired surrogate crash the matcher", () => {
    // Older V8 threw a SyntaxError for an unpaired surrogate under the `u`
    // flag; current V8 accepts and matches it. Either way the matcher must
    // answer without throwing: a macOS filename can hold bytes UTF-8 cannot
    // represent, and the request must not fail on one.
    const loneSurrogate = "\uD83E";
    expect(() => globMatcher(loneSurrogate)).not.toThrow();
    expect(() => globMatches(loneSurrogate, loneSurrogate)).not.toThrow();
    expect(typeof globMatches(loneSurrogate, loneSurrogate)).toBe("boolean");
  });
});
