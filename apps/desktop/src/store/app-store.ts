import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { isTauriRuntime } from "../lib/backend-runtime";
import {
  DEFAULT_TERMINAL_THEME,
  isKnownTheme,
  type TerminalThemeName,
} from "../lib/terminal-themes";

export type WorkspaceDensity = "compact" | "comfortable";
/**
 * T20: app-shell theme. "system" follows prefers-color-scheme in
 * real time; "light" / "dark" override.
 */
export type AppShellTheme = "system" | "light" | "dark";

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
  /**
   * T20: app shell theme (system / light / dark). Default "system".
   */
  appShellTheme: AppShellTheme;
  /**
   * T17 / T18 / T19: opt-in toggles for the OS-integration polish.
   * Default false in browser preview; default true in Tauri ship
   * (set by the migrate fn).
   */
  notificationsEnabled: boolean;
  dockBadgeEnabled: boolean;
  autoUpdateCheckOnLaunch: boolean;
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
  setAppShellTheme: (theme: AppShellTheme) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setDockBadgeEnabled: (enabled: boolean) => void;
  setAutoUpdateCheckOnLaunch: (enabled: boolean) => void;
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
  appShellTheme: AppShellTheme;
  notificationsEnabled: boolean;
  dockBadgeEnabled: boolean;
  autoUpdateCheckOnLaunch: boolean;
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
      appShellTheme: "system",
      notificationsEnabled: false,
      dockBadgeEnabled: false,
      autoUpdateCheckOnLaunch: false,
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
      setAppShellTheme: (appShellTheme) => set({ appShellTheme }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setDockBadgeEnabled: (dockBadgeEnabled) => set({ dockBadgeEnabled }),
      setAutoUpdateCheckOnLaunch: (autoUpdateCheckOnLaunch) =>
        set({ autoUpdateCheckOnLaunch }),
    }),
    {
      name: "termsnip-app",
      version: 6,
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
        appShellTheme: state.appShellTheme,
        notificationsEnabled: state.notificationsEnabled,
        dockBadgeEnabled: state.dockBadgeEnabled,
        autoUpdateCheckOnLaunch: state.autoUpdateCheckOnLaunch,
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
            appShellTheme: "system",
            notificationsEnabled: isTauriRuntime(),
            dockBadgeEnabled: isTauriRuntime(),
            autoUpdateCheckOnLaunch: isTauriRuntime(),
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
            appShellTheme: "system",
            notificationsEnabled: isTauriRuntime(),
            dockBadgeEnabled: isTauriRuntime(),
            autoUpdateCheckOnLaunch: isTauriRuntime(),
          };
        }

        if (version < 6) {
          // v5 → v6: introduced T17-T20 polish toggles. Defaults
          // mirror the runtime: opt-in for browser preview, opt-out
          // for the Tauri ship.
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
            appShellTheme: "system",
            notificationsEnabled: isTauriRuntime(),
            dockBadgeEnabled: isTauriRuntime(),
            autoUpdateCheckOnLaunch: isTauriRuntime(),
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
          appShellTheme: state.appShellTheme ?? "system",
          notificationsEnabled: state.notificationsEnabled ?? isTauriRuntime(),
          dockBadgeEnabled: state.dockBadgeEnabled ?? isTauriRuntime(),
          autoUpdateCheckOnLaunch:
            state.autoUpdateCheckOnLaunch ?? isTauriRuntime(),
        };
      },
    }
  )
);

export function isDemoModeEnabled() {
  return useAppStore.getState().demoModeEnabled;
}
