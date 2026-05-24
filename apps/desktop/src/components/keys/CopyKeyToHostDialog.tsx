// T12: ssh-copy-id dialog. Pick an SSH-protocol host, confirm, and
// the API endpoint runs the equivalent of:
//   mkdir -p ~/.ssh && chmod 700 ~/.ssh
//   && cat >> ~/.ssh/authorized_keys
//   && chmod 600 ~/.ssh/authorized_keys
// over the existing exec channel.

import { useState } from "react";
import type { HostRecord } from "../../types/host";
import type { KeyRecord } from "../../types/key";
import { Modal } from "../common/Modal";

interface CopyKeyToHostDialogProps {
  open: boolean;
  keyRecord: KeyRecord | undefined;
  hosts: HostRecord[];
  busy: boolean;
  errorMessage?: string;
  successMessage?: string;
  onCancel: () => void;
  onConfirm: (hostId: string) => void;
}

export function CopyKeyToHostDialog({
  open,
  keyRecord,
  hosts,
  busy,
  errorMessage,
  successMessage,
  onCancel,
  onConfirm,
}: CopyKeyToHostDialogProps) {
  const sshHosts = hosts.filter((host) => host.protocol === "ssh");
  const [selectedHostId, setSelectedHostId] = useState<string>(
    () => sshHosts[0]?.id ?? "",
  );

  // Reset the selection to the first SSH host whenever the dialog transitions
  // from closed -> open. Uses the "Adjusting state during render" pattern from
  // the React docs (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // instead of a useEffect to avoid the cascading-render lint warning.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSelectedHostId(sshHosts[0]?.id ?? "");
    }
  }

  if (!keyRecord) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={`Copy "${keyRecord.label}" to a host`}
      description="Installs the public key into ~/.ssh/authorized_keys on the target. Only SSH hosts are eligible."
      onClose={onCancel}
      className="max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selectedHostId)}
            disabled={busy || !selectedHostId}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Copying…" : "Copy key"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Public key path
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-slate-100">
            {keyRecord.publicKeyPath || `${keyRecord.privateKeyPath}.pub`}
          </p>
        </div>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Target host
          </span>
          {sshHosts.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-3 py-3 text-xs text-slate-400">
              No SSH hosts in the inventory. Add one before installing this key.
            </p>
          ) : (
            <select
              aria-label="Target host"
              value={selectedHostId}
              onChange={(event) => setSelectedHostId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            >
              {sshHosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label} — {host.username}@{host.hostname}:{host.port}
                </option>
              ))}
            </select>
          )}
        </label>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
          >
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div
            role="status"
            className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100"
          >
            {successMessage}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
