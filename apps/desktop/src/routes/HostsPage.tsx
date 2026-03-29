import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHosts } from "../hooks/useHosts";
import { formatEnvironmentVariables, formatHostAddress, formatRelativeTime } from "../lib/utils";
import { useAppStore } from "../store/app-store";
import { useConnectionSecretsStore } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { HostEditor } from "../components/hosts/HostEditor";
import { HostFilterBar } from "../components/hosts/HostFilterBar";
import { HostList } from "../components/hosts/HostList";
import { ConfirmDialog } from "../components/common/ConfirmDialog";

export function HostsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeGroup, setActiveGroup] = useState("all");
  const [activeTag, setActiveTag] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hostPendingDelete, setHostPendingDelete] = useState<string | null>(null);
  const query = useAppStore((state) => state.sidebarSearch);
  const setQuery = useAppStore((state) => state.setSidebarSearch);
  const setHostSecrets = useConnectionSecretsStore((state) => state.setHostSecrets);
  const clearHostSecrets = useConnectionSecretsStore((state) => state.clearHostSecrets);
  const createHost = useHostsStore((state) => state.createHost);
  const updateHost = useHostsStore((state) => state.updateHost);
  const deleteHost = useHostsStore((state) => state.deleteHost);
  const toggleFavorite = useHostsStore((state) => state.toggleFavorite);
  const markConnected = useHostsStore((state) => state.markConnected);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const removeKnownHost = useKnownHostsStore((state) => state.removeKnownHost);
  const openSession = useSessionsStore((state) => state.openSession);
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
  const trustedKnownHost = knownHosts.find(
    (knownHost) =>
      knownHost.hostname === selectedHost?.hostname && knownHost.port === selectedHost.port
  );
  const selectedHostEnvironmentLines = selectedHost
    ? formatEnvironmentVariables(selectedHost.environment).split("\n").filter(Boolean)
    : [];

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

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-2.5">
        <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Inventory control
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold text-slate-50">Hosts, identity, and launch.</h2>
                <p className="text-[12px] text-slate-400">
                  Search updates the list and detail pane in place.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Hosts", value: allHosts.length, accent: "text-slate-50" },
                {
                  label: "Favorites",
                  value: allHosts.filter((host) => host.favorite).length,
                  accent: "text-amber-200",
                },
                { label: "Groups", value: groups.length, accent: "text-cyan-200" },
                { label: "Tags", value: tags.length, accent: "text-emerald-200" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 px-2.5 py-1.5"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {item.label}
                  </p>
                  <p className={`mt-0.5 text-base font-semibold ${item.accent}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-400">
              <span className="rounded-full border border-slate-800 bg-slate-950/70 px-2.5 py-1">
                Session and SFTP launch from the same inventory
              </span>
              <span className="rounded-full border border-slate-800 bg-slate-950/70 px-2.5 py-1">
                ⌘1 to ⌘6 keeps the workspace keyboard-first
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateParams({ new: "1", edit: null })}
                className="rounded-xl bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Add host
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveGroup("all");
                  setActiveTag("all");
                  setFavoritesOnly(false);
                  setQuery("");
                }}
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>

        <HostFilterBar
          query={query}
          groups={groups}
          tags={tags}
          activeGroup={activeGroup}
          activeTag={activeTag}
          favoritesOnly={favoritesOnly}
          onQueryChange={setQuery}
          onGroupChange={setActiveGroup}
          onTagChange={setActiveTag}
          onFavoritesToggle={() => setFavoritesOnly((current) => !current)}
        />

        <section className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1.8fr)_320px]">
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
          />

          <aside className="min-h-0 overflow-auto rounded-[20px] border border-slate-800/80 bg-slate-950/45 p-3">
          {selectedHost ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Host details
              </p>
              <h3 className="mt-1.5 text-base font-semibold text-slate-50">{selectedHost.label}</h3>
              <p className="mt-0.5 text-sm text-slate-300">{formatHostAddress(selectedHost)}</p>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {selectedHost.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => launchSession(selectedHost.id)}
                  className="rounded-xl bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
                >
                  Open session
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateParams({ edit: selectedHost.id, new: null, focus: selectedHost.id })
                  }
                  className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-white"
                >
                  Edit host
                </button>
                <button
                  type="button"
                  onClick={() => setHostPendingDelete(selectedHost.id)}
                  className="rounded-xl border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 transition hover:border-rose-400 hover:text-white"
                >
                  Delete host
                </button>
              </div>

              <dl className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Identity
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">
                    {selectedHost.keyLabel || "Not assigned yet"}
                  </dd>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {selectedHost.agentForwarding ? "SSH agent forwarded" : "Agent not forwarded"}
                  </p>
                </div>
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    SFTP root
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">{selectedHost.sftpRoot}</dd>
                </div>
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Jump host
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">
                    {selectedHost.jumpHostId && hostsById[selectedHost.jumpHostId]
                      ? hostsById[selectedHost.jumpHostId].label
                      : "Direct"}
                  </dd>
                </div>
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Last used
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">
                    {formatRelativeTime(selectedHost.lastConnectedAt)}
                  </dd>
                </div>
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Runtime
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">
                    {selectedHostEnvironmentLines.length
                      ? `${selectedHostEnvironmentLines.length} env vars`
                      : "No env overrides"}
                  </dd>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {selectedHost.agentForwarding ? "Agent forwarding enabled" : "Direct credentials only"}
                  </p>
                </div>
                <div className="rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Known host
                  </dt>
                  <dd className="mt-1 text-sm text-slate-100">
                    {trustedKnownHost
                      ? `${trustedKnownHost.algorithm} · trusted`
                      : "Unverified"}
                  </dd>
                  {trustedKnownHost ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {trustedKnownHost.fingerprint}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-500">
                    Policy:{" "}
                    {selectedHost.hostKeyPolicy === "requireTrusted"
                      ? "Trusted key required"
                      : "Unknown keys allowed"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/keys?scanHost=${encodeURIComponent(selectedHost.id)}&autoScan=1`
                        )
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
              </dl>

              {selectedHostEnvironmentLines.length ? (
                <div className="mt-3 rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Session environment
                  </p>
                  <pre className="mt-2 overflow-auto rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] leading-5 text-cyan-100">
                    {selectedHostEnvironmentLines.slice(0, 6).join("\n")}
                  </pre>
                </div>
              ) : null}

              <div className="mt-3 rounded-[16px] border border-slate-800 bg-slate-900/50 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Practical parity
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-300">
                  <li>Host CRUD is implemented with local persistence.</li>
                  <li>Search covers labels, hostnames, users, groups, tags, notes, and key labels.</li>
                  <li>Favorites, groups, and tag filters are live in both sidebar and main workspace.</li>
                </ul>
              </div>

              <p className="mt-3 text-sm leading-5 text-slate-400">{selectedHost.note}</p>
            </>
          ) : (
            <div className="rounded-[16px] border border-dashed border-slate-700/80 bg-slate-950/40 p-5 text-sm leading-5 text-slate-400">
              Add your first host to start building a usable local inventory.
            </div>
          )}
          </aside>
        </section>
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
    </>
  );
}
