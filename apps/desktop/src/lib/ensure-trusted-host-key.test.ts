import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKnownHostsStore } from "../store/known-hosts-store";
import type { HostRecord } from "../types/host";

// We exercise the policy short-circuits (the cheap branches) without mocking
// the network scan or the prompt store. That's the contract that's most
// likely to regress when other code paths change. The interactive branches
// stay covered by the manual QA path until P3 adds a Playwright e2e harness.

vi.mock("./api", () => ({
  scanKnownHost: vi.fn(),
}));

const initialKnownHostsState = useKnownHostsStore.getState();

beforeEach(() => {
  useKnownHostsStore.setState({
    ...initialKnownHostsState,
    knownHosts: [],
  });
});

afterEach(() => {
  useKnownHostsStore.setState(initialKnownHostsState);
  vi.clearAllMocks();
});

function makeHost(overrides: Partial<HostRecord> = {}): HostRecord {
  return {
    id: "h1",
    label: "Host 1",
    protocol: "ssh",
    hostname: "h1.example.com",
    username: "deploy",
    port: 22,
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "requireTrusted",
    agentForwarding: false,
    environment: {},
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ensureTrustedHostKey", () => {
  it("short-circuits ok=true for protocols that do not need trust", async () => {
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    const result = await ensureTrustedHostKey(makeHost({ protocol: "telnet" }));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("protocol-does-not-need-trust");
  });

  it("short-circuits ok=true when the host policy is allowUnknown", async () => {
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    const result = await ensureTrustedHostKey(
      makeHost({ hostKeyPolicy: "allowUnknown" })
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("policy-allows-unknown");
  });

  it("short-circuits ok=true when a matching trusted key already exists", async () => {
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    useKnownHostsStore.setState({
      ...initialKnownHostsState,
      knownHosts: [
        {
          id: "h1.example.com:22:ssh-ed25519",
          hostname: "h1.example.com",
          port: 22,
          algorithm: "ssh-ed25519",
          publicKey: "AAAA…",
          fingerprint: "SHA256:demo",
          trustedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const result = await ensureTrustedHostKey(makeHost());
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("already-trusted");
  });

  it("returns ok=false reason=user-non-interactive in non-interactive mode when trust is missing", async () => {
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    const result = await ensureTrustedHostKey(makeHost(), { interactive: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("user-non-interactive");
  });

  it("returns ok=false reason=scan-empty when the scan yields no candidates", async () => {
    const apiModule = await import("./api");
    (apiModule.scanKnownHost as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entries: [],
    });
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    const result = await ensureTrustedHostKey(makeHost());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("scan-empty");
  });

  it("returns ok=false reason=scan-failed when scanKnownHost throws", async () => {
    const apiModule = await import("./api");
    (apiModule.scanKnownHost as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ETIMEDOUT")
    );
    const { ensureTrustedHostKey } = await import("./ensure-trusted-host-key");
    const result = await ensureTrustedHostKey(makeHost());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("scan-failed");
  });
});
