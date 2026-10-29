import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchHostSession } from "./launch-host-session";
import type { HostRecord } from "../types/host";
import { useConnectErrorStore } from "../store/connect-error-store";

// M07 / #89: regression test for the per-host mutex. Two rapid
// launchHostSession calls for the same host id used to spawn two
// parallel ensureTrustedHostKey flows (duplicate trust prompts +
// possible duplicate known-hosts entries). The mutex returns the same
// Promise for both.

vi.mock("./ensure-trusted-host-key", () => ({
  ensureTrustedHostKey: vi.fn(),
}));

vi.mock("../store/hosts-store", () => ({
  useHostsStore: {
    getState: () => ({
      markConnected: vi.fn(),
    }),
  },
}));

vi.mock("../store/sessions-store", () => ({
  useSessionsStore: {
    getState: () => ({
      openSession: vi.fn(() => "tab-123"),
    }),
  },
}));

import { ensureTrustedHostKey } from "./ensure-trusted-host-key";

function host(id: string): HostRecord {
  return {
    id,
    label: `host-${id}`,
    protocol: "ssh",
    hostname: `${id}.example.com`,
    username: "u",
    port: 22,
    authMethod: "none",
    privateKeyPath: "",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "allowUnknown",
    agentForwarding: false,
    environment: {},
    jumpHostId: undefined,
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("launchHostSession per-host mutex (M07)", () => {
  beforeEach(() => {
    vi.mocked(ensureTrustedHostKey).mockReset();
    useConnectErrorStore.getState().clearConnectError();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates concurrent calls for the same host id", async () => {
    let resolveTrust: (value: { ok: true }) => void = () => undefined;
    vi.mocked(ensureTrustedHostKey).mockImplementation(
      () => new Promise((resolve) => (resolveTrust = resolve as typeof resolveTrust))
    );

    const promiseA = launchHostSession(host("a"));
    const promiseB = launchHostSession(host("a"));

    // Both calls should see the same in-flight promise — only one
    // ensureTrustedHostKey invocation.
    expect(ensureTrustedHostKey).toHaveBeenCalledTimes(1);

    resolveTrust({ ok: true });
    const [a, b] = await Promise.all([promiseA, promiseB]);

    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it("does not deduplicate calls for different host ids", async () => {
    vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: true });

    await Promise.all([
      launchHostSession(host("a")),
      launchHostSession(host("b")),
    ]);

    expect(ensureTrustedHostKey).toHaveBeenCalledTimes(2);
  });

  it("clears the mutex after completion so a second legitimate call goes through", async () => {
    vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: true });

    await launchHostSession(host("a"));
    await launchHostSession(host("a"));

    expect(ensureTrustedHostKey).toHaveBeenCalledTimes(2);
  });

  it("clears the mutex when ensureTrustedHostKey rejects", async () => {
    // A throwing trust scan used to reject out of launchHostSession. None of
    // the call sites have a try/catch, so that surfaced as an unhandled
    // rejection with nothing on screen. It now resolves with ok=false and
    // publishes the failure — see the "failure reporting" suite below.
    vi.mocked(ensureTrustedHostKey).mockRejectedValueOnce(new Error("network"));
    const failed = await launchHostSession(host("a"));
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("trust-scan-threw");

    // Next call should not be blocked by the stuck mutex.
    vi.mocked(ensureTrustedHostKey).mockResolvedValueOnce({ ok: true });
    const result = await launchHostSession(host("a"));
    expect(result.ok).toBe(true);
  });
});

// Every connect entry point — hosts page, quick-connect, sidebar, command
// palette, welcome panel — funnels through launchHostSession. Publishing the
// failure here is what guarantees the user sees WHY the connect failed;
// previously the message was computed and then dropped into a console.warn,
// so an unreachable host produced no on-screen output at all.
describe("launchHostSession failure reporting", () => {
  beforeEach(() => {
    vi.mocked(ensureTrustedHostKey).mockReset();
    useConnectErrorStore.getState().clearConnectError();
  });

  it("publishes a scan failure to the connect-error store", async () => {
    vi.mocked(ensureTrustedHostKey).mockResolvedValue({
      ok: false,
      reason: "scan-failed",
    });

    const result = await launchHostSession(host("a"));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("scan-failed");
    expect(useConnectErrorStore.getState().message).toBe(
      "Could not scan a.example.com:22. Check that the host is reachable and try again."
    );
    expect(useConnectErrorStore.getState().tone).toBe("error");
  });

  it("publishes a rejected fingerprint as a warning, not an error", async () => {
    vi.mocked(ensureTrustedHostKey).mockResolvedValue({
      ok: false,
      reason: "user-rejected",
    });

    const result = await launchHostSession(host("a"));

    expect(result.reason).toBe("user-rejected-fingerprint");
    expect(useConnectErrorStore.getState().tone).toBe("warning");
    expect(useConnectErrorStore.getState().message).toContain("Connection cancelled");
  });

  it("publishes a thrown trust scan instead of rejecting", async () => {
    vi.mocked(ensureTrustedHostKey).mockRejectedValue(new Error("network"));

    const result = await launchHostSession(host("a"));

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("trust-scan-threw");
    expect(useConnectErrorStore.getState().message).toContain("Could not reach");
    expect(useConnectErrorStore.getState().tone).toBe("error");
  });

  it("clears a stale failure once a connect succeeds", async () => {
    vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: false, reason: "scan-failed" });
    await launchHostSession(host("a"));
    expect(useConnectErrorStore.getState().message).not.toBeNull();

    vi.mocked(ensureTrustedHostKey).mockResolvedValue({ ok: true });
    await launchHostSession(host("b"));

    expect(useConnectErrorStore.getState().message).toBeNull();
  });
});
