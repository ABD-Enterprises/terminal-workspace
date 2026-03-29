import { useEffect, useRef } from "react";
import { createBackendSession } from "../../lib/api";
import { buildBackendConnectionFromKnownHost, findKnownHostMatch } from "../../lib/connections";
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
    const inactiveTabIds = new Set(
      tabs.filter((tab) => tab.id !== activeTabId).map((tab) => tab.id)
    );

    Object.values(panes)
      .filter(
        (pane) =>
          pane.transport === "ssh" &&
          pane.reconnectOnRestore &&
          pane.connectionState !== "error" &&
          !pane.backendSessionId &&
          tabs.some((tab) => tab.paneIds.includes(pane.id) && inactiveTabIds.has(tab.id))
      )
      .forEach((pane) => {
        const host = hosts.find((entry) => entry.id === pane.hostId);
        if (!host || host.authMethod === "none") {
          return;
        }

        if (!canRestoreSessionWithoutPrompt(host)) {
          if (pane.connectionState !== "pendingSecrets") {
            setPaneState(pane.id, "pendingSecrets");
          }
          return;
        }

        if (restoringPaneIdsRef.current.has(pane.id)) {
          return;
        }

        const trustedKnownHost = findKnownHostMatch(knownHosts, host);

        try {
          restoringPaneIdsRef.current.add(pane.id);
          setPaneTransport(pane.id, "ssh");
          setPaneState(pane.id, "connecting");
          void createBackendSession(
            buildBackendConnectionFromKnownHost(
              host,
              trustedKnownHost ? { publicKey: trustedKnownHost.publicKey } : undefined
            )
          )
            .then(({ sessionId }) => {
              setPaneBackendSession(pane.id, sessionId);
            })
            .catch(() => {
              setPaneBackendSession(pane.id, undefined);
              setPaneState(pane.id, "error");
            })
            .finally(() => {
              restoringPaneIdsRef.current.delete(pane.id);
            });
        } catch {
          restoringPaneIdsRef.current.delete(pane.id);
          setPaneBackendSession(pane.id, undefined);
          setPaneState(pane.id, "error");
        }
      });
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

  return null;
}
