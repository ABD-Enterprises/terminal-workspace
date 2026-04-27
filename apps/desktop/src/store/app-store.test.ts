import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_THEME } from "../lib/terminal-themes";
import { useAppStore } from "./app-store";

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
