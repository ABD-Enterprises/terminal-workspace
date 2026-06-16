import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserSessionSocketUrl,
  closeSession,
  createSession,
  getSessionBackendStatus,
  isTauriRuntime,
  openSessionSocket,
  resetBackendRuntimeCacheForTests,
  resizeSession,
  resolveBackendHttpUrl,
} from "./backend-runtime";
import type { BackendHostConnection } from "./backend-contract";

// #101 native-path coverage: the native session socket consumes Tauri
// `terminal_workspace://session-stream` events. Capture the registered listener so
// tests can drive the event sequence the Rust session loop emits. This is
// the renderer half of every native terminal session and was previously
// untested — all session tests ran in browser/mock mode.
const eventBus = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  return {
    handlers,
    emit(payload: unknown) {
      for (const handler of handlers) {
        handler({ payload });
      }
    },
    reset() {
      handlers.length = 0;
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    eventBus.handlers.push(handler);
    return () => {
      const index = eventBus.handlers.indexOf(handler);
      if (index >= 0) {
        eventBus.handlers.splice(index, 1);
      }
    };
  }),
}));

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
  protocol: "ssh",
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
  eventBus.reset();
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
        invoke: async () => ({ backendBaseUrl: "", sessionBridge: "tauri-native" }),
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
          sessionBridge: "tauri-native",
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

  it("uses the tauri invoke bridge for native backend status and lifecycle calls", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ sessionId: "native-session" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    setWindowStub({
      __TAURI_INTERNALS__: { invoke },
    });

    await getSessionBackendStatus();
    await createSession(hostFixture);
    await closeSession("native-session");
    await resizeSession("native-session", { cols: 80, rows: 24 });

    expect(invoke).toHaveBeenNthCalledWith(1, "terminal_workspace_backend_status", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "terminal_workspace_create_backend_session", {
      request: { host: hostFixture },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "terminal_workspace_close_backend_session", {
      request: { sessionId: "native-session" },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "terminal_workspace_resize_backend_session", {
      request: { payload: { cols: 80, rows: 24 }, sessionId: "native-session" },
    });
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

    expect(sockets[0]?.url).toBe(["ws", "://workspace.local:5173/ws/sessions/session-123"].join(""));
  });

  // ---- Native session socket lifecycle (#101) ---------------------------
  // The path the real Tauri app uses for every terminal session. Drives the
  // full handshake: open stream -> deliver matching-stream messages -> drop
  // foreign-stream events -> close. Previously zero coverage, which is how
  // "all tests green" coexisted with "the terminal does not work" in the
  // shipped native build.

  it("native socket opens a stream via the tauri invoke bridge", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "terminal_workspace_open_backend_session_stream") {
        return { ok: true, streamId: "stream-1" };
      }
      return { ok: true };
    });
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");

    expect(invoke).toHaveBeenCalledWith("terminal_workspace_open_backend_session_stream", {
      request: { sessionId: "sess-1" },
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("native socket delivers messages tagged with its own streamId", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "terminal_workspace_open_backend_session_stream"
        ? { ok: true, streamId: "stream-1" }
        : { ok: true }
    );
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");
    const messages: string[] = [];
    socket.addEventListener("message", (event) => messages.push(event.data));

    eventBus.emit({
      sessionId: "sess-1",
      streamId: "stream-1",
      kind: "message",
      data: "hello from pty",
    });

    expect(messages).toEqual(["hello from pty"]);
  });

  it("native socket ignores events for a different session or stream", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "terminal_workspace_open_backend_session_stream"
        ? { ok: true, streamId: "stream-1" }
        : { ok: true }
    );
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");
    const messages: string[] = [];
    socket.addEventListener("message", (event) => messages.push(event.data));

    // Wrong session id, and wrong stream id — both must be dropped.
    eventBus.emit({ sessionId: "other", streamId: "stream-1", kind: "message", data: "x" });
    eventBus.emit({ sessionId: "sess-1", streamId: "stream-9", kind: "message", data: "y" });

    expect(messages).toEqual([]);
  });

  it("native socket send() forwards input through the tauri bridge", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "terminal_workspace_open_backend_session_stream"
        ? { ok: true, streamId: "stream-1" }
        : { ok: true }
    );
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");
    socket.send("ls -la\n");

    expect(invoke).toHaveBeenCalledWith("terminal_workspace_send_backend_session_stream", {
      request: { data: "ls -la\n", sessionId: "sess-1", streamId: "stream-1" },
    });
  });

  it("native socket finishes on a close event", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "terminal_workspace_open_backend_session_stream"
        ? { ok: true, streamId: "stream-1" }
        : { ok: true }
    );
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");
    let closed = false;
    socket.addEventListener("close", () => {
      closed = true;
    });

    eventBus.emit({ sessionId: "sess-1", streamId: "stream-1", kind: "close" });

    expect(closed).toBe(true);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("native socket surfaces error events to error listeners", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "terminal_workspace_open_backend_session_stream"
        ? { ok: true, streamId: "stream-1" }
        : { ok: true }
    );
    setWindowStub({ __TAURI_INTERNALS__: { invoke } });

    const socket = await openSessionSocket("sess-1");
    const errors: (string | undefined)[] = [];
    socket.addEventListener("error", (event) => errors.push(event.message));

    eventBus.emit({
      sessionId: "sess-1",
      streamId: "stream-1",
      kind: "error",
      message: "ssh channel closed unexpectedly",
    });

    expect(errors).toEqual(["ssh channel closed unexpectedly"]);
  });
});
