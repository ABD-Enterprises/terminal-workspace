import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createMigratingLocalStorage } from "../lib/persistence";
import { isTauriRuntime } from "../lib/backend-runtime";
import type { UpdateCheckResult } from "../lib/auto-update";
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
  /**
   * #97: result of the most-recent update check (transient — re-derived each
   * launch, not persisted) and the version the user has dismissed (persisted
   * per-version so the banner doesn't nag between releases).
   */
  updateResult: UpdateCheckResult | null;
  dismissedUpdateVersion: string | null;
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
  setUpdateResult: (result: UpdateCheckResult | null) => void;
  dismissUpdate: () => void;
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
  dismissedUpdateVersion: string | null;
}

function createPersistentId() {
  return crypto.randomUUID();
}

/**
 * Single source of truth for the persisted-state shape used by both
 * `partialize` (write path) and `migrate` (read path on schema bump).
 * Pass whatever the persisted payload carries; missing fields fall
 * back to runtime-appropriate defaults (browser preview opts out of
 * the OS-integration toggles; the Tauri ship opts in).
 *
 * Per-version overrides in `migrate` layer on top of this — they only
 * need to override the handful of fields that need different
 * historical-aware values, not re-state the full shape.
 *
 * Exported for unit-test coverage.
 */
export function buildBaselineDefaults(state: Partial<PersistedAppState>): PersistedAppState {
  const safeTerminalTheme = isKnownTheme(state.terminalTheme)
    ? state.terminalTheme
    : DEFAULT_TERMINAL_THEME;
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
    autoUpdateCheckOnLaunch: state.autoUpdateCheckOnLaunch ?? isTauriRuntime(),
    dismissedUpdateVersion: state.dismissedUpdateVersion ?? null,
  };
}

/**
 * Read-side migration: take a payload from any prior persisted
 * version + the version number, return the v6 shape. Exported for
 * unit-test coverage.
 *
 * Audit pickup: the prior shape had four near-identical return blocks
 * (14 fields each) differing only in a handful of per-version
 * overrides. Build a single baseline from whatever the persisted
 * payload happens to carry, then layer the historical-aware
 * overrides on top.
 */
export function migrateAppState(
  persistedState: unknown,
  version: number
): PersistedAppState {
  const state = (persistedState ?? {}) as Partial<PersistedAppState>;
  const baseline = buildBaselineDefaults(state);

  if (version < 1) {
    // v0 → today: a pre-v1 payload predates the Tauri runtime gate
    // AND the onboarding one-shots. The native ship must never enable
    // demo mode; the upgrading user has already learned the app.
    return {
      ...baseline,
      demoModeEnabled: isTauriRuntime() ? false : baseline.demoModeEnabled,
      sawImportCallout: true,
      sawFirstRunTour: true,
    };
  }
  if (version < 5) {
    // v4 → v5: introduced the onboarding one-shots. Treat upgrade
    // users as if they've already dismissed them so we don't pop
    // callouts at someone who has used the app for months.
    return {
      ...baseline,
      sawImportCallout: true,
      sawFirstRunTour: true,
    };
  }
  // v5 → v6 and v6 → current: baseline defaults already encode the
  // right behavior (Tauri ship opts into the OS-integration toggles,
  // browser preview opts out).
  return baseline;
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
      updateResult: null,
      dismissedUpdateVersion: null,
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
      setUpdateResult: (updateResult) => set({ updateResult }),
      dismissUpdate: () =>
        set((state) =>
          state.updateResult?.version
            ? { dismissedUpdateVersion: state.updateResult.version }
            : {}
        ),
    }),
    {
      name: "terminal-workspace-app",
      version: 6,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : createMigratingLocalStorage()
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
        dismissedUpdateVersion: state.dismissedUpdateVersion,
      }),
      migrate: migrateAppState,
    }
  )
);

export function isDemoModeEnabled() {
  return useAppStore.getState().demoModeEnabled;
}

/**
 * #97: the update banner shows only when the most-recent check found an
 * available, versioned update that the user hasn't already dismissed. Pure so
 * the visibility rule is unit-testable independent of any working updater.
 */
export function shouldShowUpdateBanner(
  updateResult: UpdateCheckResult | null,
  dismissedUpdateVersion: string | null
): boolean {
  return Boolean(
    updateResult?.available &&
      updateResult.version &&
      updateResult.version !== dismissedUpdateVersion
  );
}
