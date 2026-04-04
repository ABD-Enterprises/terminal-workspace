import { afterEach, describe, expect, it } from "vitest";
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
    expect(state.vaultId).toBeTruthy();
    expect(state.deviceId).toBeTruthy();
  });

  it("updates persisted shell preferences independently from transient UI state", () => {
    useAppStore.getState().setVaultId("vault-imported");
    useAppStore.getState().setWorkspaceDensity("comfortable");
    useAppStore.getState().setSectionShortcutsEnabled(false);
    useAppStore.getState().setDemoModeEnabled(false);
    useAppStore.getState().openCommandPalette();
    useAppStore.getState().setSidebarSearch("local");

    const state = useAppStore.getState();

    expect(state.workspaceDensity).toBe("comfortable");
    expect(state.sectionShortcutsEnabled).toBe(false);
    expect(state.demoModeEnabled).toBe(false);
    expect(state.vaultId).toBe("vault-imported");
    expect(state.commandPaletteOpen).toBe(true);
    expect(state.sidebarSearch).toBe("local");
  });
});
