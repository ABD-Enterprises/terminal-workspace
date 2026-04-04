import type { PortForwardRecord } from "../types/forward";
import type { HostAuthMethod, HostProtocol } from "../types/host";
import type { KeyGenerationType } from "../types/key";
import type { RemoteFileEntry } from "../types/transfer";

export interface BackendStatusResponse {
  ok: boolean;
  backendBaseUrl?: string;
  transport?: "browser" | "tauri-proxy";
}

export interface BackendTransportInfo {
  backendBaseUrl: string;
  sessionBridge: "browser" | "tauri-proxy";
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface BackendHostConnection {
  agentForwarding: boolean;
  authMethod: HostAuthMethod;
  environment?: Record<string, string>;
  hostname: string;
  jumpHost?: BackendHostConnection;
  knownHostAlgorithm?: string;
  knownHostPublicKey?: string;
  password: string;
  passphrase: string;
  port: number;
  privateKeyPath: string;
  protocol: HostProtocol;
  sftpRoot?: string;
  username: string;
}

export interface KnownHostScanResult {
  algorithm: string;
  fingerprint: string;
  hostname: string;
  port: number;
  publicKey: string;
}

export interface ResizeSessionPayload {
  cols: number;
  rows: number;
}

export interface SftpDirectoryResponse {
  entries: RemoteFileEntry[];
  path: string;
}

export interface GenerateKeyPayload {
  comment: string;
  passphrase: string;
  path: string;
  type: KeyGenerationType;
}

export interface CreateForwardPayload {
  direction: "local" | "remote";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  sessionId: string;
}

export interface SnippetExecutionTarget {
  host: BackendHostConnection;
  id: string;
  label: string;
}

export interface SnippetExecutionResult {
  targetId: string;
  label: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorMessage?: string;
}

export interface DownloadRemoteFileResponse {
  blob: Blob;
  filename: string;
}

export interface BackendBooleanResponse {
  ok: boolean;
  pending?: boolean;
}

export interface ListForwardsResponse {
  forwards: PortForwardRecord[];
}
