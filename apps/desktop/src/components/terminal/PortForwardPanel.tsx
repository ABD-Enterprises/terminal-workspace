import { useCallback, useEffect, useState } from "react";
import { createLocalForward, deleteLocalForward, listLocalForwards } from "../../lib/api";
import type { PortForwardRecord } from "../../types/forward";

interface PortForwardPanelProps {
  sessionId?: string;
  disabled?: boolean;
}

export function PortForwardPanel({ sessionId, disabled = false }: PortForwardPanelProps) {
  const [direction, setDirection] = useState<"local" | "remote">("local");
  const [localHost, setLocalHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState("15432");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("5432");
  const [forwards, setForwards] = useState<PortForwardRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const loadForwards = useCallback(async () => {
    if (!sessionId) {
      setForwards([]);
      return;
    }

    try {
      const result = await listLocalForwards(sessionId);
      setForwards(result.forwards);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId]);

  useEffect(() => {
    void loadForwards();
  }, [loadForwards]);

  const createForward = async () => {
    if (!sessionId) {
      return;
    }

    setBusy(true);
    try {
      await createLocalForward({
        direction,
        localHost,
        localPort: Number.parseInt(localPort, 10),
        remoteHost,
        remotePort: Number.parseInt(remotePort, 10),
        sessionId,
      });
      await loadForwards();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Port forwards</p>
        <button
          type="button"
          onClick={() => void loadForwards()}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-3 rounded-[14px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <select
          value={direction}
          onChange={(event) => setDirection(event.target.value as "local" | "remote")}
          disabled={disabled || !sessionId}
          className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
        >
          <option value="local">Local forward</option>
          <option value="remote">Remote forward</option>
        </select>
        <input
          value={localHost}
          onChange={(event) => setLocalHost(event.target.value)}
          placeholder={direction === "local" ? "Local bind host" : "Local destination host"}
          disabled={disabled || !sessionId}
          className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <input
          value={localPort}
          onChange={(event) => setLocalPort(event.target.value)}
          placeholder={direction === "local" ? "Local bind port" : "Local destination port"}
          disabled={disabled || !sessionId}
          className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <input
          value={remoteHost}
          onChange={(event) => setRemoteHost(event.target.value)}
          placeholder={direction === "local" ? "Remote destination host" : "Remote bind host"}
          disabled={disabled || !sessionId}
          className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <input
          value={remotePort}
          onChange={(event) => setRemotePort(event.target.value)}
          placeholder={direction === "local" ? "Remote destination port" : "Remote bind port"}
          disabled={disabled || !sessionId}
          className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        />
      </div>

      <button
        type="button"
        disabled={busy || disabled || !sessionId}
        onClick={() => void createForward()}
        className="mt-2.5 w-full rounded-lg bg-emerald-400 px-4 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Creating…"
          : direction === "local"
            ? "Create local forward"
            : "Create remote forward"}
      </button>

      <div className="mt-2.5 space-y-1.5">
        {forwards.length ? (
          forwards.map((forward) => (
            <div
              key={forward.id}
              className="flex items-center justify-between gap-3 rounded-[14px] border border-slate-800 bg-slate-950/70 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">
                  {forward.direction === "local"
                    ? `${forward.localHost}:${forward.localPort}`
                    : `${forward.remoteHost}:${forward.remotePort}`}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {forward.direction === "local"
                    ? `${forward.remoteHost}:${forward.remotePort}`
                    : `${forward.localHost}:${forward.localPort}`}
                </p>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                {forward.direction}
              </span>
              <button
                type="button"
                onClick={() => void deleteLocalForward(forward.id).then(loadForwards)}
                className="rounded-lg border border-rose-500/40 px-3 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
              >
                Stop
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">
            {sessionId
              ? "No active forwards for this session."
              : "Reconnect the session before creating forwards."}
          </p>
        )}
      </div>
    </div>
  );
}
