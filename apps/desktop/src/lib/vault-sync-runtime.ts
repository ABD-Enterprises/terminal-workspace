import { useAppStore } from "../store/app-store";
import { useVaultSyncTrustStore } from "../store/vault-sync-trust-store";
import {
  evaluateVaultSyncEnvelopeTrust,
  inspectVaultSyncEnvelope,
  parseVaultSyncEnvelope,
  type VaultSyncEnvelopeAnalysis,
  type VaultSyncTrustAnalysis,
} from "./vault-sync-contract";

export interface VaultSyncRuntimeInspection {
  envelope: VaultSyncEnvelopeAnalysis;
  trust: VaultSyncTrustAnalysis;
}

export async function inspectVaultSyncEnvelopeWithLocalPolicy(
  value: unknown,
  now?: string
): Promise<VaultSyncRuntimeInspection> {
  const appState = useAppStore.getState();
  const localContext = {
    vaultId: appState.vaultId,
    lastAppliedSnapshotId: appState.lastAppliedSnapshotId,
  };
  const envelope = parseVaultSyncEnvelope(value);

  return {
    envelope: await inspectVaultSyncEnvelope(envelope, localContext),
    trust: evaluateVaultSyncEnvelopeTrust(
      envelope,
      useVaultSyncTrustStore.getState().policy,
      now ?? envelope.header.exportedAt
    ),
  };
}
