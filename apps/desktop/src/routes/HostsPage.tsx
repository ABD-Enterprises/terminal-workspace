import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EnvironmentEditor } from "../components/hosts/EnvironmentEditor";
import { HostEditor } from "../components/hosts/HostEditor";
import { HostFilterBar } from "../components/hosts/HostFilterBar";
import { HostList } from "../components/hosts/HostList";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { useHosts } from "../hooks/useHosts";
import { readSshConfigFile } from "../lib/api";
import {
  describeHostRuntime,
  formatEnvironmentVariables,
  formatHostAddress,
  formatRelativeTime,
} from "../lib/utils";
import { useAppStore } from "../store/app-store";
import { useConnectionSecretsStore } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { formatHostEnvironmentKind } from "../types/environment";
import {
  formatHostProtocol,
  hostSupportsJumpHosts,
  hostSupportsPortForwarding,
  hostSupportsSftp,
  hostSupportsTrustedKeys,
} from "../types/host";

export function HostsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeEnvironmentId, setActiveEnvironmentId] = useState("all");
  const [activeTag, setActiveTag] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hostPendingDelete, setHostPendingDelete] = useState<string | null>(null);
  const [environmentPendingDelete, setEnvironmentPendingDelete] = useState<string | null>(null);
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | null>(null);
  const [creatingEnvironment, setCreatingEnvironment] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const query = useAppStore((state) => state.sidebarSearch);
  const setQuery = useAppStore((state) => state.setSidebarSearch);
  const setHostSecrets = useConnectionSecretsStore((state) => state.setHostSecrets);
  const clearHostSecrets = useConnectionSecretsStore((state) => state.clearHostSecrets);
  const createHost = useHostsStore((state) => state.createHost);
  const updateHost = useHostsStore((state) => state.updateHost);
  const deleteHost = useHostsStore((state) => state.deleteHost);
  const toggleFavorite = useHostsStore((state) => state.toggleFavorite);
  const markConnected = useHostsStore((state) => state.markConnected);
  const environments = useHostsStore((state) => state.environments);
  const createEnvironment = useHostsStore((state) => state.createEnvironment);
  const updateEnvironment = useHostsStore((state) => state.updateEnvironment);
  const deleteEnvironment = useHostsStore((state) => state.deleteEnvironment);
  const importHostsFromSshConfig = useHostsStore((state) => state.importHostsFromSshConfig);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const removeKnownHost = useKnownHostsStore((state) => state.removeKnownHost);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const openSession = useSessionsStore((state) => state.openSession);
  const { allHosts, environmentSections, filteredHosts, tags } = useHosts({
    activeEnvironmentId,
    activeTag,
    favoritesOnly,
  });

  const connectedHostIds = useMemo(() => {
    const nextIds = new Set<string>();

    sessionTabs.forEach((tab) => {
      const activePane = sessionPanes[tab.activePaneId];
      if (activePane?.connectionState === "connected") {
        nextIds.add(activePane.hostId);
      }
    });

    return nextIds;
  }, [sessionPanes, sessionTabs]);

  const editingHostId = searchParams.get("edit");
  const focusedHostId = searchParams.get("focus");
  const creatingHost = searchParams.get("new") === "1";
  const editingHost = allHosts.find((host) => host.id === editingHostId);
  const editingEnvironment =
    environments.find((environment) => environment.id === editingEnvironmentId) ?? undefined;
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

  const launchSession = (hostId: string) => {
    const host = allHosts.find((entry) => entry.id === hostId);
    if (!host) {
      return;
    }

    markConnected(host.id);
    const tabId = openSession(host);
    navigate(`/sessions?tabId=${tabId}`);
  };

  const environmentCount = environments.length;
  const connectedSummary = connectedHostIds.size;

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-2.5">
        <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">
              {allHosts.length} hosts • {environmentCount} environments • {connectedSummary} connected •{" "}
              {tags.length} tags
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCreatingEnvironment(true)}
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Add environment
              </button>
              <button
                type="button"
                onClick={() => updateParams({ new: "1", edit: null })}
                className="rounded-xl bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Add host
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setImportStatus("Importing ~/.ssh/config into a local environment…");
                    const config = await readSshConfigFile();
                    const result = importHostsFromSshConfig(config.contents, activeEnvironmentId === "all" ? undefined : activeEnvironmentId);
                    setImportStatus(`Imported ${result.importedCount} host${result.importedCount === 1 ? "" : "s"} from ${config.path}.`);
                    if (activeEnvironmentId === "all") {
                      setActiveEnvironmentId(result.environmentId);
                    }
                  } catch (error) {
                    setImportStatus(
                      error instanceof Error ? error.message : "Unable to import ~/.ssh/config."
                    );
                  }
                }}
                className="rounded-xl border border-cyan-400/40 px-3 py-1.5 text-sm text-cyan-100 transition hover:border-cyan-300 hover:text-white"
              >
                Import ~/.ssh/config
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveEnvironmentId("all");
                  setActiveTag("all");
                  setFavoritesOnly(false);
                  setQuery("");
                  setImportStatus(null);
                  updateParams({ focus: null });
                }}
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Reset filters
              </button>
            </div>
          </div>
          {importStatus ? (
            <p className="mt-2 text-xs text-slate-400">{importStatus}</p>
          ) : null}
        </div>

        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
          <HostFilterBar
            query={query}
            environments={environments}
            tags={tags}
            activeEnvironmentId={activeEnvironmentId}
            activeTag={activeTag}
            favoritesOnly={favoritesOnly}
            onQueryChange={setQuery}
            onEnvironmentChange={setActiveEnvironmentId}
            onTagChange={setActiveTag}
            onFavoritesToggle={() => setFavoritesOnly((current) => !current)}
          />

          <section className="rounded-[20px] border border-slate-800/80 bg-slate-950/50 p-2.5">
            <div className="flex items-center justify-between gap-3 px-2 py-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Environments
              </p>
              <span className="text-xs text-slate-500">{environmentCount} total</span>
            </div>
            <div className="mt-1 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
              {environments.map((environment) => {
                const hostCount = allHosts.filter((host) => host.environmentId === environment.id).length;
                const environmentConnectedCount = allHosts.filter(
                  (host) => host.environmentId === environment.id && connectedHostIds.has(host.id)
                ).length;

                return (
                  <button
                    key={environment.id}
                    type="button"
                    onClick={() => setActiveEnvironmentId(environment.id)}
                    className={`rounded-[16px] border px-3 py-2 text-left transition ${
                      activeEnvironmentId === environment.id
                        ? "border-emerald-400/40 bg-emerald-400/10"
                        : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">
                        {environment.label}
                      </span>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                        {formatHostEnvironmentKind(environment.kind)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {hostCount} hosts · {environmentConnectedCount} connected
                    </p>
                    {environment.description ? (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400">
                        {environment.description}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="min-h-0 flex-1">
          <HostList
            sections={environmentSections}
            hostsById={hostsById}
            connectedHostIds={connectedHostIds}
            selectedHostId={selectedHost?.id}
            onSelect={(hostId) => updateParams({ focus: hostId })}
            onConnect={launchSession}
            onEdit={(hostId) => updateParams({ edit: hostId, new: null, focus: hostId })}
            onDelete={setHostPendingDelete}
            onToggleFavorite={toggleFavorite}
            onCreateHost={() => updateParams({ new: "1", edit: null })}
            onEditEnvironment={setEditingEnvironmentId}
            onDeleteEnvironment={setEnvironmentPendingDelete}
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
              const assignedEnvironment = environments.find(
                (environment) => environment.id === host.environmentId
              );

              return (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100">
                      {formatHostProtocol(host.protocol)}
                    </span>
                    {assignedEnvironment ? (
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-100">
                        {assignedEnvironment.label}
                      </span>
                    ) : null}
                    {visibleTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <dl className="mt-3 grid gap-2.5 lg:grid-cols-3">
                    <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Identity
                      </dt>
                      <dd className="mt-1 text-sm text-slate-100">
                        {host.protocol === "ssh" ? host.keyLabel || "Not assigned yet" : formatHostAddress(host)}
                      </dd>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {describeHostRuntime(
                          host,
                          host.jumpHostId && hostsById[host.jumpHostId]
                            ? hostsById[host.jumpHostId].label
                            : undefined
                        )}
                      </p>
                    </div>
                    {hostSupportsSftp(host.protocol) ? (
                      <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                        <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          SFTP root
                        </dt>
                        <dd className="mt-1 text-sm text-slate-100">{host.sftpRoot}</dd>
                      </div>
                    ) : null}
                    <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Runtime
                      </dt>
                      <dd className="mt-1 text-sm text-slate-100">
                        {host.protocol === "ssh"
                          ? hostSupportsPortForwarding(host.protocol)
                            ? `${host.forwardingCount} forwards configured`
                            : formatHostProtocol(host.protocol)
                          : "Native shell bridge"}
                      </dd>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {environmentLines.length ? `${environmentLines.length} env vars` : "No env overrides"}
                      </p>
                    </div>
                    {hostSupportsJumpHosts(host.protocol) ? (
                      <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                        <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Jump host
                        </dt>
                        <dd className="mt-1 text-sm text-slate-100">
                          {host.jumpHostId && hostsById[host.jumpHostId]
                            ? hostsById[host.jumpHostId].label
                            : "Direct"}
                        </dd>
                      </div>
                    ) : null}
                    <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Last used
                      </dt>
                      <dd className="mt-1 text-sm text-slate-100">
                        {formatRelativeTime(host.lastConnectedAt)}
                      </dd>
                    </div>
                    {hostSupportsTrustedKeys(host.protocol) ? (
                      <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                        <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Known host
                        </dt>
                        <dd className="mt-1 text-sm text-slate-100">
                          {trustedKnownHost ? `${trustedKnownHost.algorithm} · trusted` : "Unverified"}
                        </dd>
                        {trustedKnownHost ? (
                          <p className="mt-1 text-[11px] text-slate-500">{trustedKnownHost.fingerprint}</p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-slate-500">
                          Policy:{" "}
                          {host.hostKeyPolicy === "requireTrusted"
                            ? "Trusted key required"
                            : "Unknown keys allowed"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
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
                      </div>
                    ) : (
                      <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                        <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Trust
                        </dt>
                        <dd className="mt-1 text-sm text-slate-100">No network trust required</dd>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {host.protocol === "localShell"
                            ? "Local shell sessions stay on this workstation."
                            : host.protocol === "telnet"
                              ? "Telnet sessions use the native PTY bridge and do not rely on SSH trust metadata."
                              : host.protocol === "serial"
                                ? "Serial sessions connect to a local device path and do not use network trust."
                                : `${formatHostProtocol(host.protocol)} sessions use the native bridge without separate SSH trust metadata.`}
                        </p>
                      </div>
                    )}
                  </dl>

                  <div className="mt-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                    <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Session environment
                      </p>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                        {environmentLines.length ? environmentLines.join("\n") : "No env overrides"}
                      </pre>
                    </div>

                    <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                        Operator note
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {host.note || "No note recorded for this host yet."}
                      </p>
                    </div>
                  </div>
                </>
              );
            }}
          />
        </div>
      </section>

      <HostEditor
        key={editingHost?.id ?? (creatingHost ? "new" : "closed")}
        open={creatingHost || Boolean(editingHost)}
        host={editingHost}
        environments={environments}
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

      <EnvironmentEditor
        open={creatingEnvironment || Boolean(editingEnvironment)}
        environment={editingEnvironment}
        onClose={() => {
          setCreatingEnvironment(false);
          setEditingEnvironmentId(null);
        }}
        onSave={(values) => {
          if (editingEnvironment) {
            updateEnvironment(editingEnvironment.id, values);
          } else {
            const environmentId = createEnvironment(values);
            setActiveEnvironmentId(environmentId);
          }

          setCreatingEnvironment(false);
          setEditingEnvironmentId(null);
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

      <ConfirmDialog
        open={Boolean(environmentPendingDelete)}
        title="Delete environment"
        description="This removes the named environment and leaves its hosts in the inventory as unassigned entries until you move them into another environment."
        confirmLabel="Delete environment"
        onCancel={() => setEnvironmentPendingDelete(null)}
        onConfirm={() => {
          if (!environmentPendingDelete) {
            return;
          }

          deleteEnvironment(environmentPendingDelete);
          if (activeEnvironmentId === environmentPendingDelete) {
            setActiveEnvironmentId("all");
          }
          setEnvironmentPendingDelete(null);
        }}
      />
    </>
  );
}

