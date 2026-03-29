import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type WorkspaceDensity = "compact" | "comfortable";

interface AppState {
  sidebarSearch: string;
  commandPaletteOpen: boolean;
  workspaceDensity: WorkspaceDensity;
  sectionShortcutsEnabled: boolean;
  setSidebarSearch: (search: string) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setWorkspaceDensity: (density: WorkspaceDensity) => void;
  setSectionShortcutsEnabled: (enabled: boolean) => void;
}

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarSearch: "",
      commandPaletteOpen: false,
      workspaceDensity: "compact",
      sectionShortcutsEnabled: true,
      setSidebarSearch: (sidebarSearch) => set({ sidebarSearch }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      setWorkspaceDensity: (workspaceDensity) => set({ workspaceDensity }),
      setSectionShortcutsEnabled: (sectionShortcutsEnabled) => set({ sectionShortcutsEnabled }),
    }),
    {
      name: "termsnip-app",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state) => ({
        workspaceDensity: state.workspaceDensity,
        sectionShortcutsEnabled: state.sectionShortcutsEnabled,
      }),
    }
  )
);
