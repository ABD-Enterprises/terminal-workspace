import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  BackendBooleanResponse,
  BackendHostConnection,
  BackendStatusResponse,
  BackendTransportInfo,
  CreateSessionResponse,
  ResizeSessionPayload,
} from "./backend-contract";
import type { SessionConnectionState } from "../types/session";

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

const SESSION_STREAM_EVENT_NAME = "terminal_workspace://session-stream";

let cachedTransportInfoPromise: Promise<BackendTransportInfo> | undefined;

type SessionSocketEventName = "close" | "error" | "message";

interface SessionMessageEvent {
  data: string;
}

interface SessionCloseEvent {
  type: "close";
}

interface SessionErrorEvent {
  type: "error";
  message?: string;
}

interface SessionSocketEventMap {
  close: SessionCloseEvent;
  error: SessionErrorEvent;
  message: SessionMessageEvent;
}

type SessionSocketListener<TEventName extends SessionSocketEventName> = (
  event: SessionSocketEventMap[TEventName]
) => void;

interface SessionStreamEventPayload {
  data?: string;
  kind: "close" | "error" | "message";
  message?: string;
  sessionId: string;
  streamId: string;
}

interface OpenSessionStreamResponse {
  ok: boolean;
  streamId: string;
}

interface SessionStreamRequest {
  sessionId: string;
  streamId?: string;
}

interface SessionStreamSendRequest extends SessionStreamRequest {
  data: string;
}

export interface SessionSocketLike {
  readyState: number;
  addEventListener<TEventName extends SessionSocketEventName>(
    type: TEventName,
    listener: SessionSocketListener<TEventName>
  ): void;
  close: () => void;
  send: (data: string) => void;
}

/**
 * A validated frame delivered over a session socket. Each transport (native
 * Tauri IPC and the browser WebSocket) hands consumers an opaque string per
 * message; this discriminated union is the only shape the terminal pipe
 * understands.
 */
export type SessionFrame =
  | { type: "data"; data: string }
  | { type: "status"; state: SessionConnectionState }
  | { type: "error"; message: string };

const SESSION_CONNECTION_STATES: readonly SessionConnectionState[] = [
  "connecting",
  "connected",
  "disconnected",
  "pendingSecrets",
  "error",
];

/**
 * Parse and validate a raw session-socket frame at the transport boundary.
 * Returns the typed frame, or `null` for anything malformed — invalid JSON, a
 * non-object payload, an unknown `type`, or a missing/mistyped field. Callers
 * drop `null` frames so a single corrupt message can never throw out of the
 * socket message listener and tear down the terminal data pipe.
 */
export function parseSessionFrame(raw: unknown): SessionFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const frame = parsed as Record<string, unknown>;
  switch (frame.type) {
    case "data":
      return typeof frame.data === "string" ? { type: "data", data: frame.data } : null;
    case "status":
      return typeof frame.state === "string" &&
        (SESSION_CONNECTION_STATES as readonly string[]).includes(frame.state)
        ? { type: "status", state: frame.state as SessionConnectionState }
        : null;
    case "error":
      return typeof frame.message === "string"
        ? { type: "error", message: frame.message }
        : null;
    default:
      return null;
  }
}

function getTauriInternals() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    return undefined;
  }

  return internals;
}

function buildAbsoluteBackendUrl(backendBaseUrl: string, path: string) {
  if (!backendBaseUrl) {
    return path;
  }

  return new URL(path, `${backendBaseUrl.replace(/\/+$/, "")}/`).toString();
}

export async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>) {
  const internals = getTauriInternals();
  if (!internals) {
    throw new Error("Tauri runtime is unavailable.");
  }

  return internals.invoke<T>(command, args);
}

async function getNativeTransportInfo() {
  cachedTransportInfoPromise ??= invokeTauriCommand<BackendTransportInfo>("terminal_workspace_transport_info")
    .catch((error) => {
      cachedTransportInfoPromise = undefined;
      throw error;
    });

  return cachedTransportInfoPromise;
}

export function isTauriRuntime() {
  return Boolean(getTauriInternals());
}

export function resetBackendRuntimeCacheForTests() {
  cachedTransportInfoPromise = undefined;
}

export function buildBrowserSessionSocketUrl(
  locationLike: Pick<Location, "host" | "protocol">,
  sessionId: string
) {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws/sessions/${sessionId}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function openBrowserSessionSocket(sessionId: string) {
  if (typeof window === "undefined") {
    throw new Error("Browser window is unavailable.");
  }

  return new WebSocket(buildBrowserSessionSocketUrl(window.location, sessionId));
}

async function listenToSessionStreamEvents(
  handler: (payload: SessionStreamEventPayload) => void
): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SessionStreamEventPayload>(SESSION_STREAM_EVENT_NAME, (event) => {
    handler(event.payload);
  });
}

class NativeSessionSocket implements SessionSocketLike {
  readyState: number = WebSocket.CONNECTING;

  private closed = false;
  private readonly listeners = {
    close: new Set<(event: SessionCloseEvent) => void>(),
    error: new Set<(event: SessionErrorEvent) => void>(),
    message: new Set<(event: SessionMessageEvent) => void>(),
  };
  private pendingEvents: SessionStreamEventPayload[] = [];
  private streamId?: string;
  private unlisten?: UnlistenFn;

