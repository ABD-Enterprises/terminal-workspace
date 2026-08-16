import { afterEach, describe, expect, it, vi } from "vitest";

// #148: this file previously held a single "imports successfully" smoke test,
// which is why the swallowed-error defect below survived. The behaviour that
// actually matters is the boundary contract: null means browser preview, and a
// real failure propagates its reason.

const invokeTauriCommand = vi.fn();
const isTauriRuntime = vi.fn();

vi.mock("./backend-runtime", () => ({
  invokeTauriCommand: (...args: unknown[]) => invokeTauriCommand(...args),
  isTauriRuntime: () => isTauriRuntime(),
}));

async function loadModule() {
  return await import("./auto-update");
}

afterEach(() => {
  invokeTauriCommand.mockReset();
  isTauriRuntime.mockReset();
});

describe("checkForUpdates", () => {
  it("returns null in browser preview without invoking the command", async () => {
    isTauriRuntime.mockReturnValue(false);
    const { checkForUpdates } = await loadModule();

    await expect(checkForUpdates()).resolves.toBeNull();
    expect(invokeTauriCommand).not.toHaveBeenCalled();
  });

  it("propagates a real failure instead of collapsing it to null", async () => {
    // The regression: a 404 from a dead GitHub Releases feed used to return
    // null, which callers read as "browser preview" and reported as such to a
    // user sitting in the packaged app.
    isTauriRuntime.mockReturnValue(true);
    invokeTauriCommand.mockRejectedValue(new Error("Could not fetch a valid release JSON"));
    const { checkForUpdates } = await loadModule();

    await expect(checkForUpdates()).rejects.toThrow("Could not fetch a valid release JSON");
  });

  it("passes a successful result straight through", async () => {
    isTauriRuntime.mockReturnValue(true);
    invokeTauriCommand.mockResolvedValue({ available: true, version: "0.2.0" });
    const { checkForUpdates } = await loadModule();

    await expect(checkForUpdates()).resolves.toEqual({ available: true, version: "0.2.0" });
  });
});

describe("installUpdateAndRestart", () => {
  it("does not force by default, so the live-session guard can refuse", async () => {
    isTauriRuntime.mockReturnValue(true);
    invokeTauriCommand.mockResolvedValue(undefined);
    const { installUpdateAndRestart } = await loadModule();

    await installUpdateAndRestart();

    expect(invokeTauriCommand).toHaveBeenCalledWith(
      "terminal_workspace_install_update_and_restart",
      { request: { force: false } },
    );
  });

  it("forwards an explicit confirmation as force", async () => {
    isTauriRuntime.mockReturnValue(true);
    invokeTauriCommand.mockResolvedValue(undefined);
    const { installUpdateAndRestart } = await loadModule();

    await installUpdateAndRestart(true);

    expect(invokeTauriCommand).toHaveBeenCalledWith(
      "terminal_workspace_install_update_and_restart",
      { request: { force: true } },
    );
  });
});

describe("parseLiveSessionRefusal", () => {
  it("extracts the session count from the Rust refusal", async () => {
    const { parseLiveSessionRefusal } = await loadModule();

    expect(
      parseLiveSessionRefusal(
        new Error(
          "Installing this update restarts the app and will close 3 live SSH session(s). " +
            "Confirm to continue. live-sessions:3",
        ),
      ),
    ).toBe(3);
  });

  it("returns null for an unrelated install failure", async () => {
    const { parseLiveSessionRefusal } = await loadModule();

    expect(parseLiveSessionRefusal(new Error("No update is available to install"))).toBeNull();
  });

  it("handles a non-Error rejection value", async () => {
    const { parseLiveSessionRefusal } = await loadModule();

    expect(parseLiveSessionRefusal("live-sessions:2")).toBe(2);
    expect(parseLiveSessionRefusal("something else")).toBeNull();
  });

  it("treats a zero count as no refusal", async () => {
    const { parseLiveSessionRefusal } = await loadModule();

    expect(parseLiveSessionRefusal(new Error("live-sessions:0"))).toBeNull();
  });
});
