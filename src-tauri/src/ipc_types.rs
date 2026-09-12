use std::collections::HashMap;

use crate::default_backend_protocol;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendTransportInfo {
    pub backend_base_url: String,
    pub session_bridge: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatusResponse {
    pub ok: bool,
    pub backend_base_url: String,
    pub transport: &'static str,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendHostConnection {
    pub agent_forwarding: bool,
    pub auth_method: String,
    pub environment: Option<HashMap<String, String>>,
    /// "requireTrusted" or "allowUnknown". Optional for backward compatibility
    /// with renderer builds that pre-date the contract change. When absent or
    /// "requireTrusted" we refuse to connect without a known_host_public_key.
    /// See docs/parity-and-hardening-review.md §3.S-1.
    #[serde(default)]
    pub host_key_policy: Option<String>,
    pub hostname: String,
    pub jump_host: Option<Box<BackendHostConnection>>,
    pub known_host_algorithm: Option<String>,
    pub known_host_public_key: Option<String>,
    pub password: String,
    pub passphrase: String,
    pub port: u32,
    pub private_key_path: String,
    #[serde(default = "default_backend_protocol")]
    pub protocol: String,
    pub sftp_root: Option<String>,
    pub username: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackendSessionRequest {
    pub host: BackendHostConnection,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdRequest {
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeSessionPayload {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeBackendSessionRequest {
    pub session_id: String,
    pub payload: ResizeSessionPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub kind: String,
    pub modified_at: Option<String>,
    pub name: String,
    pub path: String,
    pub permissions: Option<String>,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectoryResponse {
    pub entries: Vec<RemoteFileEntry>,
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPathRequest {
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRuntimeStatusRequest {
    pub protocol: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRuntimeStatusResponse {
    pub available: bool,
    pub client: Option<String>,
    pub install_hint: Option<String>,
    pub message: String,
    pub protocol: String,
    pub resolved_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyMetadata {
    pub algorithm: String,
    pub bits: u32,
    pub fingerprint: String,
    pub comment: String,
    pub private_key_path: String,
    pub public_key_path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyCommandOperation {
    Inspect,
    Generate,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "kebab-case")]
pub enum KeyCommandFailure {
    PathRequired,
    KeyBodyRequired,
    PathMustBeAbsolute {
        path: String,
    },
    PathOutsideAllowedRoots {
        path: String,
    },
    ParentDirectoryUnavailable {
        path: String,
    },
    PathAlreadyExists {
        path: String,
    },
    PrivateKeyUnreadable {
        path: String,
    },
    PrivateKeyWriteFailed {
        path: String,
    },
    UnsupportedKeyType,
    SshKeygenUnavailable {
        operation: KeyCommandOperation,
        path: String,
    },
    SshKeygenFailed {
        operation: KeyCommandOperation,
        path: String,
    },
    InvalidKeyMetadata {
        path: String,
    },
    WorkerFailed {
        path: String,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyRequest {
    pub comment: String,
    pub passphrase: String,
    pub path: String,
    #[serde(rename = "type")]
    pub key_type: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostScanRequest {
    pub hostname: String,
    pub port: u16,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostScanResult {
    pub algorithm: String,
    pub fingerprint: String,
    pub hostname: String,
    pub port: u16,
    pub public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostScanResponse {
    pub entries: Vec<KnownHostScanResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendPathResponse {
    pub ok: bool,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardRecord {
    pub created_at: String,
    pub direction: String,
    pub id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListForwardsResponse {
    pub forwards: Vec<PortForwardRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathRequest {
    pub host: BackendHostConnection,
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpRenameRequest {
    pub current_path: String,
    pub host: BackendHostConnection,
    pub next_path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDeleteRequest {
    pub host: BackendHostConnection,
    pub is_directory: bool,
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadRequest {
    pub contents_base64: String,
    pub filename: String,
    pub host: BackendHostConnection,
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateForwardPayload {
    pub direction: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardIdRequest {
    pub forward_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetExecutionTarget {
    pub host: BackendHostConnection,
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SshFailureStage {
    Configuration,
    Connect,
    SessionInitialization,
    Handshake,
    HostKeyVerification,
    Authentication,
    ChannelOpen,
    ExecRequest,
    OutputRead,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "kebab-case")]
pub enum RemoteCommandFailure {
    SshFailed {
        stage: SshFailureStage,
    },
    TimedOut {
        #[serde(rename = "timeoutSeconds")]
        timeout_seconds: u64,
    },
    WorkerFailed,
    RemoteCommandExited {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetExecutionResult {
    pub target_id: String,
    pub label: String,
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<RemoteCommandFailure>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetExecutionRequest {
    pub command: String,
    pub targets: Vec<SnippetExecutionTarget>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetExecutionResponse {
    pub results: Vec<SnippetExecutionResult>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBooleanResponse {
    pub ok: bool,
    pub pending: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendBinaryResponse {
    pub base64_body: String,
    pub content_disposition: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSecretsRequest {
    pub host_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreHostSecretsRequest {
    pub host_id: String,
    pub password: String,
    pub passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSecretsResponse {
    pub password: String,
    pub passphrase: String,
    /// True when the keychain was locked or access was denied (as opposed to
    /// the secret simply being absent). Lets the renderer branch on a stable
    /// signal — surface an error / prompt for the secret — instead of parsing
    /// an opaque error string or treating a locked keychain as "no secret".
    pub keychain_unavailable: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPassphraseRequest {
    pub fingerprint: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreKeyPassphraseRequest {
    pub fingerprint: String,
    pub passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPassphraseResponse {
    pub passphrase: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPassphraseRequest {
    pub identity_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreIdentityPassphraseRequest {
    pub identity_id: String,
    pub passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPassphraseResponse {
    pub passphrase: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStreamRequest {
    pub session_id: String,
    pub stream_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStreamSendRequest {
    pub data: String,
    pub session_id: String,
    pub stream_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStreamOpenResponse {
    pub ok: bool,
    pub stream_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStreamEvent {
    pub data: Option<String>,
    pub kind: &'static str,
    pub message: Option<String>,
    pub session_id: String,
    pub stream_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPrivateKeyFromBodyRequest {
    pub path: String,
    pub body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyKeyToHostRequest {
    pub private_key_path: String,
    pub host: BackendHostConnection,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "kebab-case")]
pub enum CopyKeyToHostFailure {
    PrivateKeyPathRequired,
    TargetHostRequired,
    PublicKeyUnreadable {
        #[serde(rename = "publicKeyPath")]
        public_key_path: String,
    },
    PublicKeyEmpty {
        #[serde(rename = "publicKeyPath")]
        public_key_path: String,
    },
    RemoteCommandFailed {
        hostname: String,
        command: RemoteCommandFailure,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyKeyToHostResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<CopyKeyToHostFailure>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDockBadgeRequest {
    pub count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckRequest {}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateRequest {
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum UpdateInstallProgressEvent {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSshConfigFileRequest {
    pub path: String,
    pub parent_cycle_key: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSshConfigFileResponse {
    pub cycle_key: String,
    pub content: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "reason", rename_all = "kebab-case")]
pub enum SshConfigCommandFailure {
    SshRootUnavailable { path: String },
    InvalidPath { path: String },
    PathUnavailable { path: String },
    PathOutsideSshRoot { path: String },
    PathNotRegularFile { path: String },
    SizeLimitExceeded { path: String },
    ReadFailed { path: String },
    GlobInDirectoryComponent { path: String },
    WorkerFailed { path: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobSshConfigFilesRequest {
    pub pattern: String,
    pub parent_cycle_key: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigGlobMatch {
    pub cycle_key: String,
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobSshConfigFilesResponse {
    pub matches: Vec<SshConfigGlobMatch>,
}
