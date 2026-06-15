import { describe, expect, it } from "vitest";
import type { LocalConfigBundle } from "./local-config";
import {
  buildVaultSyncEnvelope,
  classifyVaultSyncStrategy,
  evaluateVaultSyncEnvelopeTrust,
  inspectVaultSyncEnvelope,
  parseVaultSyncTrustPolicy,
} from "./vault-sync-contract";

const baseBundle: LocalConfigBundle = {
  app: "Terminal Workspace",
  version: 5,
  identities: [],
  exportedAt: "2026-04-04T16:30:00.000Z",
  vault: {
    schema: "local-first-vault",
    vaultId: "vault-current",
    sourceDeviceId: "device-a",
    snapshotId: "snapshot-next",
    baseSnapshotId: "snapshot-current",
  },
  hosts: [
    {
      id: "host-1",
      label: "Host 1",
      protocol: "ssh",
      hostname: "10.0.0.10",
      username: "ops",
      port: 22,
      authMethod: "privateKey",
      privateKeyPath: "/tmp/id_host_1",
      group: "Prod",
      tags: ["prod"],
      note: "Primary",
      favorite: false,
      keyLabel: "Key 1",
      hostKeyPolicy: "allowUnknown",
      agentForwarding: false,
      environment: {},
      sftpRoot: "/srv",
      snippetCount: 0,
      forwardingCount: 0,
      createdAt: "2026-04-04T15:00:00.000Z",
      updatedAt: "2026-04-04T15:10:00.000Z",
    },
  ],
  keys: [
    {
      id: "key-1",
      label: "Key 1",
      algorithm: "ED25519",
      bits: 256,
      fingerprint: "SHA256:key1",
      comment: "key1@test",
      privateKeyPath: "/tmp/id_key_1",
      publicKeyPath: "/tmp/id_key_1.pub",
      source: "imported",
      hasPassphrase: false,
      assignedHostIds: ["host-1"],
      createdAt: "2026-04-04T15:00:00.000Z",
      updatedAt: "2026-04-04T15:10:00.000Z",
    },
  ],
  snippets: [
    {
      id: "snippet-1",
      title: "Tail logs",
      description: "Tail logs",
      command: "tail -f /var/log/app.log",
      tags: ["logs"],
      targetHostIds: ["host-1"],
      createdAt: "2026-04-04T15:00:00.000Z",
      updatedAt: "2026-04-04T15:10:00.000Z",
    },
  ],
  knownHosts: [
    {
      id: "10.0.0.10:22:ssh-ed25519",
      hostname: "10.0.0.10",
      port: 22,
      algorithm: "ssh-ed25519",
      publicKey: "AAAAB3NzaC1yc2EAAAADAQABAAABAQC7",
      fingerprint: "SHA256:known1",
      trustedAt: "2026-04-04T15:00:00.000Z",
      updatedAt: "2026-04-04T15:10:00.000Z",
    },
  ],
  deletions: {
    hosts: [{ id: "host-old", deletedAt: "2026-04-04T15:20:00.000Z" }],
    keys: [],
    snippets: [],
    knownHosts: [{ id: "10.0.0.20:22:ssh-ed25519", deletedAt: "2026-04-04T15:25:00.000Z" }],
    identities: [],
  },
};

