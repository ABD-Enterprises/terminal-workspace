import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { generatePrivateKey, inspectPrivateKey, scanKnownHost } from "./api";

describe("native trust and key tooling API", () => {
  beforeEach(() => {
    invokeTauriCommand.mockReset();
    isTauriRuntime.mockReset();
    isTauriRuntime.mockReturnValue(true);
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
});
