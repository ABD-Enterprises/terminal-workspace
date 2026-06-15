import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_THEME } from "../lib/terminal-themes";
import {
  buildBaselineDefaults,
  migrateAppState,
  shouldShowUpdateBanner,
  useAppStore,
} from "./app-store";

const initialState = useAppStore.getState();

afterEach(() => {
  useAppStore.setState(initialState);
});

describe("app store preferences", () => {
  it("defaults to a dense workspace with section shortcuts and demo mode enabled", () => {
    const state = useAppStore.getState();

    expect(state.workspaceDensity).toBe("compact");
    expect(state.sectionShortcutsEnabled).toBe(true);
    expect(state.demoModeEnabled).toBe(true);
    expect(state.terminalTheme).toBe(DEFAULT_TERMINAL_THEME);
    expect(state.vaultId).toBeTruthy();
    expect(state.deviceId).toBeTruthy();
    expect(state.lastAppliedSnapshotId).toBeNull();
  });

  it("updates persisted shell preferences independently from transient UI state", () => {
    useAppStore.getState().setVaultId("vault-imported");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-imported");
    useAppStore.getState().setWorkspaceDensity("comfortable");
    useAppStore.getState().setSectionShortcutsEnabled(false);
    useAppStore.getState().setDemoModeEnabled(false);
    useAppStore.getState().setTerminalTheme("monokai");
    useAppStore.getState().openCommandPalette();
    useAppStore.getState().setSidebarSearch("local");

    const state = useAppStore.getState();

    expect(state.workspaceDensity).toBe("comfortable");
    expect(state.sectionShortcutsEnabled).toBe(false);
    expect(state.demoModeEnabled).toBe(false);
    expect(state.terminalTheme).toBe("monokai");
    expect(state.vaultId).toBe("vault-imported");
    expect(state.lastAppliedSnapshotId).toBe("snapshot-imported");
    expect(state.commandPaletteOpen).toBe(true);
    expect(state.sidebarSearch).toBe("local");
  });

  it("setTerminalTheme rejects an unknown name and falls back to the default", () => {
    useAppStore
      .getState()
      .setTerminalTheme("not-a-theme" as unknown as "auto");
    expect(useAppStore.getState().terminalTheme).toBe(DEFAULT_TERMINAL_THEME);
  });
});

describe("buildBaselineDefaults", () => {
  it("falls back to runtime-appropriate defaults for an empty payload", () => {
    const baseline = buildBaselineDefaults({});
    expect(baseline.workspaceDensity).toBe("compact");
    expect(baseline.sectionShortcutsEnabled).toBe(true);
    expect(baseline.sawImportCallout).toBe(false);
    expect(baseline.sawFirstRunTour).toBe(false);
    expect(baseline.appShellTheme).toBe("system");
    expect(baseline.terminalTheme).toBe(DEFAULT_TERMINAL_THEME);
    // vault + device ids are generated when absent
    expect(baseline.vaultId).toBeTruthy();
    expect(baseline.deviceId).toBeTruthy();
  });

  it("preserves carried-over values when present", () => {
    const baseline = buildBaselineDefaults({
      workspaceDensity: "comfortable",
      sectionShortcutsEnabled: false,
      sawImportCallout: true,
      sawFirstRunTour: true,
      appShellTheme: "light",
      vaultId: "v",
      deviceId: "d",
    });
    expect(baseline.workspaceDensity).toBe("comfortable");
    expect(baseline.sectionShortcutsEnabled).toBe(false);
    expect(baseline.sawImportCallout).toBe(true);
    expect(baseline.sawFirstRunTour).toBe(true);
    expect(baseline.appShellTheme).toBe("light");
    expect(baseline.vaultId).toBe("v");
    expect(baseline.deviceId).toBe("d");
  });

  it("recovers from a corrupt terminalTheme by falling back to default", () => {
    const baseline = buildBaselineDefaults({
      terminalTheme: "not-a-theme" as unknown as "auto",
    });
    expect(baseline.terminalTheme).toBe(DEFAULT_TERMINAL_THEME);
  });
});

describe("migrateAppState", () => {
  it("treats a pre-v1 payload as a long-time user (one-shots dismissed)", () => {
    const result = migrateAppState({}, 0);
    expect(result.sawImportCallout).toBe(true);
    expect(result.sawFirstRunTour).toBe(true);
  });

  it("treats a v4 → v5 upgrade as a long-time user (one-shots dismissed)", () => {
    const result = migrateAppState({ workspaceDensity: "comfortable" }, 4);
    expect(result.sawImportCallout).toBe(true);
    expect(result.sawFirstRunTour).toBe(true);
    // Carries over the persisted field
    expect(result.workspaceDensity).toBe("comfortable");
  });

  it("a v6 payload round-trips cleanly through the baseline path", () => {
    const result = migrateAppState(
      {
        workspaceDensity: "comfortable",
        sawImportCallout: false,
        sawFirstRunTour: false,
      },
      6
    );
    // The one-shots are NOT flipped for a current-version upgrade —
    // they take whatever the payload carried.
    expect(result.sawImportCallout).toBe(false);
    expect(result.sawFirstRunTour).toBe(false);
    expect(result.workspaceDensity).toBe("comfortable");
  });

  it("handles null persistedState gracefully", () => {
    const result = migrateAppState(null, 0);
    expect(result.workspaceDensity).toBe("compact");
  });

  it("defaults dismissedUpdateVersion to null and carries it over when present", () => {
    expect(buildBaselineDefaults({}).dismissedUpdateVersion).toBeNull();
    expect(
      buildBaselineDefaults({ dismissedUpdateVersion: "1.2.3" }).dismissedUpdateVersion
    ).toBe("1.2.3");
  });
});

describe("#97 update banner state", () => {
  it("setUpdateResult stores the result; updateResult is null by default", () => {
    expect(useAppStore.getState().updateResult).toBeNull();
    useAppStore.getState().setUpdateResult({ available: true, version: "9.9.9" });
    expect(useAppStore.getState().updateResult).toEqual({ available: true, version: "9.9.9" });
  });

  it("dismissUpdate records the current update's version (persisted), no-op without one", () => {
    // No update → dismiss is a no-op.
    useAppStore.getState().setUpdateResult(null);
    useAppStore.getState().dismissUpdate();
    expect(useAppStore.getState().dismissedUpdateVersion).toBeNull();

    // With an available, versioned update → records the version.
    useAppStore.getState().setUpdateResult({ available: true, version: "9.9.9" });
    useAppStore.getState().dismissUpdate();
    expect(useAppStore.getState().dismissedUpdateVersion).toBe("9.9.9");
  });

  it("shouldShowUpdateBanner gates on available + version + not-dismissed", () => {
    expect(shouldShowUpdateBanner(null, null)).toBe(false);
    expect(shouldShowUpdateBanner({ available: false }, null)).toBe(false);
    expect(shouldShowUpdateBanner({ available: true }, null)).toBe(false); // no version
    expect(shouldShowUpdateBanner({ available: true, version: "9.9.9" }, null)).toBe(true);
    expect(shouldShowUpdateBanner({ available: true, version: "9.9.9" }, "9.9.9")).toBe(false);
    expect(shouldShowUpdateBanner({ available: true, version: "9.9.9" }, "1.0.0")).toBe(true);
  });
});
