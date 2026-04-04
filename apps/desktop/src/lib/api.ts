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
  invokeTauriCommand,
  isTauriRuntime,
  openSessionSocket,
  proxyBackendBinary,
  proxyBackendJson,
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
export type { SessionSocketLike } from "./backend-runtime";

async function backendFetch<T>(path: string, init?: RequestInit) {
  if (isTauriRuntime()) {
    return proxyBackendJson<T>(path, init);
  }

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

async function backendBinaryFetch(path: string, init?: RequestInit) {
  if (isTauriRuntime()) {
    return proxyBackendBinary(path, init);
  }

  const response = await fetch(path, init);

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

  if (isTauriRuntime()) {
    return invokeTauriCommand<SftpDirectoryResponse>("termsnip_sftp_list_directory", {
      request: { host, path },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ ok: boolean; path: string }>("termsnip_sftp_create_directory", {
      request: { host, path },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ ok: boolean; path: string }>("termsnip_sftp_rename_entry", {
      request: { host, currentPath, nextPath },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ ok: boolean }>("termsnip_sftp_delete_entry", {
      request: { host, path, isDirectory },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ ok: boolean; path: string }>("termsnip_sftp_upload_file", {
      request: {
        host,
        path: remotePath,
        filename: file.name,
        contentsBase64: encodeBase64(await file.arrayBuffer()),
      },
    });
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

  if (isTauriRuntime()) {
    const response = await invokeTauriCommand<{
      base64Body: string;
      contentDisposition?: string;
      contentType?: string;
    }>("termsnip_sftp_download_file", {
      request: { host, path },
    });
    const blob = new Blob([decodeBase64ToBytes(response.base64Body)], {
      type: response.contentType ?? "application/octet-stream",
    });
    const header = response.contentDisposition;
    const filename =
      header?.match(/filename="?([^"]+)"?$/)?.[1] ??
      path.split("/").filter(Boolean).slice(-1)[0] ??
      "download";

    return { blob, filename } satisfies DownloadRemoteFileResponse;
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

function decodeBase64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function inspectPrivateKey(path: string) {
  if (isDemoModeEnabled()) {
    return inspectDemoPrivateKey(path);
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<KeyMetadata>("termsnip_inspect_private_key", {
      request: { path },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<KeyMetadata>("termsnip_generate_private_key", {
      request: payload,
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ entries: KnownHostScanResult[] }>("termsnip_scan_known_host", {
      request: { hostname, port },
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<ListForwardsResponse>("termsnip_list_session_forwards", {
      request: { sessionId },
    });
  }

  return backendFetch<ListForwardsResponse>(
    `/api/backend/forwards?sessionId=${encodeURIComponent(sessionId)}`
  );
}

export async function createLocalForward(payload: CreateForwardPayload) {
  if (isDemoModeEnabled()) {
    return createDemoForward(payload);
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<PortForwardRecord>("termsnip_create_forward", {
      request: payload,
    });
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

  if (isTauriRuntime()) {
    return invokeTauriCommand<BackendBooleanResponse>("termsnip_delete_forward", {
      request: { forwardId },
    });
  }

  return backendFetch<BackendBooleanResponse>(`/api/backend/forwards/${forwardId}`, {
    method: "DELETE",
  });
}

export async function executeSnippetOnHosts(command: string, targets: SnippetExecutionTarget[]) {
  if (isDemoModeEnabled()) {
    return executeDemoSnippetOnHosts(command, targets);
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<{ results: SnippetExecutionResult[] }>(
      "termsnip_execute_snippet_on_hosts",
      {
        request: { command, targets },
      }
    );
  }

  return backendFetch<{ results: SnippetExecutionResult[] }>("/api/backend/snippets/execute", {
    method: "POST",
    body: JSON.stringify({ command, targets }),
  });
}

export async function openBackendSessionSocket(sessionId: string) {
  return openSessionSocket(sessionId);
}
