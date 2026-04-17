import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeTauriCommand, isTauriRuntime } = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriRuntime: vi.fn(),
}));

vi.mock("../store/app-store", () => ({
  isDemoModeEnabled: () => false,
}));

vi.mock("./backend-runtime", () => ({
  closeSession: vi.fn(),
  createSession: vi.fn(),
  getSessionBackendStatus: vi.fn(),
  invokeTauriCommand,
  isTauriRuntime,
  openSessionSocket: vi.fn(),
  proxyBackendBinary: vi.fn(),
  proxyBackendJson: vi.fn(),
  resizeSession: vi.fn(),
}));

vi.mock("./demo-backend", () => ({
  createDemoForward: vi.fn(),
  createDemoRemoteDirectory: vi.fn(),
  deleteDemoForward: vi.fn(),
  deleteDemoRemoteEntry: vi.fn(),
  downloadDemoRemoteFile: vi.fn(),
  executeDemoSnippetOnHosts: vi.fn(),
  generateDemoPrivateKey: vi.fn(),
  inspectDemoPrivateKey: vi.fn(),
  listDemoForwards: vi.fn(),
  listDemoRemoteDirectory: vi.fn(),
  renameDemoRemoteEntry: vi.fn(),
  scanDemoKnownHost: vi.fn(),
  uploadDemoRemoteFile: vi.fn(),
}));

import {
  generatePrivateKey,
  getProtocolRuntimeStatus,
  inspectPrivateKey,
  readSshConfigFile,
  scanKnownHost,
} from "./api";
import {
  createLocalForward,
  executeSnippetOnHosts,
  listRemoteDirectory,
  type BackendHostConnection,
} from "./api";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

const hostFixture: BackendHostConnection = {
  agentForwarding: false,
  authMethod: "privateKey",
  environment: {},
  hostname: "bastion.internal",
  password: "",
  passphrase: "",
  port: 22,
  privateKeyPath: "~/.ssh/id_ed25519",
  protocol: "ssh",
  username: "ops",
};

describe("native trust and key tooling API", () => {
  beforeEach(() => {
    invokeTauriCommand.mockReset();
    isTauriRuntime.mockReset();
    isTauriRuntime.mockReturnValue(true);
    fetchMock.mockReset();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
      writable: true,
    });
  });

  it("routes private-key inspection through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValue({ algorithm: "ED25519" });

    await inspectPrivateKey("~/.ssh/id_ed25519");

    expect(invokeTauriCommand).toHaveBeenCalledWith("termsnip_inspect_private_key", {
      request: { path: "~/.ssh/id_ed25519" },
    });
  });

  it("routes key generation through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValue({ algorithm: "ED25519" });

    await generatePrivateKey({
      comment: "termsnip@local",
      passphrase: "secret",
      path: "~/.ssh/termsnip_ed25519",
      type: "ed25519",
    });

    expect(invokeTauriCommand).toHaveBeenCalledWith("termsnip_generate_private_key", {
      request: {
        comment: "termsnip@local",
        passphrase: "secret",
        path: "~/.ssh/termsnip_ed25519",
        type: "ed25519",
      },
    });
  });

  it("routes known-host scans through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValue({ entries: [] });

    await scanKnownHost("bastion.internal", 2222);

    expect(invokeTauriCommand).toHaveBeenCalledWith("termsnip_scan_known_host", {
      request: { hostname: "bastion.internal", port: 2222 },
    });
  });

  it("routes native protocol runtime status checks through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValue({
      available: true,
      client: "mosh",
      message: "Mosh client resolved.",
      protocol: "mosh",
      resolvedPath: "/opt/homebrew/bin/mosh",
    });

    await getProtocolRuntimeStatus("mosh");

    expect(invokeTauriCommand).toHaveBeenCalledWith("termsnip_protocol_runtime_status", {
      request: { protocol: "mosh" },
    });
  });

  it("routes native ssh config reads through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValue({
      contents: "Host prod\n  HostName bastion.internal\n",
      path: "/Users/deffenda/.ssh/config",
    });

    await readSshConfigFile();

    expect(invokeTauriCommand).toHaveBeenCalledWith("termsnip_read_ssh_config", {
      request: { path: undefined },
    });
  });

  it("routes browser key inspection through the backend HTTP seam", async () => {
    isTauriRuntime.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ algorithm: "ED25519" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );

    await inspectPrivateKey("~/.ssh/id_ed25519");

    expect(fetchMock).toHaveBeenCalledWith("/api/backend/keys/inspect", {
      body: JSON.stringify({ path: "~/.ssh/id_ed25519" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("routes browser SFTP listing through the backend HTTP seam", async () => {
    isTauriRuntime.mockReturnValue(false);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ entries: [], path: "/" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );

    await listRemoteDirectory(hostFixture, "/");

    expect(fetchMock).toHaveBeenCalledWith("/api/backend/sftp/list", {
      body: JSON.stringify({ host: hostFixture, path: "/" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("reports browser-only protocol runtime availability without invoking Tauri", async () => {
    isTauriRuntime.mockReturnValue(false);

    await expect(getProtocolRuntimeStatus("telnet")).resolves.toEqual({
      available: false,
      installHint: "Open this host in the native macOS app to use its protocol runtime.",
      message: "This protocol requires the native macOS runtime.",
      protocol: "telnet",
    });
  });

  it("requires the native runtime for ssh config import in the browser", async () => {
    isTauriRuntime.mockReturnValue(false);

    await expect(readSshConfigFile()).rejects.toThrow(
      "Open the native macOS app to import ~/.ssh/config."
    );
  });

  it("routes native forwards and snippet execution through the Tauri command bridge", async () => {
    invokeTauriCommand.mockResolvedValueOnce({ id: "forward-1" }).mockResolvedValueOnce({
      results: [{ ok: true }],
    });

    await createLocalForward({
      direction: "local",
      localHost: "127.0.0.1",
      localPort: 8080,
      remoteHost: "127.0.0.1",
      remotePort: 80,
      sessionId: "session-1",
    });
    await executeSnippetOnHosts("echo ok", [
      { host: hostFixture, id: "host-1", label: "Bastion" },
    ]);

    expect(invokeTauriCommand).toHaveBeenNthCalledWith(1, "termsnip_create_forward", {
      request: {
        direction: "local",
        localHost: "127.0.0.1",
        localPort: 8080,
        remoteHost: "127.0.0.1",
        remotePort: 80,
        sessionId: "session-1",
      },
    });
    expect(invokeTauriCommand).toHaveBeenNthCalledWith(2, "termsnip_execute_snippet_on_hosts", {
      request: {
        command: "echo ok",
        targets: [{ host: hostFixture, id: "host-1", label: "Bastion" }],
      },
    });
  });
});
