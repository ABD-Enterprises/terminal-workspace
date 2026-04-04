import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { isTauriRuntime } from "../lib/backend-runtime";

export type WorkspaceDensity = "compact" | "comfortable";

interface AppState {
  sidebarSearch: string;
  commandPaletteOpen: boolean;
  workspaceDensity: WorkspaceDensity;
  sectionShortcutsEnabled: boolean;
  demoModeEnabled: boolean;
  setSidebarSearch: (search: string) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setWorkspaceDensity: (density: WorkspaceDensity) => void;
  setSectionShortcutsEnabled: (enabled: boolean) => void;
  setDemoModeEnabled: (enabled: boolean) => void;
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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarSearch: "",
      commandPaletteOpen: false,
      workspaceDensity: "compact",
      sectionShortcutsEnabled: true,
      demoModeEnabled: getDefaultDemoModeEnabled(),
      setSidebarSearch: (sidebarSearch) => set({ sidebarSearch }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      setWorkspaceDensity: (workspaceDensity) => set({ workspaceDensity }),
      setSectionShortcutsEnabled: (sectionShortcutsEnabled) => set({ sectionShortcutsEnabled }),
      setDemoModeEnabled: (demoModeEnabled) => set({ demoModeEnabled }),
    }),
    {
      name: "termsnip-app",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state): PersistedAppState => ({
        workspaceDensity: state.workspaceDensity,
        sectionShortcutsEnabled: state.sectionShortcutsEnabled,
        demoModeEnabled: state.demoModeEnabled,
      }),
      migrate: (persistedState, version): PersistedAppState => {
        const state = (persistedState ?? {}) as Partial<PersistedAppState>;

        if (version < 1) {
          return {
            workspaceDensity: state.workspaceDensity ?? "compact",
            sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
            demoModeEnabled: isTauriRuntime()
              ? false
              : state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
          };
        }

        return {
          workspaceDensity: state.workspaceDensity ?? "compact",
          sectionShortcutsEnabled: state.sectionShortcutsEnabled ?? true,
          demoModeEnabled: state.demoModeEnabled ?? getDefaultDemoModeEnabled(),
        };
      },
    }
  )
);

export function isDemoModeEnabled() {
  return useAppStore.getState().demoModeEnabled;
}
