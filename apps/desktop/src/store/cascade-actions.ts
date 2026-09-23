import { useConnectionSecretsStore } from "./connection-secrets-store";
import { useHostsStore } from "./hosts-store";
import { useKeysStore } from "./keys-store";
import { useSessionsStore } from "./sessions-store";
import { useSnippetsStore } from "./snippets-store";
import { useTransfersStore } from "./transfers-store";

/**
 * Perform a complete cascade delete for a host.
 * This guarantees no stale references are left behind across the local inventory.
 */
export function deleteHostAndCascade(hostId: string) {
  // 1. Core host deletion
  useHostsStore.getState().deleteHost(hostId);

  // 2. Cascade to Native / Connection Secrets
  useConnectionSecretsStore.getState().clearHostSecrets(hostId);

  // 3. Cascade to Keys (unassign)
  useKeysStore.getState().unassignHostFromAll(hostId);

  // 4. Cascade to Snippets (remove from targets)
  useSnippetsStore.getState().removeHostFromAllTargets(hostId);

  // 5. Cascade to Sessions (close all panes/tabs attached to this host)
  useSessionsStore.getState().closePanesForHost(hostId);

  // 6. Cascade to Transfers (clear active context)
  const transfersState = useTransfersStore.getState();
  if (transfersState.activeHostId === hostId) {
    transfersState.setActiveHost(undefined);
  }
}