  private constructor(private readonly sessionId: string) {}

  static async connect(sessionId: string) {
    const socket = new NativeSessionSocket(sessionId);
    await socket.initialize();
    return socket;
  }

  addEventListener<TEventName extends SessionSocketEventName>(
    type: TEventName,
    listener: SessionSocketListener<TEventName>
  ) {
    if (type === "message") {
      this.listeners.message.add(listener as SessionSocketListener<"message">);
      return;
    }

    if (type === "error") {
      this.listeners.error.add(listener as SessionSocketListener<"error">);
      return;
    }

    this.listeners.close.add(listener as SessionSocketListener<"close">);
  }

  close = () => {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
      return;
    }

    this.readyState = WebSocket.CLOSING;
    void invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_close_backend_session_stream", {
      request: {
        sessionId: this.sessionId,
        streamId: this.streamId,
      } satisfies SessionStreamRequest,
    })
      .catch((error) => {
        this.emit("error", {
          type: "error",
          message: getErrorMessage(error),
        });
      })
      .finally(() => {
        this.finishClose();
      });
  };

  send = (data: string) => {
    if (this.readyState !== WebSocket.OPEN || !this.streamId) {
      return;
    }

    void invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_send_backend_session_stream", {
      request: {
        data,
        sessionId: this.sessionId,
        streamId: this.streamId,
      } satisfies SessionStreamSendRequest,
    }).catch((error) => {
      this.emit("error", {
        type: "error",
        message: getErrorMessage(error),
      });
      this.finishClose();
    });
  };

  private emit<TEventName extends SessionSocketEventName>(
    type: TEventName,
    event: SessionSocketEventMap[TEventName]
  ) {
    if (type === "message") {
      this.listeners.message.forEach((listener) => {
        listener(event as SessionMessageEvent);
      });
      return;
    }

    if (type === "error") {
      this.listeners.error.forEach((listener) => {
        listener(event as SessionErrorEvent);
      });
      return;
    }

    this.listeners.close.forEach((listener) => {
      listener(event as SessionCloseEvent);
    });
  }

  private finishClose() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.pendingEvents = [];
    this.unlisten?.();
    this.unlisten = undefined;
    this.emit("close", { type: "close" });
  }

  private flushPendingEvents() {
    if (!this.streamId || !this.pendingEvents.length) {
      return;
    }

    const pendingEvents = this.pendingEvents;
    this.pendingEvents = [];
    pendingEvents.forEach((event) => {
      this.handleStreamEvent(event);
    });
  }

  private handleStreamEvent(event: SessionStreamEventPayload) {
    if (event.sessionId !== this.sessionId) {
      return;
    }

    if (!this.streamId) {
      this.pendingEvents.push(event);
      return;
    }

    if (event.streamId !== this.streamId) {
      return;
    }

    if (event.kind === "message" && event.data) {
      this.emit("message", { data: event.data });
      return;
    }

    if (event.kind === "error") {
      this.emit("error", {
        type: "error",
        message: event.message,
      });
      return;
    }

    this.finishClose();
  }

  private async initialize() {
    this.unlisten = await listenToSessionStreamEvents((event) => {
      this.handleStreamEvent(event);
    });

    try {
      const response = await invokeTauriCommand<OpenSessionStreamResponse>(
        "terminal_workspace_open_backend_session_stream",
        {
          request: {
            sessionId: this.sessionId,
          } satisfies SessionStreamRequest,
        }
      );

      this.streamId = response.streamId;
      this.readyState = WebSocket.OPEN;
      this.flushPendingEvents();
    } catch (error) {
      this.emit("error", {
        type: "error",
        message: getErrorMessage(error),
      });
      this.finishClose();
      throw error;
    }
  }
}

async function browserFetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `Backend request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function resolveBackendHttpUrl(path: string) {
  if (!isTauriRuntime()) {
    return path;
  }

  const transportInfo = await getNativeTransportInfo().catch(() => ({
    backendBaseUrl: "",
    sessionBridge: "tauri-native" as const,
  }));

  return buildAbsoluteBackendUrl(transportInfo.backendBaseUrl, path);
}

export async function openSessionSocket(sessionId: string): Promise<SessionSocketLike> {
  if (isTauriRuntime()) {
    return NativeSessionSocket.connect(sessionId);
  }

  return openBrowserSessionSocket(sessionId);
}

export async function getSessionBackendStatus() {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendStatusResponse>("terminal_workspace_backend_status");
  }

  return browserFetchJson<BackendStatusResponse>("/api/backend/status");
}

export async function createSession(host: BackendHostConnection) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<CreateSessionResponse>("terminal_workspace_create_backend_session", {
      request: { host },
    });
  }

  return browserFetchJson<CreateSessionResponse>("/api/backend/sessions", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

export async function closeSession(sessionId: string) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_close_backend_session", {
      request: { sessionId },
    });
  }

  return browserFetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function resizeSession(sessionId: string, payload: ResizeSessionPayload) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_resize_backend_session", {
      request: { sessionId, payload },
    });
  }

  return browserFetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
