import { useRef, useState } from "react";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
} from "../lib/local-config";
import { cn } from "../lib/utils";
import { useAppStore } from "../store/app-store";

const settingsMilestones = [
  "Restore prior session tabs and splits on relaunch",
  "Local preferences for theme, keyboard, and behavior",
  "Known-host defaults and runtime secret prompts",
  "Import and export of local configuration",
];

export function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const setWorkspaceDensity = useAppStore((state) => state.setWorkspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  const setSectionShortcutsEnabled = useAppStore((state) => state.setSectionShortcutsEnabled);
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);
  const setDemoModeEnabled = useAppStore((state) => state.setDemoModeEnabled);

  const exportConfig = () => {
    const bundle = buildLocalConfigBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `termsnip-config-${bundle.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    setErrorMessage(undefined);
    setStatusMessage(
      `Exported ${bundle.hosts.length} hosts, ${bundle.keys.length} keys, ${bundle.snippets.length} snippets, and ${bundle.knownHosts.length} trusted host entries.`
    );
  };

  const importConfig = async (file?: File | null) => {
    if (!file) {
      return;
    }

    try {
      const bundle = JSON.parse(await file.text());
      const summary = applyImportedLocalConfigBundle(bundle);
      setErrorMessage(undefined);
      setStatusMessage(
        `Imported ${summary.hostCount} hosts, ${summary.keyCount} keys, ${summary.snippetCount} snippets, and ${summary.knownHostCount} trusted host entries. Sessions were reset so the workspace can reconnect cleanly.`
      );
    } catch (error) {
      setStatusMessage(undefined);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr]">
      <div className="grid gap-3">
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
            Local-first preferences
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">
            Backups and migration are live.
          </h2>
          <div className="mt-3 grid gap-2">
            {settingsMilestones.map((milestone) => (
              <div
                key={milestone}
                className="rounded-[16px] border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-300"
              >
                {milestone}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Workspace preferences
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Keep the shell dense by default, or relax spacing slightly. Shortcut badges and
                `⌘1` through `⌘6` navigation can also be disabled if they conflict with your
                terminal habits.
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
                When enabled, `⌘1` through `⌘6` jump sections and shortcut badges stay visible in
                the shell.
              </p>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3 lg:col-span-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Demo mode</p>
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
                <span>{demoModeEnabled ? "Demo backend enabled" : "Demo backend disabled"}</span>
              </button>
              <p className="mt-2 text-sm leading-5 text-slate-300">
                When enabled, sessions, keys, trust scans, snippets, and transfers stay inside a
                deterministic mock backend so screenshots and browser tests do not depend on live
                SSH material.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Local config bundle
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Export a portable JSON snapshot of hosts, keys, snippets, and trusted host keys.
                Import replaces the current local config and clears open sessions so reconnects are
                explicit.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportConfig}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Export config
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Import config
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              void importConfig(event.target.files?.[0] ?? null);
            }}
          />

          {statusMessage ? (
            <div className="mt-3 rounded-[16px] border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
              {statusMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-3 rounded-[16px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Export scope</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                Hosts, keys, snippets, and known-host trust are included.
              </p>
            </div>
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Secret handling</p>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              Passwords and passphrases are not exported because runtime secrets stay outside the
              persisted host inventory and, in the native shell, live in macOS Keychain.
            </p>
            </div>
          </div>
        </div>
      </div>

      <aside className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Scope note
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Cloud sync, shared vaults, and team features are still intentionally outside the 90%
          local-first target. The immediate focus is making a single Mac fully replace daily
          Termius usage.
        </p>
        <div className="mt-4 grid gap-2">
          <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Current default
            </p>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              Native shell quality is the active milestone. Demo mode still ships on by default so
              the seeded workspace stays browsable without any host-specific setup.
            </p>
          </div>
          <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
              Next hardening target
            </p>
            <p className="mt-1 text-sm leading-5 text-slate-300">
              Key inspection, key generation, and trust scanning are the main remaining native-mode
              features that still proxy through the Node backend after the new Rust session, SFTP,
              forward, and snippet work.
            </p>
          </div>
        </div>
      </aside>
    </section>
  );
}
