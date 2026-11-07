// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type SessionConnectionState } from "../../types/session";
import { describePaneStatus, usePaneStatusAnnouncement } from "./use-pane-status-announcement";

function setup(initial: SessionConnectionState, active = true) {
  return renderHook(
    ({ state, isActive }: { state: SessionConnectionState; isActive: boolean }) =>
      usePaneStatusAnnouncement(state, "Prod", isActive),
    { initialProps: { state: initial, isActive: active } }
  );
}

describe("usePaneStatusAnnouncement (#510)", () => {
  it("says nothing for the state a pane starts in", () => {
    const { result } = setup("connected");
    expect(result.current).toBe("");
  });

  it("announces each change in the active pane once", () => {
    const { result, rerender } = setup("connecting");
    rerender({ state: "connected", isActive: true });
    expect(result.current).toBe("Prod: connected.");
    rerender({ state: "connected", isActive: true });
    expect(result.current).toBe("Prod: connected.");
    rerender({ state: "disconnected", isActive: true });
    expect(result.current).toBe("Prod: disconnected.");
    rerender({ state: "pendingSecrets", isActive: true });
    expect(result.current).toBe("Prod: needs a password or passphrase to connect.");
  });

  it("keeps an inactive pane silent, and does not catch up when it becomes active", () => {
    const { result, rerender } = setup("connecting", false);
    rerender({ state: "connected", isActive: false });
    expect(result.current).toBe("");
    rerender({ state: "connected", isActive: true });
    expect(result.current).toBe("");
  });

  it("clears the live region when the pane stops being active", () => {
    const { result, rerender } = setup("connecting");
    rerender({ state: "connected", isActive: true });
    rerender({ state: "connected", isActive: false });
    expect(result.current).toBe("");
  });

  it("leaves errors to the pane's alert banner and skips connecting", () => {
    expect(describePaneStatus("error", "Prod")).toBeNull();
    expect(describePaneStatus("connecting", "Prod")).toBeNull();
  });
});
