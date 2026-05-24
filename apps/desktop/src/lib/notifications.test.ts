import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/app-store";
import { ensureNotificationPermission, fireNotification } from "./notifications";

describe("notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.setState({ notificationsEnabled: false });
  });

  it("requests permission and sends enabled notifications", async () => {
    const notificationCtor = vi.fn();
    Object.assign(notificationCtor, {
      permission: "default",
      requestPermission: vi.fn(async () => "granted"),
    });
    vi.stubGlobal("Notification", notificationCtor);
    vi.stubGlobal("window", { Notification: notificationCtor });
    useAppStore.setState({ notificationsEnabled: true });

    await expect(ensureNotificationPermission()).resolves.toBe(true);
    Object.assign(notificationCtor, { permission: "granted" });
    await expect(
      fireNotification({
        body: "An SSH session ended.",
        kind: "session-disconnected",
        title: "Session disconnected",
      }),
    ).resolves.toBe(true);

    expect(notificationCtor).toHaveBeenCalledWith("Session disconnected", {
      body: "An SSH session ended.",
      tag: "session-disconnected",
    });
  });

  it("no-ops when disabled or unsupported", async () => {
    vi.stubGlobal("window", {});

    await expect(ensureNotificationPermission()).resolves.toBe(false);
    await expect(
      fireNotification({
        body: "done",
        kind: "snippet-finished",
        title: "Snippet finished",
      }),
    ).resolves.toBe(false);
  });
});
