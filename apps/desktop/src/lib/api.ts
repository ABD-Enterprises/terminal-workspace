import { isDemoModeEnabled } from "../store/app-store";
import type { PortForwardRecord } from "../types/forward";
import type { HostProtocol } from "../types/host";
import type { KeyMetadata } from "../types/key";
import type {
  BackendBooleanResponse,
  BackendHostConnection,
  BackendStatusResponse,
  CopyKeyToHostPayload,
  CopyKeyToHostResponse,
  CreateForwardPayload,
  CreateSessionResponse,
  DownloadRemoteFileResponse,
  GenerateKeyPayload,
  ImportPrivateKeyFromBodyPayload,
  KnownHostScanResult,
  ListForwardsResponse,
  ProtocolRuntimeStatusResponse,
  ResizeSessionPayload,
  SftpDirectoryResponse,
  SnippetExecutionResult,
  SnippetExecutionTarget,
} from "./backend-contract";
import {
  closeSession,
  createSession,
  invokeTauriCommand,
  isTauriRuntime,
  openSessionSocket,
  resizeSession,
} from "./backend-runtime";
import type { Backend } from "./backend-runtime";
import {
  copyDemoKeyToHost,
  createDemoForward,
  createDemoRemoteDirectory,
  deleteDemoForward,
  deleteDemoRemoteEntry,
  downloadDemoRemoteFile,
  executeDemoSnippetOnHosts,
  generateDemoPrivateKey,
  importDemoPrivateKeyFromBody,
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

/**
 * Fetch JSON from the Node backend. Browser-mode fallback only — every
 * native (Tauri) caller short-circuits to a `terminal_workspace_*` invokeTauriCommand
 * before reaching here. P2-NET removed the now-dead native proxy path; the Tauri shell
 * is the source of truth in native and never needs to hit the Node
 * backend's HTTP surface anymore.
 */
async function backendFetch<T>(path: string, init?: RequestInit) {
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

/**
 * Browser-mode binary fetch. See `backendFetch` — the dead Tauri-runtime
 * branch was removed in P2-NET.
 */
async function backendBinaryFetch(path: string, init?: RequestInit) {
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

function decodeBase64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

const demoBackend: Backend = {
  getBackendStatus: async () => ({ ok: true }),
  getProtocolRuntimeStatus: async (protocol) => ({
    available: true,
    message: "Demo mode bypasses native protocol runtime checks.",
    protocol,
  }),
  createBackendSession: createSession,
  closeBackendSession: closeSession,
  resizeBackendSession: resizeSession,
  listRemoteDirectory: listDemoRemoteDirectory,
  createRemoteDirectory: createDemoRemoteDirectory,
  renameRemoteEntry: renameDemoRemoteEntry,
  deleteRemoteEntry: deleteDemoRemoteEntry,
  uploadRemoteFile: uploadDemoRemoteFile,
  downloadRemoteFile: downloadDemoRemoteFile,
  inspectPrivateKey: inspectDemoPrivateKey,
  generatePrivateKey: generateDemoPrivateKey,
  importPrivateKeyFromBody: (payload) => importDemoPrivateKeyFromBody(payload),
  copyKeyToHost: (payload) => copyDemoKeyToHost(payload),
  scanKnownHost: scanDemoKnownHost,
  listLocalForwards: listDemoForwards,
  createLocalForward: createDemoForward,
  deleteLocalForward: deleteDemoForward,
  executeSnippetOnHosts: executeDemoSnippetOnHosts,
  openBackendSessionSocket: openSessionSocket,
};

const tauriBackend: Backend = {
  getBackendStatus: () =>
    invokeTauriCommand<BackendStatusResponse>("terminal_workspace_backend_status"),
  getProtocolRuntimeStatus: (protocol) =>
    invokeTauriCommand<ProtocolRuntimeStatusResponse>(
      "terminal_workspace_protocol_runtime_status",
      {
        request: { protocol },
      }
    ),
  createBackendSession: (host) =>
    invokeTauriCommand<CreateSessionResponse>("terminal_workspace_create_backend_session", {
      request: { host },
    }),
  closeBackendSession: (sessionId) =>
    invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_close_backend_session", {
      request: { sessionId },
    }),
  resizeBackendSession: (sessionId, payload) =>
    invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_resize_backend_session", {
      request: { sessionId, payload },
    }),
  listRemoteDirectory: (host, path) =>
    invokeTauriCommand<SftpDirectoryResponse>("terminal_workspace_sftp_list_directory", {
      request: { host, path },
    }),
  createRemoteDirectory: (host, path) =>
    invokeTauriCommand<{ ok: boolean; path: string }>(
      "terminal_workspace_sftp_create_directory",
      {
        request: { host, path },
      }
    ),
  renameRemoteEntry: (host, currentPath, nextPath) =>
    invokeTauriCommand<{ ok: boolean; path: string }>(
      "terminal_workspace_sftp_rename_entry",
      {
        request: { host, currentPath, nextPath },
      }
    ),
  deleteRemoteEntry: (host, path, isDirectory) =>
    invokeTauriCommand<{ ok: boolean }>("terminal_workspace_sftp_delete_entry", {
      request: { host, path, isDirectory },
    }),
  uploadRemoteFile: async (host, remotePath, file) =>
    invokeTauriCommand<{ ok: boolean; path: string }>(
      "terminal_workspace_sftp_upload_file",
      {
        request: {
          host,
          path: remotePath,
          filename: file.name,
          contentsBase64: encodeBase64(await file.arrayBuffer()),
        },
      }
    ),
  downloadRemoteFile: async (host, path) => {
    const response = await invokeTauriCommand<{
      base64Body: string;
      contentDisposition?: string;
      contentType?: string;
    }>("terminal_workspace_sftp_download_file", {
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
  },
  inspectPrivateKey: (path) =>
    invokeTauriCommand<KeyMetadata>("terminal_workspace_inspect_private_key", {
      request: { path },
    }),
  generatePrivateKey: (payload) =>
    invokeTauriCommand<KeyMetadata>("terminal_workspace_generate_private_key", {
      request: payload,
    }),
  importPrivateKeyFromBody: (payload) =>
    invokeTauriCommand<KeyMetadata>("terminal_workspace_import_private_key_from_body", {
      request: payload,
    }),
  copyKeyToHost: (payload) =>
    invokeTauriCommand<CopyKeyToHostResponse>("terminal_workspace_copy_key_to_host", {
      request: payload,
    }),
  scanKnownHost: (hostname, port) =>
    invokeTauriCommand<{ entries: KnownHostScanResult[] }>(
      "terminal_workspace_scan_known_host",
      {
        request: { hostname, port },
      }
    ),
  listLocalForwards: (sessionId) =>
    invokeTauriCommand<ListForwardsResponse>("terminal_workspace_list_session_forwards", {
      request: { sessionId },
    }),
  createLocalForward: (payload) =>
    invokeTauriCommand<PortForwardRecord>("terminal_workspace_create_forward", {
      request: payload,
    }),
  deleteLocalForward: (forwardId) =>
    invokeTauriCommand<BackendBooleanResponse>("terminal_workspace_delete_forward", {
      request: { forwardId },
    }),
  executeSnippetOnHosts: (command, targets) =>
    invokeTauriCommand<{ results: SnippetExecutionResult[] }>(
      "terminal_workspace_execute_snippet_on_hosts",
      {
        request: { command, targets },
      }
    ),
  openBackendSessionSocket: openSessionSocket,
};

const httpBackend: Backend = {
  getBackendStatus: () => backendFetch<BackendStatusResponse>("/api/backend/status"),
  getProtocolRuntimeStatus: async (protocol) => ({
    available: protocol === "ssh",
    installHint:
      protocol === "ssh"
        ? undefined
        : "Open this host in the native macOS app to use its protocol runtime.",
    message:
      protocol === "ssh"
        ? "SSH is available through the browser/backend transport."
        : "This protocol requires the native macOS runtime.",
    protocol,
  }),
  createBackendSession: (host) =>
    backendFetch<CreateSessionResponse>("/api/backend/sessions", {
      method: "POST",
      body: JSON.stringify({ host }),
    }),
  closeBackendSession: (sessionId) =>
    backendFetch<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}`, {
      method: "DELETE",
    }),
  resizeBackendSession: (sessionId, payload) =>
    backendFetch<BackendBooleanResponse>(`/api/backend/sessions/${sessionId}/resize`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listRemoteDirectory: (host, path) =>
    backendFetch<SftpDirectoryResponse>("/api/backend/sftp/list", {
      method: "POST",
      body: JSON.stringify({ host, path }),
    }),
  createRemoteDirectory: (host, path) =>
    backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/mkdir", {
      method: "POST",
      body: JSON.stringify({ host, path }),
    }),
  renameRemoteEntry: (host, currentPath, nextPath) =>
    backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/rename", {
      method: "POST",
      body: JSON.stringify({ host, currentPath, nextPath }),
    }),
  deleteRemoteEntry: (host, path, isDirectory) =>
    backendFetch<{ ok: boolean }>("/api/backend/sftp/delete", {
      method: "POST",
      body: JSON.stringify({ host, path, isDirectory }),
    }),
  uploadRemoteFile: async (host, remotePath, file) =>
    backendFetch<{ ok: boolean; path: string }>("/api/backend/sftp/upload", {
      method: "POST",
      body: JSON.stringify({
        host,
        path: remotePath,
        filename: file.name,
        contentsBase64: encodeBase64(await file.arrayBuffer()),
      }),
    }),
  downloadRemoteFile: async (host, path) => {
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
  },
  inspectPrivateKey: (path) =>
    backendFetch<KeyMetadata>("/api/backend/keys/inspect", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  generatePrivateKey: (payload) =>
    backendFetch<KeyMetadata>("/api/backend/keys/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importPrivateKeyFromBody: (payload) =>
    backendFetch<KeyMetadata>("/api/backend/keys/import-from-body", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  copyKeyToHost: (payload) =>
    backendFetch<CopyKeyToHostResponse>("/api/backend/keys/copy-to-host", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  scanKnownHost: (hostname, port) =>
    backendFetch<{ entries: KnownHostScanResult[] }>("/api/backend/known-hosts/scan", {
      method: "POST",
      body: JSON.stringify({ hostname, port }),
    }),
  listLocalForwards: (sessionId) =>
    backendFetch<ListForwardsResponse>(
      `/api/backend/forwards?sessionId=${encodeURIComponent(sessionId)}`
    ),
  createLocalForward: (payload) =>
    backendFetch<PortForwardRecord>("/api/backend/forwards", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteLocalForward: (forwardId) =>
    backendFetch<BackendBooleanResponse>(`/api/backend/forwards/${forwardId}`, {
      method: "DELETE",
    }),
  executeSnippetOnHosts: (command, targets) =>
    backendFetch<{ results: SnippetExecutionResult[] }>("/api/backend/snippets/execute", {
      method: "POST",
      body: JSON.stringify({ command, targets }),
    }),
  openBackendSessionSocket: openSessionSocket,
};

function getBackend() {
  if (isDemoModeEnabled()) {
    return demoBackend;
  }

  return isTauriRuntime() ? tauriBackend : httpBackend;
}

export async function getBackendStatus() {
  return getBackend().getBackendStatus();
}

export async function getProtocolRuntimeStatus(protocol: HostProtocol) {
  return getBackend().getProtocolRuntimeStatus(protocol);
}

export async function createBackendSession(host: BackendHostConnection) {
  return getBackend().createBackendSession(host);
}

export async function closeBackendSession(sessionId: string) {
  return getBackend().closeBackendSession(sessionId);
}

export async function resizeBackendSession(sessionId: string, payload: ResizeSessionPayload) {
  return getBackend().resizeBackendSession(sessionId, payload);
}

export async function listRemoteDirectory(host: BackendHostConnection, path: string) {
  return getBackend().listRemoteDirectory(host, path);
}

export async function createRemoteDirectory(host: BackendHostConnection, path: string) {
  return getBackend().createRemoteDirectory(host, path);
}

export async function renameRemoteEntry(
  host: BackendHostConnection,
  currentPath: string,
  nextPath: string
) {
  return getBackend().renameRemoteEntry(host, currentPath, nextPath);
}

export async function deleteRemoteEntry(
  host: BackendHostConnection,
  path: string,
  isDirectory: boolean
) {
  return getBackend().deleteRemoteEntry(host, path, isDirectory);
}

export async function uploadRemoteFile(
  host: BackendHostConnection,
  remotePath: string,
  file: File
) {
  return getBackend().uploadRemoteFile(host, remotePath, file);
}

export async function downloadRemoteFile(host: BackendHostConnection, path: string) {
  return getBackend().downloadRemoteFile(host, path);
}

export async function inspectPrivateKey(path: string) {
  return getBackend().inspectPrivateKey(path);
}

export async function generatePrivateKey(payload: GenerateKeyPayload) {
  return getBackend().generatePrivateKey(payload);
}

/**
 * T13: write a pasted private key body to disk (0600 perms) and
 * return inspect metadata. Validation of the body shape happens
 * client-side in lib/private-key-validation.ts before we get here.
 */
export async function importPrivateKeyFromBody(payload: ImportPrivateKeyFromBodyPayload) {
  return getBackend().importPrivateKeyFromBody(payload);
}

/**
 * T12: install a public key on a remote host (ssh-copy-id equivalent).
 * Caller hands us the private key path (we read .pub next to it) and a
 * BackendHostConnection so the backend can open the one-shot SSH
 * session itself.
 */
export async function copyKeyToHost(payload: CopyKeyToHostPayload) {
  return getBackend().copyKeyToHost(payload);
}

export async function scanKnownHost(hostname: string, port: number) {
  return getBackend().scanKnownHost(hostname, port);
}

export async function listLocalForwards(sessionId: string) {
  return getBackend().listLocalForwards(sessionId);
}

export async function createLocalForward(payload: CreateForwardPayload) {
  return getBackend().createLocalForward(payload);
}

export async function deleteLocalForward(forwardId: string) {
  return getBackend().deleteLocalForward(forwardId);
}

export async function executeSnippetOnHosts(command: string, targets: SnippetExecutionTarget[]) {
  return getBackend().executeSnippetOnHosts(command, targets);
}

export async function openBackendSessionSocket(sessionId: string) {
  return getBackend().openBackendSessionSocket(sessionId);
}
