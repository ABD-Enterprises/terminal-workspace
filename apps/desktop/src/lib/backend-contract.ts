import type { PortForwardRecord } from "../types/forward";
import type { HostAuthMethod, HostKeyPolicy, HostProtocol } from "../types/host";
import type { KeyGenerationType } from "../types/key";
import type { RemoteFileEntry } from "../types/transfer";

export interface BackendStatusResponse {
  ok: boolean;
  backendBaseUrl?: string;
  transport?: "browser" | "tauri-native";
}

export interface BackendTransportInfo {
  backendBaseUrl: string;
  sessionBridge: "browser" | "tauri-native";
}

export interface ProtocolRuntimeStatusResponse {
  available: boolean;
  client?: string;
  installHint?: string;
  message: string;
  protocol: HostProtocol;
  resolvedPath?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface BackendHostConnection {
  agentForwarding: boolean;
  authMethod: HostAuthMethod;
  environment?: Record<string, string>;
  hostKeyPolicy?: HostKeyPolicy;
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

/**
 * T13: import a private key by pasting its body. The backend writes
 * the body to `path` with 0600 perms, then runs inspect and returns
 * the same KeyMetadata shape as a path-only import.
 */
export interface ImportPrivateKeyFromBodyPayload {
  path: string;
  body: string;
}

/**
 * T12: install a public key on a remote host via the SSH exec channel.
 * Runs the equivalent of `ssh-copy-id`:
 *   mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo <key> >> ~/.ssh/authorized_keys
 *   && chmod 600 ~/.ssh/authorized_keys
 * Returns ok=true on a clean exit, otherwise ok=false + a short reason.
 */
export interface CopyKeyToHostPayload {
  /** Path to the local private key (we read `{path}.pub` to get the body). */
  privateKeyPath: string;
  /** Full BackendHostConnection — backend opens a one-shot SSH session. */
  host: BackendHostConnection;
}

export interface CopyKeyToHostResponse {
  ok: boolean;
  reason?: string;
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
