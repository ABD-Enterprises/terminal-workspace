import { afterEach, describe, expect, it } from "vitest";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
  inspectImportedLocalConfigBundle,
  type LocalConfigBundle,
} from "./local-config";
import { useAppStore } from "../store/app-store";
import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";
import { useKeysStore } from "../store/keys-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { useTransfersStore } from "../store/transfers-store";
import {
  useVaultSyncStore,
  VAULT_TOMBSTONE_RETENTION_DAYS,
} from "../store/vault-sync-store";

const baseHostState = useHostsStore.getState();
const baseKeyState = useKeysStore.getState();
const baseSnippetState = useSnippetsStore.getState();
const baseKnownHostState = useKnownHostsStore.getState();
const baseSessionState = useSessionsStore.getState();
const baseTransferState = useTransfersStore.getState();
const baseAppState = useAppStore.getState();
const baseVaultSyncState = useVaultSyncStore.getState();
const baseIdentitiesState = useIdentitiesStore.getState();

afterEach(() => {
  useAppStore.setState(baseAppState);
  useHostsStore.setState(baseHostState);
  useKeysStore.setState(baseKeyState);
  useSnippetsStore.setState(baseSnippetState);
  useKnownHostsStore.setState(baseKnownHostState);
  useSessionsStore.setState(baseSessionState);
  useTransfersStore.setState(baseTransferState);
  useVaultSyncStore.setState(baseVaultSyncState);
  useIdentitiesStore.setState(baseIdentitiesState);
});

