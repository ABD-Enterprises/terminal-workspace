import { afterEach, describe, expect, it } from "vitest";
import { useVaultSyncTrustStore } from "./vault-sync-trust-store";

const baseTrustState = useVaultSyncTrustStore.getState();

afterEach(() => {
  useVaultSyncTrustStore.setState(baseTrustState);
});

describe("vault sync trust store", () => {
  it("persists sorted trusted keys and deduplicates replacements", () => {
    useVaultSyncTrustStore.getState().upsertTrustedKey({
      keyId: "wrap-key-1",
      algorithm: "AES-256-GCM",
      validFrom: "2026-04-01T00:00:00.000Z",
      rotateAfter: "2026-05-01T00:00:00.000Z",
      retireAfter: null,
      allowedVaultIds: ["vault-b", "vault-a", "vault-a"],
      replacementKeyIds: ["wrap-key-3", "wrap-key-2", "wrap-key-2"],
    });
    useVaultSyncTrustStore.getState().upsertTrustedKey({
      keyId: "wrap-key-2",
      algorithm: "AES-256-GCM",
      validFrom: "2026-04-02T00:00:00.000Z",
      rotateAfter: null,
      retireAfter: null,
      allowedVaultIds: null,
      replacementKeyIds: [],
    });

    expect(useVaultSyncTrustStore.getState().policy.trustedKeys).toEqual([
      {
        keyId: "wrap-key-2",
        algorithm: "AES-256-GCM",
        validFrom: "2026-04-02T00:00:00.000Z",
        rotateAfter: null,
        retireAfter: null,
        allowedVaultIds: null,
        replacementKeyIds: [],
      },
      {
        keyId: "wrap-key-1",
        algorithm: "AES-256-GCM",
        validFrom: "2026-04-01T00:00:00.000Z",
        rotateAfter: "2026-05-01T00:00:00.000Z",
        retireAfter: null,
        allowedVaultIds: ["vault-a", "vault-b"],
        replacementKeyIds: ["wrap-key-2", "wrap-key-3"],
      },
    ]);
  });

  it("toggles unknown-key policy and removes trusted keys", () => {
    useVaultSyncTrustStore.getState().setAllowUnknownKeys(true);
    useVaultSyncTrustStore.getState().upsertTrustedKey({
      keyId: "wrap-key-1",
      algorithm: "AES-256-GCM",
      validFrom: "2026-04-01T00:00:00.000Z",
      rotateAfter: null,
      retireAfter: null,
      allowedVaultIds: null,
      replacementKeyIds: [],
    });
    useVaultSyncTrustStore.getState().removeTrustedKey("wrap-key-1");

    expect(useVaultSyncTrustStore.getState().policy).toEqual({
      schema: "termsnip-vault-sync-trust",
      version: 1,
      allowUnknownKeys: true,
      trustedKeys: [],
    });
  });
});
