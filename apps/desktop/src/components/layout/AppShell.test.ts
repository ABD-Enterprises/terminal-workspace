import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./AppShell");
  expect(mod).toBeDefined();
});

it("#445: the window title is the product name, qualified by the active host", async () => {
  const { APP_TITLE, formatAppTitle } = await import("./AppShell");

  expect(APP_TITLE).toBe("Terminal Workspace");
  expect(formatAppTitle(undefined)).toBe("Terminal Workspace");
  expect(formatAppTitle({ label: "prod-web", protocol: "ssh" })).toBe(
    "Terminal Workspace — prod-web (SSH)",
  );
  expect(formatAppTitle({ label: "lab", protocol: "localShell" })).toBe(
    "Terminal Workspace — lab (Local shell)",
  );
});
