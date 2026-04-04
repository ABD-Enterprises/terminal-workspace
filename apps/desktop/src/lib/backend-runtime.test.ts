import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserSessionSocketUrl,
  closeSession,
  createSession,
  getSessionBackendStatus,
  isTauriRuntime,
  openSessionSocket,
  proxyBackendBinary,
  proxyBackendJson,
  resetBackendRuntimeCacheForTests,
  resizeSession,
  resolveBackendHttpUrl,
} from "./backend-runtime";
import type { BackendHostConnection } from "./backend-contract";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

const hostFixture: BackendHostConnection = {
  agentForwarding: false,
  authMethod: "privateKey",
  environment: {},
  hostname: "native.internal",
  password: "",
  passphrase: "",
  port: 22,
  privateKeyPath: "~/.ssh/id_ed25519",
  username: "ops",
};

function setWindowStub(windowStub: unknown) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowStub,
    writable: true,
  });
}

afterEach(() => {
  resetBackendRuntimeCacheForTests();
  vi.restoreAllMocks();

  if (originalWindow) {
    setWindowStub(originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
    writable: true,
  });

  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: originalWebSocket,
    writable: true,
  });
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

  it("uses fetch for browser backend status and session lifecycle calls", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, sessionId: "session-1" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        })
      )
    );
    Reflect.deleteProperty(globalThis, "window");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });

    await getSessionBackendStatus();
    await createSession(hostFixture);
    await closeSession("session-1");
    await resizeSession("session-1", { cols: 120, rows: 40 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/backend/status", {
      headers: { "Content-Type": "application/json" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/backend/sessions", {
      body: JSON.stringify({ host: hostFixture }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/backend/sessions/session-1", {
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/backend/sessions/session-1/resize", {
      body: JSON.stringify({ cols: 120, rows: 40 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("uses the tauri invoke bridge for native backend status, lifecycle, and proxy calls", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ sessionId: "native-session" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        base64Body: "YmluYXJ5",
        contentType: "application/octet-stream",
      });
    setWindowStub({
      __TAURI_INTERNALS__: { invoke },
    });

    await getSessionBackendStatus();
    await createSession(hostFixture);
    await closeSession("native-session");
    await resizeSession("native-session", { cols: 80, rows: 24 });
    await proxyBackendJson("/api/backend/known-hosts/scan", {
      body: JSON.stringify({ hostname: "native.internal", port: 22 }),
      method: "POST",
    });
    const binaryResponse = await proxyBackendBinary("/api/backend/sftp/download", {
      body: JSON.stringify({ host: hostFixture, path: "README.txt" }),
      method: "POST",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "termsnip_backend_status", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "termsnip_create_backend_session", {
      request: { host: hostFixture },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "termsnip_close_backend_session", {
      request: { sessionId: "native-session" },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "termsnip_resize_backend_session", {
      request: { payload: { cols: 80, rows: 24 }, sessionId: "native-session" },
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "termsnip_proxy_backend_json", {
      request: {
        body: { hostname: "native.internal", port: 22 },
        method: "POST",
        path: "/api/backend/known-hosts/scan",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "termsnip_proxy_backend_binary", {
      request: {
        body: { host: hostFixture, path: "README.txt" },
        method: "POST",
        path: "/api/backend/sftp/download",
      },
    });
    await expect(binaryResponse.text()).resolves.toBe("binary");
  });

  it("opens browser session sockets with the computed websocket URL", async () => {
    const sockets: { url: string }[] = [];

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.OPEN;

      constructor(public url: string) {
        sockets.push({ url });
      }

      addEventListener() {}
      close() {}
      send() {}
    }

    setWindowStub({ location: { host: "workspace.local:5173", protocol: "http:" } });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
      writable: true,
    });

    await openSessionSocket("session-123");

    expect(sockets[0]?.url).toBe("ws://workspace.local:5173/ws/sessions/session-123");
  });
});