describe("vault sync contract", () => {
  it("builds an exchange envelope with lineage and count summaries", async () => {
    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    expect(envelope.header.vaultId).toBe("vault-current");
    expect(envelope.header.snapshotId).toBe("snapshot-next");
    expect(envelope.header.recordCounts).toEqual({
      hosts: 1,
      keys: 1,
      snippets: 1,
      knownHosts: 1,
    });
    expect(envelope.header.deletionCounts).toEqual({
      hosts: 1,
      keys: 0,
      snippets: 0,
      knownHosts: 1,
    });
    expect(envelope.digest.algorithm).toBe("SHA-256");
    expect(envelope.digest.value).toHaveLength(64);
  });

  it("inspects a valid fast-forward envelope and verifies its digest", async () => {
    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    const analysis = await inspectVaultSyncEnvelope(envelope, {
      vaultId: "vault-current",
      lastAppliedSnapshotId: "snapshot-current",
    });

    expect(analysis.strategy).toBe("fast_forward");
    expect(analysis.digestMatches).toBe(true);
    expect(analysis.header.deletionCounts.hosts).toBe(1);
  });

  it("detects digest tampering and classifies cross-vault adoption", async () => {
    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    const analysis = await inspectVaultSyncEnvelope(
      {
        ...envelope,
        cipher: {
          ...envelope.cipher,
          ciphertext: "tampered-ciphertext",
        },
      },
      {
        vaultId: "vault-different",
        lastAppliedSnapshotId: "snapshot-current",
      }
    );

    expect(analysis.strategy).toBe("adopt_vault");
    expect(analysis.digestMatches).toBe(false);
  });

  it("classifies same-snapshot and divergent envelopes without parsing", () => {
    expect(
      classifyVaultSyncStrategy(
        {
          schema: "termsnip-vault-sync",
          version: 1,
          payloadKind: "local-config-bundle",
          vaultId: "vault-current",
          sourceDeviceId: "device-a",
          snapshotId: "snapshot-current",
          baseSnapshotId: "snapshot-root",
          exportedAt: "2026-04-04T16:30:00.000Z",
          recordCounts: { hosts: 0, keys: 0, snippets: 0, knownHosts: 0 },
          deletionCounts: { hosts: 0, keys: 0, snippets: 0, knownHosts: 0 },
        },
        {
          vaultId: "vault-current",
          lastAppliedSnapshotId: "snapshot-current",
        }
      )
    ).toBe("same_snapshot");

    expect(
      classifyVaultSyncStrategy(
        {
          schema: "termsnip-vault-sync",
          version: 1,
          payloadKind: "local-config-bundle",
          vaultId: "vault-current",
          sourceDeviceId: "device-a",
          snapshotId: "snapshot-other",
          baseSnapshotId: "snapshot-root",
          exportedAt: "2026-04-04T16:30:00.000Z",
          recordCounts: { hosts: 0, keys: 0, snippets: 0, knownHosts: 0 },
          deletionCounts: { hosts: 0, keys: 0, snippets: 0, knownHosts: 0 },
        },
        {
          vaultId: "vault-current",
          lastAppliedSnapshotId: "snapshot-current",
        }
      )
    ).toBe("divergent");
  });

  it("accepts active trusted keys and flags rotating keys with replacements", async () => {
    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    expect(
      evaluateVaultSyncEnvelopeTrust(
        envelope,
        {
          schema: "termsnip-vault-sync-trust",
          version: 1,
          allowUnknownKeys: false,
          trustedKeys: [
            {
              keyId: "wrap-key-1",
              algorithm: "AES-256-GCM",
              validFrom: "2026-04-01T00:00:00.000Z",
              rotateAfter: "2026-05-01T00:00:00.000Z",
              retireAfter: "2026-06-01T00:00:00.000Z",
              allowedVaultIds: ["vault-current"],
              replacementKeyIds: ["wrap-key-2"],
            },
          ],
        },
        "2026-04-15T00:00:00.000Z"
      )
    ).toMatchObject({
      accepted: true,
      status: "active",
      matchedKeyId: "wrap-key-1",
      replacementKeyIds: ["wrap-key-2"],
    });

    expect(
      evaluateVaultSyncEnvelopeTrust(
        envelope,
        {
          schema: "termsnip-vault-sync-trust",
          version: 1,
          allowUnknownKeys: false,
          trustedKeys: [
            {
              keyId: "wrap-key-1",
              algorithm: "AES-256-GCM",
              validFrom: "2026-04-01T00:00:00.000Z",
              rotateAfter: "2026-04-10T00:00:00.000Z",
              retireAfter: "2026-06-01T00:00:00.000Z",
              allowedVaultIds: ["vault-current"],
              replacementKeyIds: ["wrap-key-2"],
            },
          ],
        },
        "2026-04-15T00:00:00.000Z"
      )
    ).toMatchObject({
      accepted: true,
      status: "rotating",
      matchedKeyId: "wrap-key-1",
      replacementKeyIds: ["wrap-key-2"],
    });
  });

  it("rejects retired, unknown, and vault-mismatched keys", async () => {
    const envelope = await buildVaultSyncEnvelope(baseBundle, {
      algorithm: "AES-256-GCM",
      keyId: "wrap-key-1",
      nonce: "nonce-value",
      ciphertext: "ciphertext-value",
      authTag: "auth-tag-value",
    });

    expect(
      evaluateVaultSyncEnvelopeTrust(envelope, {
        schema: "termsnip-vault-sync-trust",
        version: 1,
        allowUnknownKeys: false,
        trustedKeys: [
          {
            keyId: "wrap-key-1",
            algorithm: "AES-256-GCM",
            validFrom: "2026-04-01T00:00:00.000Z",
            rotateAfter: "2026-04-10T00:00:00.000Z",
            retireAfter: "2026-04-02T00:00:00.000Z",
            allowedVaultIds: ["vault-current"],
            replacementKeyIds: ["wrap-key-2"],
          },
        ],
      })
    ).toMatchObject({
      accepted: false,
      status: "retired",
      matchedKeyId: "wrap-key-1",
    });

    expect(
      evaluateVaultSyncEnvelopeTrust(envelope, {
        schema: "termsnip-vault-sync-trust",
        version: 1,
        allowUnknownKeys: false,
        trustedKeys: [],
      })
    ).toMatchObject({
      accepted: false,
      status: "unknown",
      matchedKeyId: null,
    });

    expect(
      evaluateVaultSyncEnvelopeTrust(envelope, {
        schema: "termsnip-vault-sync-trust",
        version: 1,
        allowUnknownKeys: false,
        trustedKeys: [
          {
            keyId: "wrap-key-1",
            algorithm: "AES-256-GCM",
            validFrom: "2026-04-01T00:00:00.000Z",
            rotateAfter: null,
            retireAfter: null,
            allowedVaultIds: ["vault-other"],
            replacementKeyIds: [],
          },
        ],
      })
    ).toMatchObject({
      accepted: false,
      status: "vault_mismatch",
      matchedKeyId: "wrap-key-1",
    });
  });

  it("parses a valid trust policy and rejects invalid policy payloads", () => {
    expect(
      parseVaultSyncTrustPolicy({
        schema: "termsnip-vault-sync-trust",
        version: 1,
        allowUnknownKeys: false,
        trustedKeys: [
          {
            keyId: "wrap-key-1",
            algorithm: "AES-256-GCM",
            validFrom: "2026-04-01T00:00:00.000Z",
            rotateAfter: null,
            retireAfter: null,
            allowedVaultIds: ["vault-current"],
            replacementKeyIds: ["wrap-key-2"],
          },
        ],
      })
    ).toMatchObject({
      allowUnknownKeys: false,
      trustedKeys: [{ keyId: "wrap-key-1" }],
    });

    expect(() =>
      parseVaultSyncTrustPolicy({
        schema: "termsnip-vault-sync-trust",
        version: 1,
        allowUnknownKeys: false,
        trustedKeys: [
          {
            keyId: "wrap-key-1",
            algorithm: "AES-128-GCM",
          },
        ],
      })
    ).toThrow("Vault sync trust policy is invalid.");
  });
});
