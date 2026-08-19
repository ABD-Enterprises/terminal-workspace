import { afterEach, expect, it, vi } from "vitest";

vi.mock("../store/app-store", () => ({ isDemoModeEnabled: () => false }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("imports successfully", async () => {
  const mod = await import("./ssh-config-fs");
  expect(mod).toBeDefined();
});

it("logs the caller pattern without exposing a browser transport error", async () => {
  const error = new Error("sensitive transport detail");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { globSshConfigFiles } = await import("./ssh-config-fs");

  await expect(globSshConfigFiles("~/.ssh/conf.d/*.conf")).resolves.toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "[ssh-config] glob rejected:",
    "~/.ssh/conf.d/*.conf",
    "The SSH config Include glob could not be expanded."
  );
  expect(warn.mock.calls[0]).not.toContain(error);
});

it("logs browser glob HTTP failures before returning no matches", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { globSshConfigFiles } = await import("./ssh-config-fs");

  await expect(globSshConfigFiles("~/.ssh/conf.d/*.conf")).resolves.toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "[ssh-config] glob rejected:",
    "~/.ssh/conf.d/*.conf",
    "HTTP 503"
  );
});
