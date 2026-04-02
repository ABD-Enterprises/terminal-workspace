import { isDemoModeEnabled } from "../store/app-store";
import type { PortForwardRecord } from "../types/forward";
import type { KeyMetadata } from "../types/key";
import type {
  BackendBooleanResponse,
  BackendHostConnection,
  CreateForwardPayload,
  DownloadRemoteFileResponse,
  GenerateKeyPayload,
  KnownHostScanResult,
  ListForwardsResponse,
  ResizeSessionPayload,
  SftpDirectoryResponse,
  SnippetExecutionResult,
  SnippetExecutionTarget,
} from "./backend-contract";
import {
  closeSession,
  createSession,
  getSessionBackendStatus,
  openSessionSocket,
  resolveBackendHttpUrl,
  resizeSession,
} from "./backend-runtime";
import {
  createDemoForward,
  createDemoRemoteDirectory,
  deleteDemoForward,
  deleteDemoRemoteEntry,
  downloadDemoRemoteFile,
  executeDemoSnippetOnHosts,
  generateDemoPrivateKey,
  inspectDemoPrivateKey,
  listDemoForwards,
  listDemoRemoteDirectory,
  renameDemoRemoteEntry,
  scanDemoKnownHost,
  uploadDemoRemoteFile,
} from "./demo-backend";

export type {
  BackendHostConnection,
  BackendStatusResponse,
  CreateForwardPayload,
  CreateSessionResponse,
  GenerateKeyPayload,
  KnownHostScanResult,
  ResizeSessionPayload,
  SnippetExecutionResult,
  SnippetExecutionTarget,
} from "./backend-contract";

async function backendFetch<T>(path: string, init?: RequestInit) {
  const response = await fetch(await resolveBackendHttpUrl(path), {
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

async function backendBinaryFetch(path: string, init?: RequestInit) {
  const response = await fetch(await resolveBackendHttpUrl(path), init);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `Backend request failed: ${response.status}`);
  }

  return response;
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

export async function getBackendStatus() {
  if (isDemoModeEnabled()) {
    return { ok: true };
  }

  return getSessionBackendStatus();
}

export async function createBackendSession(host: BackendHostConnection) {
  return createSession(host);
}

export async function closeBackendSession(sessionId: string) {
  return closeSession(sessionId);
}

export async function resizeBackendSession(sessionId: string, payload: ResizeSessionPayload) {
  return resizeSession(sessionId, payload);
}

export async function listRemoteDirectory(host: BackendHostConnection, path: string) {
  if (isDemoModeEnabled()) {
    return listDemoRemoteDirectory(host, path);
  }

  return backendFetch<SftpDirectoryResponse>("/api/backend/sftp/list", {
    method: "POST",
    body: JSON.stringify({ host, path }),
  });
}

export async function createRemoteDirectory(host: BackendHostConnection, path: string) {
  if (isDemoModeEnabled()) {
    return createDemoRemoteDirectory(host, path);
  }

  return backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/mkdir", {
    method: "POST",
    body: JSON.stringify({ host, path }),
  });
}

export async function renameRemoteEntry(
  host: BackendHostConnection,
  currentPath: string,
  nextPath: string
) {
  if (isDemoModeEnabled()) {
    return renameDemoRemoteEntry(host, currentPath, nextPath);
  }

  return backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/rename", {
    method: "POST",
    body: JSON.stringify({ host, currentPath, nextPath }),
  });
}

export async function deleteRemoteEntry(
  host: BackendHostConnection,
  path: string,
  isDirectory: boolean
) {
  if (isDemoModeEnabled()) {
    return deleteDemoRemoteEntry(host, path, isDirectory);
  }

  return backendFetch<{ ok: boolean }>("/api/backend/sftp/delete", {
    method: "POST",
    body: JSON.stringify({ host, path, isDirectory }),
  });
}

export async function uploadRemoteFile(
  host: BackendHostConnection,
  remotePath: string,
  file: File
) {
  if (isDemoModeEnabled()) {
    return uploadDemoRemoteFile(host, remotePath, file);
  }

  return backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/upload", {
    method: "POST",
    body: JSON.stringify({
      host,
      path: remotePath,
      filename: file.name,
      contentsBase64: encodeBase64(await file.arrayBuffer()),
    }),
  });
}

export async function downloadRemoteFile(host: BackendHostConnection, path: string) {
  if (isDemoModeEnabled()) {
    return downloadDemoRemoteFile(host, path);
  }

  const response = await backendBinaryFetch("/api/backend/sftp/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ host, path }),
  });
  const blob = await response.blob();
  const header = response.headers.get("content-disposition");
  const filename =
    header?.match(/filename="?([^"]+)"?$/)?.[1] ??
    path.split("/").filter(Boolean).slice(-1)[0] ??
    "download";

  return { blob, filename } satisfies DownloadRemoteFileResponse;
}

export async function inspectPrivateKey(path: string) {
  if (isDemoModeEnabled()) {
    return inspectDemoPrivateKey(path);
  }

  return backendFetch<KeyMetadata>("/api/backend/keys/inspect", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function generatePrivateKey(payload: GenerateKeyPayload) {
  if (isDemoModeEnabled()) {
    return generateDemoPrivateKey(payload);
  }

  return backendFetch<KeyMetadata>("/api/backend/keys/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scanKnownHost(hostname: string, port: number) {
  if (isDemoModeEnabled()) {
    return scanDemoKnownHost(hostname, port);
  }

  return backendFetch<{ entries: KnownHostScanResult[] }>("/api/backend/known-hosts/scan", {
    method: "POST",
    body: JSON.stringify({ hostname, port }),
  });
}

export async function listLocalForwards(sessionId: string) {
  if (isDemoModeEnabled()) {
    return listDemoForwards(sessionId);
  }

  return backendFetch<ListForwardsResponse>(
    `/api/backend/forwards?sessionId=${encodeURIComponent(sessionId)}`
  );
}

export async function createLocalForward(payload: CreateForwardPayload) {
  if (isDemoModeEnabled()) {
    return createDemoForward(payload);
  }

  return backendFetch<PortForwardRecord>("/api/backend/forwards", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteLocalForward(forwardId: string) {
  if (isDemoModeEnabled()) {
    return deleteDemoForward(forwardId);
  }

  return backendFetch<BackendBooleanResponse>(`/api/backend/forwards/${forwardId}`, {
    method: "DELETE",
  });
}

export async function executeSnippetOnHosts(command: string, targets: SnippetExecutionTarget[]) {
  if (isDemoModeEnabled()) {
    return executeDemoSnippetOnHosts(command, targets);
  }

  return backendFetch<{ results: SnippetExecutionResult[] }>("/api/backend/snippets/execute", {
    method: "POST",
    body: JSON.stringify({ command, targets }),
  });
}

export async function openBackendSessionSocket(sessionId: string) {
  return openSessionSocket(sessionId);
}
