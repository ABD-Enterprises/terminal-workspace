import { useEffect, useRef } from "react";
import { createBackendSession } from "../../lib/api";
import { buildBackendConnection } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt } from "../../lib/runtime-secrets";
import { useConnectionSecretsStore } from "../../store/connection-secrets-store";
import { useHostsStore } from "../../store/hosts-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useSessionsStore } from "../../store/sessions-store";

export function SessionRestoreManager() {
  const restoringPaneIdsRef = useRef(new Set<string>());
  const tabs = useSessionsStore((state) => state.tabs);
  const panes = useSessionsStore((state) => state.panes);
  const activeTabId = useSessionsStore((state) => state.activeTabId);
  const setPaneState = useSessionsStore((state) => state.setPaneState);
  const setPaneTransport = useSessionsStore((state) => state.setPaneTransport);
  const setPaneBackendSession = useSessionsStore((state) => state.setPaneBackendSession);
  const hosts = useHostsStore((state) => state.hosts);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const secretsByHostId = useConnectionSecretsStore((state) => state.secretsByHostId);

  useEffect(() => {
    let cancelled = false;
    const inactiveTabIds = new Set(
      tabs.filter((tab) => tab.id !== activeTabId).map((tab) => tab.id)
    );

    const restoreInactiveSessions = async () => {
      const restoreCandidates = Object.values(panes).filter(
        (pane) =>
          pane.transport === "ssh" &&
          pane.reconnectOnRestore &&
          pane.connectionState !== "error" &&
          !pane.backendSessionId &&
          tabs.some((tab) => tab.paneIds.includes(pane.id) && inactiveTabIds.has(tab.id))
      );

      for (const pane of restoreCandidates) {
        const host = hosts.find((entry) => entry.id === pane.hostId);
        if (!host || host.authMethod === "none") {
          continue;
        }

        const canRestore = await canRestoreSessionWithoutPrompt(host);
        if (cancelled) {
          return;
        }

        if (!canRestore) {
          if (pane.connectionState !== "pendingSecrets") {
            setPaneState(pane.id, "pendingSecrets");
          }
          continue;
        }

        if (restoringPaneIdsRef.current.has(pane.id)) {
          continue;
        }


        try {
          restoringPaneIdsRef.current.add(pane.id);
          setPaneTransport(pane.id, "ssh");
          setPaneState(pane.id, "connecting");
          void createBackendSession(
            // #489: the whole approved-key inventory, so a jump hop gets its
            // own approval too. Passing only the target's approval made a
            // re-approved jump host fall back to its stale pin on restore.
            buildBackendConnection(host, knownHosts)
          )
            .then(({ sessionId }) => {
              setPaneBackendSession(pane.id, sessionId);
            })
            .catch((error) => {
              setPaneBackendSession(pane.id, undefined);
              const message = error instanceof Error ? error.message : String(error);
              setPaneState(pane.id, "error", message);
            })
            .finally(() => {
              restoringPaneIdsRef.current.delete(pane.id);
            });
        } catch (error) {
          restoringPaneIdsRef.current.delete(pane.id);
          setPaneBackendSession(pane.id, undefined);
          const message = error instanceof Error ? error.message : String(error);
          setPaneState(pane.id, "error", message);
        }
      }
    };

    void restoreInactiveSessions();

    return () => {
      cancelled = true;
    };
  }, [
    activeTabId,
    hosts,
    knownHosts,
    panes,
    secretsByHostId,
    setPaneBackendSession,
    setPaneState,
    setPaneTransport,
    tabs,
  ]);

  // Pending credentials are requested only by the pane's explicit Resume
  // action. Merely restoring or selecting a tab must not open a native prompt.
  return null;
}
