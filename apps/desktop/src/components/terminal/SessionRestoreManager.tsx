import { useEffect, useRef } from "react";
import { createBackendSession } from "../../lib/api";
import { buildBackendConnectionFromKnownHost, findKnownHostMatch } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
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

        const trustedKnownHost = findKnownHostMatch(knownHosts, host);

        try {
          restoringPaneIdsRef.current.add(pane.id);
          setPaneTransport(pane.id, "ssh");
          setPaneState(pane.id, "connecting");
          void createBackendSession(
            buildBackendConnectionFromKnownHost(
              host,
              trustedKnownHost
                ? {
                    algorithm: trustedKnownHost.algorithm,
                    publicKey: trustedKnownHost.publicKey,
                  }
                : undefined
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

  // When the user activates a tab whose pane is sitting in `pendingSecrets`
  // (set by the inactive-restore loop above when a passphrase was missing),
  // proactively open the secrets prompt instead of leaving the badge cyan and
  // silent. Closes the gap called out in
  // internal/parity-and-hardening-review.md §4.3 — "the tab just sits there cyan
  // and frozen". The actual reconnect happens on the next inactive-restore
  // tick once the secrets store is hydrated.
  const promptedPaneIdsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) {
      return;
    }
    const activePane = panes[activeTab.activePaneId];
    if (!activePane || activePane.connectionState !== "pendingSecrets") {
      return;
    }
    if (promptedPaneIdsRef.current.has(activePane.id)) {
      return;
    }
    const host = hosts.find((entry) => entry.id === activePane.hostId);
    if (!host || host.authMethod === "none") {
      return;
    }

    promptedPaneIdsRef.current.add(activePane.id);
    void ensureRuntimeSecrets(host, "Resume SSH session", { interactive: true })
      .then((approved) => {
        if (approved) {
          // Move the pane out of pendingSecrets so the inactive-restore
          // loop picks it up on its next tick. Setting "connecting" is
          // intentional — the SSH connect is async and will overwrite to
          // "connected" or "error" shortly after.
          setPaneState(activePane.id, "connecting");
        }
      })
      .catch(() => {
        // The prompt was cancelled or another error occurred; leave the
        // pane in pendingSecrets so the user can retry by switching tabs
        // or by clicking through the connection panel.
      })
      .finally(() => {
        // Allow re-prompt next time the same pane re-enters pendingSecrets
        // (e.g. if the user typed the wrong passphrase and the connect
        // failed and the secret store cleared).
        promptedPaneIdsRef.current.delete(activePane.id);
      });
  }, [activeTabId, hosts, panes, setPaneState, tabs]);

  return null;
}
