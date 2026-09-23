import type { UpdateCheckResult } from "./auto-update";
import type { BackendBooleanResponse, BackendStatusResponse, BackendTransportInfo, CopyKeyToHostPayload, CreateSessionResponse, ProtocolRuntimeStatusResponse, ResizeSessionPayload, SftpDirectoryResponse, SnippetExecutionTarget } from "./backend-contract";
import type { HostSecretsRequest, StoreHostSecretsRequest, KeyPassphraseRequest, StoreKeyPassphraseRequest, IdentityPassphraseRequest, StoreIdentityPassphraseRequest, HostSecretsResponse, KeyPassphraseResponse, IdentityPassphraseResponse } from "./native-secrets";
import type { GlobSshConfigFilesResponse, ReadSshConfigFileResponse } from "./ssh-config-fs";
import type { CopyKeyToHostResponse, GenerateKeyPayload as GeneratePrivateKeyRequest, ImportPrivateKeyFromBodyPayload as ImportPrivateKeyRequest, KnownHostScanResult, ListForwardsResponse, SnippetExecutionResult } from "./backend-contract";
import type { KeyMetadata } from "../types/key";
import type { PortForwardRecord } from "../types/forward";
import type { BackendHostConnection } from "./backend-contract";

export interface TauriCommands {
  "terminal_workspace_read_ssh_config_file": {
    request: { path: string };
    response: ReadSshConfigFileResponse;
  };
  "terminal_workspace_glob_ssh_config_files": {
    request: { pattern: string };
    response: GlobSshConfigFilesResponse;
  };
  "terminal_workspace_transport_info": {
    request: undefined;
    response: BackendTransportInfo;
  };
  "terminal_workspace_close_backend_session_stream": {
    request: { sessionId: string; streamId?: string };
    response: BackendBooleanResponse;
  };
  "terminal_workspace_send_backend_session_stream": {
    request: { sessionId: string; streamId?: string; data: string };
    response: BackendBooleanResponse;
  };
  "terminal_workspace_open_backend_session_stream": {
    request: { sessionId: string };
    response: { streamId: string };
  };
  "terminal_workspace_backend_status": {
    request: undefined;
    response: BackendStatusResponse;
  };
  "terminal_workspace_create_backend_session": {
    request: { host: BackendHostConnection };
    response: CreateSessionResponse;
  };
  "terminal_workspace_close_backend_session": {
    request: { sessionId: string };
    response: BackendBooleanResponse;
  };
  "terminal_workspace_resize_backend_session": {
    request: { sessionId: string; payload: ResizeSessionPayload };
    response: BackendBooleanResponse;
  };
  "terminal_workspace_load_host_secrets": {
    request: HostSecretsRequest;
    response: HostSecretsResponse;
  };
  "terminal_workspace_store_host_secrets": {
    request: StoreHostSecretsRequest;
    response: void;
  };
  "terminal_workspace_clear_host_secrets": {
    request: HostSecretsRequest;
    response: void;
  };
  "terminal_workspace_load_key_passphrase": {
    request: KeyPassphraseRequest;
    response: KeyPassphraseResponse;
  };
  "terminal_workspace_store_key_passphrase": {
    request: StoreKeyPassphraseRequest;
    response: void;
  };
  "terminal_workspace_clear_key_passphrase": {
    request: KeyPassphraseRequest;
    response: void;
  };
  "terminal_workspace_load_identity_passphrase": {
    request: IdentityPassphraseRequest;
    response: IdentityPassphraseResponse;
  };
  "terminal_workspace_store_identity_passphrase": {
    request: StoreIdentityPassphraseRequest;
    response: void;
  };
  "terminal_workspace_clear_identity_passphrase": {
    request: IdentityPassphraseRequest;
    response: void;
  };
  "terminal_workspace_set_dock_badge": {
    request: { count: number | null };
    response: void;
  };
  "terminal_workspace_check_for_updates": {
    request: Record<string, never>;
    response: UpdateCheckResult;
  };
  "terminal_workspace_install_update_and_restart": {
    request: { force: boolean };
    response: void;
  };
  "terminal_workspace_protocol_runtime_status": {
    request: { protocol: string };
    response: ProtocolRuntimeStatusResponse;
  };
  "terminal_workspace_sftp_list_directory": {
    request: { host: BackendHostConnection; path: string };
    response: SftpDirectoryResponse;
  };
  "terminal_workspace_sftp_create_directory": {
    request: { host: BackendHostConnection; path: string };
    response: { ok: boolean; path: string };
  };
  "terminal_workspace_sftp_rename_entry": {
    request: { host: BackendHostConnection; currentPath: string; nextPath: string };
    response: { ok: boolean; path: string };
  };
  "terminal_workspace_sftp_delete_entry": {
    request: { host: BackendHostConnection; path: string; isDirectory: boolean };
    response: { ok: boolean };
  };
  "terminal_workspace_sftp_upload_file": {
    request: { host: BackendHostConnection; path: string; filename: string; contentsBase64: string };
    response: { ok: boolean; path: string };
  };
  "terminal_workspace_sftp_download_file": {
    request: { host: BackendHostConnection; path: string };
    response: { base64Body: string; contentDisposition?: string; contentType?: string };
  };
  "terminal_workspace_inspect_private_key": {
    request: { path: string };
    response: KeyMetadata;
  };
  "terminal_workspace_generate_private_key": {
    request: GeneratePrivateKeyRequest;
    response: KeyMetadata;
  };
  "terminal_workspace_import_private_key_from_body": {
    request: ImportPrivateKeyRequest;
    response: KeyMetadata;
  };
  "terminal_workspace_copy_key_to_host": {
    request: CopyKeyToHostPayload;
    response: CopyKeyToHostResponse;
  };
  "terminal_workspace_scan_known_host": {
    request: { hostname: string; port: number };
    response: { entries: KnownHostScanResult[] };
  };
  "terminal_workspace_list_session_forwards": {
    request: { sessionId: string };
    response: ListForwardsResponse;
  };
  "terminal_workspace_create_forward": {
    request: Partial<PortForwardRecord> & { sessionId: string };
    response: PortForwardRecord;
  };
  "terminal_workspace_delete_forward": {
    request: { forwardId: string };
    response: BackendBooleanResponse;
  };
  "terminal_workspace_execute_snippet_on_hosts": {
    request: { command: string; targets: SnippetExecutionTarget[] };
    response: { results: SnippetExecutionResult[] };
  };
}
