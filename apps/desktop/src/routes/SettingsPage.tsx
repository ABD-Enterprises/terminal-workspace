import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { SettingsPreferencesSection } from "./SettingsPreferencesSection";
import { SettingsTrustPolicySection } from "./SettingsTrustPolicySection";
import { IdentityEditor, type IdentityEditorValues } from "../components/identities/IdentityEditor";
import { IdentityList } from "../components/identities/IdentityList";
import { applyImportedLocalConfigBundle, buildLocalConfigBundle, inspectImportedLocalConfigBundle, type LocalConfigImportAnalysis } from "../lib/local-config";
import { buildIdentityUsage } from "../lib/identity-usage";
import { useAppStore } from "../store/app-store";
import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";

export function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [pendingImport, setPendingImport] = useState<{
    bundle: unknown;
    analysis: LocalConfigImportAnalysis;
    fileName: string;
  } | null>(null);
  const vaultId = useAppStore((state) => state.vaultId);
  const deviceId = useAppStore((state) => state.deviceId);
  const lastAppliedSnapshotId = useAppStore((state) => state.lastAppliedSnapshotId);

  // ---- Identity manager state (P2-DM1 batch 2) ---------------------------
  const identities = useIdentitiesStore((state) => state.identities);
  const upsertIdentity = useIdentitiesStore((state) => state.upsertIdentity);
  const removeIdentity = useIdentitiesStore((state) => state.removeIdentity);
  const allHosts = useHostsStore((state) => state.hosts);
  const usageByIdentityId = useMemo(() => buildIdentityUsage(allHosts), [allHosts]);
  const [identityEditorOpen, setIdentityEditorOpen] = useState(false);
  const [editingIdentityId, setEditingIdentityId] = useState<string | undefined>();
  const [identityPendingDelete, setIdentityPendingDelete] = useState<
    | {
        identityId: string;
        label: string;
        usageCount: number;
      }
    | null
  >(null);

  const submitIdentity = (values: IdentityEditorValues) => {
    if (editingIdentityId) {
      const existing = identities.find((entry) => entry.id === editingIdentityId);
      upsertIdentity({
        id: editingIdentityId,
        label: values.label.trim(),
        username: values.username.trim(),
        authMethod: values.authMethod,
        privateKeyPath:
          values.authMethod === "privateKey" ? values.privateKeyPath.trim() : "",
        keyId: existing?.keyId,
        hasPassphrase: values.authMethod === "privateKey" ? values.hasPassphrase : false,
        comment: values.comment.trim(),
        // Editing always promotes to "imported" so a future re-derivation
        // never overwrites the user's edits.
        source: "imported",
        createdAt: existing?.createdAt,
      });
      setStatusMessage(`Updated identity ${values.label.trim()}.`);
    } else {
      upsertIdentity({
        id: crypto.randomUUID(),
        label: values.label.trim(),
        username: values.username.trim(),
        authMethod: values.authMethod,
        privateKeyPath:
          values.authMethod === "privateKey" ? values.privateKeyPath.trim() : "",
        hasPassphrase: values.authMethod === "privateKey" ? values.hasPassphrase : false,
        comment: values.comment.trim(),
        source: "imported",
      });
      setStatusMessage(`Created identity ${values.label.trim()}.`);
    }
    setErrorMessage(undefined);
    setIdentityEditorOpen(false);
    setEditingIdentityId(undefined);
  };

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
        <SettingsPreferencesSection />

        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Reusable identities
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                A reusable bundle of <code>(username, auth method, key path)</code> shared across hosts.
                Editing the identity once propagates to every host that adopts it. The runtime still
                reads each host's per-host fields in this build — switching the read path lands in the
                next batch of P2-DM1.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingIdentityId(undefined);
                  setIdentityEditorOpen(true);
                }}
                className="rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Add identity
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <IdentityList
              identities={identities}
              usageByIdentityId={usageByIdentityId}
              editingIdentityId={editingIdentityId}
              onEdit={(identityId) => {
                setEditingIdentityId(identityId);
                setIdentityEditorOpen(true);
              }}
              onDelete={(identityId) => {
                const target = identities.find((entry) => entry.id === identityId);
                if (!target) return;
                setIdentityPendingDelete({
                  identityId,
                  label: target.label,
                  usageCount: usageByIdentityId.get(identityId)?.length ?? 0,
                });
              }}
            />
            <IdentityEditor
              open={identityEditorOpen}
              identity={
                editingIdentityId
                  ? identities.find((entry) => entry.id === editingIdentityId)
                  : undefined
              }
              onCancel={() => {
                setIdentityEditorOpen(false);
                setEditingIdentityId(undefined);
              }}
              onSubmit={(values) => submitIdentity(values)}
            />
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

        <SettingsTrustPolicySection
          setStatusMessage={setStatusMessage}
          setErrorMessage={setErrorMessage}
        />
      </div>

      <aside className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
        <p className="text-sm leading-6 text-slate-400">
          Cloud sync, shared vaults, and team features are still intentionally outside the 90%
          local-first target. The immediate focus is making a single Mac fully replace daily
          alternative client usage.
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
          <p>
            Remote sync trust policy is now local-first too: trusted wrapping keys can be
            exported, imported, rotated, and enforced before encrypted envelopes are accepted.
          </p>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(identityPendingDelete)}
        title="Delete identity"
        description={
          identityPendingDelete?.usageCount
            ? `${identityPendingDelete.label} is currently linked to ${identityPendingDelete.usageCount} host${identityPendingDelete.usageCount === 1 ? "" : "s"}. Those hosts will keep working from their per-host credential fields, but they will lose the link to this identity. You can re-bind them later in the host editor.`
            : `Delete ${identityPendingDelete?.label ?? "this identity"}? No hosts currently reference it.`
        }
        confirmLabel="Delete identity"
        onCancel={() => setIdentityPendingDelete(null)}
        onConfirm={() => {
          if (!identityPendingDelete) return;
          const removed = removeIdentity(identityPendingDelete.identityId);
          setIdentityPendingDelete(null);
          if (editingIdentityId === identityPendingDelete.identityId) {
            setIdentityEditorOpen(false);
            setEditingIdentityId(undefined);
          }
          setErrorMessage(undefined);
          setStatusMessage(
            removed
              ? `Removed identity ${removed.label}.`
              : "Identity already removed."
          );
        }}
      />
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
  return `${label}: +${section.added} updated ${section.updated} removed ${section.removed} kept ${section.retainedLocal} unchanged ${section.unchanged} conflicts ${section.conflicts}`;
}

function formatConflictResolution(strategy: "keep-local" | "prefer-imported") {
  return strategy === "keep-local" ? "keeping local conflicts" : "preferring imported conflicts";
}
