import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileBrowser } from "../components/sftp/FileBrowser";
import { formatHostAddress } from "../lib/utils";
import { TransferQueue } from "../components/sftp/TransferQueue";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useTransfersStore } from "../store/transfers-store";

export function TransfersPage() {
  const navigate = useNavigate();
  const hosts = useHostsStore((state) => state.hosts.filter((host) => host.protocol === "ssh"));
  const markConnected = useHostsStore((state) => state.markConnected);
  const openSession = useSessionsStore((state) => state.openSession);
  const activeHostId = useTransfersStore((state) => state.activeHostId);
  const setActiveHost = useTransfersStore((state) => state.setActiveHost);
  const queue = useTransfersStore((state) => state.queue);
  const clearCompleted = useTransfersStore((state) => state.clearCompleted);
  const activeHost = hosts.find((host) => host.id === activeHostId) ?? hosts[0];

  useEffect(() => {
    if (!activeHostId && hosts[0]) {
      setActiveHost(hosts[0].id);
    }
  }, [activeHostId, hosts, setActiveHost]);

  if (!activeHost) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center rounded-[24px] border border-dashed border-slate-700/80 bg-slate-950/40 px-6 py-12 text-sm text-slate-400">
        Add a host with SSH credentials to start browsing remote files.
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Active host
            </span>
            <select
              value={activeHost.id}
              onChange={(event) => setActiveHost(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            >
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label}
                </option>
              ))}
            </select>
          </label>

          <div className="min-w-0 rounded-[18px] border border-slate-800 bg-slate-950/60 px-3.5 py-3">
            <p className="truncate text-sm font-medium text-slate-100">{activeHost.label}</p>
            <p className="mt-1 truncate text-xs text-slate-400">
              {formatHostAddress(activeHost)}
            </p>
            <p className="mt-2 truncate text-[11px] text-slate-500">
              Root {activeHost.sftpRoot} • Auth {activeHost.authMethod}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => {
                markConnected(activeHost.id);
                const tabId = openSession(activeHost);
                navigate(`/sessions?tabId=${tabId}`);
              }}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
            >
              Open terminal
            </button>
            <button
              type="button"
              onClick={() => navigate(`/hosts?focus=${activeHost.id}&edit=${activeHost.id}`)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Edit host
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1">
          <FileBrowser host={activeHost} />
        </div>
        <div className="min-h-[220px] max-h-[300px]">
          <TransferQueue items={queue} onClearCompleted={clearCompleted} />
        </div>
      </div>
    </section>
  );
}
