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

it("returns native read identity and forwards canonical-relative context", async () => {
  const invoke = vi.fn().mockResolvedValue({
    cycleKey: "opaque-target-key",
    content: "Host sibling\n",
  });
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
  const { readSshConfigFile } = await import("./ssh-config-fs");
  const context = {
    parentCycleKey: "opaque-parent-key",
    parentPath: "~/.ssh/conf.d/10.conf",
    relativePath: "sibling.conf",
  };

  await expect(
    readSshConfigFile("~/.ssh/conf.d/sibling.conf", context)
  ).resolves.toEqual({
    cycleKey: "opaque-target-key",
    content: "Host sibling\n",
  });
  expect(invoke).toHaveBeenCalledWith("terminal_workspace_read_ssh_config_file", {
    request: {
      path: "~/.ssh/conf.d/sibling.conf",
      ...context,
    },
  });
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
