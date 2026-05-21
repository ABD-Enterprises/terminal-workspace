import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { isTauriRuntime } from "../lib/backend-runtime";
import {
  DEFAULT_TERMINAL_THEME,
  isKnownTheme,
  type TerminalThemeName,
} from "../lib/terminal-themes";

export type WorkspaceDensity = "compact" | "comfortable";

interface AppState {
  sidebarSearch: string;
  commandPaletteOpen: boolean;
  cheatsheetOpen: boolean;
  workspaceDensity: WorkspaceDensity;
  sectionShortcutsEnabled: boolean;
  demoModeEnabled: boolean;
  terminalTheme: TerminalThemeName;
  vaultId: string;
  deviceId: string;
  lastAppliedSnapshotId: string | null;
  /**
   * One-shot onboarding flags. Persisted so the surfaces only render on
   * first run. See T03 (import-SSH callout) and T05 (first-run mini-tour).
   */
  sawImportCallout: boolean;
  sawFirstRunTour: boolean;
  setSidebarSearch: (search: string) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  openCheatsheet: () => void;
  closeCheatsheet: () => void;
  setWorkspaceDensity: (density: WorkspaceDensity) => void;
  setSectionShortcutsEnabled: (enabled: boolean) => void;
  setDemoModeEnabled: (enabled: boolean) => void;
  setTerminalTheme: (theme: TerminalThemeName) => void;
  setVaultId: (vaultId: string) => void;
  setLastAppliedSnapshotId: (snapshotId: string | null) => void;
  markImportCalloutSeen: () => void;
  markFirstRunTourSeen: () => void;
}

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function getDefaultDemoModeEnabled() {
  return !isTauriRuntime();
}

interface PersistedAppState {
  demoModeEnabled: boolean;
  sectionShortcutsEnabled: boolean;
  workspaceDensity: WorkspaceDensity;
  terminalTheme: TerminalThemeName;
  vaultId: string;
  deviceId: string;
  lastAppliedSnapshotId: string | null;
  sawImportCallout: boolean;
  sawFirstRunTour: boolean;
}

function createPersistentId() {
  return crypto.randomUUID();
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarSearch: "",
      commandPaletteOpen: false,
      cheatsheetOpen: false,
      workspaceDensity: "compact",
      sectionShortcutsEnabled: true,
      demoModeEnabled: getDefaultDemoModeEnabled(),
      terminalTheme: DEFAULT_TERMINAL_THEME,
      vaultId: createPersistentId(),
      deviceId: createPersistentId(),
      lastAppliedSnapshotId: null,
      sawImportCallout: false,
      sawFirstRunTour: false,
      setSidebarSearch: (sidebarSearch) => set({ sidebarSearch }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      openCheatsheet: () => set({ cheatsheetOpen: true }),
      closeCheatsheet: () => set({ cheatsheetOpen: false }),
      setWorkspaceDensity: (workspaceDensity) => set({ workspaceDensity }),
      setSectionShortcutsEnabled: (sectionShortcutsEnabled) => set({ sectionShortcutsEnabled }),
      setDemoModeEnabled: (demoModeEnabled) => set({ demoModeEnabled }),
      setTerminalTheme: (terminalTheme) =>
        set({
          terminalTheme: isKnownTheme(terminalTheme) ? terminalTheme : DEFAULT_TERMINAL_THEME,
        }),
      setVaultId: (vaultId) => set({ vaultId }),
      setLastAppliedSnapshotId: (lastAppliedSnapshotId) => set({ lastAppliedSnapshotId }),
      markImportCalloutSeen: () => set({ sawImportCallout: true }),
      markFirstRunTourSeen: () => set({ sawFirstRunTour: true }),
    }),
    {
      name: "termsnip-app",
      version: 5,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state): PersistedAppState => ({
        workspaceDensity: state.workspaceDensity,
        sectionShortcutsEnabled: state.sectionShortcutsEnabled,
        demoModeEnabled: state.demoModeEnabled,
        terminalTheme: state.terminalTheme,
        vaultId: state.vaultId,
        deviceId: state.deviceId,
        lastAppliedSnapshotId: state.lastAppliedSnapshotId,
        sawImportCallout: state.sawImportCallout,
        sawFirstRunTour: state.sawFirstRunTour,
      }),
      migrate: (persistedState, version): PersistedAppState => {
        const state = (persistedState ?? {}) as Partial<PersistedAppState>;
        const safeTerminalTheme = isKnownTheme(state.terminalTheme)
          ? state.terminalTheme
          : DEFAULT_TERMINAL_THEME;

        if (version < 1) {
          return {
            workspaceDensity: state.workspaceDensity ?? "compact",
            sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
            demoModeEnabled: isTauriRuntime()
              ? false
              : state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
            terminalTheme: safeTerminalTheme,
            vaultId: state.vaultId ?? createPersistentId(),
            deviceId: state.deviceId ?? createPersistentId(),
            lastAppliedSnapshotId: state.lastAppliedSnapshotId ?? null,
            // T03/T05: upgrading users have seen the app before, so flag
            // the one-shot callouts as already-seen.
            sawImportCallout: true,
            sawFirstRunTour: true,
          };
        }

        if (version < 5) {
          // v4 → v5: introduced onboarding one-shots. Upgrade users have
          // already learned the app — don't pop the callouts at them.
          return {
            workspaceDensity: state.workspaceDensity ?? "compact",
            sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
            demoModeEnabled: state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
            terminalTheme: safeTerminalTheme,
            vaultId: state.vaultId ?? createPersistentId(),
            deviceId: state.deviceId ?? createPersistentId(),
            lastAppliedSnapshotId: state.lastAppliedSnapshotId ?? null,
            sawImportCallout: true,
            sawFirstRunTour: true,
          };
        }

        return {
          workspaceDensity: state.workspaceDensity ?? "compact",
          sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
          demoModeEnabled: state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
          terminalTheme: safeTerminalTheme,
          vaultId: state.vaultId ?? createPersistentId(),
          deviceId: state.deviceId ?? createPersistentId(),
          lastAppliedSnapshotId: state.lastAppliedSnapshotId ?? null,
          sawImportCallout: state.sawImportCallout ?? false,
          sawFirstRunTour: state.sawFirstRunTour ?? false,
        };
      },
    }
  )
);

export function isDemoModeEnabled() {
  return useAppStore.getState().demoModeEnabled;
}
