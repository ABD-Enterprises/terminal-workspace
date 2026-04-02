import type {
  BackendBooleanResponse,
  BackendHostConnection,
  BackendStatusResponse,
  BackendTransportInfo,
  CreateSessionResponse,
  ResizeSessionPayload,
} from "./backend-contract";

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

const DEFAULT_NATIVE_BACKEND_BASE_URL = "http://127.0.0.1:8790";

let cachedTransportInfoPromise: Promise<BackendTransportInfo> | undefined;

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

async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>) {
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

export function buildBackendSessionSocketUrl(backendBaseUrl: string, sessionId: string) {
  const backendUrl = new URL(backendBaseUrl);
  const protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${backendUrl.host}/ws/sessions/${sessionId}`;
}

async function openBrowserSessionSocket(sessionId: string) {
  if (typeof window === "undefined") {
    throw new Error("Browser window is unavailable.");
  }

  return new WebSocket(buildBrowserSessionSocketUrl(window.location, sessionId));
}

async function openNativeSessionSocket(sessionId: string) {
  const { backendBaseUrl } = await getNativeTransportInfo();
  return new WebSocket(buildBackendSessionSocketUrl(backendBaseUrl, sessionId));
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
    backendBaseUrl: DEFAULT_NATIVE_BACKEND_BASE_URL,
    sessionBridge: "tauri-proxy" as const,
  }));

  return buildAbsoluteBackendUrl(transportInfo.backendBaseUrl, path);
}

export async function openSessionSocket(sessionId: string) {
  if (isTauriRuntime()) {
    return openNativeSessionSocket(sessionId);
  }

  return openBrowserSessionSocket(sessionId);
}

export async function getSessionBackendStatus() {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendStatusResponse>("termsnip_backend_status");
  }

  return browserFetchJson<BackendStatusResponse>("/api/backend/status");
}

export async function createSession(host: BackendHostConnection) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<CreateSessionResponse>("termsnip_create_backend_session", {
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
    return invokeTauriCommand<BackendBooleanResponse>("termsnip_close_backend_session", {
      request: { sessionId },
    });
  }

  return browserFetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function resizeSession(sessionId: string, payload: ResizeSessionPayload) {
  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("termsnip_resize_backend_session", {
      request: { sessionId, payload },
    });
  }

  return browserFetchJson<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
