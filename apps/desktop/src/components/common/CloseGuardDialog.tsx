// UX-3: confirmation surface for the close guards in close-guard-store.
// Rendered once in AppShell; it reads the pending-decision state and shows a
// ConfirmDialog describing exactly which sessions still have transfers moving.

import { useHostsStore } from "../../store/hosts-store";
import { useCloseGuardStore } from "../../store/close-guard-store";
import { useSessionsStore } from "../../store/sessions-store";
import { countActiveTransfers, useTransfersStore } from "../../store/transfers-store";
import { ConfirmDialog } from "./ConfirmDialog";

export function CloseGuardDialog() {
  const pendingTabIds = useCloseGuardStore((state) => state.pendingTabIds);
  const windowClosePending = useCloseGuardStore((state) => state.windowClosePending);
  const confirmTabClose = useCloseGuardStore((state) => state.confirmTabClose);
  const cancelTabClose = useCloseGuardStore((state) => state.cancelTabClose);
  const confirmWindowClose = useCloseGuardStore((state) => state.confirmWindowClose);
  const cancelWindowClose = useCloseGuardStore((state) => state.cancelWindowClose);
  const tabs = useSessionsStore((state) => state.tabs);
  const hosts = useHostsStore((state) => state.hosts);
  const queue = useTransfersStore((state) => state.queue);

  const hostLabel = (hostId: string) =>
    hosts.find((host) => host.id === hostId)?.label ?? "a host";

  if (windowClosePending) {
    const activeCount = countActiveTransfers(queue);
    return (
      <ConfirmDialog
        open
        title="Close window with active transfers?"
        description={
          activeCount === 1
            ? "One file transfer is still in progress. Closing the window now leaves a partial file behind. Transfers cannot resume after the window closes."
            : `${activeCount} file transfers are still in progress. Closing the window now leaves partial files behind. Transfers cannot resume after the window closes.`
        }
        confirmLabel="Close window"
        onCancel={cancelWindowClose}
        onConfirm={confirmWindowClose}
      />
    );
  }

  if (pendingTabIds.length === 0) {
    return null;
  }

  const pendingTabs = pendingTabIds
    .map((tabId) => tabs.find((tab) => tab.id === tabId))
    .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
  const described = pendingTabs
    .map((tab) => {
      const activeCount = countActiveTransfers(queue, tab.hostId);
      const label = hostLabel(tab.hostId);
      return activeCount === 1
        ? `${label} (1 transfer)`
        : `${label} (${activeCount} transfers)`;
    })
    .join(", ");

  return (
    <ConfirmDialog
      open
      title={
        pendingTabIds.length === 1
          ? "Close session with active transfers?"
          : `Close ${pendingTabIds.length} sessions with active transfers?`
      }
      description={`${described} still in progress. Closing now leaves partial files behind. Transfers cannot resume after the session closes.`}
      confirmLabel="Close anyway"
      onCancel={cancelTabClose}
      onConfirm={confirmTabClose}
    />
  );
}
