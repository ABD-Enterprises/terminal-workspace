import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TerminalWorkspace } from "../components/terminal/TerminalWorkspace";
import { formatHostProtocol } from "../types/host";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";

export function SessionsPage() {
  const [searchParams] = useSearchParams();
  const [historyQuery, setHistoryQuery] = useState("");
  const hostId = searchParams.get("hostId");
  const tabId = searchParams.get("tabId");
  const hosts = useHostsStore((state) => state.hosts);
  const selectedHost = useHostsStore((state) =>
    state.hosts.find((host) => host.id === hostId)
  );
  const selectTab = useSessionsStore((state) => state.selectTab);
  const tabCount = useSessionsStore((state) => state.tabs.length);
  const commandHistory = useSessionsStore((state) => state.commandHistory);
  const clearCommandHistory = useSessionsStore((state) => state.clearCommandHistory);
  const queueCommandForHosts = useSessionsStore((state) => state.queueCommandForHosts);
  const activePaneCount = useSessionsStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return activeTab?.paneIds.length ?? 0;
  });
  const hostMap = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  const filteredHistory = useMemo(() => {
    const normalizedQuery = historyQuery.trim().toLowerCase();
    return commandHistory
      .filter((entry) => {
        if (!normalizedQuery) {
          return true;
        }

        const host = hostMap.get(entry.hostId);
        return [
          entry.command,
          entry.outputPreview ?? "",
          host?.label ?? "",
          host?.hostname ?? "",
          host ? formatHostProtocol(host.protocol) : "",
          entry.transport,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [commandHistory, historyQuery, hostMap]);

  useEffect(() => {
    if (tabId) {
      selectTab(tabId);
    }
  }, [selectTab, tabId]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2.5">
      {tabCount ? (
        <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-slate-400">
              {tabCount} tab{tabCount === 1 ? "" : "s"} active • {activePaneCount} pane{activePaneCount === 1 ? "" : "s"} in focus
            </p>
          </div>
        </div>
      ) : null}
      <div className="rounded-[24px] border border-slate-800/80 bg-slate-950/45 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-100">Command history</p>
            <p className="text-xs text-slate-500">
              App-dispatched commands persist across relaunch and can be replayed into their saved host sessions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">
              {filteredHistory.length} shown{filteredHistory.length !== commandHistory.length
                ? ` of ${commandHistory.length}`
                : ""}
            </span>
            <input
              type="search"
              aria-label="Search command history"
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search host, protocol, or command"
              className="w-full min-w-[240px] rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/60"
            />
            <button
              type="button"
              onClick={() => clearCommandHistory()}
              disabled={commandHistory.length === 0}
              className="rounded-2xl border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {filteredHistory.length ? (
            filteredHistory.map((entry) => {
              const historyHost = hostMap.get(entry.hostId);

              return (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[20px] border border-slate-800/80 bg-slate-950/75 px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{historyHost?.label ?? "Unknown host"}</span>
                      <span>•</span>
                      <span>{historyHost ? formatHostProtocol(historyHost.protocol) : entry.transport}</span>
                      <span>•</span>
                      <span>
                        {new Date(entry.createdAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p
                      title={entry.command}
                      className="mt-1 truncate font-mono text-sm text-emerald-100"
                    >
                      {entry.command}
                    </p>
                    {entry.outputPreview ? (
                      <p
                        title={entry.outputPreview}
                        className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-2xl border border-slate-800/80 bg-slate-900/70 px-3 py-2 font-mono text-xs text-slate-300"
                      >
                        {entry.outputPreview}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={!historyHost}
                    aria-label={
                      historyHost
                        ? `Run saved command again on ${historyHost.label}`
                        : "Run saved command again"
                    }
                    onClick={() => {
                      if (historyHost) {
                        queueCommandForHosts([historyHost], entry.command, "Replay history command");
                      }
                    }}
                    className="rounded-2xl border border-emerald-400/30 px-3 py-2 text-xs text-emerald-100 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
                  >
                    Run again
                  </button>
                </div>
              );
            })
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-800 bg-slate-950/65 px-3 py-4 text-sm text-slate-500">
              {commandHistory.length
                ? "No saved commands matched this search."
                : "No saved commands yet. Commands launched from snippets, broadcasts, and other app-driven flows will show up here."}
            </div>
          )}
        </div>
      </div>
      <TerminalWorkspace launchHost={selectedHost} />
    </section>
  );
}
