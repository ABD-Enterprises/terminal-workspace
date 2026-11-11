// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendHostConnection } from "../../lib/backend-contract";
import { useConnectionSecretsStore } from "../../store/connection-secrets-store";
import { useHostsStore } from "../../store/hosts-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import type { HostRecord } from "../../types/host";
import type { KnownHostRecord } from "../../types/known-host";
import type { SessionPane, SessionTab } from "../../types/session";

const createBackendSession = vi.fn<(host: BackendHostConnection) => Promise<{ sessionId: string }>>(
  async () => ({ sessionId: "s-1" })
);

const secretMocks = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
}));

vi.mock("../../lib/api", () => ({
  createBackendSession: (host: BackendHostConnection) => createBackendSession(host),
}));
vi.mock("../../lib/runtime-secrets", () => ({
  canRestoreSessionWithoutPrompt: async () => true,
  ensureRuntimeSecrets: secretMocks.ensure,
}));

import { SessionRestoreManager } from "./SessionRestoreManager";

const now = "2026-11-07T00:00:00.000Z";

function host(overrides: Partial<HostRecord>): HostRecord {
  return {
    id: "h",
    label: "Host",
    hostname: "host.internal",
    port: 22,
    username: "ops",
    protocol: "ssh",
    authMethod: "password",
    privateKeyPath: "",
    hostKeyPolicy: "allowUnknown",
    agentForwarding: false,
    environment: {},
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    jumpHostId: undefined,
    sftpRoot: "/home",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as HostRecord;
}

function approval(hostname: string, publicKey: string): KnownHostRecord {
  return {
    id: `${hostname}:22:ssh-ed25519`,
    hostname,
    port: 22,
    algorithm: "ssh-ed25519",
    publicKey,
    fingerprint: "SHA256:test",
    trustedAt: now,
    updatedAt: now,
  };
}

function pane(id: string, hostId: string, restore: boolean): SessionPane {
  return {
    id,
    hostId,
    title: id,
    connectionState: "disconnected",
    transport: "ssh",
    queuedCommands: [],
    reconnectOnRestore: restore,
    persistOutputPreview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function tab(id: string, paneId: string, hostId: string): SessionTab {
  return {
    id,
    title: id,
    hostId,
    paneIds: [paneId],
    activePaneId: paneId,
    splitDirection: "horizontal",
    createdAt: now,
    updatedAt: now,
  } as SessionTab;
}

describe("SessionRestoreManager (#489)", () => {
  afterEach(() => {
    cleanup();
    createBackendSession.mockClear();
    secretMocks.ensure.mockClear();
  });

  it("does not prompt when a restored pane waiting for credentials is active", async () => {
    useHostsStore.setState({ hosts: [host({ id: "waiting" })] });
    useSessionsStore.setState({
      tabs: [tab("active", "p-waiting", "waiting")],
      panes: {
        "p-waiting": { ...pane("p-waiting", "waiting", true), connectionState: "pendingSecrets" },
      },
      activeTabId: "active",
    });
    render(<SessionRestoreManager />);
    // Flush the restore effect's asynchronous work. Native approval must be
    // reached only from the existing explicit Resume button in TerminalPane.
    await Promise.resolve();
    expect(secretMocks.ensure).not.toHaveBeenCalled();
    expect(createBackendSession).not.toHaveBeenCalled();
    expect(useSessionsStore.getState().panes["p-waiting"].connectionState).toBe("pendingSecrets");
  });

  it("restores a session through a jump host with each hop's own approved key", async () => {
    useHostsStore.setState({
      hosts: [
        host({ id: "jump", label: "Jump", hostname: "jump.internal" }),
        host({ id: "target", label: "Target", hostname: "target.internal", jumpHostId: "jump" }),
      ],
    });
    useConnectionSecretsStore.getState().setHostSecrets("jump", { password: "j", passphrase: "" });
    useConnectionSecretsStore.getState().setHostSecrets("target", { password: "t", passphrase: "" });
    useKnownHostsStore.setState({
      knownHosts: [
        approval("target.internal", "AAAATARGETAPPROVED"),
        approval("jump.internal", "AAAAJUMPAPPROVED"),
      ],
    });
    useSessionsStore.setState({
      tabs: [tab("active", "p-active", "jump"), tab("background", "p-restore", "target")],
      panes: {
        "p-active": pane("p-active", "jump", false),
        "p-restore": pane("p-restore", "target", true),
      },
      activeTabId: "active",
    });

    render(<SessionRestoreManager />);

    await waitFor(() => expect(createBackendSession).toHaveBeenCalledTimes(1));
    const connection = createBackendSession.mock.calls[0]?.[0];
    expect(connection?.knownHostPublicKey).toBe("AAAATARGETAPPROVED");
    // Before #489 the jump hop got no approval here, so a re-approved jump
    // host fell back to its stale pin on restore.
    expect(connection?.jumpHost?.hostname).toBe("jump.internal");
    expect(connection?.jumpHost?.knownHostPublicKey).toBe("AAAAJUMPAPPROVED");
  });
});
