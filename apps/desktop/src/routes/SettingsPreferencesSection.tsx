import { useState } from "react";
import { checkForUpdates } from "../lib/auto-update";
import { isTauriRuntime } from "../lib/backend-runtime";
import { cn } from "../lib/utils";
import { useAppStore } from "../store/app-store";
import { listTerminalThemeOptions, type TerminalThemeName } from "../lib/terminal-themes";

export function SettingsPreferencesSection() {
  const nativeRuntime = isTauriRuntime();
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const setWorkspaceDensity = useAppStore((state) => state.setWorkspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  const setSectionShortcutsEnabled = useAppStore((state) => state.setSectionShortcutsEnabled);
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);
  const setDemoModeEnabled = useAppStore((state) => state.setDemoModeEnabled);
  const terminalTheme = useAppStore((state) => state.terminalTheme);
  const setTerminalTheme = useAppStore((state) => state.setTerminalTheme);
  const terminalThemeOptions = listTerminalThemeOptions();
  // T17-T20 polish toggles.
  const appShellTheme = useAppStore((state) => state.appShellTheme);
  const setAppShellTheme = useAppStore((state) => state.setAppShellTheme);
  const notificationsEnabled = useAppStore((state) => state.notificationsEnabled);
  const setNotificationsEnabled = useAppStore((state) => state.setNotificationsEnabled);
  const dockBadgeEnabled = useAppStore((state) => state.dockBadgeEnabled);
  const setDockBadgeEnabled = useAppStore((state) => state.setDockBadgeEnabled);
  const autoUpdateCheckOnLaunch = useAppStore((state) => state.autoUpdateCheckOnLaunch);
  const setAutoUpdateCheckOnLaunch = useAppStore((state) => state.setAutoUpdateCheckOnLaunch);
  // T19 audit fix: manual check button status. null = idle (button
  // text shown by default); string = last result.
  const [updateCheckStatus, setUpdateCheckStatus] = useState<string | null>(null);

  return (
    <>
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Workspace preferences
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Keep the shell dense by default, or relax spacing slightly. `⌘1` through `⌘6`
                navigation can also be disabled if it conflicts with your terminal habits.
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Workspace density
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["compact", "comfortable"] as const).map((density) => (
                  <button
                    key={density}
                    type="button"
                    onClick={() => setWorkspaceDensity(density)}
                    className={cn(
                      "rounded-[14px] border px-3 py-2 text-sm transition",
                      workspaceDensity === density
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                        : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                    )}
                  >
                    {density === "compact" ? "Compact" : "Comfortable"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-300">
                Compact keeps the current reduced-scroll operator layout. Comfortable adds a little
                more padding around the shell chrome.
              </p>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Keyboard behavior
              </p>
              <button
                type="button"
                onClick={() => setSectionShortcutsEnabled(!sectionShortcutsEnabled)}
                className={cn(
                  "mt-2 inline-flex items-center gap-2 rounded-[14px] border px-3 py-2 text-sm transition",
                  sectionShortcutsEnabled
                    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                    : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                )}
              >
                <span>{sectionShortcutsEnabled ? "Section shortcuts enabled" : "Section shortcuts disabled"}</span>
              </button>
              <p className="mt-2 text-sm leading-5 text-slate-300">
                When enabled, `⌘1` through `⌘6` jump sections and the shell keeps a single shortcut
                hint in the header.
              </p>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3 lg:col-span-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Runtime mode</p>
              <button
                type="button"
                onClick={() => setDemoModeEnabled(!demoModeEnabled)}
                className={cn(
                  "mt-2 inline-flex items-center gap-2 rounded-[14px] border px-3 py-2 text-sm transition",
                  demoModeEnabled
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
                    : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                )}
              >
                <span>
                  {demoModeEnabled
                    ? "Demo backend"
                    : nativeRuntime
                      ? "Native transport"
                      : "Live backend"}
                </span>
              </button>
              <p className="mt-2 text-sm leading-5 text-slate-300">
                Demo mode keeps sessions, keys, trust scans, snippets, and transfers inside a
                deterministic mock backend so screenshots and browser tests do not depend on live
                SSH material. Native mode uses the live transport path.
              </p>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3 lg:col-span-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Terminal theme
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                Pick a colour palette for every terminal pane. <strong>Auto</strong> follows the
                macOS appearance setting via <code>prefers-color-scheme</code>. Theme changes apply
                live without disconnecting open sessions.
              </p>
              <div
                role="radiogroup"
                aria-label="Terminal theme"
                className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
              >
                {terminalThemeOptions.map((option) => {
                  const selected = terminalTheme === option.name;
                  return (
                    <button
                      key={option.name}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      // Explicit aria-label keeps the accessible name short
                      // ("Slate Emerald") rather than the concatenated
                      // label + mode badge + description text. Tests can
                      // address radios by their theme name unambiguously.
                      aria-label={option.label}
                      onClick={() => setTerminalTheme(option.name as TerminalThemeName)}
                      className={cn(
                        "flex items-stretch gap-3 rounded-[14px] border px-3 py-2 text-left transition",
                        selected
                          ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-50"
                          : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-800"
                        style={{ background: option.preview.background }}
                      >
                        <span
                          className="block h-1/2 w-full"
                          style={{ background: option.preview.foreground, opacity: 0.18 }}
                        />
                        <span
                          className="block h-1.5 w-full"
                          style={{ background: option.preview.accent }}
                        />
                      </span>
                      <span className="flex min-w-0 flex-col justify-center gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                              option.mode === "auto"
                                ? "border-sky-400/40 text-sky-200"
                                : option.mode === "light"
                                  ? "border-amber-400/40 text-amber-200"
                                  : "border-slate-600 text-slate-300"
                            )}
                          >
                            {option.mode}
                          </span>
                        </span>
                        <span className="text-[11px] leading-4 text-slate-400">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* T17-T20 polish: app-shell theme + native OS integrations. */}
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            Appearance &amp; OS integration
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            App shell theme follows the system by default. The three OS-integration toggles are
            no-ops in browser preview; they activate in the Tauri ship.
          </p>

          <div className="mt-3 space-y-3">
            <div role="radiogroup" aria-label="App shell theme" className="flex flex-wrap gap-2">
              {(["system", "light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={appShellTheme === option}
                  aria-label={`App shell theme ${option}`}
                  onClick={() => setAppShellTheme(option)}
                  className={cn(
                    "rounded-2xl border px-3 py-1.5 text-sm capitalize transition",
                    appShellTheme === option
                      ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-100"
                      : "border-slate-700 bg-slate-950/50 text-slate-300 hover:border-slate-500 hover:text-white"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm text-slate-200">Native notifications</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">
                  T17 — fire a notification when a session disconnects or a snippet finishes
                  outside the focused tab.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Enable native notifications"
                checked={notificationsEnabled}
                onChange={(event) => setNotificationsEnabled(event.target.checked)}
                className="h-4 w-4 accent-emerald-400"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm text-slate-200">Dock badge</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">
                  T18 — show the active session count on the macOS dock icon.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Enable dock badge"
                checked={dockBadgeEnabled}
                onChange={(event) => setDockBadgeEnabled(event.target.checked)}
                className="h-4 w-4 accent-emerald-400"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm text-slate-200">Check for updates on launch</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">
                  T19 — auto-checks GitHub Releases; install + restart is offered via banner.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Check for updates on launch"
                checked={autoUpdateCheckOnLaunch}
                onChange={(event) => setAutoUpdateCheckOnLaunch(event.target.checked)}
                className="h-4 w-4 accent-emerald-400"
              />
            </label>

            {/* T19 audit fix: manual "Check for updates" button. The
                button is always present; in browser preview the
                checkForUpdates call returns null and we show "Not
                available in browser preview". In the Tauri ship it
                routes through tauri-plugin-updater. */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm text-slate-200">Check for updates now</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">
                  {updateCheckStatus ?? "Hit the button to query GitHub Releases."}
                </span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  setUpdateCheckStatus("Checking…");
                  try {
                    const result = await checkForUpdates();
                    if (!result) {
                      setUpdateCheckStatus(
                        "Not available in browser preview — wire to GitHub Releases in the Tauri ship."
                      );
                      return;
                    }
                    setUpdateCheckStatus(
                      result.available
                        ? `Update ${result.version ?? ""} available.`
                        : "You're on the latest version."
                    );
                  } catch (error) {
                    setUpdateCheckStatus(
                      error instanceof Error ? error.message : String(error)
                    );
                  }
                }}
                aria-label="Check for updates"
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Check
              </button>
            </div>
          </div>
        </div>
    </>
  );
}
