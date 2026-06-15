import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store/app-store";
import { useVaultSyncTrustStore } from "../store/vault-sync-trust-store";
import type { LocalConfigBundle } from "./local-config";
import { buildVaultSyncEnvelope } from "./vault-sync-contract";
import { inspectVaultSyncEnvelopeWithLocalPolicy } from "./vault-sync-runtime";

const baseAppState = useAppStore.getState();
const baseTrustState = useVaultSyncTrustStore.getState();

const baseBundle: LocalConfigBundle = {
  app: "Terminal Workspace",
  version: 5,
  identities: [],
  exportedAt: "2026-04-04T18:00:00.000Z",
  vault: {
    schema: "local-first-vault",
    vaultId: "vault-current",
    sourceDeviceId: "device-remote",
    snapshotId: "snapshot-next",
    baseSnapshotId: "snapshot-current",
  },
  hosts: [],
  keys: [],
  snippets: [],
  knownHosts: [],
  deletions: {
    hosts: [],
    keys: [],
    snippets: [],
    knownHosts: [],
    identities: [],
  },
};

afterEach(() => {
  useAppStore.setState(baseAppState);
  useVaultSyncTrustStore.setState(baseTrustState);
});

describe("vault sync runtime", () => {
  it("loads local app state and trusted key policy automatically", async () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");
    useVaultSyncTrustStore.getState().replacePolicy({
      schema: "termsnip-vault-sync-trust",
      version: 1,
      allowUnknownKeys: false,
      trustedKeys: [
        {
          keyId: "wrap-key-1",
          algorithm: "AES-256-GCM",
          validFrom: "2026-04-01T00:00:00.000Z",
          rotateAfter: "2026-05-01T00:00:00.000Z",
          retireAfter: null,
          allowedVaultIds: ["vault-current"],
          replacementKeyIds: [],
        },
      ],
    });

    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    const inspection = await inspectVaultSyncEnvelopeWithLocalPolicy(envelope);

    expect(inspection.envelope.strategy).toBe("fast_forward");
    expect(inspection.envelope.digestMatches).toBe(true);
    expect(inspection.trust).toMatchObject({
      accepted: true,
      status: "active",
      matchedKeyId: "wrap-key-1",
    });
  });

  it("rejects untrusted envelopes when the local trust store does not allow unknown keys", async () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");
    useVaultSyncTrustStore.getState().replacePolicy({
      schema: "termsnip-vault-sync-trust",
      version: 1,
      allowUnknownKeys: false,
      trustedKeys: [],
    });

    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-unknown",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    const inspection = await inspectVaultSyncEnvelopeWithLocalPolicy(envelope);

    expect(inspection.envelope.strategy).toBe("fast_forward");
    expect(inspection.trust).toMatchObject({
      accepted: false,
      status: "unknown",
      matchedKeyId: null,
    });
  });
});
