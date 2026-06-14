import { useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHosts } from "../hooks/useHosts";
import { useListKeyboardNavigation } from "../hooks/useListKeyboardNavigation";
import { describeHostRuntime, formatEnvironmentVariables, formatHostAddress, formatRelativeTime } from "../lib/utils";
import { useAppStore } from "../store/app-store";
import { useConnectionSecretsStore } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { HostEditor } from "../components/hosts/HostEditor";
import { HostFilterBar } from "../components/hosts/HostFilterBar";
import { HostList } from "../components/hosts/HostList";
import { ImportSshCallout } from "../components/hosts/ImportSshCallout";
import { WelcomePanel } from "../components/hosts/WelcomePanel";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import {
  formatHostProtocol,
  hostSupportsJumpHosts,
  hostSupportsPortForwarding,
  hostSupportsSftp,
  hostSupportsTrustedKeys,
  emptyHostFormValues,
} from "../types/host";
import { launchHostSession } from "../lib/launch-host-session";
import { parseSshConfig, toHostFormValues } from "../lib/ssh-config";
import { resolveSshIncludes } from "../lib/ssh-config-include";
import { readSshConfigFile } from "../lib/ssh-config-fs";

export function HostsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeGroup, setActiveGroup] = useState("all");
  const [activeTag, setActiveTag] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hostPendingDelete, setHostPendingDelete] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<
    | {
        importedCount: number;
        defaultsAppliedCount: number;
        unresolvedProxyJumpAliases: string[];
        skipped: { reason: string; detail: string }[];
      }
    | null
  >(null);
  const setQuery = useAppStore((state) => state.setSidebarSearch);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const cheatsheetOpen = useAppStore((state) => state.cheatsheetOpen);
  const setHostSecrets = useConnectionSecretsStore((state) => state.setHostSecrets);
  const clearHostSecrets = useConnectionSecretsStore((state) => state.clearHostSecrets);
  const createHost = useHostsStore((state) => state.createHost);
  const updateHost = useHostsStore((state) => state.updateHost);
  const deleteHost = useHostsStore((state) => state.deleteHost);
  const toggleFavorite = useHostsStore((state) => state.toggleFavorite);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const removeKnownHost = useKnownHostsStore((state) => state.removeKnownHost);
  const { allHosts, filteredHosts, groups, tags } = useHosts({
    activeGroup,
    activeTag,
    favoritesOnly,
  });

  const editingHostId = searchParams.get("edit");
  const focusedHostId = searchParams.get("focus");
  const creatingHost = searchParams.get("new") === "1";
  const editingHost = allHosts.find((host) => host.id === editingHostId);
  const selectedHost =
    filteredHosts.find((host) => host.id === focusedHostId) ??
    allHosts.find((host) => host.id === focusedHostId) ??
    filteredHosts[0] ??
    allHosts[0];
  const hostsById = Object.fromEntries(allHosts.map((host) => [host.id, host]));
  const updateParams = (updates: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });

    setSearchParams(nextParams);
  };

  const launchSession = async (hostId: string) => {
    const host = allHosts.find((entry) => entry.id === hostId);
    if (!host) {
      return;
    }
    const result = await launchHostSession(host);
    if (!result.ok || !result.tabId) {
      // Trust prompt rejected / scan failed — surface a non-blocking
      // banner via console for now; future polish ticket can route this
      // through a global toast.
      if (result.errorMessage) {
        console.warn(`[hosts] ${result.errorMessage}`);
      }
      return;
    }
    navigate(`/sessions?tabId=${result.tabId}`);
  };

  const resetFilters = () => {
    setActiveGroup("all");
    setActiveTag("all");
    setFavoritesOnly(false);
    setQuery("");
    updateParams({ focus: null });
  };

  // Single source of truth for the SSH-config import flow. Used by the
  // toolbar button, the cold-start WelcomePanel, and the ImportSshCallout
  // banner — all three should pop the same file picker.
  const openImportSshConfig = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          // Resolve `Include` directives via the native bridge when
          // available; falls back to "log and skip" in dev/web mode
          // where readSshConfigFile returns null.
          const expanded = await resolveSshIncludes(content, {
            readFile: readSshConfigFile,
          });
          const result = parseSshConfig(expanded.text);
          const skipped = [...result.skipped, ...expanded.skipped];
          result.hosts.forEach((host) =>
            createHost({ ...emptyHostFormValues, ...toHostFormValues(host) })
          );
          setImportReport({
            importedCount: result.hosts.length,
            defaultsAppliedCount: result.defaultsAppliedCount,
            unresolvedProxyJumpAliases: result.unresolvedProxyJumpAliases,
            skipped,
          });
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [createHost]);

  // Keyboard navigation for the host list. Disabled while any dialog
  // (Add/Edit, delete confirm, import report) or the global palette /
  // cheatsheet is open, so j/k don't bleed through to the background.
  // Enter on the selected host launches the session — the same action as
  // the row's "Open" button. See QWEN review keyboard-first item.
  const navDisabled =
    creatingHost ||
    editingHost !== undefined ||
    hostPendingDelete !== null ||
    importReport !== null ||
    commandPaletteOpen ||
    cheatsheetOpen;
  useListKeyboardNavigation({
    itemIds: filteredHosts.map((host) => host.id),
    selectedId: selectedHost?.id,
    onSelect: (hostId) => updateParams({ focus: hostId }),
    onActivate: launchSession,
    enabled: !navDisabled,
  });

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-2.5">
        {allHosts.length === 0 ? (
          // Cold-start: skip the filter bar + list entirely. WelcomePanel
          // has the three first-action CTAs the user needs.
          <div className="min-h-0 flex-1">
            <WelcomePanel
              onAddHost={() => updateParams({ new: "1", edit: null })}
              onImportSshConfig={openImportSshConfig}
            />
          </div>
        ) : (
          <>
            <HostFilterBar
              groups={groups}
              tags={tags}
              activeGroup={activeGroup}
              activeTag={activeTag}
              favoritesOnly={favoritesOnly}
              total={allHosts.length}
              shown={filteredHosts.length}
              onGroupChange={setActiveGroup}
              onTagChange={setActiveTag}
              onFavoritesToggle={() => setFavoritesOnly((current) => !current)}
              onAddHost={() => updateParams({ new: "1", edit: null })}
              onImportSshConfig={openImportSshConfig}
              onResetFilters={resetFilters}
            />
            <ImportSshCallout onImport={openImportSshConfig} />

            <div className="min-h-0 flex-1">
              <HostList
                hosts={filteredHosts}
                hostsById={hostsById}
                selectedHostId={selectedHost?.id}
                onSelect={(hostId) => updateParams({ focus: hostId })}
                onConnect={launchSession}
                onEdit={(hostId) => updateParams({ edit: hostId, new: null, focus: hostId })}
                onDelete={setHostPendingDelete}
                onToggleFavorite={toggleFavorite}
                onCreateHost={() => updateParams({ new: "1", edit: null })}
            renderExpandedContent={(host) => {
              const trustedKnownHost = hostSupportsTrustedKeys(host.protocol)
                ? knownHosts.find(
                    (knownHost) => knownHost.hostname === host.hostname && knownHost.port === host.port
                  )
                : undefined;
              const environmentLines = formatEnvironmentVariables(host.environment)
                .split("\n")
                .filter(Boolean);
              const visibleTags = host.tags.filter(
                (tag) => tag.trim().toLowerCase() !== "favorite"
              );

              // #105: progressive disclosure. The expansion groups every
              // host detail into three calm sections — Connection, Trust &
              // activity, Environment & notes — instead of nine bordered
              // cards. The outer wrapper (HostList) owns the only border, so
              // sections here use light top-rules, not nested card chrome.
              return (
                <div className="space-y-3 text-[13px]">
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Connection
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      <div className="flex gap-3">
                        <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Identity</dt>
                        <dd className="min-w-0 text-slate-200">
                          {host.protocol === "ssh"
                            ? host.keyLabel || "Not assigned yet"
                            : formatHostAddress(host)}
                        </dd>
                      </div>
                      <div className="flex gap-3">
                        <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Runtime</dt>
                        <dd className="min-w-0 text-slate-200">
                          {host.protocol === "ssh"
                            ? hostSupportsPortForwarding(host.protocol)
                              ? `${host.forwardingCount} forwards · ${environmentLines.length} env`
                              : formatHostProtocol(host.protocol)
                            : `Native shell bridge · ${environmentLines.length} env`}
                        </dd>
                      </div>
                      <div className="flex gap-3 sm:col-span-2">
                        <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Path</dt>
                        <dd className="min-w-0 text-slate-400">
                          {describeHostRuntime(
                            host,
                            host.jumpHostId && hostsById[host.jumpHostId]
                              ? hostsById[host.jumpHostId].label
                              : undefined
                          )}
                        </dd>
                      </div>
                      {hostSupportsJumpHosts(host.protocol) ? (
                        <div className="flex gap-3">
                          <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Jump host</dt>
                          <dd className="min-w-0 text-slate-200">
                            {host.jumpHostId && hostsById[host.jumpHostId]
                              ? hostsById[host.jumpHostId].label
                              : "Direct"}
                          </dd>
                        </div>
                      ) : null}
                      {hostSupportsSftp(host.protocol) ? (
                        <div className="flex gap-3">
                          <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">SFTP root</dt>
                          <dd className="min-w-0 text-slate-200">{host.sftpRoot}</dd>
                        </div>
                      ) : null}
                      {visibleTags.length ? (
                        <div className="flex gap-3 sm:col-span-2">
                          <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Tags</dt>
                          <dd className="min-w-0 text-slate-400">{visibleTags.join(" · ")}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>

                  <section className="border-t border-slate-800/60 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Trust &amp; activity
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {hostSupportsTrustedKeys(host.protocol) ? (
                        <div className="flex gap-3 sm:col-span-2">
                          <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Known host</dt>
                          <dd className="min-w-0 space-y-1">
                            <p className="text-slate-200">
                              {trustedKnownHost ? `${trustedKnownHost.algorithm} · trusted` : "Unverified"}
                            </p>
                            {trustedKnownHost ? (
                              <p className="break-all text-[11px] text-slate-500">{trustedKnownHost.fingerprint}</p>
                            ) : null}
                            <p className="text-[11px] text-slate-500">
                              Policy:{" "}
                              {host.hostKeyPolicy === "requireTrusted"
                                ? "Trusted key required"
                                : "Unknown keys allowed"}
                            </p>
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/keys?scanHost=${encodeURIComponent(host.id)}&autoScan=1`)
                                }
                                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                              >
                                Manage trust
                              </button>
                              {trustedKnownHost ? (
                                <button
                                  type="button"
                                  onClick={() => removeKnownHost(trustedKnownHost.id)}
                                  className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-white"
                                >
                                  Revoke trust
                                </button>
                              ) : null}
                            </div>
                          </dd>
                        </div>
                      ) : (
                        <div className="flex gap-3 sm:col-span-2">
                          <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Trust</dt>
                          <dd className="min-w-0 space-y-1">
                            <p className="text-slate-200">No network trust required</p>
                            <p className="text-[11px] text-slate-500">
                              {host.protocol === "localShell"
                                ? "Local shell sessions stay on this workstation."
                                : host.protocol === "telnet"
                                  ? "Telnet sessions use the native PTY bridge and do not rely on SSH trust metadata."
                                  : host.protocol === "serial"
                                    ? "Serial sessions connect to a local device path and do not use network trust."
                                    : `${formatHostProtocol(host.protocol)} sessions use the native bridge without separate SSH trust metadata.`}
                            </p>
                          </dd>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <dt className="w-24 shrink-0 text-[11px] leading-5 text-slate-500">Last used</dt>
                        <dd className="min-w-0 text-slate-200">{formatRelativeTime(host.lastConnectedAt)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="border-t border-slate-800/60 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Environment &amp; notes
                    </p>
                    <div className="mt-2 grid gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                      <div>
                        <p className="text-[11px] leading-5 text-slate-500">Session environment</p>
                        <pre className="mt-1 whitespace-pre-wrap break-all rounded-xl bg-slate-950/70 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                          {environmentLines.length ? environmentLines.join("\n") : "No env overrides"}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[11px] leading-5 text-slate-500">Operator note</p>
                        <p className="mt-1 leading-6 text-slate-300">
                          {host.note || "No note recorded for this host yet."}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              );
            }}
              />
            </div>
          </>
        )}
      </section>

      <HostEditor
        key={editingHost?.id ?? (creatingHost ? "new" : "closed")}
        open={creatingHost || Boolean(editingHost)}
        host={editingHost}
        onClose={() => updateParams({ new: null, edit: null })}
        onSave={(values) => {
          const hostId = editingHost ? updateHost(editingHost.id, values) : createHost(values);
          setHostSecrets(hostId, {
            password: values.password,
            passphrase: values.passphrase,
          });
          updateParams({ new: null, edit: null, focus: hostId });
        }}
      />

      <ConfirmDialog
        open={Boolean(hostPendingDelete)}
        title="Delete host"
        description="This removes the host from the local inventory. Existing tabs close on refresh, and any trusted host key or assigned identity remains in local storage until you remove it separately."
        confirmLabel="Delete host"
        onCancel={() => setHostPendingDelete(null)}
        onConfirm={() => {
          if (hostPendingDelete) {
            deleteHost(hostPendingDelete);
            clearHostSecrets(hostPendingDelete);
            setHostPendingDelete(null);
            updateParams({ focus: null, edit: null });
          }
        }}
      />

      {importReport ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ssh-import-report-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4"
          onClick={() => setImportReport(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 text-sm text-slate-200 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="ssh-import-report-title" className="text-base font-semibold text-white">
              SSH config import summary
            </h2>
            <ul className="mt-3 space-y-1 text-slate-300">
              <li>
                Imported <strong className="text-white">{importReport.importedCount}</strong> host
                {importReport.importedCount === 1 ? "" : "s"}.
              </li>
              {importReport.defaultsAppliedCount > 0 ? (
                <li>
                  Inherited defaults from <code>Host *</code> on{" "}
                  <strong className="text-white">{importReport.defaultsAppliedCount}</strong> host
                  {importReport.defaultsAppliedCount === 1 ? "" : "s"}.
                </li>
              ) : null}
              {importReport.unresolvedProxyJumpAliases.length > 0 ? (
                <li>
                  ProxyJump targets not present in the file (assign manually):{" "}
                  <span className="text-amber-300">
                    {importReport.unresolvedProxyJumpAliases.join(", ")}
                  </span>
                </li>
              ) : null}
            </ul>
            {importReport.skipped.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-950/30 p-3">
                <p className="text-xs uppercase tracking-wider text-amber-300">
                  Skipped ({importReport.skipped.length})
                </p>
                <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-xs text-amber-100/90">
                  {importReport.skipped.slice(0, 25).map((entry, index) => (
                    <li key={`${entry.reason}-${index}`}>
                      <span className="text-amber-300">{entry.reason}:</span> {entry.detail}
                    </li>
                  ))}
                  {importReport.skipped.length > 25 ? (
                    <li className="text-amber-300/80">
                      …and {importReport.skipped.length - 25} more
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              {/* #111: dismiss is a neutral action — accent is reserved for
                  the single primary action per view. */}
              <button
                type="button"
                onClick={() => setImportReport(null)}
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
