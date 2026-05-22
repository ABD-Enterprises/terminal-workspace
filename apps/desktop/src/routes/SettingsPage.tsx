import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { IdentityEditor, type IdentityEditorValues } from "../components/identities/IdentityEditor";
import { IdentityList } from "../components/identities/IdentityList";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
  inspectImportedLocalConfigBundle,
  type LocalConfigImportAnalysis,
} from "../lib/local-config";
import { checkForUpdates } from "../lib/auto-update";
import { isTauriRuntime } from "../lib/backend-runtime";
import { buildIdentityUsage } from "../lib/identity-usage";
import { parseVaultSyncTrustPolicy, type VaultSyncTrustedKey } from "../lib/vault-sync-contract";
import { cn, splitCommaList } from "../lib/utils";
import { useAppStore } from "../store/app-store";
import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";
import { useVaultSyncTrustStore } from "../store/vault-sync-trust-store";
import {
  listTerminalThemeOptions,
  type TerminalThemeName,
} from "../lib/terminal-themes";

interface TrustedKeyDraft {
  originalKeyId: string | null;
  keyId: string;
  validFrom: string;
  rotateAfter: string;
  retireAfter: string;
  allowedVaultIds: string;
  replacementKeyIds: string;
}

const emptyTrustedKeyDraft: TrustedKeyDraft = {
  originalKeyId: null,
  keyId: "",
  validFrom: "",
  rotateAfter: "",
  retireAfter: "",
  allowedVaultIds: "",
  replacementKeyIds: "",
};

