import { expect, it } from "vitest";
import { nextSearchIndex } from "./use-terminal-pane-search";

it("wraps in-pane search navigation across match bounds", () => {
  expect(nextSearchIndex(0, -1, 3)).toBe(2);
  expect(nextSearchIndex(2, 1, 3)).toBe(0);
  expect(nextSearchIndex(1, 1, 3)).toBe(2);
});

it("keeps the active search index at zero when there are no matches", () => {
  expect(nextSearchIndex(2, 1, 0)).toBe(0);
});
