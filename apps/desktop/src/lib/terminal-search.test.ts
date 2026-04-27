import { describe, expect, it } from "vitest";
import {
  findMatchesInBuffer,
  type SearchableBuffer,
  type SearchableBufferLine,
} from "./terminal-search";

function makeLine(text: string): SearchableBufferLine {
  return {
    translateToString: (trimRight) => {
      // Tests only ever call with trimRight=true; honour the contract anyway.
      return trimRight ? text.replace(/\s+$/, "") : text;
    },
  };
}

function makeBuffer(lines: string[]): SearchableBuffer {
  return {
    length: lines.length,
    getLine: (y) => {
      if (y < 0 || y >= lines.length) {
        return undefined;
      }
      return makeLine(lines[y]);
    },
  };
}

describe("findMatchesInBuffer", () => {
  it("returns an empty list for an empty query", () => {
    const buffer = makeBuffer(["hello world"]);
    expect(findMatchesInBuffer(buffer, "", false)).toEqual([]);
  });

  it("finds a single occurrence on a single line", () => {
    const buffer = makeBuffer(["the quick brown fox"]);
    expect(findMatchesInBuffer(buffer, "quick", false)).toEqual([
      { row: 0, col: 4, length: 5 },
    ]);
  });

  it("finds multiple non-overlapping occurrences on the same line", () => {
    const buffer = makeBuffer(["abcabcabc"]);
    expect(findMatchesInBuffer(buffer, "abc", false)).toEqual([
      { row: 0, col: 0, length: 3 },
      { row: 0, col: 3, length: 3 },
      { row: 0, col: 6, length: 3 },
    ]);
  });

  it("returns matches across multiple lines in document order", () => {
    const buffer = makeBuffer([
      "line one with foo",
      "line two without",
      "third line foo bar foo",
    ]);
    expect(findMatchesInBuffer(buffer, "foo", false)).toEqual([
      { row: 0, col: 14, length: 3 },
      { row: 2, col: 11, length: 3 },
      { row: 2, col: 19, length: 3 },
    ]);
  });

  it("is case-insensitive by default", () => {
    const buffer = makeBuffer(["Foo FOO foo"]);
    expect(findMatchesInBuffer(buffer, "foo", false)).toEqual([
      { row: 0, col: 0, length: 3 },
      { row: 0, col: 4, length: 3 },
      { row: 0, col: 8, length: 3 },
    ]);
  });

  it("respects case-sensitive matching", () => {
    const buffer = makeBuffer(["Foo FOO foo"]);
    expect(findMatchesInBuffer(buffer, "foo", true)).toEqual([
      { row: 0, col: 8, length: 3 },
    ]);
  });

  it("trims trailing whitespace before matching column positions", () => {
    // The terminal often pads lines with trailing spaces. translateToString
    // trims these, so a match at column 0 should land at column 0 regardless
    // of pad width.
    const buffer = makeBuffer(["hit                  "]);
    const matches = findMatchesInBuffer(buffer, "hit", false);
    expect(matches).toEqual([{ row: 0, col: 0, length: 3 }]);
  });

  it("handles undefined lines gracefully (sparse scrollback)", () => {
    const buffer: SearchableBuffer = {
      length: 3,
      getLine: (y) => {
        if (y === 1) return undefined;
        return makeLine(y === 0 ? "alpha" : "beta");
      },
    };
    expect(findMatchesInBuffer(buffer, "a", false)).toEqual([
      { row: 0, col: 0, length: 1 },
      { row: 0, col: 4, length: 1 },
      { row: 2, col: 3, length: 1 },
    ]);
  });

  it("returns no matches when the query never appears", () => {
    const buffer = makeBuffer(["alpha", "beta", "gamma"]);
    expect(findMatchesInBuffer(buffer, "delta", false)).toEqual([]);
  });

  it("does not loop infinitely on overlapping needles", () => {
    // "aaa" in "aaaa" with our advance-by-needle.length stride gives two
    // matches at 0 and 3 (no overlap), not an infinite tail.
    const buffer = makeBuffer(["aaaa"]);
    expect(findMatchesInBuffer(buffer, "aa", false)).toEqual([
      { row: 0, col: 0, length: 2 },
      { row: 0, col: 2, length: 2 },
    ]);
  });
});
