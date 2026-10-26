import { expect, it } from "vitest";
import { emptyGenerateKeyValues } from "./key";

it("defaults the generate-key comment to the current product name", () => {
  expect(emptyGenerateKeyValues.comment).toBe("terminal-workspace@local");
});
