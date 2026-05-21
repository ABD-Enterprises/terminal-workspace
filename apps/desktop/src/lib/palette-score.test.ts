import { describe, expect, it } from "vitest";
import { matchesPalette, scorePaletteMatch } from "./palette-score";

describe("scorePaletteMatch", () => {
  it("returns 0 for empty query or target", () => {
    expect(scorePaletteMatch("", "Production Gateway")).toBe(0);
    expect(scorePaletteMatch("pgw", "")).toBe(0);
    expect(scorePaletteMatch("   ", "Production Gateway")).toBe(0);
  });

  it("scores exact match highest", () => {
    expect(scorePaletteMatch("Production Gateway", "Production Gateway")).toBe(10_000);
    expect(scorePaletteMatch("production gateway", "Production Gateway")).toBe(10_000);
  });

  it("scores acronym match above substring", () => {
    // "pg" is the acronym for "Production Gateway" — first letter of
    // each word. That should score above a mid-target substring like
    // "gat" which only matches inside Gateway.
    const acronym = scorePaletteMatch("pg", "Production Gateway");
    const substring = scorePaletteMatch("gat", "Production Gateway");
    expect(acronym).toBeGreaterThan(substring);
    expect(acronym).toBeGreaterThan(0);
  });

  it("scores prefix match above mid-target substring", () => {
    const prefix = scorePaletteMatch("prod", "Production Gateway");
    const mid = scorePaletteMatch("gate", "Production Gateway");
    expect(prefix).toBeGreaterThan(mid);
  });

  it("scores subsequence match lowest (above zero)", () => {
    const score = scorePaletteMatch("pgy", "Production Gateway");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1_000);
  });

  it("returns 0 for no match", () => {
    expect(scorePaletteMatch("xyz", "Production Gateway")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(scorePaletteMatch("PGW", "production gateway")).toBeGreaterThan(0);
    expect(scorePaletteMatch("PROD", "production gateway")).toBeGreaterThan(0);
  });

  it("handles non-whitespace word separators (-, _, /, :, .)", () => {
    expect(scorePaletteMatch("ab", "alpha-bravo")).toBeGreaterThan(0);
    expect(scorePaletteMatch("ab", "alpha_bravo")).toBeGreaterThan(0);
    expect(scorePaletteMatch("ab", "alpha/bravo")).toBeGreaterThan(0);
    expect(scorePaletteMatch("acme", "acme/production")).toBeGreaterThan(0);
  });

  it("shorter target beats longer one for same match category", () => {
    const short = scorePaletteMatch("prod", "Production");
    const long = scorePaletteMatch("prod", "Production Gateway with a long suffix");
    expect(short).toBeGreaterThan(long);
  });

  it("acronym prefix scores above plain substring", () => {
    const acronymPrefix = scorePaletteMatch("pg", "Production Gateway"); // pg is acronym start
    const substring = scorePaletteMatch("at", "Production Gateway"); // "at" appears mid-word
    expect(acronymPrefix).toBeGreaterThan(substring);
  });
});

describe("matchesPalette", () => {
  it("returns true for any non-zero score", () => {
    expect(matchesPalette("pgw", "Production Gateway")).toBe(true);
    expect(matchesPalette("prod", "Production Gateway")).toBe(true);
  });

  it("returns false when scorePaletteMatch returns 0", () => {
    expect(matchesPalette("xyz", "Production Gateway")).toBe(false);
    expect(matchesPalette("", "anything")).toBe(false);
  });
});
