import { afterEach, describe, expect, it } from "vitest";
import {
  buildBackendSessionSocketUrl,
  buildBrowserSessionSocketUrl,
  isTauriRuntime,
  resetBackendRuntimeCacheForTests,
  resolveBackendHttpUrl,
} from "./backend-runtime";

const originalWindow = globalThis.window;

function setWindowStub(windowStub: unknown) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowStub,
    writable: true,
  });
}

afterEach(() => {
  resetBackendRuntimeCacheForTests();

  if (originalWindow) {
    setWindowStub(originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("backend runtime bridge", () => {
  it("builds browser websocket URLs from the active window location", () => {
    expect(
      buildBrowserSessionSocketUrl(
        {
          host: "workspace.local:5173",
          protocol: "https:",
        } as Location,
        "session-123"
      )
    ).toBe("wss://workspace.local:5173/ws/sessions/session-123");
  });

  it("builds backend websocket URLs from an absolute backend origin", () => {
    expect(buildBackendSessionSocketUrl("http://127.0.0.1:8790", "session-abc")).toBe(
      "ws://127.0.0.1:8790/ws/sessions/session-abc"
    );
  });

  it("detects the tauri runtime when native internals are present", () => {
    setWindowStub({
      __TAURI_INTERNALS__: {
        invoke: async () => ({ backendBaseUrl: "http://127.0.0.1:8790", sessionBridge: "tauri-proxy" }),
      },
    });

    expect(isTauriRuntime()).toBe(true);
  });

  it("keeps browser builds on relative backend paths", async () => {
    Reflect.deleteProperty(globalThis, "window");

    await expect(resolveBackendHttpUrl("/api/backend/status")).resolves.toBe("/api/backend/status");
  });

  it("resolves native backend URLs through the tauri transport bridge", async () => {
    setWindowStub({
      __TAURI_INTERNALS__: {
        invoke: async () => ({
          backendBaseUrl: "http://127.0.0.1:8899",
          sessionBridge: "tauri-proxy",
        }),
      },
    });

    await expect(resolveBackendHttpUrl("/api/backend/status")).resolves.toBe(
      "http://127.0.0.1:8899/api/backend/status"
    );
  });
});