describe("local config", () => {
  it("exports the current durable config bundle", () => {
    const staleDeletedAt = new Date(
      Date.now() - (VAULT_TOMBSTONE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    useVaultSyncStore.getState().replaceDeletions({
      hosts: [
        { id: "host-stale", deletedAt: staleDeletedAt },
        { id: "host-live", deletedAt: "2026-03-29T10:30:00.000Z" },
      ],
      keys: [],
      snippets: [],
      knownHosts: [],
      identities: [],
    });

    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-a",
          label: "Host A",
          protocol: "ssh",
          hostname: "127.0.0.1",
          username: "deffenda",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_a",
          group: "Fixtures",
          tags: ["a"],
          note: "Fixture host",
          favorite: false,
          keyLabel: "Fixture Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/tmp",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
    });

    const bundle = buildLocalConfigBundle();
    expect(bundle.app).toBe("Terminal Workspace");
    expect(bundle.version).toBe(5);
    expect(bundle.vault.schema).toBe("local-first-vault");
    expect(bundle.vault.vaultId).toBe(baseAppState.vaultId);
    expect(bundle.vault.sourceDeviceId).toBe(baseAppState.deviceId);
    expect(bundle.vault.snapshotId).toBeTruthy();
    expect(bundle.vault.baseSnapshotId).toBeNull();
    expect(bundle.deletions).toEqual({
      hosts: [{ id: "host-live", deletedAt: "2026-03-29T10:30:00.000Z" }],
      keys: [],
      snippets: [],
      knownHosts: [],
      identities: [],
    });
    expect(bundle.hosts).toHaveLength(1);
    expect(bundle.hosts[0]?.id).toBe("host-a");
  });

  it("classifies sync lineage before import", () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");

    const analysis = inspectImportedLocalConfigBundle({
      app: "TermSnip",
      version: 2,
      exportedAt: "2026-03-29T10:00:00.000Z",
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
    });

    expect(analysis.strategy).toBe("fast_forward");
    expect(analysis.currentSnapshotId).toBe("snapshot-current");
    expect(analysis.importedSnapshotId).toBe("snapshot-next");
    expect(analysis.importedBaseSnapshotId).toBe("snapshot-current");
    expect(analysis.mergePlan).toMatchObject({
      applicable: true,
      hasConflicts: false,
    });
  });

  it("imports durable config and clears stale sessions", () => {
    useSessionsStore.setState({
      ...baseSessionState,
      activeTabId: "stale-tab",
      tabs: [
        {
          id: "stale-tab",
          title: "Stale",
          hostId: "stale-host",
          paneIds: ["stale-pane"],
          activePaneId: "stale-pane",
          splitDirection: "vertical",
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      panes: {
        "stale-pane": {
          id: "stale-pane",
          hostId: "stale-host",
          title: "Stale",
          connectionState: "connected",
          transport: "ssh",
          queuedCommands: [],
          reconnectOnRestore: true,
          persistOutputPreview: true,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      },
    });

    const bundle: LocalConfigBundle = {
      app: "Terminal Workspace",
      version: 5,
      identities: [],
      exportedAt: "2026-03-29T10:00:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-imported",
        sourceDeviceId: "device-remote",
        snapshotId: "snapshot-1",
        baseSnapshotId: "snapshot-root",
      },
      deletions: {
        hosts: [],
        keys: [],
        snippets: [],
        knownHosts: [],
        identities: [],
      },
      hosts: [
        {
          id: "host-b",
          label: "Host B",
          protocol: "ssh",
          hostname: "127.0.0.1",
          username: "deffenda",
          port: 2222,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_b",
          group: "Imported",
          tags: ["imported"],
          note: "Imported host",
          favorite: true,
          keyLabel: "Imported Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: true,
          environment: {
            APP_ENV: "imported",
          },
          sftpRoot: "/tmp",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
          lastConnectedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      keys: [
        {
          id: "key-b",
          label: "Imported Key",
          algorithm: "ED25519",
          bits: 256,
          fingerprint: "SHA256:test",
          comment: "imported@test",
          privateKeyPath: "/tmp/id_b",
          publicKeyPath: "/tmp/id_b.pub",
          source: "imported",
          hasPassphrase: false,
          assignedHostIds: ["host-b", "missing-host"],
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      snippets: [
        {
          id: "snippet-b",
          title: "Imported Snippet",
          description: "Imported",
          command: "echo imported",
          tags: ["imported"],
          targetHostIds: ["host-b", "missing-host"],
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
      knownHosts: [
        {
          id: "127.0.0.1:2222:ssh-ed25519",
          hostname: "127.0.0.1",
          port: 2222,
          algorithm: "ssh-ed25519",
          publicKey: "AAAAB3Nza...",
          fingerprint: "SHA256:test",
          trustedAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
    };

    const summary = applyImportedLocalConfigBundle(bundle);

    expect(summary).toEqual({
      hostCount: 1,
      keyCount: 1,
      snippetCount: 1,
      knownHostCount: 1,
      identityCount: 0,
      importStrategy: "adopt_vault",
      mode: "replace",
      conflictResolution: null,
      mergePlan: null,
      snapshotId: "snapshot-1",
      vaultId: "vault-imported",
    });
    expect(useHostsStore.getState().hosts[0]?.id).toBe("host-b");
    expect(useKeysStore.getState().keys[0]?.assignedHostIds).toEqual(["host-b"]);
    expect(useSnippetsStore.getState().snippets[0]?.targetHostIds).toEqual(["host-b"]);
    expect(useSessionsStore.getState().tabs).toEqual([]);
    expect(useSessionsStore.getState().activeTabId).toBeUndefined();
    expect(useTransfersStore.getState().activeHostId).toBe("host-b");
    expect(useAppStore.getState().vaultId).toBe("vault-imported");
    expect(useAppStore.getState().deviceId).toBe(baseAppState.deviceId);
    expect(useAppStore.getState().lastAppliedSnapshotId).toBe("snapshot-1");
  });

  it("merges non-conflicting local and imported records for the same vault", () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-local",
          label: "Local Host",
          protocol: "ssh",
          hostname: "10.0.0.1",
          username: "ops",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_local",
          group: "Local",
          tags: ["local"],
          note: "Local only",
          favorite: false,
          keyLabel: "Local Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/srv",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
    });

    const bundle: LocalConfigBundle = {
      app: "Terminal Workspace",
      version: 5,
      identities: [],
      exportedAt: "2026-03-29T11:00:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-current",
        sourceDeviceId: "device-remote",
        snapshotId: "snapshot-next",
        baseSnapshotId: "snapshot-current",
      },
      deletions: {
        hosts: [],
        keys: [],
        snippets: [],
        knownHosts: [],
        identities: [],
      },
      hosts: [
        {
          id: "host-remote",
          label: "Remote Host",
          protocol: "ssh",
          hostname: "10.0.0.2",
          username: "deploy",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_remote",
          group: "Remote",
          tags: ["remote"],
          note: "Imported",
          favorite: true,
          keyLabel: "Remote Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: true,
          environment: {
            APP_ENV: "staging",
          },
          sftpRoot: "/var/www",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T11:00:00.000Z",
          updatedAt: "2026-03-29T11:00:00.000Z",
        },
      ],
      keys: [],
      snippets: [],
      knownHosts: [],
    };

    const summary = applyImportedLocalConfigBundle(bundle, { mode: "merge" });

    expect(summary).toMatchObject({
      hostCount: 2,
      importStrategy: "fast_forward",
      mode: "merge",
      snapshotId: "snapshot-next",
    });
    expect(summary.mergePlan?.hosts).toEqual({
      added: 1,
      updated: 0,
      removed: 0,
      retainedLocal: 1,
      unchanged: 0,
      conflicts: 0,
      conflictingIds: [],
    });
    expect(useHostsStore.getState().hosts.map((host) => host.id)).toEqual([
      "host-remote",
      "host-local",
    ]);
    expect(useAppStore.getState().lastAppliedSnapshotId).toBe("snapshot-next");
  });

  it("allows same-vault merge conflicts to resolve toward local or imported records", () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-shared",
          label: "Local Label",
          protocol: "ssh",
          hostname: "10.0.0.10",
          username: "ops",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_local",
          group: "Ops",
          tags: ["local"],
          note: "Local note",
          favorite: false,
          keyLabel: "Local Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/srv",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T11:00:00.000Z",
        },
      ],
    });

    const bundle: LocalConfigBundle = {
      app: "Terminal Workspace",
      version: 5,
      identities: [],
      exportedAt: "2026-03-29T11:30:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-current",
        sourceDeviceId: "device-remote",
        snapshotId: "snapshot-next",
        baseSnapshotId: "snapshot-current",
      },
      deletions: {
        hosts: [],
        keys: [],
        snippets: [],
        knownHosts: [],
        identities: [],
      },
      hosts: [
        {
          id: "host-shared",
          label: "Imported Label",
          protocol: "ssh",
          hostname: "10.0.0.10",
          username: "ops",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_remote",
          group: "Ops",
          tags: ["remote"],
          note: "Imported note",
          favorite: true,
          keyLabel: "Imported Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: true,
          environment: {},
          sftpRoot: "/srv",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T11:00:00.000Z",
        },
      ],
      keys: [],
      snippets: [],
      knownHosts: [],
    };

    const analysis = inspectImportedLocalConfigBundle(bundle);
    expect(analysis.mergePlan?.hosts.conflicts).toBe(1);
    expect(analysis.mergePlan?.hosts.conflictingIds).toEqual(["host-shared"]);

    const keepLocalSummary = applyImportedLocalConfigBundle(bundle, {
      mode: "merge",
      conflictResolution: "keep-local",
    });
    expect(keepLocalSummary.conflictResolution).toBe("keep-local");
    expect(useHostsStore.getState().hosts[0]?.label).toBe("Local Label");

    useAppStore.setState(baseAppState);
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-shared",
          label: "Local Label",
          protocol: "ssh",
          hostname: "10.0.0.10",
          username: "ops",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_local",
          group: "Ops",
          tags: ["local"],
          note: "Local note",
          favorite: false,
          keyLabel: "Local Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/srv",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T11:00:00.000Z",
        },
      ],
    });
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");

    const preferImportedSummary = applyImportedLocalConfigBundle(bundle, {
      mode: "merge",
      conflictResolution: "prefer-imported",
    });
    expect(preferImportedSummary.conflictResolution).toBe("prefer-imported");
    expect(useHostsStore.getState().hosts[0]?.label).toBe("Imported Label");
  });

  it("removes records when imported tombstones supersede local updates", () => {
    useAppStore.getState().setVaultId("vault-current");
    useAppStore.getState().setLastAppliedSnapshotId("snapshot-current");
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-remove",
          label: "Remove Me",
          protocol: "ssh",
          hostname: "10.0.0.99",
          username: "ops",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_remove",
          group: "Ops",
          tags: ["remove"],
          note: "Local record",
          favorite: false,
          keyLabel: "Remove Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/srv",
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:30:00.000Z",
        },
      ],
    });

    const bundle: LocalConfigBundle = {
      app: "Terminal Workspace",
      version: 5,
      identities: [],
      exportedAt: "2026-03-29T11:30:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-current",
        sourceDeviceId: "device-remote",
        snapshotId: "snapshot-next",
        baseSnapshotId: "snapshot-current",
      },
      deletions: {
        hosts: [{ id: "host-remove", deletedAt: "2026-03-29T11:00:00.000Z" }],
        keys: [],
        snippets: [],
        knownHosts: [],
        identities: [],
      },
      hosts: [],
      keys: [],
      snippets: [],
      knownHosts: [],
    };

    const analysis = inspectImportedLocalConfigBundle(bundle);
    expect(analysis.mergePlan?.hosts.removed).toBe(1);

    const summary = applyImportedLocalConfigBundle(bundle, { mode: "merge" });
    expect(summary.hostCount).toBe(0);
    expect(useHostsStore.getState().hosts).toEqual([]);
    expect(useVaultSyncStore.getState().deletions.hosts).toEqual([
      { id: "host-remove", deletedAt: "2026-03-29T11:00:00.000Z" },
    ]);
  });

  // M13 (#95): reusable identities travel in the v4 bundle so a
  // cross-machine export → import preserves user-edited identities and
  // the host↔identity bindings.
  it("exports identities in the v4 bundle and round-trips them on import, preserving host bindings", () => {
    useIdentitiesStore.setState({
      ...baseIdentitiesState,
      identities: [
        {
          id: "id-deploy",
          label: "Deploy Shared Key",
          username: "deploy",
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_deploy",
          hasPassphrase: false,
          comment: "edited label survives export",
          source: "imported",
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
    });
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-bound",
          label: "Bound Host",
          protocol: "ssh",
          hostname: "10.0.0.5",
          username: "deploy",
          port: 22,
          authMethod: "privateKey",
          privateKeyPath: "/tmp/id_deploy",
          group: "Fixtures",
          tags: [],
          note: "",
          favorite: false,
          keyLabel: "Deploy Shared Key",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
          sftpRoot: "/tmp",
          snippetCount: 0,
          forwardingCount: 0,
          identityId: "id-deploy",
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      ],
    });

    const bundle = buildLocalConfigBundle();
    expect(bundle.version).toBe(5);
    expect(bundle.identities).toHaveLength(1);
    expect(bundle.identities[0]?.id).toBe("id-deploy");
    expect(bundle.identities[0]?.comment).toBe("edited label survives export");

    // Simulate a fresh machine: wipe identities + hosts, then import.
    useIdentitiesStore.setState({ ...baseIdentitiesState, identities: [] });
    useHostsStore.setState({ ...baseHostState, hosts: [] });

    const summary = applyImportedLocalConfigBundle(bundle);
    expect(summary.identityCount).toBe(1);

    const importedIdentities = useIdentitiesStore.getState().identities;
    expect(importedIdentities).toHaveLength(1);
    expect(importedIdentities[0]?.id).toBe("id-deploy");
    expect(importedIdentities[0]?.comment).toBe("edited label survives export");

    const importedHost = useHostsStore.getState().hosts.find((host) => host.id === "host-bound");
    expect(importedHost?.identityId).toBe("id-deploy");
  });

  it("imports a legacy v3 bundle (no identities field) cleanly, treating identities as empty", () => {
    // A v3 bundle predates the identities collection. inspect + apply must
    // not throw, and identityCount must be 0.
    const v3Bundle = {
      app: "TermSnip",
      version: 3,
      exportedAt: "2026-03-29T10:00:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-legacy",
        sourceDeviceId: "device-old",
        snapshotId: "snapshot-legacy",
        baseSnapshotId: null,
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

    const analysis = inspectImportedLocalConfigBundle(v3Bundle);
    expect(analysis.identityCount).toBe(0);

    expect(() => applyImportedLocalConfigBundle(v3Bundle)).not.toThrow();
    expect(useIdentitiesStore.getState().identities).toEqual([]);
  });

  it("#115: imports a legacy v4 'TermSnip' bundle, migrating the app field forward", () => {
    // The pre-rename export used app: "TermSnip", version: 4. After the
    // rename to app: "Terminal Workspace", version 5, that legacy bundle must
    // still inspect + apply without error.
    const legacyV4Bundle = {
      app: "TermSnip",
      version: 4,
      exportedAt: "2026-03-29T10:00:00.000Z",
      vault: {
        schema: "local-first-vault",
        vaultId: "vault-legacy-v4",
        sourceDeviceId: "device-old",
        snapshotId: "snapshot-legacy-v4",
        baseSnapshotId: null,
      },
      hosts: [],
      keys: [],
      snippets: [],
      knownHosts: [],
      identities: [],
      deletions: { hosts: [], keys: [], snippets: [], knownHosts: [], identities: [] },
    };

    expect(() => inspectImportedLocalConfigBundle(legacyV4Bundle)).not.toThrow();
    expect(() => applyImportedLocalConfigBundle(legacyV4Bundle)).not.toThrow();
  });
});
