import { isDemoModeEnabled } from "../store/app-store";
import type { PortForwardRecord } from "../types/forward";
import type { HostProtocol } from "../types/host";
import type { KeyMetadata } from "../types/key";
import { fetchJson, fetchResponse } from "./http";
import type {
  BackendBooleanResponse,
  BackendHostConnection,
  CopyKeyToHostPayload,
  CopyKeyToHostResponse,
  CreateForwardPayload,
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
  getSessionBackendStatus,
  invokeTauriCommand,
  isTauriRuntime,
  openSessionSocket,
  resizeSession,
} from "./backend-runtime";
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

export async function getProtocolRuntimeStatus(protocol: HostProtocol) {
  if (isDemoModeEnabled()) {
    return {
      available: true,
      message: "Demo mode bypasses native protocol runtime checks.",
      protocol,
    } satisfies ProtocolRuntimeStatusResponse;
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<ProtocolRuntimeStatusResponse>("termsnip_protocol_runtime_status", {
      request: { protocol },
    });
  }

  return {
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
  } satisfies ProtocolRuntimeStatusResponse;
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

  return fetchJson<SftpDirectoryResponse>("/api/backend/sftp/list", {
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

  return fetchJson<{ ok: boolean; path: string }>("/api/backend/sftp/mkdir", {
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

  return fetchJson<{ ok: boolean; path: string }>("/api/backend/sftp/rename", {
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

  return fetchJson<{ ok: boolean }>("/api/backend/sftp/delete", {
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

  return fetchJson<{ ok: boolean; path: string }>("/api/backend/sftp/upload", {
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

  const response = await fetchResponse("/api/backend/sftp/download", {
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

  return fetchJson<KeyMetadata>("/api/backend/keys/inspect", {
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

  return fetchJson<KeyMetadata>("/api/backend/keys/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * T13: write a pasted private key body to disk (0600 perms) and
 * return inspect metadata. Validation of the body shape happens
 * client-side in lib/private-key-validation.ts before we get here.
 */
export async function importPrivateKeyFromBody(payload: ImportPrivateKeyFromBodyPayload) {
  if (isDemoModeEnabled()) {
    return importDemoPrivateKeyFromBody(payload);
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<KeyMetadata>("termsnip_import_private_key_from_body", {
      request: payload,
    });
  }

  return fetchJson<KeyMetadata>("/api/backend/keys/import-from-body", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * T12: install a public key on a remote host (ssh-copy-id equivalent).
 * Caller hands us the private key path (we read .pub next to it) and a
 * BackendHostConnection so the backend can open the one-shot SSH
 * session itself.
 */
export async function copyKeyToHost(payload: CopyKeyToHostPayload) {
  if (isDemoModeEnabled()) {
    return copyDemoKeyToHost(payload);
  }

  if (isTauriRuntime()) {
    return invokeTauriCommand<CopyKeyToHostResponse>("termsnip_copy_key_to_host", {
      request: payload,
    });
  }

  return fetchJson<CopyKeyToHostResponse>("/api/backend/keys/copy-to-host", {
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

  return fetchJson<{ entries: KnownHostScanResult[] }>("/api/backend/known-hosts/scan", {
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

  return fetchJson<ListForwardsResponse>(
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

  return fetchJson<PortForwardRecord>("/api/backend/forwards", {
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

  return fetchJson<BackendBooleanResponse>(`/api/backend/forwards/${forwardId}`, {
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

  return fetchJson<{ results: SnippetExecutionResult[] }>("/api/backend/snippets/execute", {
    method: "POST",
    body: JSON.stringify({ command, targets }),
  });
}

export async function openBackendSessionSocket(sessionId: string) {
  return openSessionSocket(sessionId);
}
