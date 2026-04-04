import { useRef, useState } from "react";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
} from "../lib/local-config";
import { isTauriRuntime } from "../lib/backend-runtime";
import { cn } from "../lib/utils";
import { useAppStore } from "../store/app-store";

export function SettingsPage() {
  const nativeRuntime = isTauriRuntime();
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
    <section className="grid h-full min-h-0 gap-3 overflow-auto pr-1 xl:grid-cols-[1.2fr_0.9fr]">
      <div className="grid gap-3">
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
          </div>
        </div>

        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Local config bundle
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Export a portable vault snapshot of hosts, keys, snippets, and trusted host keys.
                Import replaces the current local config, adopts the incoming vault ID, and clears
                open sessions so reconnects are explicit.
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
                Hosts, keys, snippets, known-host trust, and vault metadata are included.
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
        <p className="text-sm leading-6 text-slate-400">
          Cloud sync, shared vaults, and team features are still intentionally outside the 90%
          local-first target. The immediate focus is making a single Mac fully replace daily
          Termius usage.
        </p>
        <div className="mt-4 space-y-4 text-sm leading-6 text-slate-300">
          <p>
            Browser and screenshot flows still default to demo mode. The native shell now defaults
            to live transport so local testing starts against the real Tauri-backed connection path.
          </p>
          <p>
            Native mode now covers sessions, transfers, forwards, snippets, key inspection, key
            generation, and trust scanning. Browser mode still uses the backend path so seeded demo
            and screenshot flows stay stable.
          </p>
        </div>
      </aside>
    </section>
  );
}
