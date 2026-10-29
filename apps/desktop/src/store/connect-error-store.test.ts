import { describe, expect, it, beforeEach } from "vitest";
import { reportConnectError, useConnectErrorStore } from "./connect-error-store";

// The connect-failure channel exists because every connect failure used to
// be computed correctly and then dropped into a console.warn at each call
// site, so a host that was down, firewalled, or mis-typed produced no
// on-screen output at all. These tests pin the reporting contract.

describe("connect-error-store", () => {
  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
  });

  it("starts with no message", () => {
    expect(useConnectErrorStore.getState().message).toBeNull();
    expect(useConnectErrorStore.getState().tone).toBe("error");
  });

  it("reports a message with the error tone by default", () => {
    reportConnectError("Could not scan host:22.");

    expect(useConnectErrorStore.getState().message).toBe("Could not scan host:22.");
    expect(useConnectErrorStore.getState().tone).toBe("error");
  });

  it("reports a user-initiated failure as a warning", () => {
    reportConnectError("Connection cancelled — host key was not trusted.", "warning");

    expect(useConnectErrorStore.getState().tone).toBe("warning");
  });

  it("ignores an empty message so no blank banner can render", () => {
    reportConnectError("");
    reportConnectError(null);
    reportConnectError(undefined);

    expect(useConnectErrorStore.getState().message).toBeNull();
  });

  it("replaces the previous message rather than stacking failures", () => {
    reportConnectError("First failure.");
    reportConnectError("Second failure.");

    expect(useConnectErrorStore.getState().message).toBe("Second failure.");
  });

  it("clears the message", () => {
    reportConnectError("Something failed.");
    useConnectErrorStore.getState().clearConnectError();

    expect(useConnectErrorStore.getState().message).toBeNull();
  });
});
