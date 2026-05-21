// Aggregated view of every active port-forward across all sessions. T14.
//
// Termius has a dedicated Tunnels surface; we previously hid port
// forwards inside the right rail of the session workspace, so users
// couldn't see what was forwarded across the whole vault. This route
// iterates the active sessions (via sessions-store) and asks the
// backend for the forwards on each. Stopping a forward calls the
// existing deleteLocalForward API.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteLocalForward, listLocalForwards } from "../lib/api";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import type { PortForwardRecord } from "../types/forward";

interface ForwardRow {
  forward: PortForwardRecord;
  hostLabel: string;
  hostId: string | undefined;
}

export function TunnelsPage() {
  const hosts = useHostsStore((state) => state.hosts);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const [rows, setRows] = useState<ForwardRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Sessions that have a non-empty backendSessionId are the candidates
  // for forward enumeration. Group by host so we can label rows even
  // if a session tab is later closed.
  const activeSessions = useMemo(() => {
    const seen = new Set<string>();
    const out: { sessionId: string; hostId: string }[] = [];
    for (const tab of sessionTabs) {
      const pane = sessionPanes[tab.activePaneId];
      if (!pane || !pane.backendSessionId) {
        continue;
      }
      if (seen.has(pane.backendSessionId)) {
        continue;
      }
      seen.add(pane.backendSessionId);
      out.push({ sessionId: pane.backendSessionId, hostId: tab.hostId });
    }
    return out;
  }, [sessionPanes, sessionTabs]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErrorMessage(undefined);
    try {
      const next: ForwardRow[] = [];
      for (const { sessionId, hostId } of activeSessions) {
        try {
          const result = await listLocalForwards(sessionId);
          const host = hosts.find((entry) => entry.id === hostId);
          for (const forward of result.forwards) {
            next.push({
              forward,
              hostId,
              hostLabel: host?.label ?? "Unknown host",
            });
          }
        } catch {
          // Skip individual session failures so one bad session
          // doesn't blank the whole page.
        }
      }
      setRows(next);
    } finally {
      setBusy(false);
    }
  }, [activeSessions, hosts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleStop = async (forwardId: string) => {
    try {
      await deleteLocalForward(forwardId);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3"
      aria-label="Active port forwards"
    >
      <header className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-50">Tunnels</h1>
            <p className="text-sm text-slate-400">
              {rows.length} active forward{rows.length === 1 ? "" : "s"} across {activeSessions.length} session
              {activeSessions.length === 1 ? "" : "s"}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
        >
          {errorMessage}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-700/80 bg-slate-950/40 px-6 py-10 text-center">
          <h2 className="text-base font-semibold text-slate-100">No active tunnels</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
            Port forwarding lives on a host. Open a host in{" "}
            <Link to="/sessions" className="text-emerald-300 underline-offset-2 hover:underline">
              Sessions
            </Link>{" "}
            and use the Port Forward panel in the right rail to add one.
          </p>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/55">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_180px_180px_100px] gap-3 border-b border-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <span>Host</span>
            <span>Direction</span>
            <span>Local</span>
            <span>Remote</span>
            <span className="text-right">Manage</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {rows.map(({ forward, hostLabel }) => (
              <div
                key={forward.id}
                className="grid grid-cols-[minmax(0,1fr)_120px_180px_180px_100px] gap-3 border-b border-slate-900/80 px-3 py-2 text-sm text-slate-200"
                data-testid="tunnel-row"
              >
                <span className="truncate font-medium text-slate-100">{hostLabel}</span>
                <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {forward.direction}
                </span>
                <span className="font-mono text-[12px] text-slate-300">
                  {forward.localHost}:{forward.localPort}
                </span>
                <span className="font-mono text-[12px] text-slate-300">
                  {forward.remoteHost}:{forward.remotePort}
                </span>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => void handleStop(forward.id)}
                    className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
                  >
                    Stop
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
