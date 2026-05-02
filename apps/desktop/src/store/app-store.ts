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
    }),
    {
      name: "termsnip-app",
      version: 4,
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
        };
      },
    }
  )
);

export function isDemoModeEnabled() {
  return useAppStore.getState().demoModeEnabled;
}
