import { describe, expect, it } from "vitest";
import { shouldScheduleReconnect } from "./connect-failure-policy";

describe("shouldScheduleReconnect (#373)", () => {
  it("never retries after a host key mismatch, even for a previously connected pane", () => {
    expect(
      shouldScheduleReconnect("host_key_mismatch", { connectedOnce: true, reconnectOnRestore: true })
    ).toBe(false);
    expect(
      shouldScheduleReconnect("host_key_mismatch", { connectedOnce: false, reconnectOnRestore: false })
    ).toBe(false);
  });

  it("keeps the previous behaviour for every other category", () => {
    for (const category of ["timeout", "refused", "auth_failed", "network_unreachable", "dns_failure", "unknown"] as const) {
      expect(shouldScheduleReconnect(category, { connectedOnce: true, reconnectOnRestore: false })).toBe(true);
      expect(shouldScheduleReconnect(category, { connectedOnce: false, reconnectOnRestore: true })).toBe(true);
      expect(shouldScheduleReconnect(category, { connectedOnce: false, reconnectOnRestore: false })).toBe(false);
    }
  });
});