export function SettingsPage() {
  const nativeRuntime = isTauriRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trustPolicyFileInputRef = useRef<HTMLInputElement>(null);
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
  const vaultId = useAppStore((state) => state.vaultId);
  const deviceId = useAppStore((state) => state.deviceId);
  const lastAppliedSnapshotId = useAppStore((state) => state.lastAppliedSnapshotId);
  const trustPolicy = useVaultSyncTrustStore((state) => state.policy);
  const setAllowUnknownKeys = useVaultSyncTrustStore((state) => state.setAllowUnknownKeys);
  const upsertTrustedKey = useVaultSyncTrustStore((state) => state.upsertTrustedKey);
  const removeTrustedKey = useVaultSyncTrustStore((state) => state.removeTrustedKey);
  const replacePolicy = useVaultSyncTrustStore((state) => state.replacePolicy);
  const [trustedKeyDraft, setTrustedKeyDraft] = useState<TrustedKeyDraft>(emptyTrustedKeyDraft);

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

  const exportTrustPolicy = () => {
    const blob = new Blob([JSON.stringify(trustPolicy, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "termsnip-sync-trust-policy.json";
    anchor.click();
    URL.revokeObjectURL(url);

    setErrorMessage(undefined);
    setStatusMessage(`Exported ${trustPolicy.trustedKeys.length} trusted sync key records.`);
  };

  const importTrustPolicy = async (file?: File | null) => {
    if (!file) {
      return;
    }

    try {
      const policy = parseVaultSyncTrustPolicy(JSON.parse(await file.text()));
      replacePolicy(policy);
      setErrorMessage(undefined);
      setStatusMessage(
        `Imported ${policy.trustedKeys.length} trusted sync key records${policy.allowUnknownKeys ? " with unknown keys allowed." : "."}`
      );
    } catch (error) {
      setStatusMessage(undefined);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (trustPolicyFileInputRef.current) {
        trustPolicyFileInputRef.current.value = "";
      }
    }
  };

  const submitTrustedKey = () => {
    const keyId = trustedKeyDraft.keyId.trim();
    const validFrom = trustedKeyDraft.validFrom.trim();
    const rotateAfter = trustedKeyDraft.rotateAfter.trim();
    const retireAfter = trustedKeyDraft.retireAfter.trim();

    if (!keyId || !validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Trusted sync keys require a key ID and valid-from timestamp.");
      return;
    }

    if (rotateAfter && rotateAfter < validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Rotation cannot start before the key becomes valid.");
      return;
    }

    if (retireAfter && retireAfter < validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Retirement cannot happen before the key becomes valid.");
      return;
    }

    upsertTrustedKey({
      keyId,
      algorithm: "AES-256-GCM",
      validFrom,
      rotateAfter: rotateAfter || null,
      retireAfter: retireAfter || null,
      allowedVaultIds: splitCommaList(trustedKeyDraft.allowedVaultIds).length
        ? splitCommaList(trustedKeyDraft.allowedVaultIds)
        : null,
      replacementKeyIds: splitCommaList(trustedKeyDraft.replacementKeyIds),
    });
    setTrustedKeyDraft(emptyTrustedKeyDraft);
    setErrorMessage(undefined);
    setStatusMessage(
      `${trustedKeyDraft.originalKeyId ? "Updated" : "Added"} trusted sync key ${keyId}.`
    );
  };

  const editTrustedKey = (key: VaultSyncTrustedKey) => {
    setTrustedKeyDraft({
      originalKeyId: key.keyId,
      keyId: key.keyId,
      validFrom: key.validFrom,
      rotateAfter: key.rotateAfter ?? "",
      retireAfter: key.retireAfter ?? "",
      allowedVaultIds: key.allowedVaultIds?.join(", ") ?? "",
      replacementKeyIds: key.replacementKeyIds.join(", "),
    });
    setErrorMessage(undefined);
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

        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Remote sync trust policy
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Bootstrap and manage the trusted key IDs that can wrap remote vault snapshots. The
                policy stays local, can be exported for bootstrap distribution, and is loaded
                automatically before remote envelopes are accepted.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportTrustPolicy}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Export trust policy
              </button>
              <button
                type="button"
                onClick={() => trustPolicyFileInputRef.current?.click()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Import trust policy
              </button>
            </div>
          </div>

          <input
            ref={trustPolicyFileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              void importTrustPolicy(event.target.files?.[0] ?? null);
            }}
          />

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Trust enforcement
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {trustPolicy.allowUnknownKeys
                      ? "Unknown envelope keys are allowed."
                      : "Only explicitly trusted envelope keys are allowed."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowUnknownKeys(!trustPolicy.allowUnknownKeys)}
                  className={cn(
                    "rounded-[14px] border px-3 py-2 text-sm transition",
                    trustPolicy.allowUnknownKeys
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
                      : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                  )}
                >
                  {trustPolicy.allowUnknownKeys ? "Allow unknown keys" : "Require trusted keys"}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {trustPolicy.trustedKeys.length ? (
                  trustPolicy.trustedKeys.map((key) => (
                    <div
                      key={key.keyId}
                      className="rounded-[14px] border border-slate-800 bg-slate-950/60 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100">{key.keyId}</p>
                          <p className="text-xs leading-5 text-slate-400">
                            Valid from {key.validFrom}
                            {key.rotateAfter ? ` • Rotate after ${key.rotateAfter}` : ""}
                            {key.retireAfter ? ` • Retire after ${key.retireAfter}` : ""}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            Vaults {key.allowedVaultIds?.join(", ") ?? "all"} • Replacements{" "}
                            {key.replacementKeyIds.length ? key.replacementKeyIds.join(", ") : "none"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editTrustedKey(key)}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              removeTrustedKey(key.keyId);
                              if (trustedKeyDraft.originalKeyId === key.keyId) {
                                setTrustedKeyDraft(emptyTrustedKeyDraft);
                              }
                              setErrorMessage(undefined);
                              setStatusMessage(`Removed trusted sync key ${key.keyId}.`);
                            }}
                            className="rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[14px] border border-dashed border-slate-800 bg-slate-950/50 px-3 py-4 text-sm text-slate-400">
                    No trusted sync keys are configured yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Trusted key editor
              </p>
              <div className="mt-3 grid gap-2">
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Key ID
                  <input
                    value={trustedKeyDraft.keyId}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({ ...current, keyId: event.target.value }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="wrap-key-1"
                  />
                </label>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Valid from (ISO-8601)
                  <input
                    value={trustedKeyDraft.validFrom}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({ ...current, validFrom: event.target.value }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="2026-04-01T00:00:00.000Z"
                  />
                </label>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                    Rotate after
                    <input
                      value={trustedKeyDraft.rotateAfter}
                      onChange={(event) =>
                        setTrustedKeyDraft((current) => ({ ...current, rotateAfter: event.target.value }))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                      placeholder="2026-05-01T00:00:00.000Z"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                    Retire after
                    <input
                      value={trustedKeyDraft.retireAfter}
                      onChange={(event) =>
                        setTrustedKeyDraft((current) => ({ ...current, retireAfter: event.target.value }))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                      placeholder="2026-06-01T00:00:00.000Z"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Allowed vault IDs
                  <input
                    value={trustedKeyDraft.allowedVaultIds}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({
                        ...current,
                        allowedVaultIds: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="vault-a, vault-b"
                  />
                </label>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Replacement key IDs
                  <input
                    value={trustedKeyDraft.replacementKeyIds}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({
                        ...current,
                        replacementKeyIds: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="wrap-key-2, wrap-key-3"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitTrustedKey}
                  className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
                >
                  {trustedKeyDraft.originalKeyId ? "Update key" : "Add key"}
                </button>
                <button
                  type="button"
                  onClick={() => setTrustedKeyDraft(emptyTrustedKeyDraft)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Reset form
                </button>
              </div>
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
