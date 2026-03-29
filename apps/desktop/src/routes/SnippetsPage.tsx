import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { SearchInput } from "../components/common/SearchInput";
import { SnippetEditor } from "../components/snippets/SnippetEditor";
import { SnippetList } from "../components/snippets/SnippetList";
import { buildBackendConnection } from "../lib/connections";
import { ensureRuntimeSecrets } from "../lib/runtime-secrets";
import { executeSnippetOnHosts, type SnippetExecutionResult } from "../lib/api";
import { formatRelativeTime } from "../lib/utils";
import { useHostsStore } from "../store/hosts-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { emptySnippetFormValues, type SnippetRecord } from "../types/snippet";

export function SnippetsPage() {
  const navigate = useNavigate();
  const hosts = useHostsStore((state) => state.hosts);
  const markConnected = useHostsStore((state) => state.markConnected);
  const setSnippetCounts = useHostsStore((state) => state.setSnippetCounts);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const activeTabId = useSessionsStore((state) => state.activeTabId);
  const tabs = useSessionsStore((state) => state.tabs);
  const panes = useSessionsStore((state) => state.panes);
  const queuePaneCommand = useSessionsStore((state) => state.queuePaneCommand);
  const snippets = useSnippetsStore((state) => state.snippets);
  const createSnippet = useSnippetsStore((state) => state.createSnippet);
  const updateSnippet = useSnippetsStore((state) => state.updateSnippet);
  const deleteSnippet = useSnippetsStore((state) => state.deleteSnippet);
  const duplicateSnippet = useSnippetsStore((state) => state.duplicateSnippet);
  const markSnippetRun = useSnippetsStore((state) => state.markSnippetRun);
  const [query, setQuery] = useState("");
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>();
  const [editorTarget, setEditorTarget] = useState<SnippetRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deletePendingId, setDeletePendingId] = useState<string>();
  const [selectedHostIdsOverride, setSelectedHostIdsOverride] = useState<string[] | null>(null);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastResults, setBroadcastResults] = useState<SnippetExecutionResult[]>([]);

  const hostsById = useMemo(
    () => Object.fromEntries(hosts.map((host) => [host.id, host])),
    [hosts]
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activePane = activeTab ? panes[activeTab.activePaneId] : undefined;

  const filteredSnippets = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return snippets;
    }

    return snippets.filter((snippet) =>
      [snippet.title, snippet.description, snippet.command, snippet.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(trimmedQuery)
    );
  }, [query, snippets]);

  const selectedSnippet =
    filteredSnippets.find((snippet) => snippet.id === selectedSnippetId) ??
    snippets.find((snippet) => snippet.id === selectedSnippetId) ??
    filteredSnippets[0] ??
    snippets[0];
  const selectedHostIds = selectedHostIdsOverride ?? selectedSnippet?.targetHostIds ?? [];

  useEffect(() => {
    const counts = snippets.reduce<Record<string, number>>((result, snippet) => {
      snippet.targetHostIds.forEach((hostId) => {
        result[hostId] = (result[hostId] ?? 0) + 1;
      });
      return result;
    }, {});

    setSnippetCounts(counts);
  }, [setSnippetCounts, snippets]);
  const runInActivePane = () => {
    if (!selectedSnippet || !activePane) {
      return;
    }

    queuePaneCommand(activePane.id, selectedSnippet.command, selectedSnippet.title);
    markSnippetRun(selectedSnippet.id);
    markConnected(activePane.hostId);
    navigate(activeTabId ? `/sessions?tabId=${activeTabId}` : "/sessions");
  };

  const broadcastToHosts = async () => {
    if (!selectedSnippet || !selectedHostIds.length) {
      return;
    }

    const targetHosts = hosts.filter((host) => selectedHostIds.includes(host.id));
    setBroadcastBusy(true);

    try {
      const preparedTargets = [];

      for (const host of targetHosts) {
        const readyForConnection = await ensureRuntimeSecrets(host, "Run snippet");
        if (!readyForConnection) {
          return;
        }

        preparedTargets.push({
          id: host.id,
          label: host.label,
          host: buildBackendConnection(host, knownHosts),
        });
      }

      const result = await executeSnippetOnHosts(
        selectedSnippet.command,
        preparedTargets
      );

      targetHosts.forEach((host) => markConnected(host.id));
      setBroadcastResults(result.results);
      markSnippetRun(selectedSnippet.id);
    } finally {
      setBroadcastBusy(false);
    }
  };

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Snippet library
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-50">
                Save commands once, inject them into the active pane, or broadcast across hosts.
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditorTarget(null);
                  setEditorOpen(true);
                }}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                New snippet
              </button>
              <button
                type="button"
                disabled={!selectedSnippet}
                onClick={() => {
                  if (!selectedSnippet) {
                    return;
                  }

                  const snippetId = duplicateSnippet(selectedSnippet.id);
                  setSelectedSnippetId(snippetId);
                }}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Duplicate
              </button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-3">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search snippets, tags, descriptions, or commands"
              />
            </div>

            <SnippetList
              snippets={filteredSnippets}
              hostsById={hostsById}
              selectedSnippetId={selectedSnippet?.id}
              onSelect={(snippetId) => {
                setSelectedSnippetId(snippetId);
                setSelectedHostIdsOverride(null);
              }}
              onDuplicate={(snippetId) => {
                setSelectedHostIdsOverride(null);
                setSelectedSnippetId(duplicateSnippet(snippetId));
              }}
              onDelete={setDeletePendingId}
            />
          </div>

          <aside className="min-h-0 overflow-auto rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-3">
            {selectedSnippet ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Snippet details
                    </p>
                    <h3 className="mt-1.5 truncate text-lg font-semibold text-slate-50">
                      {selectedSnippet.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-400">{selectedSnippet.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditorTarget(selectedSnippet);
                      setEditorOpen(true);
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
                  >
                    Edit
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedSnippet.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] text-slate-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-3 rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Command</p>
                    <p className="text-[11px] text-slate-500">
                      Last run {formatRelativeTime(selectedSnippet.lastRunAt)}
                    </p>
                  </div>
                  <pre className="mt-2 overflow-auto rounded-[14px] bg-slate-950/80 p-3 text-xs leading-5 text-emerald-200">
                    <code>{selectedSnippet.command}</code>
                  </pre>
                </div>

                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    disabled={!activePane}
                    onClick={runInActivePane}
                    className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Run in active pane
                  </button>
                  <button
                    type="button"
                    disabled={!selectedHostIds.length}
                    onClick={() => void broadcastToHosts()}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {broadcastBusy ? "Broadcasting…" : "Broadcast to selected hosts"}
                  </button>
                </div>

                <div className="mt-3 rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Targets</p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedHostIdsOverride(selectedSnippet.targetHostIds)}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                      >
                        Defaults
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedHostIdsOverride(
                            selectedHostIds.length === hosts.length ? [] : hosts.map((host) => host.id)
                          )
                        }
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                      >
                        {selectedHostIds.length === hosts.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 max-h-[320px] space-y-1.5 overflow-auto pr-1">
                    {hosts.map((host) => {
                      const selected = selectedHostIds.includes(host.id);

                      return (
                        <label
                          key={host.id}
                          className={`flex items-start gap-3 rounded-[14px] border px-3 py-2 text-sm transition ${
                            selected
                              ? "border-emerald-400/40 bg-emerald-400/10"
                              : "border-slate-800 bg-slate-950/70"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setSelectedHostIdsOverride((current) => {
                                const resolvedCurrent = current ?? selectedSnippet.targetHostIds;

                                return selected
                                  ? resolvedCurrent.filter((entry) => entry !== host.id)
                                  : [...resolvedCurrent, host.id];
                              })
                            }
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-100">
                              {host.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                              {host.username}@{host.hostname}:{host.port}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Last broadcast
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {broadcastResults.length ? (
                      broadcastResults.map((result) => (
                        <div
                          key={`${result.targetId}-${result.exitCode ?? "error"}`}
                          className={`rounded-[14px] border px-3 py-2 ${
                            result.ok
                              ? "border-emerald-400/40 bg-emerald-400/10"
                              : "border-rose-500/40 bg-rose-500/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-medium text-slate-100">
                              {result.label}
                            </p>
                            <span className="text-[11px] text-slate-400">
                              {result.ok ? "ok" : `exit ${result.exitCode ?? "?"}`}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-5 text-slate-400">
                            {(result.stdout || result.stderr || result.errorMessage || "No output")
                              .trim()
                              .slice(0, 160) || "No output"}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">
                        Broadcast results appear here after a multi-host execution run.
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-[18px] border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-500">
                Select a snippet to inspect its command and target hosts.
              </div>
            )}
          </aside>
        </div>
      </section>

      <SnippetEditor
        key={editorTarget?.id ?? (editorOpen ? "new" : "closed")}
        open={editorOpen}
        snippet={editorTarget ?? undefined}
        hosts={hosts}
        onClose={() => {
          setEditorOpen(false);
          setEditorTarget(null);
        }}
        onSave={(values) => {
          const snippetId = editorTarget
            ? updateSnippet(editorTarget.id, values)
            : createSnippet({ ...emptySnippetFormValues, ...values });
          setSelectedSnippetId(snippetId);
          setSelectedHostIdsOverride(null);
          setEditorOpen(false);
          setEditorTarget(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deletePendingId)}
        title="Delete snippet"
        description="Delete this saved command from the local snippet library?"
        confirmLabel="Delete"
        onCancel={() => setDeletePendingId(undefined)}
        onConfirm={() => {
          if (!deletePendingId) {
            return;
          }

          deleteSnippet(deletePendingId);
          if (selectedSnippet?.id === deletePendingId) {
            setSelectedSnippetId(undefined);
          }
          setSelectedHostIdsOverride(null);
          setDeletePendingId(undefined);
        }}
      />
    </>
  );
}
