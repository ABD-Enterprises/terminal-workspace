import { useRef, useState } from "react";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
  inspectImportedLocalConfigBundle,
  type LocalConfigImportAnalysis,
} from "../lib/local-config";
import { isTauriRuntime } from "../lib/backend-runtime";
import { cn } from "../lib/utils";
import { useAppStore } from "../store/app-store";

export function SettingsPage() {
  const nativeRuntime = isTauriRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [pendingImport, setPendingImport] = useState<{
    bundle: unknown;
    analysis: LocalConfigImportAnalysis;
    fileName: string;
  } | null>(null);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const setWorkspaceDensity = useAppStore((state) => state.setWorkspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  const setSectionShortcutsEnabled = useAppStore((state) => state.setSectionShortcutsEnabled);
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);
  const setDemoModeEnabled = useAppStore((state) => state.setDemoModeEnabled);
  const vaultId = useAppStore((state) => state.vaultId);
  const deviceId = useAppStore((state) => state.deviceId);
  const lastAppliedSnapshotId = useAppStore((state) => state.lastAppliedSnapshotId);

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
      setErrorMessage(undefined);
      setStatusMessage(undefined);
      setPendingImport({
        bundle,
        analysis: inspectImportedLocalConfigBundle(bundle),
        fileName: file.name,
      });
    } catch (error) {
      setPendingImport(null);
      setStatusMessage(undefined);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const applyPendingImport = (
    mode: "replace" | "merge",
    conflictResolution?: "keep-local" | "prefer-imported"
  ) => {
    if (!pendingImport) {
      return;
    }

    try {
      const summary = applyImportedLocalConfigBundle(pendingImport.bundle, {
        mode,
        conflictResolution,
      });
      setPendingImport(null);
      setErrorMessage(undefined);
      setStatusMessage(
        `Imported ${summary.hostCount} hosts, ${summary.keyCount} keys, ${summary.snippetCount} snippets, and ${summary.knownHostCount} trusted host entries via ${summary.mode}${summary.conflictResolution ? ` (${formatConflictResolution(summary.conflictResolution)})` : ""}. Strategy: ${formatImportStrategy(summary.importStrategy)}. Sessions were reset so the workspace can reconnect cleanly.`
      );
    } catch (error) {
      setStatusMessage(undefined);
      setErrorMessage(error instanceof Error ? error.message : String(error));
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

          {pendingImport ? (
            <div className="mt-3 rounded-[18px] border border-amber-400/30 bg-amber-400/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-amber-200">
                    Import preview
                  </p>
                  <p className="mt-1 text-sm font-medium text-amber-50">
                    {formatImportStrategy(pendingImport.analysis.strategy)}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-amber-100/90">
                    {describeImportStrategy(pendingImport.analysis)}
                  </p>
                  {pendingImport.analysis.mergePlan ? (
                    <div className="mt-3 grid gap-2 text-xs text-amber-100/80 md:grid-cols-2">
                      <p>{formatMergeSection("Hosts", pendingImport.analysis.mergePlan.hosts)}</p>
                      <p>{formatMergeSection("Keys", pendingImport.analysis.mergePlan.keys)}</p>
                      <p>{formatMergeSection("Snippets", pendingImport.analysis.mergePlan.snippets)}</p>
                      <p>{formatMergeSection("Trust", pendingImport.analysis.mergePlan.knownHosts)}</p>
                    </div>
                  ) : null}
                  <p className="mt-2 text-xs text-amber-100/70">{pendingImport.fileName}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingImport(null)}
                    className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-200/50 hover:text-white"
                  >
                    Cancel
                  </button>
                  {canMergeImport(pendingImport.analysis) ? (
                    <button
                      type="button"
                      onClick={() => applyPendingImport("merge")}
                      className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-200/60 hover:text-white"
                    >
                      Merge import
                    </button>
                  ) : null}
                  {canResolveMergeConflicts(pendingImport.analysis) ? (
                    <button
                      type="button"
                      onClick={() => applyPendingImport("merge", "keep-local")}
                      className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-200/60 hover:text-white"
                    >
                      Merge keeping local
                    </button>
                  ) : null}
                  {canResolveMergeConflicts(pendingImport.analysis) ? (
                    <button
                      type="button"
                      onClick={() => applyPendingImport("merge", "prefer-imported")}
                      className="rounded-lg border border-sky-300/40 bg-sky-300/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-200/60 hover:text-white"
                    >
                      Merge preferring imported
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => applyPendingImport("replace")}
                    className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-amber-200"
                  >
                    {getImportActionLabel(pendingImport.analysis.strategy)}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

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

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current lineage</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                Vault <span className="font-mono text-slate-200">{vaultId.slice(0, 8)}</span> on
                device <span className="font-mono text-slate-200">{deviceId.slice(0, 8)}</span>.
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {lastAppliedSnapshotId
                  ? `Last applied snapshot ${lastAppliedSnapshotId.slice(0, 8)}`
                  : "No imported snapshot has been applied yet."}
              </p>
            </div>
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Export scope</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                Hosts, keys, snippets, known-host trust, vault metadata, and snapshot ancestry are included.
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
          <p>
            Local config imports now preview whether a snapshot is a fast-forward, a divergent
            replacement, or a vault adoption step before replacing the local workspace.
          </p>
        </div>
      </aside>
    </section>
  );
}

function formatImportStrategy(strategy: LocalConfigImportAnalysis["strategy"]) {
  switch (strategy) {
    case "same_snapshot":
      return "Same snapshot";
    case "fast_forward":
      return "Fast-forward snapshot";
    case "divergent":
      return "Divergent snapshot";
    case "adopt_vault":
      return "Adopt external vault";
    case "legacy":
      return "Legacy import";
  }
}

function getImportActionLabel(strategy: LocalConfigImportAnalysis["strategy"]) {
  switch (strategy) {
    case "same_snapshot":
      return "Re-apply snapshot";
    case "fast_forward":
      return "Apply snapshot";
    case "divergent":
      return "Replace local state";
    case "adopt_vault":
      return "Adopt vault";
    case "legacy":
      return "Import legacy config";
  }
}

function describeImportStrategy(analysis: LocalConfigImportAnalysis) {
  switch (analysis.strategy) {
    case "same_snapshot":
      return `This bundle already matches the local snapshot ${truncateId(analysis.importedSnapshotId)}. Re-applying will reset local sessions and transfers without changing vault lineage.`;
    case "fast_forward":
      return `This bundle advances vault ${truncateId(analysis.importedVaultId)} from ${truncateId(analysis.importedBaseSnapshotId)} to ${truncateId(analysis.importedSnapshotId)} and can replace the local workspace cleanly.`;
    case "divergent":
      return `This bundle targets vault ${truncateId(analysis.importedVaultId)} but does not descend from the current local snapshot ${truncateId(analysis.currentSnapshotId)}. Importing will discard local changes and switch to snapshot ${truncateId(analysis.importedSnapshotId)}.`;
    case "adopt_vault":
      return `This bundle will switch the device from vault ${truncateId(analysis.currentVaultId)} to ${truncateId(analysis.importedVaultId)} and apply snapshot ${truncateId(analysis.importedSnapshotId)} from device ${truncateId(analysis.importedDeviceId)}.`;
    case "legacy":
      return "This bundle has no snapshot lineage metadata. Importing will replace the current local config, but conflict detection is not available.";
  }
}

function truncateId(value: string | null) {
  return value ? value.slice(0, 8) : "unknown";
}

function canMergeImport(analysis: LocalConfigImportAnalysis) {
  return (
    Boolean(analysis.mergePlan?.applicable) &&
    !analysis.mergePlan?.hasConflicts &&
    (analysis.strategy === "fast_forward" ||
      analysis.strategy === "divergent" ||
      analysis.strategy === "same_snapshot")
  );
}

function canResolveMergeConflicts(analysis: LocalConfigImportAnalysis) {
  return (
    Boolean(analysis.mergePlan?.applicable) &&
    Boolean(analysis.mergePlan?.hasConflicts) &&
    (analysis.strategy === "fast_forward" ||
      analysis.strategy === "divergent" ||
      analysis.strategy === "same_snapshot")
  );
}

function formatMergeSection(label: string, section: NonNullable<LocalConfigImportAnalysis["mergePlan"]>["hosts"]) {
  return `${label}: +${section.added} updated ${section.updated} kept ${section.retainedLocal} unchanged ${section.unchanged} conflicts ${section.conflicts}`;
}

function formatConflictResolution(strategy: "keep-local" | "prefer-imported") {
  return strategy === "keep-local" ? "keeping local conflicts" : "preferring imported conflicts";
}
