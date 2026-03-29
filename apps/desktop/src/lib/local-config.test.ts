import { afterEach, describe, expect, it } from "vitest";
import {
  applyImportedLocalConfigBundle,
  buildLocalConfigBundle,
  type LocalConfigBundle,
} from "./local-config";
import { useHostsStore } from "../store/hosts-store";
import { useKeysStore } from "../store/keys-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { useTransfersStore } from "../store/transfers-store";

const baseHostState = useHostsStore.getState();
const baseKeyState = useKeysStore.getState();
const baseSnippetState = useSnippetsStore.getState();
const baseKnownHostState = useKnownHostsStore.getState();
const baseSessionState = useSessionsStore.getState();
const baseTransferState = useTransfersStore.getState();

afterEach(() => {
  useHostsStore.setState(baseHostState);
  useKeysStore.setState(baseKeyState);
  useSnippetsStore.setState(baseSnippetState);
  useKnownHostsStore.setState(baseKnownHostState);
  useSessionsStore.setState(baseSessionState);
  useTransfersStore.setState(baseTransferState);
});

describe("local config", () => {
  it("exports the current durable config bundle", () => {
    useHostsStore.setState({
      ...baseHostState,
      hosts: [
        {
          id: "host-a",
          label: "Host A",
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
    expect(bundle.app).toBe("TermSnip");
    expect(bundle.version).toBe(1);
    expect(bundle.hosts).toHaveLength(1);
    expect(bundle.hosts[0]?.id).toBe("host-a");
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
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      },
    });

    const bundle: LocalConfigBundle = {
      app: "TermSnip",
      version: 1,
      exportedAt: "2026-03-29T10:00:00.000Z",
      hosts: [
        {
          id: "host-b",
          label: "Host B",
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
    });
    expect(useHostsStore.getState().hosts[0]?.id).toBe("host-b");
    expect(useKeysStore.getState().keys[0]?.assignedHostIds).toEqual(["host-b"]);
    expect(useSnippetsStore.getState().snippets[0]?.targetHostIds).toEqual(["host-b"]);
    expect(useSessionsStore.getState().tabs).toEqual([]);
    expect(useSessionsStore.getState().activeTabId).toBeUndefined();
    expect(useTransfersStore.getState().activeHostId).toBe("host-b");
  });
});
