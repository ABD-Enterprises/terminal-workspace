import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  BackendBooleanResponse,
  BackendHostConnection,
  BackendStatusResponse,
  BackendTransportInfo,
  CreateSessionResponse,
  ResizeSessionPayload,
} from "./backend-contract";
import { fetchJson } from "./http";

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

const DEFAULT_NATIVE_BACKEND_BASE_URL = "http://127.0.0.1:8790";
const SESSION_STREAM_EVENT_NAME = "termsnip://session-stream";

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

interface BackendProxyRequest {
  body?: unknown;
  method: string;
  path: string;
}

interface BackendBinaryProxyResponse {
  base64Body: string;
  contentDisposition?: string;
  contentType?: string;
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
  cachedTransportInfoPromise ??= invokeTauriCommand<BackendTransportInfo>("termsnip_transport_info")
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

function decodeBase64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function parseProxyRequestBody(body?: BodyInit | null) {
  if (!body) {
    return undefined;
  }

  if (typeof body === "string") {
    return body ? JSON.parse(body) : undefined;
  }

  throw new Error("Native backend proxy only supports JSON string bodies.");
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
    void invokeTauriCommand<BackendBooleanResponse>("termsnip_close_backend_session_stream", {
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

    void invokeTauriCommand<BackendBooleanResponse>("termsnip_send_backend_session_stream", {
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
        "termsnip_open_backend_session_stream",
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

/**
 * @deprecated P2-NET — kept for backward compatibility but no longer used
 * in real flows. Every API call in `lib/api.ts` either invokes a first-
 * class `termsnip_*` Tauri command or falls through to the browser-mode
 * `fetch()` path; nothing routes through `proxyBackendJson` anymore.
 * Slated for removal in 0.2.0 alongside the matching
 * `termsnip_proxy_backend_json` Rust command and the `BackendBridge`
 * HTTP client.
 */
export async function proxyBackendJson<T>(path: string, init?: RequestInit) {
  return invokeTauriCommand<T>("termsnip_proxy_backend_json", {
    request: {
      body: parseProxyRequestBody(init?.body),
      method: init?.method ?? "GET",
      path,
    } satisfies BackendProxyRequest,
  });
}

/** @deprecated P2-NET — see {@link proxyBackendJson} for the removal contract. */
export async function proxyBackendBinary(path: string, init?: RequestInit) {
  const response = await invokeTauriCommand<BackendBinaryProxyResponse>(
    "termsnip_proxy_backend_binary",
    {
      request: {
        body: parseProxyRequestBody(init?.body),
        method: init?.method ?? "GET",
        path,
      } satisfies BackendProxyRequest,
    }
  );

  return new Response(decodeBase64ToBytes(response.base64Body), {
    headers: {
      ...(response.contentDisposition
        ? { "content-disposition": response.contentDisposition }
        : undefined),
      ...(response.contentType ? { "content-type": response.contentType } : undefined),
    },
    status: 200,
  });
}

export async function resolveBackendHttpUrl(path: string) {
  if (!isTauriRuntime()) {
    return path;
  }

  const transportInfo = await getNativeTransportInfo().catch(() => ({
    backendBaseUrl: DEFAULT_NATIVE_BACKEND_BASE_URL,
    sessionBridge: "tauri-proxy" as const,
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
    return invokeTauriCommand<BackendStatusResponse>("termsnip_backend_status");
  }

  return fetchJson<BackendStatusResponse>("/api/backend/status");
}

export async function createSession(host: BackendHostConnection) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<CreateSessionResponse>("termsnip_create_backend_session", {
      request: { host },
    });
  }

  return fetchJson<CreateSessionResponse>("/api/backend/sessions", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

export async function closeSession(sessionId: string) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("termsnip_close_backend_session", {
      request: { sessionId },
    });
  }

  return fetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function resizeSession(sessionId: string, payload: ResizeSessionPayload) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("termsnip_resize_backend_session", {
      request: { sessionId, payload },
    });
  }

  return fetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
