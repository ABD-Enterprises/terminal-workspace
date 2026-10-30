// @vitest-environment happy-dom
//
// UX-1: a connect failure must reach the screen.
//
// The connect-error store and the banner component have their own tests, but
// neither proves the thing this change exists to guarantee: that the app
// shell shows the banner. Rendering the banner on its own would still pass
// with the banner removed from the shell — which is the original defect, a
// host that is down producing no on-screen output at all.
//
// So this renders the real AppShell and asserts the reported failure appears
// in it. Everything with a side effect (the sidebar, the command palette, the
// auto-update check, the dock badge, session restore) is mocked; the banner,
// its store, and the shell's own render path are real.
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../store/app-store";
import { useConnectErrorStore } from "../../store/connect-error-store";

vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./CommandPaletteDialog", () => ({ CommandPaletteDialog: () => null }));
vi.mock("../common/FirstRunTour", () => ({ FirstRunTour: () => null }));
vi.mock("../common/KeyboardCheatsheet", () => ({
  KeyboardCheatsheet: () => null,
}));
vi.mock("../common/UpdateAvailableBanner", () => ({
  UpdateAvailableBanner: () => null,
}));
vi.mock("../terminal/SessionRestoreManager", () => ({
  SessionRestoreManager: () => null,
}));
vi.mock("../../hooks/useAutoUpdateCheck", () => ({
  useAutoUpdateCheck: () => undefined,
}));
vi.mock("../../hooks/useDockBadgeSync", () => ({
  useDockBadgeSync: () => undefined,
}));

async function renderAppShell() {
  const { AppShell } = await import("./AppShell");
  return render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
}

function setDemoMode(enabled: boolean) {
  useAppStore.setState({ ...useAppStore.getState(), demoModeEnabled: enabled });
}

describe("AppShell", () => {
  it("imports successfully", async () => {
    const mod = await import("./AppShell");
    expect(mod).toBeDefined();
  });

  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
    setDemoMode(false);
  });

  afterEach(() => {
    cleanup();
    useConnectErrorStore.getState().clearConnectError();
    setDemoMode(false);
  });

  it("shows a reported connect failure in the shell", async () => {
    useConnectErrorStore
      .getState()
      .setConnectError(
        "Could not reach example.internal:22. Check that the host is reachable and try again.",
      );

    await renderAppShell();

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain(
      "Could not reach example.internal:22.",
    );
  });

  it("shows nothing when there is no connect failure", async () => {
    await renderAppShell();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the demo-mode banner in the shell when demo mode is on", async () => {
    // The banner's own test proves it renders; only the shell can prove it is
    // MOUNTED, which is the difference between "demo mode is indicated" and
    // "the user is told the output they are reading is fabricated".
    setDemoMode(true);

    await renderAppShell();

    expect(screen.queryByRole("status", { name: "Demo mode" })).not.toBeNull();
  });

  it("shows no demo-mode banner when demo mode is off", async () => {
    await renderAppShell();

    expect(screen.queryByRole("status", { name: "Demo mode" })).toBeNull();
  });
});
