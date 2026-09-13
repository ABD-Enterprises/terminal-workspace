import { expect, it } from "vitest";
import { normalizeRuntimeStatus } from "./use-terminal-pane-runtime-status";

it("normalizes runtime status responses to the state shape used by terminal panes", () => {
  expect(normalizeRuntimeStatus({ available: false, installHint: "Install OpenSSH", message: "Missing runtime" })).toEqual({
    available: false,
    installHint: "Install OpenSSH",
    message: "Missing runtime",
  });
});
