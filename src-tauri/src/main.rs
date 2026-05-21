#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{Datelike, NaiveDate, TimeZone, Utc};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::json;
use ssh2::{Channel, Session};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::mpsc::{
    error::TryRecvError, unbounded_channel, UnboundedReceiver, UnboundedSender,
};

mod keychain_support;
mod native_transport;

use keychain_support::*;
use native_transport::*;

const SESSION_STREAM_EVENT_NAME: &str = "termsnip://session-stream";
const KEYCHAIN_PASSWORD_SERVICE: &str = "com.termsnip.runtime.password";
/// Per-host passphrase entry. Retained for backward compatibility (older
/// builds wrote here) and as the migration source. New writes go to
/// `KEYCHAIN_KEY_PASSPHRASE_SERVICE` keyed by SSH key fingerprint so that
/// multiple hosts using the same private key share a single Keychain
/// entry. See parity-and-hardening-plan.md P1-S5.
const KEYCHAIN_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.passphrase";
/// Per-key-fingerprint passphrase entry. Account is the SSH public-key
/// fingerprint (`SHA256:<base64>` form). When a key is deleted from the
/// keys store, the renderer calls `termsnip_clear_key_passphrase` to GC
/// the orphaned entry.
const KEYCHAIN_KEY_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.key-passphrase";
/// Per-identity passphrase entry (P2-DM1 batch 3). Account is the
/// IdentityRecord's `id`. This is the canonical home for passphrases now
/// that hosts route through reusable identities. The two older services
/// remain for backward compatibility — `connection-secrets-store` reads
/// identity → fingerprint → host and migrates forward at each found stage.
const KEYCHAIN_IDENTITY_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.identity-passphrase";
const DEFAULT_TERMINAL_COLS: u16 = 120;
const DEFAULT_TERMINAL_ROWS: u16 = 36;
const DEFAULT_TERMINAL_PIXEL_WIDTH: u16 = DEFAULT_TERMINAL_COLS * 8;
const DEFAULT_TERMINAL_PIXEL_HEIGHT: u16 = DEFAULT_TERMINAL_ROWS * 16;
const NATIVE_SESSION_READ_CHUNK_SIZE: usize = 4096;
const NATIVE_SESSION_PROMPT_WINDOW_SIZE: usize = 512;
const NATIVE_SESSION_POLL_INTERVAL_MS: u64 = 10;
const NATIVE_SESSION_BUFFER_LIMIT: usize = 128;
const NATIVE_SSH_CONTROL_READY_TIMEOUT_MS: u64 = 15_000;
const TERMSNIP_DATABASE_URL: &str = "sqlite:termsnip.db";
static SESSION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_FORWARD_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
struct NativeSessionRegistry {
    sessions: Arc<Mutex<HashMap<String, NativeSessionHandle>>>,
}

#[derive(Clone, Default)]
struct NativeForwardRegistry {
    forwards: Arc<Mutex<HashMap<String, NativeForwardHandle>>>,
}

#[derive(Clone)]
struct NativeSessionHandle {
    command_sender: UnboundedSender<NativeSessionCommand>,
    host: BackendHostConnection,
    state: Arc<Mutex<NativeSessionState>>,
}

#[derive(Clone)]
struct NativeForwardHandle {
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    record: PortForwardRecord,
}

#[derive(Default)]
struct NativeSessionState {
    buffered_messages: Vec<String>,
    connection_state: String,
    stream_id: Option<String>,
}

#[derive(Clone)]
enum NativeSessionCommand {
    Close,
    Input(String),
    Resize { cols: u16, rows: u16 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PromptResponseKind {
    Password,
    Passphrase,
}

#[derive(Clone)]
struct PromptResponse {
    kind: PromptResponseKind,
    value: String,
}

enum JumpSessionEvent {
    Eof,
    Error(String),
    Output(String),
}

struct ExternalCommandSessionSpec {
    command: CommandBuilder,
    exit_label: String,
    prompt_responses: Vec<PromptResponse>,
    cleanup_dir: Option<PathBuf>,
}

struct NativeSshControlContext {
    config_path: PathBuf,
    session_dir: PathBuf,
    target_alias: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendTransportInfo {
    backend_base_url: String,
    session_bridge: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatusResponse {
    ok: bool,
    backend_base_url: String,
    transport: &'static str,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendHostConnection {
    agent_forwarding: bool,
    auth_method: String,
    environment: Option<HashMap<String, String>>,
    /// "requireTrusted" or "allowUnknown". Optional for backward compatibility
    /// with renderer builds that pre-date the contract change. When absent or
    /// "requireTrusted" we refuse to connect without a known_host_public_key.
    /// See docs/parity-and-hardening-review.md §3.S-1.
    #[serde(default)]
    host_key_policy: Option<String>,
    hostname: String,
    jump_host: Option<Box<BackendHostConnection>>,
    known_host_algorithm: Option<String>,
    known_host_public_key: Option<String>,
    password: String,
    passphrase: String,
    port: u32,
    private_key_path: String,
    #[serde(default = "default_backend_protocol")]
    protocol: String,
    sftp_root: Option<String>,
    username: String,
}

fn host_requires_trusted_key(host: &BackendHostConnection) -> bool {
    // Default to "requireTrusted" when absent for the same secure-by-default
    // reason the TS layer flipped its default. Only an explicit "allowUnknown"
    // opts a host out of strict checking. SSH and Mosh are the only protocols
    // for which trusted-host-key checking is meaningful.
    if host.protocol != "ssh" && host.protocol != "mosh" {
        return false;
    }
    match host.host_key_policy.as_deref() {
        Some("allowUnknown") => false,
        _ => true,
    }
}

fn default_backend_protocol() -> String {
    "ssh".to_string()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBackendSessionRequest {
    host: BackendHostConnection,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionResponse {
    session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIdRequest {
    session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeSessionPayload {
    cols: u16,
    rows: u16,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeBackendSessionRequest {
    session_id: String,
    payload: ResizeSessionPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFileEntry {
    kind: String,
    modified_at: Option<String>,
    name: String,
    path: String,
    permissions: Option<String>,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpDirectoryResponse {
    entries: Vec<RemoteFileEntry>,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyPathRequest {
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtocolRuntimeStatusRequest {
    protocol: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProtocolRuntimeStatusResponse {
    available: bool,
    client: Option<String>,
    install_hint: Option<String>,
    message: String,
    protocol: String,
    resolved_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyMetadata {
    algorithm: String,
    bits: u32,
    fingerprint: String,
    comment: String,
    private_key_path: String,
    public_key_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateKeyRequest {
    comment: String,
    passphrase: String,
    path: String,
    #[serde(rename = "type")]
    key_type: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostScanRequest {
    hostname: String,
    port: u16,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostScanResult {
    algorithm: String,
    fingerprint: String,
    hostname: String,
    port: u16,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostScanResponse {
    entries: Vec<KnownHostScanResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendPathResponse {
    ok: bool,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortForwardRecord {
    created_at: String,
    direction: String,
    id: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListForwardsResponse {
    forwards: Vec<PortForwardRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpPathRequest {
    host: BackendHostConnection,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpRenameRequest {
    current_path: String,
    host: BackendHostConnection,
    next_path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpDeleteRequest {
    host: BackendHostConnection,
    is_directory: bool,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpUploadRequest {
    contents_base64: String,
    filename: String,
    host: BackendHostConnection,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateForwardPayload {
    direction: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    session_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardIdRequest {
    forward_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippetExecutionTarget {
    host: BackendHostConnection,
    id: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnippetExecutionResult {
    target_id: String,
    label: String,
    ok: bool,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    error_message: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippetExecutionRequest {
    command: String,
    targets: Vec<SnippetExecutionTarget>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnippetExecutionResponse {
    results: Vec<SnippetExecutionResult>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendBooleanResponse {
    ok: bool,
    pending: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendBinaryResponse {
    base64_body: String,
    content_disposition: Option<String>,
    content_type: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSecretsRequest {
    host_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreHostSecretsRequest {
    host_id: String,
    password: String,
    passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostSecretsResponse {
    password: String,
    passphrase: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyPassphraseRequest {
    fingerprint: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreKeyPassphraseRequest {
    fingerprint: String,
    passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyPassphraseResponse {
    passphrase: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityPassphraseRequest {
    identity_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreIdentityPassphraseRequest {
    identity_id: String,
    passphrase: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityPassphraseResponse {
    passphrase: String,
}

/// Reject identity ids that are obviously empty / malformed. The renderer
/// only forwards UUIDs from the persisted identities store; this guard
/// catches a rogue caller passing whitespace or empty so we don't probe
/// the empty Keychain account by accident.
fn validate_identity_id(identity_id: &str) -> Result<(), String> {
    let trimmed = identity_id.trim();
    if trimmed.is_empty() {
        return Err("Identity id is required".to_string());
    }
    if trimmed.len() > 256 {
        return Err("Identity id is unreasonably long".to_string());
    }
    Ok(())
}

/// Reject fingerprints that are obviously empty / malformed. The rest of the
/// validation lives in the renderer (only known fingerprints from the keys
/// store are forwarded), this is a defense-in-depth check that prevents an
/// XSS-bypassed caller from probing arbitrary Keychain accounts. The
/// fingerprint format is `SHA256:<43 base64 chars>` for SHA-256 and
/// `MD5:xx:xx:..` for legacy MD5. We require the prefix and a non-empty
/// payload, but do not validate the inner format strictly — Keychain
/// accounts are arbitrary strings, and rejecting future fingerprint
/// algorithms would create an upgrade footgun.
fn validate_key_fingerprint(fingerprint: &str) -> Result<(), String> {
    let trimmed = fingerprint.trim();
    if trimmed.is_empty() {
        return Err("Key fingerprint is required".to_string());
    }
    let Some((algo, payload)) = trimmed.split_once(':') else {
        return Err(format!(
            "Key fingerprint must use ALGO:VALUE format, got {trimmed:?}"
        ));
    };
    if algo.is_empty() || payload.trim().is_empty() {
        return Err("Key fingerprint algorithm and value must both be non-empty".to_string());
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStreamRequest {
    session_id: String,
    stream_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStreamSendRequest {
    data: String,
    session_id: String,
    stream_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStreamOpenResponse {
    ok: bool,
    stream_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStreamEvent {
    data: Option<String>,
    kind: &'static str,
    message: Option<String>,
    session_id: String,
    stream_id: String,
}

fn next_session_stream_id() -> String {
    SESSION_STREAM_COUNTER
        .fetch_add(1, Ordering::Relaxed)
        .to_string()
}

fn next_native_session_id() -> String {
    format!(
        "native-{}",
        NATIVE_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn next_native_forward_id() -> String {
    format!(
        "forward-{}",
        NATIVE_FORWARD_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn expand_home(pathname: &str) -> PathBuf {
    if let Some(stripped) = pathname.strip_prefix("~/") {
        if let Some(home_dir) = env::var_os("HOME") {
            return PathBuf::from(home_dir).join(stripped);
        }
    }

    PathBuf::from(pathname)
}

fn resolve_command_path(candidates: &[&str]) -> Option<PathBuf> {
    for candidate in candidates {
        let candidate_path = PathBuf::from(candidate);
        if candidate_path.is_absolute() {
            if candidate_path.is_file() {
                return Some(candidate_path);
            }
            continue;
        }

        if let Some(paths) = env::var_os("PATH") {
            for directory in env::split_paths(&paths) {
                let resolved = directory.join(candidate);
                if resolved.is_file() {
                    return Some(resolved);
                }
            }
        }
    }

    None
}

fn resolve_command_path_with_override(
    override_env: Option<&str>,
    candidates: &[&str],
) -> Option<PathBuf> {
    if let Some(override_env) = override_env {
        if let Some(path) = env::var_os(override_env) {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    resolve_command_path(candidates)
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "/._:-=@".contains(character))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

fn configure_command_environment(command: &mut CommandBuilder, host: &BackendHostConnection) {
    if let Some(environment) = get_channel_environment(&host.environment) {
        for (key, value) in environment {
            command.env(key, value);
        }
    }
}

fn protocol_runtime_response(
    protocol: &str,
    available: bool,
    client: Option<&str>,
    resolved_path: Option<String>,
    message: String,
    install_hint: Option<String>,
) -> ProtocolRuntimeStatusResponse {
    ProtocolRuntimeStatusResponse {
        available,
        client: client.map(str::to_string),
        install_hint,
        message,
        protocol: protocol.to_string(),
        resolved_path,
    }
}

fn build_protocol_runtime_status(protocol: &str) -> ProtocolRuntimeStatusResponse {
    match protocol {
        "ssh" => protocol_runtime_response(
            protocol,
            true,
            None,
            None,
            "SSH sessions are available through the native transport stack.".to_string(),
            None,
        ),
        "localShell" => {
            let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            protocol_runtime_response(
                protocol,
                true,
                Some("shell"),
                Some(shell.clone()),
                format!("Local shell sessions will launch with {shell}."),
                None,
            )
        }
        "telnet" => match resolve_command_path_with_override(
            Some("TERMSNIP_TELNET_PATH"),
            &["/usr/bin/telnet", "telnet"],
        ) {
            Some(path) => protocol_runtime_response(
                protocol,
                true,
                Some("telnet"),
                Some(path.to_string_lossy().into_owned()),
                "Telnet client resolved for native session launch.".to_string(),
                None,
            ),
            None => protocol_runtime_response(
                protocol,
                false,
                Some("telnet"),
                None,
                "Telnet client is not installed on this workstation.".to_string(),
                Some(
                    "Install a telnet client or save this host as SSH/local shell until one is available."
                        .to_string(),
                ),
            ),
        },
        "serial" => {
            if let Some(path) = resolve_command_path_with_override(
                Some("TERMSNIP_SCREEN_PATH"),
                &["/usr/bin/screen", "screen"],
            ) {
                protocol_runtime_response(
                    protocol,
                    true,
                    Some("screen"),
                    Some(path.to_string_lossy().into_owned()),
                    "Serial sessions will launch with screen.".to_string(),
                    None,
                )
            } else if let Some(path) =
                resolve_command_path_with_override(Some("TERMSNIP_CU_PATH"), &["/usr/bin/cu", "cu"])
            {
                protocol_runtime_response(
                    protocol,
                    true,
                    Some("cu"),
                    Some(path.to_string_lossy().into_owned()),
                    "Serial sessions will launch with cu.".to_string(),
                    None,
                )
            } else {
                protocol_runtime_response(
                    protocol,
                    false,
                    Some("screen|cu"),
                    None,
                    "Serial runtime requires either screen or cu.".to_string(),
                    Some(
                        "Install `screen` or `cu` so this workstation can open serial sessions."
                            .to_string(),
                    ),
                )
            }
        }
        "mosh" => match resolve_command_path_with_override(
            Some("TERMSNIP_MOSH_PATH"),
            &[
                "/opt/homebrew/bin/mosh",
                "/usr/local/bin/mosh",
                "/usr/bin/mosh",
                "mosh",
            ],
        ) {
            Some(path) => protocol_runtime_response(
                protocol,
                true,
                Some("mosh"),
                Some(path.to_string_lossy().into_owned()),
                "Mosh client resolved for native session launch.".to_string(),
                None,
            ),
            None => protocol_runtime_response(
                protocol,
                false,
                Some("mosh"),
                None,
                "Mosh client is not installed on this workstation.".to_string(),
                Some(
                    "Install `mosh` so the native client can launch this session, or use SSH until it is available."
                        .to_string(),
                ),
            ),
        },
        other => protocol_runtime_response(
            other,
            false,
            None,
            None,
            format!("Unsupported protocol runtime: {other}."),
            None,
        ),
    }
}

fn validate_network_host(
    host: &BackendHostConnection,
    require_username: bool,
) -> Result<(), String> {
    if host.hostname.trim().is_empty() || host.port == 0 {
        return Err("Missing host connection fields".to_string());
    }

    if require_username && host.username.trim().is_empty() {
        return Err("Missing host connection fields".to_string());
    }

    Ok(())
}

fn validate_mosh_host(host: &BackendHostConnection) -> Result<(), String> {
    validate_network_host(host, true)?;

    if host.auth_method == "password" && host.password.is_empty() {
        return Err("Password auth selected but no password provided".to_string());
    }

    if host.auth_method == "privateKey" && host.private_key_path.trim().is_empty() {
        return Err("Private key auth selected but no key path provided".to_string());
    }

    Ok(())
}

fn build_mosh_ssh_command(
    host: &BackendHostConnection,
    known_hosts_path: Option<&PathBuf>,
) -> String {
    let mut arguments = vec![
        "/usr/bin/ssh".to_string(),
        "-p".to_string(),
        host.port.to_string(),
        "-o".to_string(),
        "BatchMode=no".to_string(),
        "-o".to_string(),
        "GlobalKnownHostsFile=/dev/null".to_string(),
    ];

    if let Some(known_hosts_path) = known_hosts_path {
        arguments.push("-o".to_string());
        arguments.push(format!(
            "UserKnownHostsFile={}",
            known_hosts_path.to_string_lossy()
        ));
    }

    if host.known_host_public_key.is_some() && host.known_host_algorithm.is_some() {
        arguments.push("-o".to_string());
        arguments.push("StrictHostKeyChecking=yes".to_string());
    } else {
        arguments.push("-o".to_string());
        arguments.push("StrictHostKeyChecking=accept-new".to_string());
    }

    if host.agent_forwarding && env::var_os("SSH_AUTH_SOCK").is_some() {
        arguments.push("-A".to_string());
    }

    if host.auth_method == "privateKey" && !host.private_key_path.trim().is_empty() {
        arguments.push("-i".to_string());
        arguments.push(
            expand_home(&host.private_key_path)
                .to_string_lossy()
                .into_owned(),
        );
        arguments.push("-o".to_string());
        arguments.push("IdentitiesOnly=yes".to_string());
    }

    arguments
        .iter()
        .map(|argument| shell_quote(argument))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_external_command_session_spec(
    host: &BackendHostConnection,
    session_id: &str,
) -> Result<ExternalCommandSessionSpec, String> {
    match host.protocol.as_str() {
        "localShell" => {
            let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let mut command = CommandBuilder::new(shell);
            command.arg("-l");
            if let Some(home_dir) = env::var_os("HOME") {
                command.cwd(PathBuf::from(home_dir));
            }
            configure_command_environment(&mut command, host);

            Ok(ExternalCommandSessionSpec {
                command,
                exit_label: "Local shell".to_string(),
                prompt_responses: Vec::new(),
                cleanup_dir: None,
            })
        }
        "telnet" => {
            let executable = resolve_command_path_with_override(
                Some("TERMSNIP_TELNET_PATH"),
                &["/usr/bin/telnet", "telnet"],
            )
            .ok_or_else(|| "Telnet client is not installed on this workstation".to_string())?;
            let mut command = CommandBuilder::new(executable);
            command.arg(host.hostname.clone());
            command.arg(host.port.to_string());
            configure_command_environment(&mut command, host);

            Ok(ExternalCommandSessionSpec {
                command,
                exit_label: "Telnet session".to_string(),
                prompt_responses: Vec::new(),
                cleanup_dir: None,
            })
        }
        "serial" => {
            let mut command = if let Some(executable) = resolve_command_path_with_override(
                Some("TERMSNIP_SCREEN_PATH"),
                &["/usr/bin/screen", "screen"],
            ) {
                let mut command = CommandBuilder::new(executable);
                command.arg(host.hostname.clone());
                command.arg(host.port.to_string());
                command
            } else if let Some(executable) =
                resolve_command_path_with_override(Some("TERMSNIP_CU_PATH"), &["/usr/bin/cu", "cu"])
            {
                let mut command = CommandBuilder::new(executable);
                command.arg("-l");
                command.arg(host.hostname.clone());
                command.arg("-s");
                command.arg(host.port.to_string());
                command
            } else {
                return Err(
                    "Serial runtime requires either `screen` or `cu` to be installed".to_string(),
                );
            };
            configure_command_environment(&mut command, host);

            Ok(ExternalCommandSessionSpec {
                command,
                exit_label: "Serial session".to_string(),
                prompt_responses: Vec::new(),
                cleanup_dir: None,
            })
        }
        "mosh" => {
            let executable = resolve_command_path_with_override(
                Some("TERMSNIP_MOSH_PATH"),
                &[
                    "/opt/homebrew/bin/mosh",
                    "/usr/local/bin/mosh",
                    "/usr/bin/mosh",
                    "mosh",
                ],
            )
            .ok_or_else(|| "Mosh client is not installed on this workstation".to_string())?;
            let cleanup_dir = if host.known_host_public_key.is_some() {
                Some(create_native_ssh_session_dir(session_id)?)
            } else {
                None
            };
            let known_hosts_path = match cleanup_dir.as_ref() {
                Some(session_dir) => Some(write_native_known_hosts(host, session_dir)?),
                None => None,
            };
            let mut command = CommandBuilder::new(executable);
            command.arg(format!("{}@{}", host.username, host.hostname));
            command.arg(format!(
                "--ssh={}",
                build_mosh_ssh_command(host, known_hosts_path.as_ref())
            ));
            configure_command_environment(&mut command, host);

            Ok(ExternalCommandSessionSpec {
                command,
                exit_label: "Mosh session".to_string(),
                prompt_responses: build_prompt_responses(host),
                cleanup_dir,
            })
        }
        other => Err(format!("Unsupported external session protocol: {other}")),
    }
}

fn emit_session_stream_event(app: &AppHandle, event: SessionStreamEvent) {
    let _ = app.emit(SESSION_STREAM_EVENT_NAME, event);
}

fn get_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
) -> Option<NativeSessionHandle> {
    registry
        .sessions
        .lock()
        .expect("native session registry lock poisoned")
        .get(session_id)
        .cloned()
}

fn insert_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
    handle: NativeSessionHandle,
) {
    registry
        .sessions
        .lock()
        .expect("native session registry lock poisoned")
        .insert(session_id.to_string(), handle);
}

fn remove_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
) -> Option<NativeSessionHandle> {
    registry
        .sessions
        .lock()
        .expect("native session registry lock poisoned")
        .remove(session_id)
}

fn insert_native_forward(
    registry: &NativeForwardRegistry,
    forward_id: &str,
    handle: NativeForwardHandle,
) {
    registry
        .forwards
        .lock()
        .expect("native forward registry lock poisoned")
        .insert(forward_id.to_string(), handle);
}

fn remove_native_forward(
    registry: &NativeForwardRegistry,
    forward_id: &str,
) -> Option<NativeForwardHandle> {
    registry
        .forwards
        .lock()
        .expect("native forward registry lock poisoned")
        .remove(forward_id)
}

fn list_native_forwards(
    registry: &NativeForwardRegistry,
    session_id: &str,
) -> Vec<PortForwardRecord> {
    registry
        .forwards
        .lock()
        .expect("native forward registry lock poisoned")
        .values()
        .filter(|handle| handle.record.session_id == session_id)
        .map(|handle| handle.record.clone())
        .collect()
}

fn close_native_forward_handle(handle: NativeForwardHandle) {
    let mut killer = handle
        .killer
        .lock()
        .expect("native forward killer lock poisoned");
    let _ = killer.kill();
}

fn close_native_forwards_for_session(registry: &NativeForwardRegistry, session_id: &str) {
    let forward_ids = registry
        .forwards
        .lock()
        .expect("native forward registry lock poisoned")
        .values()
        .filter(|handle| handle.record.session_id == session_id)
        .map(|handle| handle.record.id.clone())
        .collect::<Vec<_>>();

    for forward_id in forward_ids {
        if let Some(handle) = remove_native_forward(registry, &forward_id) {
            close_native_forward_handle(handle);
        }
    }
}

fn emit_native_session_message(
    app: &AppHandle,
    session_id: &str,
    state: &Arc<Mutex<NativeSessionState>>,
    message: String,
) {
    let stream_id = {
        let mut state = state.lock().expect("native session state lock poisoned");
        match state.stream_id.clone() {
            Some(stream_id) => Some(stream_id),
            None => {
                state.buffered_messages.push(message.clone());
                if state.buffered_messages.len() > NATIVE_SESSION_BUFFER_LIMIT {
                    let excess = state.buffered_messages.len() - NATIVE_SESSION_BUFFER_LIMIT;
                    state.buffered_messages.drain(0..excess);
                }
                None
            }
        }
    };

    if let Some(stream_id) = stream_id {
        emit_session_stream_event(
            app,
            SessionStreamEvent {
                data: Some(message),
                kind: "message",
                message: None,
                session_id: session_id.to_string(),
                stream_id,
            },
        );
    }
}

fn set_native_session_connection_state(
    app: &AppHandle,
    session_id: &str,
    state: &Arc<Mutex<NativeSessionState>>,
    next_state: &str,
) {
    {
        let mut state = state.lock().expect("native session state lock poisoned");
        state.connection_state = next_state.to_string();
    }

    emit_native_session_message(
        app,
        session_id,
        state,
        encode_session_message("status", json!({ "state": next_state })),
    );
}

fn emit_native_session_output(
    app: &AppHandle,
    session_id: &str,
    state: &Arc<Mutex<NativeSessionState>>,
    output: String,
) {
    emit_native_session_message(
        app,
        session_id,
        state,
        encode_session_message("data", json!({ "data": output })),
    );
}

fn emit_native_session_error(
    app: &AppHandle,
    session_id: &str,
    state: &Arc<Mutex<NativeSessionState>>,
    error: String,
) {
    emit_native_session_message(
        app,
        session_id,
        state,
        encode_session_message("error", json!({ "message": error })),
    );
}

fn should_use_native_session(host: &BackendHostConnection) -> bool {
    match host.protocol.as_str() {
        "localShell" => true,
        "telnet" => true,
        "serial" => true,
        "mosh" => true,
        "ssh" => host.auth_method != "none",
        _ => false,
    }
}

fn validate_ssh_host(host: &BackendHostConnection) -> Result<(), String> {
    if host.protocol != "ssh" {
        return Err(format!(
            "Unsupported SSH transport protocol: {}",
            host.protocol
        ));
    }

    if host.hostname.trim().is_empty() || host.username.trim().is_empty() || host.port == 0 {
        return Err("Missing host connection fields".to_string());
    }

    if host.port > u32::from(u16::MAX) {
        return Err("SSH port must be between 1 and 65535".to_string());
    }

    if host.auth_method == "password" && host.password.is_empty() {
        return Err("Password auth selected but no password provided".to_string());
    }

    if host.auth_method == "privateKey" && host.private_key_path.trim().is_empty() {
        return Err("Private key auth selected but no key path provided".to_string());
    }

    if host.auth_method == "none" {
        return Err("Host is configured without SSH auth".to_string());
    }

    // Defense-in-depth: refuse to connect when a host requires a trusted key
    // and the renderer did not supply one. Mirrors the Node backend check in
    // apps/desktop/server/backend.mjs createConnectConfig().
    if host_requires_trusted_key(host) && host.known_host_public_key.is_none() {
        return Err(format!(
            "Trusted host key required for {}:{} but none was provided. Scan and trust the host first.",
            host.hostname, host.port
        ));
    }

    if let Some(jump_host) = &host.jump_host {
        validate_ssh_host(jump_host)?;
    }

    Ok(())
}

fn validate_session_target(host: &BackendHostConnection) -> Result<(), String> {
    match host.protocol.as_str() {
        "localShell" => Ok(()),
        "ssh" => validate_ssh_host(host),
        "telnet" => validate_network_host(host, false),
        "serial" => validate_network_host(host, false),
        "mosh" => validate_mosh_host(host),
        other => Err(format!("Unsupported session protocol: {other}")),
    }
}

fn authenticate_native_session(
    session: &mut Session,
    host: &BackendHostConnection,
) -> Result<(), String> {
    match host.auth_method.as_str() {
        "password" => session
            .userauth_password(&host.username, &host.password)
            .map_err(|error| error.to_string())?,
        "privateKey" => session
            .userauth_pubkey_file(
                &host.username,
                None,
                &expand_home(&host.private_key_path),
                if host.passphrase.is_empty() {
                    None
                } else {
                    Some(host.passphrase.as_str())
                },
            )
            .map_err(|error| error.to_string())?,
        "none" => return Err("Host is configured without SSH auth".to_string()),
        _ => return Err(format!("Unsupported auth method: {}", host.auth_method)),
    }

    if session.authenticated() {
        Ok(())
    } else {
        Err("SSH authentication failed".to_string())
    }
}

fn open_native_channel(session: &Session, host: &BackendHostConnection) -> Result<Channel, String> {
    let mut channel = session
        .channel_session()
        .map_err(|error| error.to_string())?;
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((
                u32::from(DEFAULT_TERMINAL_COLS),
                u32::from(DEFAULT_TERMINAL_ROWS),
                u32::from(DEFAULT_TERMINAL_PIXEL_WIDTH),
                u32::from(DEFAULT_TERMINAL_PIXEL_HEIGHT),
            )),
        )
        .map_err(|error| error.to_string())?;

    if let Some(environment) = get_channel_environment(&host.environment) {
        for (key, value) in environment {
            channel
                .setenv(&key, &value)
                .map_err(|error| error.to_string())?;
        }
    }

    if host.agent_forwarding && env::var_os("SSH_AUTH_SOCK").is_some() {
        let _ = channel.request_auth_agent_forwarding();
    }

    channel.shell().map_err(|error| error.to_string())?;
    Ok(channel)
}

fn connect_native_session(host: &BackendHostConnection) -> Result<(Session, Channel), String> {
    let tcp_stream = TcpStream::connect((
        host.hostname.as_str(),
        u16::try_from(host.port).map_err(|_| "SSH port must be between 1 and 65535".to_string())?,
    ))
    .map_err(|error| error.to_string())?;
    let _ = tcp_stream.set_nodelay(true);

    let mut session = Session::new().map_err(|error| error.to_string())?;
    session.set_tcp_stream(tcp_stream);
    session.handshake().map_err(|error| error.to_string())?;

    if let Some(expected_key) = host.known_host_public_key.as_ref() {
        let (actual_key, _) = session
            .host_key()
            .ok_or_else(|| "SSH server did not present a host key".to_string())?;
        if BASE64_STANDARD.encode(actual_key) != *expected_key {
            return Err(format!(
                "Trusted host key mismatch for {}:{}.",
                host.hostname, host.port
            ));
        }
    }

    authenticate_native_session(&mut session, host)?;
    let channel = open_native_channel(&session, host)?;
    session.set_blocking(false);

    Ok((session, channel))
}

fn write_jump_session_input(
    writer: &Arc<Mutex<Box<dyn Write + Send>>>,
    input: &str,
) -> Result<(), String> {
    let mut writer = writer.lock().expect("jump session writer lock poisoned");
    writer
        .write_all(input.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn resize_jump_session_pty(
    master: &mut Box<dyn MasterPty + Send>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: cols.saturating_mul(8),
            pixel_height: rows.saturating_mul(16),
        })
        .map_err(|error| error.to_string())
}

fn spawn_jump_session_reader(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    mut prompt_responses: Vec<PromptResponse>,
    sender: std::sync::mpsc::Sender<JumpSessionEvent>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];
        let mut prompt_window = String::new();
        let reusable_responses = prompt_responses.clone();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send(JumpSessionEvent::Eof);
                    break;
                }
                Ok(count) => {
                    let output = String::from_utf8_lossy(&buffer[..count]).to_string();
                    prompt_window.push_str(&output);
                    if prompt_window.len() > NATIVE_SESSION_PROMPT_WINDOW_SIZE {
                        let excess = prompt_window.len() - NATIVE_SESSION_PROMPT_WINDOW_SIZE;
                        prompt_window.drain(0..excess);
                    }

                    while let Some(kind) = detect_prompt_kind(&prompt_window) {
                        let response =
                            take_prompt_response(&mut prompt_responses, kind).or_else(|| {
                                reusable_responses
                                    .iter()
                                    .rev()
                                    .find(|response| response.kind == kind)
                                    .cloned()
                            });
                        let Some(response) = response else {
                            break;
                        };

                        if write_jump_session_input(&writer, &format!("{}\n", response.value))
                            .is_err()
                        {
                            break;
                        }
                        prompt_window.clear();
                    }

                    let _ = sender.send(JumpSessionEvent::Output(output));
                }
                Err(error) => {
                    let _ = sender.send(JumpSessionEvent::Error(error.to_string()));
                    break;
                }
            }
        }
    });
}

fn spawn_local_session_reader(
    mut reader: Box<dyn Read + Send>,
    sender: std::sync::mpsc::Sender<JumpSessionEvent>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send(JumpSessionEvent::Eof);
                    break;
                }
                Ok(count) => {
                    let output = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let _ = sender.send(JumpSessionEvent::Output(output));
                }
                Err(error) => {
                    let _ = sender.send(JumpSessionEvent::Error(error.to_string()));
                    break;
                }
            }
        }
    });
}

fn run_external_command_session_loop(
    app: AppHandle,
    registry: NativeSessionRegistry,
    forward_registry: NativeForwardRegistry,
    session_id: String,
    state: Arc<Mutex<NativeSessionState>>,
    host: BackendHostConnection,
    mut receiver: UnboundedReceiver<NativeSessionCommand>,
) {
    let mut cleanup_dir = None;
    let result = (|| -> Result<(), String> {
        let ExternalCommandSessionSpec {
            command,
            exit_label,
            prompt_responses,
            cleanup_dir: spec_cleanup_dir,
        } = build_external_command_session_spec(&host, &session_id)?;
        cleanup_dir = spec_cleanup_dir.clone();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: DEFAULT_TERMINAL_ROWS,
                cols: DEFAULT_TERMINAL_COLS,
                pixel_width: DEFAULT_TERMINAL_PIXEL_WIDTH,
                pixel_height: DEFAULT_TERMINAL_PIXEL_HEIGHT,
            })
            .map_err(|error| error.to_string())?;

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        drop(pair.slave);

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| error.to_string())?,
        ));
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let mut master = pair.master;
        let (output_sender, output_receiver) = std::sync::mpsc::channel();

        if prompt_responses.is_empty() {
            spawn_local_session_reader(reader, output_sender);
        } else {
            spawn_jump_session_reader(reader, writer.clone(), prompt_responses, output_sender);
        }
        set_native_session_connection_state(&app, &session_id, &state, "connected");

        let mut should_close = false;
        let mut reported_error = false;

        while !should_close {
            let mut did_work = false;

            loop {
                match receiver.try_recv() {
                    Ok(NativeSessionCommand::Close) => {
                        should_close = true;
                        break;
                    }
                    Ok(NativeSessionCommand::Input(input)) => {
                        did_work = true;
                        write_jump_session_input(&writer, &input)?;
                    }
                    Ok(NativeSessionCommand::Resize { cols, rows }) => {
                        did_work = true;
                        resize_jump_session_pty(&mut master, cols, rows)?;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        should_close = true;
                        break;
                    }
                }
            }

            loop {
                match output_receiver.try_recv() {
                    Ok(JumpSessionEvent::Output(output)) => {
                        did_work = true;
                        emit_native_session_output(&app, &session_id, &state, output);
                    }
                    Ok(JumpSessionEvent::Error(error)) => {
                        emit_native_session_error(&app, &session_id, &state, error);
                        set_native_session_connection_state(&app, &session_id, &state, "error");
                        reported_error = true;
                        should_close = true;
                        break;
                    }
                    Ok(JumpSessionEvent::Eof) => {
                        should_close = true;
                        break;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        should_close = true;
                        break;
                    }
                }
            }

            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() && !reported_error {
                        emit_native_session_error(
                            &app,
                            &session_id,
                            &state,
                            format!("{exit_label} exited with status {status}."),
                        );
                        set_native_session_connection_state(&app, &session_id, &state, "error");
                    }
                    should_close = true;
                }
                Ok(None) => {}
                Err(error) => {
                    emit_native_session_error(&app, &session_id, &state, error.to_string());
                    set_native_session_connection_state(&app, &session_id, &state, "error");
                    should_close = true;
                }
            }

            if !did_work && !should_close {
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        drop(master);

        Ok(())
    })();

    if let Err(error) = result {
        emit_native_session_error(&app, &session_id, &state, error);
        set_native_session_connection_state(&app, &session_id, &state, "error");
    }

    close_native_forwards_for_session(&forward_registry, &session_id);
    remove_native_session(&registry, &session_id);
    set_native_session_connection_state(&app, &session_id, &state, "disconnected");

    if let Some(cleanup_dir) = cleanup_dir {
        let _ = fs::remove_dir_all(cleanup_dir);
    }

    let stream_id = {
        let mut state = state.lock().expect("native session state lock poisoned");
        state.stream_id.take()
    };

    if let Some(stream_id) = stream_id {
        emit_session_stream_event(
            &app,
            SessionStreamEvent {
                data: None,
                kind: "close",
                message: None,
                session_id: session_id.clone(),
                stream_id,
            },
        );
    }
}

fn run_jump_host_session_loop(
    app: AppHandle,
    registry: NativeSessionRegistry,
    forward_registry: NativeForwardRegistry,
    session_id: String,
    state: Arc<Mutex<NativeSessionState>>,
    host: BackendHostConnection,
    mut receiver: UnboundedReceiver<NativeSessionCommand>,
) {
    let session_dir = match create_native_ssh_session_dir(&session_id) {
        Ok(path) => path,
        Err(error) => {
            emit_native_session_error(&app, &session_id, &state, error);
            set_native_session_connection_state(&app, &session_id, &state, "error");
            set_native_session_connection_state(&app, &session_id, &state, "disconnected");
            return;
        }
    };

    let result = (|| -> Result<(), String> {
        let known_hosts_path = write_native_known_hosts(&host, &session_dir)?;
        let (config_path, target_alias) =
            build_native_ssh_config(&host, &session_dir, &known_hosts_path, None)?;
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: DEFAULT_TERMINAL_ROWS,
                cols: DEFAULT_TERMINAL_COLS,
                pixel_width: DEFAULT_TERMINAL_PIXEL_WIDTH,
                pixel_height: DEFAULT_TERMINAL_PIXEL_HEIGHT,
            })
            .map_err(|error| error.to_string())?;

        let mut command = CommandBuilder::new("/usr/bin/ssh");
        command.arg("-F");
        command.arg(config_path.to_string_lossy().into_owned());
        command.arg("-tt");
        command.arg(target_alias);
        if let Some(remote_command) = build_interactive_shell_command(&host.environment) {
            command.arg(remote_command);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        drop(pair.slave);

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| error.to_string())?,
        ));
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let mut master = pair.master;
        let (output_sender, output_receiver) = std::sync::mpsc::channel();

        spawn_jump_session_reader(
            reader,
            writer.clone(),
            build_prompt_responses(&host),
            output_sender,
        );
        set_native_session_connection_state(&app, &session_id, &state, "connected");

        let mut should_close = false;
        let mut reported_error = false;

        while !should_close {
            let mut did_work = false;

            loop {
                match receiver.try_recv() {
                    Ok(NativeSessionCommand::Close) => {
                        should_close = true;
                        break;
                    }
                    Ok(NativeSessionCommand::Input(input)) => {
                        did_work = true;
                        write_jump_session_input(&writer, &input)?;
                    }
                    Ok(NativeSessionCommand::Resize { cols, rows }) => {
                        did_work = true;
                        resize_jump_session_pty(&mut master, cols, rows)?;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        should_close = true;
                        break;
                    }
                }
            }

            loop {
                match output_receiver.try_recv() {
                    Ok(JumpSessionEvent::Output(output)) => {
                        did_work = true;
                        emit_native_session_output(&app, &session_id, &state, output);
                    }
                    Ok(JumpSessionEvent::Error(error)) => {
                        emit_native_session_error(&app, &session_id, &state, error);
                        set_native_session_connection_state(&app, &session_id, &state, "error");
                        reported_error = true;
                        should_close = true;
                        break;
                    }
                    Ok(JumpSessionEvent::Eof) => {
                        should_close = true;
                        break;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        should_close = true;
                        break;
                    }
                }
            }

            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() && !reported_error {
                        emit_native_session_error(
                            &app,
                            &session_id,
                            &state,
                            format!("SSH session exited with status {status}."),
                        );
                        set_native_session_connection_state(&app, &session_id, &state, "error");
                    }
                    should_close = true;
                }
                Ok(None) => {}
                Err(error) => {
                    emit_native_session_error(&app, &session_id, &state, error.to_string());
                    set_native_session_connection_state(&app, &session_id, &state, "error");
                    should_close = true;
                }
            }

            if !did_work && !should_close {
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
        }

        let _ = child.kill();
        let _ = child.wait();
        drop(master);

        Ok(())
    })();

    if let Err(error) = result {
        emit_native_session_error(&app, &session_id, &state, error);
        set_native_session_connection_state(&app, &session_id, &state, "error");
    }

    close_native_forwards_for_session(&forward_registry, &session_id);
    remove_native_session(&registry, &session_id);
    set_native_session_connection_state(&app, &session_id, &state, "disconnected");

    let stream_id = {
        let mut state = state.lock().expect("native session state lock poisoned");
        state.stream_id.take()
    };

    if let Some(stream_id) = stream_id {
        emit_session_stream_event(
            &app,
            SessionStreamEvent {
                data: None,
                kind: "close",
                message: None,
                session_id: session_id.clone(),
                stream_id,
            },
        );
    }

    let _ = fs::remove_dir_all(session_dir);
}

fn write_native_session_input(channel: &mut Channel, input: &[u8]) -> Result<(), String> {
    let mut written = 0;
    while written < input.len() {
        match channel.write(&input[written..]) {
            Ok(0) => return Err("SSH session is closed".to_string()),
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    channel.flush().map_err(|error| error.to_string())
}

fn handle_native_session_command(
    channel: &mut Channel,
    command: NativeSessionCommand,
) -> Result<bool, String> {
    match command {
        NativeSessionCommand::Close => Ok(true),
        NativeSessionCommand::Input(input) => {
            write_native_session_input(channel, input.as_bytes())?;
            Ok(false)
        }
        NativeSessionCommand::Resize { cols, rows } => {
            channel
                .request_pty_size(
                    u32::from(cols),
                    u32::from(rows),
                    Some(u32::from(cols) * 8),
                    Some(u32::from(rows) * 16),
                )
                .map_err(|error| error.to_string())?;
            Ok(false)
        }
    }
}

fn run_native_session_loop(
    app: AppHandle,
    registry: NativeSessionRegistry,
    forward_registry: NativeForwardRegistry,
    session_id: String,
    state: Arc<Mutex<NativeSessionState>>,
    session: Session,
    mut channel: Channel,
    mut receiver: UnboundedReceiver<NativeSessionCommand>,
) {
    let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];

    loop {
        let mut did_work = false;
        let mut should_close = false;

        loop {
            match receiver.try_recv() {
                Ok(command) => {
                    did_work = true;
                    match handle_native_session_command(&mut channel, command) {
                        Ok(true) => {
                            should_close = true;
                            break;
                        }
                        Ok(false) => {}
                        Err(error) => {
                            emit_native_session_error(&app, &session_id, &state, error);
                            should_close = true;
                            break;
                        }
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    should_close = true;
                    break;
                }
            }
        }

        if should_close {
            break;
        }

        match channel.read(&mut buffer) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(count) => {
                did_work = true;
                emit_native_session_output(
                    &app,
                    &session_id,
                    &state,
                    String::from_utf8_lossy(&buffer[..count]).to_string(),
                );
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => {
                emit_native_session_error(&app, &session_id, &state, error.to_string());
                break;
            }
        }

        if channel.eof() {
            break;
        }

        if !did_work {
            thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
        }
    }

    let _ = channel.close();
    let _ = channel.wait_close();
    let _ = session.disconnect(None, "TermSnip session closed", None);
    close_native_forwards_for_session(&forward_registry, &session_id);
    remove_native_session(&registry, &session_id);
    set_native_session_connection_state(&app, &session_id, &state, "disconnected");

    let stream_id = {
        let mut state = state.lock().expect("native session state lock poisoned");
        state.stream_id.take()
    };

    if let Some(stream_id) = stream_id {
        emit_session_stream_event(
            &app,
            SessionStreamEvent {
                data: None,
                kind: "close",
                message: None,
                session_id,
                stream_id,
            },
        );
    }
}

fn open_native_session_stream(
    app: &AppHandle,
    registry: &NativeSessionRegistry,
    session_id: &str,
) -> Result<SessionStreamOpenResponse, String> {
    let handle = get_native_session(registry, session_id)
        .ok_or_else(|| "Session stream not found".to_string())?;

    let (stream_id, connection_state, buffered_messages) = {
        let mut state = handle
            .state
            .lock()
            .expect("native session state lock poisoned");
        let stream_id = state
            .stream_id
            .clone()
            .unwrap_or_else(|| next_session_stream_id());
        state.stream_id = Some(stream_id.clone());
        let buffered_messages = std::mem::take(&mut state.buffered_messages);
        (stream_id, state.connection_state.clone(), buffered_messages)
    };

    emit_session_stream_event(
        app,
        SessionStreamEvent {
            data: Some(encode_session_message(
                "status",
                json!({ "state": connection_state }),
            )),
            kind: "message",
            message: None,
            session_id: session_id.to_string(),
            stream_id: stream_id.clone(),
        },
    );

    for message in buffered_messages {
        emit_session_stream_event(
            app,
            SessionStreamEvent {
                data: Some(message),
                kind: "message",
                message: None,
                session_id: session_id.to_string(),
                stream_id: stream_id.clone(),
            },
        );
    }

    Ok(SessionStreamOpenResponse {
        ok: true,
        stream_id,
    })
}

fn send_native_session_stream(
    registry: &NativeSessionRegistry,
    request: SessionStreamSendRequest,
) -> Result<BackendBooleanResponse, String> {
    let handle = get_native_session(registry, &request.session_id)
        .ok_or_else(|| "Session stream not found".to_string())?;

    let active_stream_id = handle
        .state
        .lock()
        .expect("native session state lock poisoned")
        .stream_id
        .clone();

    if active_stream_id.as_deref() != Some(request.stream_id.as_str()) {
        return Err("Session stream is stale".to_string());
    }

    handle
        .command_sender
        .send(NativeSessionCommand::Input(request.data))
        .map_err(|_| "Session stream is closed".to_string())?;

    Ok(BackendBooleanResponse {
        ok: true,
        pending: None,
    })
}

fn close_native_session_stream(
    registry: &NativeSessionRegistry,
    request: SessionStreamRequest,
) -> Option<BackendBooleanResponse> {
    let handle = get_native_session(registry, &request.session_id)?;
    let mut state = handle
        .state
        .lock()
        .expect("native session state lock poisoned");

    let should_detach = match (&request.stream_id, &state.stream_id) {
        (Some(request_stream_id), Some(active_stream_id)) => request_stream_id == active_stream_id,
        (None, Some(_)) => true,
        _ => false,
    };

    if should_detach {
        state.stream_id = None;
    }

    Some(BackendBooleanResponse {
        ok: true,
        pending: None,
    })
}

#[tauri::command]
fn termsnip_transport_info() -> BackendTransportInfo {
    BackendTransportInfo {
        backend_base_url: String::new(),
        session_bridge: "tauri-native",
    }
}

#[tauri::command]
fn termsnip_protocol_runtime_status(
    request: ProtocolRuntimeStatusRequest,
) -> ProtocolRuntimeStatusResponse {
    build_protocol_runtime_status(&request.protocol)
}

/// Backend status check. P2-NET: the native shell owns SSH/SFTP/forwarding,
/// snippets, key tooling, and persistence, so no Node backend is contacted.
#[tauri::command]
async fn termsnip_backend_status() -> Result<BackendStatusResponse, String> {
    Ok(BackendStatusResponse {
        ok: true,
        backend_base_url: String::new(),
        transport: "tauri-native",
    })
}

#[tauri::command]
async fn termsnip_inspect_private_key(request: KeyPathRequest) -> Result<KeyMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_private_key(&request.path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_generate_private_key(request: GenerateKeyRequest) -> Result<KeyMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || generate_key_pair(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_scan_known_host(
    request: KnownHostScanRequest,
) -> Result<KnownHostScanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || scan_known_host(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn termsnip_sftp_list_directory(request: SftpPathRequest) -> Result<SftpDirectoryResponse, String> {
    validate_ssh_host(&request.host)?;
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.path,
    );
    let output =
        with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
            run_sftp_batch_commands(
                &request.host,
                context,
                &[format!("@ls -la {}", escape_sftp_argument(&target_path))],
            )
        })?;

    Ok(SftpDirectoryResponse {
        entries: parse_sftp_directory_listing(&target_path, &output),
        path: target_path,
    })
}

#[tauri::command]
fn termsnip_sftp_create_directory(request: SftpPathRequest) -> Result<BackendPathResponse, String> {
    validate_ssh_host(&request.host)?;
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.path,
    );
    with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
        run_sftp_batch_commands(
            &request.host,
            context,
            &[format!("@mkdir {}", escape_sftp_argument(&target_path))],
        )
        .map(|_| BackendPathResponse {
            ok: true,
            path: target_path.clone(),
        })
    })
}

#[tauri::command]
fn termsnip_sftp_rename_entry(request: SftpRenameRequest) -> Result<BackendPathResponse, String> {
    validate_ssh_host(&request.host)?;
    let source_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.current_path,
    );
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.next_path,
    );
    with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
        run_sftp_batch_commands(
            &request.host,
            context,
            &[format!(
                "@rename {} {}",
                escape_sftp_argument(&source_path),
                escape_sftp_argument(&target_path)
            )],
        )
        .map(|_| BackendPathResponse {
            ok: true,
            path: target_path.clone(),
        })
    })
}

#[tauri::command]
fn termsnip_sftp_delete_entry(
    request: SftpDeleteRequest,
) -> Result<BackendBooleanResponse, String> {
    validate_ssh_host(&request.host)?;
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.path,
    );
    with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
        run_sftp_batch_commands(
            &request.host,
            context,
            &[format!(
                "@{} {}",
                if request.is_directory { "rmdir" } else { "rm" },
                escape_sftp_argument(&target_path)
            )],
        )
        .map(|_| BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
}

#[tauri::command]
fn termsnip_sftp_upload_file(request: SftpUploadRequest) -> Result<BackendPathResponse, String> {
    validate_ssh_host(&request.host)?;
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.path,
    );
    let contents = BASE64_STANDARD
        .decode(request.contents_base64.as_bytes())
        .map_err(|error| error.to_string())?;
    with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
        let upload_path = context
            .session_dir
            .join(format!("upload-{}", sanitize_filename(&request.filename)));
        fs::write(&upload_path, &contents).map_err(|error| error.to_string())?;
        run_sftp_batch_commands(
            &request.host,
            context,
            &[format!(
                "@put {} {}",
                escape_sftp_argument(&upload_path.to_string_lossy()),
                escape_sftp_argument(&target_path)
            )],
        )
        .map(|_| BackendPathResponse {
            ok: true,
            path: target_path.clone(),
        })
    })
}

#[tauri::command]
fn termsnip_sftp_download_file(
    request: SftpPathRequest,
) -> Result<BackendBinaryResponse, String> {
    validate_ssh_host(&request.host)?;
    let target_path = resolve_remote_path(
        request.host.sftp_root.as_deref().unwrap_or("/"),
        &request.path,
    );
    with_native_ssh_control_session(&request.host, &next_native_session_id(), |context| {
        let filename = sanitize_filename(
            target_path
                .rsplit('/')
                .find(|segment| !segment.is_empty())
                .unwrap_or("download"),
        );
        let download_path = context.session_dir.join(format!("download-{filename}"));
        run_sftp_batch_commands(
            &request.host,
            context,
            &[format!(
                "@get {} {}",
                escape_sftp_argument(&target_path),
                escape_sftp_argument(&download_path.to_string_lossy())
            )],
        )?;
        let bytes = fs::read(download_path).map_err(|error| error.to_string())?;
        Ok(BackendBinaryResponse {
            base64_body: BASE64_STANDARD.encode(bytes),
            content_disposition: Some(format!("attachment; filename=\"{filename}\"")),
            content_type: Some("application/octet-stream".to_string()),
        })
    })
}

#[tauri::command]
fn termsnip_list_session_forwards(
    native_forwards: State<'_, NativeForwardRegistry>,
    request: SessionIdRequest,
) -> ListForwardsResponse {
    list_session_forwards(native_forwards.inner(), &request.session_id)
}

#[tauri::command]
fn termsnip_create_forward(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    request: CreateForwardPayload,
) -> Result<PortForwardRecord, String> {
    create_native_forward(native_sessions.inner(), native_forwards.inner(), request)
}

#[tauri::command]
fn termsnip_delete_forward(
    native_forwards: State<'_, NativeForwardRegistry>,
    request: ForwardIdRequest,
) -> BackendBooleanResponse {
    delete_native_forward(native_forwards.inner(), &request.forward_id)
}

#[tauri::command]
async fn termsnip_execute_snippet_on_hosts(
    request: SnippetExecutionRequest,
) -> Result<SnippetExecutionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || execute_native_snippet_request(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_load_host_secrets(
    request: HostSecretsRequest,
) -> Result<HostSecretsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(HostSecretsResponse {
            password: load_keychain_secret(KEYCHAIN_PASSWORD_SERVICE, &request.host_id)?
                .unwrap_or_default(),
            passphrase: load_keychain_secret(KEYCHAIN_PASSPHRASE_SERVICE, &request.host_id)?
                .unwrap_or_default(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_store_host_secrets(
    request: StoreHostSecretsRequest,
) -> Result<BackendBooleanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_keychain_secret(
            KEYCHAIN_PASSWORD_SERVICE,
            &request.host_id,
            &request.password,
        )?;
        store_keychain_secret(
            KEYCHAIN_PASSPHRASE_SERVICE,
            &request.host_id,
            &request.passphrase,
        )?;

        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_clear_host_secrets(
    request: HostSecretsRequest,
) -> Result<BackendBooleanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_keychain_secret(KEYCHAIN_PASSWORD_SERVICE, &request.host_id)?;
        delete_keychain_secret(KEYCHAIN_PASSPHRASE_SERVICE, &request.host_id)?;

        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Read the passphrase for a private key by SSH key fingerprint. Multiple
/// hosts using the same key share this entry, so the user only has to type
/// the passphrase once per key. Returns an empty string when no entry
/// exists. See parity-and-hardening-plan.md P1-S5.
#[tauri::command]
async fn termsnip_load_key_passphrase(
    request: KeyPassphraseRequest,
) -> Result<KeyPassphraseResponse, String> {
    validate_key_fingerprint(&request.fingerprint)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(KeyPassphraseResponse {
            passphrase: load_keychain_secret(
                KEYCHAIN_KEY_PASSPHRASE_SERVICE,
                &request.fingerprint,
            )?
            .unwrap_or_default(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_store_key_passphrase(
    request: StoreKeyPassphraseRequest,
) -> Result<BackendBooleanResponse, String> {
    validate_key_fingerprint(&request.fingerprint)?;
    tauri::async_runtime::spawn_blocking(move || {
        store_keychain_secret(
            KEYCHAIN_KEY_PASSPHRASE_SERVICE,
            &request.fingerprint,
            &request.passphrase,
        )?;
        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_clear_key_passphrase(
    request: KeyPassphraseRequest,
) -> Result<BackendBooleanResponse, String> {
    validate_key_fingerprint(&request.fingerprint)?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_keychain_secret(KEYCHAIN_KEY_PASSPHRASE_SERVICE, &request.fingerprint)?;
        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Read the passphrase for a reusable Identity (P2-DM1 batch 3). Replaces
/// the per-fingerprint workaround from P1-S5 — multiple hosts that share
/// the same identity already share its (username, key) pair, so this is a
/// strict generalisation. Returns an empty string when no entry exists.
#[tauri::command]
async fn termsnip_load_identity_passphrase(
    request: IdentityPassphraseRequest,
) -> Result<IdentityPassphraseResponse, String> {
    validate_identity_id(&request.identity_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(IdentityPassphraseResponse {
            passphrase: load_keychain_secret(
                KEYCHAIN_IDENTITY_PASSPHRASE_SERVICE,
                &request.identity_id,
            )?
            .unwrap_or_default(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_store_identity_passphrase(
    request: StoreIdentityPassphraseRequest,
) -> Result<BackendBooleanResponse, String> {
    validate_identity_id(&request.identity_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        store_keychain_secret(
            KEYCHAIN_IDENTITY_PASSPHRASE_SERVICE,
            &request.identity_id,
            &request.passphrase,
        )?;
        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn termsnip_clear_identity_passphrase(
    request: IdentityPassphraseRequest,
) -> Result<BackendBooleanResponse, String> {
    validate_identity_id(&request.identity_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_keychain_secret(KEYCHAIN_IDENTITY_PASSPHRASE_SERVICE, &request.identity_id)?;
        Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSshConfigFileRequest {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadSshConfigFileResponse {
    content: String,
}

/// Read a single OpenSSH config file from the user's ~/.ssh/ tree. Used by
/// the renderer's Include-directive preprocessor (issue #28). The path
/// allowlist is the security boundary — any file outside the canonicalized
/// ~/.ssh/ root is rejected before we open it. Symlinks are followed via
/// `canonicalize`, which resolves the *destination*, not the link itself,
/// so a symlink inside ~/.ssh/ that points outside is rejected too.
///
/// File size is capped because SSH configs are text and a 100 MB attacker-
/// supplied file would otherwise pin a UI thread.
#[tauri::command]
async fn termsnip_read_ssh_config_file(
    request: ReadSshConfigFileRequest,
) -> Result<ReadSshConfigFileResponse, String> {
    tauri::async_runtime::spawn_blocking(move || read_ssh_config_file_blocking(&request.path))
        .await
        .map_err(|error| error.to_string())?
}

const SSH_CONFIG_MAX_BYTES: u64 = 1024 * 1024;

fn read_ssh_config_file_blocking(raw_path: &str) -> Result<ReadSshConfigFileResponse, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME env var is not set".to_string())?;
    let ssh_root = home
        .join(".ssh")
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize ~/.ssh: {error}"))?;

    let raw = expand_home(raw_path);
    let canonical = raw
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize {raw_path}: {error}"))?;

    if !canonical.starts_with(&ssh_root) {
        return Err(format!(
            "path {} is not under {}",
            canonical.display(),
            ssh_root.display()
        ));
    }

    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("cannot stat {}: {error}", canonical.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", canonical.display()));
    }
    if metadata.len() > SSH_CONFIG_MAX_BYTES {
        return Err(format!(
            "{} exceeds SSH config size limit of {} bytes",
            canonical.display(),
            SSH_CONFIG_MAX_BYTES
        ));
    }

    let content = std::fs::read_to_string(&canonical)
        .map_err(|error| format!("cannot read {}: {error}", canonical.display()))?;
    Ok(ReadSshConfigFileResponse { content })
}

#[tauri::command]
async fn termsnip_create_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    app: AppHandle,
    request: CreateBackendSessionRequest,
) -> Result<CreateSessionResponse, String> {
    validate_session_target(&request.host)?;

    if !should_use_native_session(&request.host) {
        return Err(format!(
            "Native transport does not support {} sessions without credentials",
            request.host.protocol
        ));
    }

    let session_id = next_native_session_id();
    let state = Arc::new(Mutex::new(NativeSessionState {
        buffered_messages: Vec::new(),
        connection_state: "connecting".to_string(),
        stream_id: None,
    }));
    let native_registry = native_sessions.inner().clone();
    let forward_registry = native_forwards.inner().clone();
    let host = request.host;
    let session_host = host.clone();
    let app_handle = app.clone();
    let session_id_for_thread = session_id.clone();
    let state_for_thread = state.clone();
    let command_sender = if host.protocol == "localShell"
        || host.protocol == "telnet"
        || host.protocol == "serial"
        || host.protocol == "mosh"
    {
        let (command_sender, command_receiver) = unbounded_channel();
        let registry_for_thread = native_registry.clone();
        let forward_registry_for_thread = forward_registry.clone();
        let thread_app = app_handle.clone();
        let thread_session_id = session_id_for_thread.clone();
        let thread_state = state_for_thread.clone();

        thread::spawn(move || {
            run_external_command_session_loop(
                thread_app,
                registry_for_thread,
                forward_registry_for_thread,
                thread_session_id,
                thread_state,
                host,
                command_receiver,
            );
        });

        command_sender
    } else if host.jump_host.is_some() {
        let (command_sender, command_receiver) = unbounded_channel();
        let registry_for_thread = native_registry.clone();
        let forward_registry_for_thread = forward_registry.clone();
        let thread_app = app_handle.clone();
        let thread_session_id = session_id_for_thread.clone();
        let thread_state = state_for_thread.clone();

        thread::spawn(move || {
            run_jump_host_session_loop(
                thread_app,
                registry_for_thread,
                forward_registry_for_thread,
                thread_session_id,
                thread_state,
                host,
                command_receiver,
            );
        });

        command_sender
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            let (session, channel) = connect_native_session(&host)?;
            let (command_sender, command_receiver) = unbounded_channel();
            let registry_for_thread = native_registry.clone();
            let forward_registry_for_thread = forward_registry.clone();
            let thread_app = app_handle.clone();
            let thread_session_id = session_id_for_thread.clone();
            let thread_state = state_for_thread.clone();

            thread::spawn(move || {
                run_native_session_loop(
                    thread_app,
                    registry_for_thread,
                    forward_registry_for_thread,
                    thread_session_id,
                    thread_state,
                    session,
                    channel,
                    command_receiver,
                );
            });

            Ok::<UnboundedSender<NativeSessionCommand>, String>(command_sender)
        })
        .await
        .map_err(|error| error.to_string())??
    };

    insert_native_session(
        native_sessions.inner(),
        &session_id,
        NativeSessionHandle {
            command_sender,
            host: session_host,
            state: state.clone(),
        },
    );
    set_native_session_connection_state(&app, &session_id, &state, "connected");

    Ok(CreateSessionResponse { session_id })
}

#[tauri::command]
async fn termsnip_close_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    request: SessionIdRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(handle) = remove_native_session(native_sessions.inner(), &request.session_id) {
        close_native_forwards_for_session(native_forwards.inner(), &request.session_id);
        let _ = handle.command_sender.send(NativeSessionCommand::Close);
        return Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        });
    }

    Err("Session not found in native runtime".to_string())
}

#[tauri::command]
async fn termsnip_resize_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    request: ResizeBackendSessionRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(handle) = get_native_session(native_sessions.inner(), &request.session_id) {
        handle
            .command_sender
            .send(NativeSessionCommand::Resize {
                cols: request.payload.cols,
                rows: request.payload.rows,
            })
            .map_err(|_| "Session stream is closed".to_string())?;

        return Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        });
    }

    Err("Session not found in native runtime".to_string())
}

#[tauri::command]
async fn termsnip_open_backend_session_stream(
    app: AppHandle,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamRequest,
) -> Result<SessionStreamOpenResponse, String> {
    open_native_session_stream(&app, native_sessions.inner(), &request.session_id)
}

#[tauri::command]
fn termsnip_send_backend_session_stream(
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamSendRequest,
) -> Result<BackendBooleanResponse, String> {
    send_native_session_stream(native_sessions.inner(), request)
}

#[tauri::command]
fn termsnip_close_backend_session_stream(
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(response) = close_native_session_stream(native_sessions.inner(), request.clone()) {
        return Ok(response);
    }

    Ok(BackendBooleanResponse {
        ok: true,
        pending: None,
    })
}

/// Channel name the renderer subscribes to for native menu activations.
/// Payload is the menu-item id string (e.g. "menu:nav-hosts").
const MENU_EVENT_NAME: &str = "termsnip://menu-event";

/// Build the macOS application menu. Each non-system item carries a stable
/// string id (`menu:*`) that the renderer maps to an action via the
/// `MENU_EVENT_NAME` event channel. Accelerators here become OS-handled
/// keyboard shortcuts; the renderer's keydown handlers remain in place as a
/// fallback for browser/dev mode where there is no native menu.
/// See parity-and-hardening-review §4.7 / plan P1-UX4.
fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("term-snip".to_string()))
        .build();

    let app_submenu = SubmenuBuilder::new(app, "term-snip")
        .about(Some(about))
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu:settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("menu:new-tab", "New Tab")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:duplicate-tab", "Duplicate Tab")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:close-tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("menu:import-ssh-config", "Import SSH config…").build(app)?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("menu:nav-hosts", "Hosts")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:nav-sessions", "Sessions")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:nav-snippets", "Snippets")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:nav-keys", "Keys")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:nav-transfers", "Transfers")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:nav-settings", "Settings")
                .accelerator("CmdOrCtrl+6")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("menu:command-palette", "Command Palette")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:toggle-density", "Toggle Compact Density")
                .build(app)?,
        )
        .separator()
        .fullscreen()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(
            &MenuItemBuilder::with_id("menu:next-tab", "Next Tab")
                .accelerator("CmdOrCtrl+Shift+]")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("menu:prev-tab", "Previous Tab")
                .accelerator("CmdOrCtrl+Shift+[")
                .build(app)?,
        )
        .separator()
        .minimize()
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("menu:help", "term-snip Documentation").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ])
        .build()
}

fn persistence_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_termsnip_persistence_tables",
        sql: r#"
            CREATE TABLE IF NOT EXISTS hosts_store (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS keys_store (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS known_hosts_store (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS identities_store (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snippets_store (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deletions (
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                PRIMARY KEY (kind, id)
            );
            CREATE INDEX IF NOT EXISTS deletions_deleted_at_idx
                ON deletions (deleted_at DESC);
        "#,
        kind: MigrationKind::Up,
    }]
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(TERMSNIP_DATABASE_URL, persistence_migrations())
                .build(),
        )
        .manage(NativeSessionRegistry::default())
        .manage(NativeForwardRegistry::default())
        .setup(|app| {
            let handle = app.handle();
            let menu = build_app_menu(&handle)?;
            app.set_menu(menu)?;
            // Bridge OS menu activations to the renderer. Errors are not
            // recoverable here and the menu would degrade silently if we
            // panicked, so we log and continue. The renderer treats missing
            // events as "menu disabled in this build".
            let event_handle = handle.clone();
            app.on_menu_event(move |_app_handle, event| {
                let id_str = event.id().0.clone();
                if let Err(error) = event_handle.emit(MENU_EVENT_NAME, id_str.clone()) {
                    eprintln!("[termsnip] failed to forward menu event {id_str}: {error}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            termsnip_transport_info,
            termsnip_protocol_runtime_status,
            termsnip_backend_status,
            termsnip_inspect_private_key,
            termsnip_generate_private_key,
            termsnip_scan_known_host,
            termsnip_sftp_list_directory,
            termsnip_sftp_create_directory,
            termsnip_sftp_rename_entry,
            termsnip_sftp_delete_entry,
            termsnip_sftp_upload_file,
            termsnip_sftp_download_file,
            termsnip_list_session_forwards,
            termsnip_create_forward,
            termsnip_delete_forward,
            termsnip_execute_snippet_on_hosts,
            termsnip_load_host_secrets,
            termsnip_store_host_secrets,
            termsnip_clear_host_secrets,
            termsnip_load_key_passphrase,
            termsnip_store_key_passphrase,
            termsnip_clear_key_passphrase,
            termsnip_load_identity_passphrase,
            termsnip_store_identity_passphrase,
            termsnip_clear_identity_passphrase,
            termsnip_read_ssh_config_file,
            termsnip_create_backend_session,
            termsnip_close_backend_session,
            termsnip_resize_backend_session,
            termsnip_open_backend_session_stream,
            termsnip_send_backend_session_stream,
            termsnip_close_backend_session_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod native_transport_fixtures;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn build_test_host_chain() -> BackendHostConnection {
        BackendHostConnection {
            agent_forwarding: true,
            auth_method: "password".to_string(),
            environment: Some(HashMap::from([(
                "APP_ENV".to_string(),
                "production".to_string(),
            )])),
            host_key_policy: None,
            hostname: "target.internal".to_string(),
            jump_host: Some(Box::new(BackendHostConnection {
                agent_forwarding: false,
                auth_method: "privateKey".to_string(),
                environment: None,
                host_key_policy: None,
                hostname: "jump.internal".to_string(),
                jump_host: None,
                known_host_algorithm: Some("ssh-ed25519".to_string()),
                known_host_public_key: Some("AAAATESTJUMP".to_string()),
                password: "".to_string(),
                passphrase: "jump-passphrase".to_string(),
                port: 2222,
                private_key_path: "~/.ssh/jump".to_string(),
                protocol: "ssh".to_string(),
                sftp_root: None,
                username: "jump".to_string(),
            })),
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATESTTARGET".to_string()),
            password: "target-password".to_string(),
            passphrase: "".to_string(),
            port: 2223,
            private_key_path: "".to_string(),
            protocol: "ssh".to_string(),
            sftp_root: None,
            username: "deploy".to_string(),
        }
    }

    #[test]
    fn builds_prompt_responses_in_jump_chain_order() {
        let responses = build_prompt_responses(&build_test_host_chain());
        let kinds = responses
            .iter()
            .map(|response| response.kind)
            .collect::<Vec<_>>();
        let values = responses
            .iter()
            .map(|response| response.value.clone())
            .collect::<Vec<_>>();

        assert_eq!(
            kinds,
            vec![PromptResponseKind::Passphrase, PromptResponseKind::Password]
        );
        assert_eq!(values, vec!["jump-passphrase", "target-password"]);
    }

    #[test]
    fn detects_only_complete_passphrase_prompts() {
        assert_eq!(
            detect_prompt_kind("Enter passphrase for key '/tmp/id_fixture_ed25519':"),
            Some(PromptResponseKind::Passphrase)
        );
        assert_eq!(
            detect_prompt_kind("Enter passphrase for key '/tmp/id_fixture_ed25519"),
            None
        );
    }

    #[test]
    fn builds_known_hosts_patterns_for_nondefault_ports() {
        let host = build_test_host_chain();
        let chain = build_connection_chain(&host);

        assert_eq!(known_hosts_host_pattern(chain[0]), "[jump.internal]:2222");
        assert_eq!(known_hosts_host_pattern(chain[1]), "[target.internal]:2223");
    }

    #[test]
    fn resolves_remote_paths_relative_to_the_sftp_root() {
        assert_eq!(resolve_remote_path("/srv", "releases/../logs"), "/srv/logs");
        assert_eq!(resolve_remote_path("/srv", "/var/tmp"), "/var/tmp");
        assert_eq!(resolve_remote_path("/", "../../etc"), "/etc");
    }

    #[test]
    fn validates_telnet_serial_and_mosh_session_targets() {
        let telnet_host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "none".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "legacy.internal".to_string(),
            jump_host: None,
            known_host_algorithm: None,
            known_host_public_key: None,
            password: "".to_string(),
            passphrase: "".to_string(),
            port: 23,
            private_key_path: "".to_string(),
            protocol: "telnet".to_string(),
            sftp_root: None,
            username: "".to_string(),
        };
        let serial_host = BackendHostConnection {
            hostname: "/dev/cu.usbserial-1410".to_string(),
            port: 115200,
            protocol: "serial".to_string(),
            ..telnet_host.clone()
        };
        let mosh_host = BackendHostConnection {
            auth_method: "privateKey".to_string(),
            hostname: "ops.internal".to_string(),
            port: 22,
            private_key_path: "~/.ssh/id_ops".to_string(),
            protocol: "mosh".to_string(),
            username: "ops".to_string(),
            ..telnet_host.clone()
        };

        assert!(should_use_native_session(&telnet_host));
        assert!(should_use_native_session(&serial_host));
        assert!(should_use_native_session(&mosh_host));
        assert!(validate_session_target(&telnet_host).is_ok());
        assert!(validate_session_target(&serial_host).is_ok());
        assert!(validate_session_target(&mosh_host).is_ok());
    }

    #[test]
    fn reports_builtin_and_unknown_protocol_runtime_status() {
        let ssh_status = build_protocol_runtime_status("ssh");
        let unknown_status = build_protocol_runtime_status("gopher");

        assert!(ssh_status.available);
        assert_eq!(ssh_status.protocol, "ssh");
        assert!(!unknown_status.available);
        assert!(unknown_status
            .message
            .contains("Unsupported protocol runtime"));
    }

    #[test]
    fn builds_mosh_ssh_command_with_known_hosts_and_key_path() {
        let host = BackendHostConnection {
            agent_forwarding: true,
            auth_method: "privateKey".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "ops.internal".to_string(),
            jump_host: None,
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATESTMOSH".to_string()),
            password: "".to_string(),
            passphrase: "passphrase".to_string(),
            port: 60022,
            private_key_path: "~/.ssh/id_ops".to_string(),
            protocol: "mosh".to_string(),
            sftp_root: None,
            username: "ops".to_string(),
        };
        let known_hosts_path = PathBuf::from("/tmp/termsnip-known-hosts");
        let ssh_command = build_mosh_ssh_command(&host, Some(&known_hosts_path));

        assert!(ssh_command.contains("/usr/bin/ssh"));
        assert!(ssh_command.contains("-p 60022"));
        assert!(ssh_command.contains("UserKnownHostsFile=/tmp/termsnip-known-hosts"));
        assert!(ssh_command.contains("StrictHostKeyChecking=yes"));
        assert!(ssh_command.contains("IdentitiesOnly=yes"));
    }

    #[test]
    fn parses_sftp_directory_listing_output() {
        let output = r#"
Connected to target.internal.
drwxr-xr-x    2 ops ops 4096 Apr  2 18:10 apps
-rw-r--r--    1 ops ops 128 Apr  1 2026 README.md
lrwxr-xr-x    1 ops ops  11 Mar 31 12:00 current -> releases
"#;

        let entries = parse_sftp_directory_listing("/srv", output);

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "apps");
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(entries[0].path, "/srv/apps");
        assert_eq!(entries[0].permissions.as_deref(), Some("755"));
        assert_eq!(entries[1].name, "current");
        assert_eq!(entries[1].kind, "file");
        assert_eq!(entries[1].path, "/srv/current");
        assert_eq!(entries[2].name, "README.md");
        assert_eq!(entries[2].permissions.as_deref(), Some("644"));
    }

    #[test]
    fn normalizes_private_key_algorithms() {
        assert_eq!(normalize_key_algorithm("ssh-ed25519"), "ED25519");
        assert_eq!(normalize_key_algorithm("ecdsa-sha2-nistp521"), "ECDSA");
        assert_eq!(normalize_key_algorithm("rsa-sha2-512"), "RSA");
        assert_eq!(normalize_key_algorithm("ssh-dss"), "UNKNOWN");
    }

    #[test]
    fn computes_known_host_scan_fingerprints() {
        assert_eq!(
            compute_public_key_fingerprint("SGVsbG8=").as_deref(),
            Ok("SHA256:GF+NsyJx/iX1Yab8k4suJkMG7DBO2lGAB9F2SCY4GWk")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_secret_round_trip() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let account = format!("termsnip-test-{}-{unique_suffix}", process::id());
        let service = format!("{KEYCHAIN_PASSWORD_SERVICE}.tests");

        store_keychain_secret(&service, &account, "test-secret")
            .expect("storing test keychain secret should succeed");
        let loaded = load_keychain_secret(&service, &account)
            .expect("loading test keychain secret should succeed");
        assert_eq!(loaded.as_deref(), Some("test-secret"));

        delete_keychain_secret(&service, &account)
            .expect("deleting test keychain secret should succeed");
        let cleared = load_keychain_secret(&service, &account)
            .expect("loading deleted test keychain secret should succeed");
        assert_eq!(cleared, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_key_passphrase_round_trip() {
        // Same shape as the per-host round-trip but exercises the new
        // fingerprint-keyed service so a regression in the constant or in
        // the per-fingerprint command path surfaces here. See
        // parity-and-hardening-plan.md P1-S5.
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let fingerprint = format!("SHA256:term-snip-test-{}-{unique_suffix}", process::id());
        let service = format!("{KEYCHAIN_KEY_PASSPHRASE_SERVICE}.tests");

        store_keychain_secret(&service, &fingerprint, "key-pass")
            .expect("storing test key passphrase should succeed");
        let loaded = load_keychain_secret(&service, &fingerprint)
            .expect("loading test key passphrase should succeed");
        assert_eq!(loaded.as_deref(), Some("key-pass"));

        delete_keychain_secret(&service, &fingerprint)
            .expect("deleting test key passphrase should succeed");
        let cleared = load_keychain_secret(&service, &fingerprint)
            .expect("loading deleted test key passphrase should succeed");
        assert_eq!(cleared, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychain_identity_passphrase_round_trip() {
        // Same shape as the per-host and per-fingerprint round-trips,
        // exercising the new per-identity service introduced by P2-DM1
        // batch 3. Catches regressions in either the constant or the
        // command-level wrapper.
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let identity_id = format!("termsnip-identity-test-{}-{unique_suffix}", process::id());
        let service = format!("{KEYCHAIN_IDENTITY_PASSPHRASE_SERVICE}.tests");

        store_keychain_secret(&service, &identity_id, "identity-pass")
            .expect("storing test identity passphrase should succeed");
        let loaded = load_keychain_secret(&service, &identity_id)
            .expect("loading test identity passphrase should succeed");
        assert_eq!(loaded.as_deref(), Some("identity-pass"));

        delete_keychain_secret(&service, &identity_id)
            .expect("deleting test identity passphrase should succeed");
        let cleared = load_keychain_secret(&service, &identity_id)
            .expect("loading deleted test identity passphrase should succeed");
        assert_eq!(cleared, None);
    }

    #[test]
    fn validates_identity_id_shape() {
        assert!(validate_identity_id("identity-prod-bastion-ops").is_ok());
        assert!(validate_identity_id("00000000-0000-0000-0000-000000000000").is_ok());
        assert!(validate_identity_id("").is_err());
        assert!(validate_identity_id("   ").is_err());
        // Rejects unreasonably long ids — defense-in-depth against bogus
        // renderer input filling the Keychain index with garbage.
        assert!(validate_identity_id(&"x".repeat(257)).is_err());
    }

    #[test]
    fn validates_key_fingerprint_shape() {
        assert!(validate_key_fingerprint("SHA256:abc").is_ok());
        assert!(validate_key_fingerprint("MD5:aa:bb:cc").is_ok());
        // Unknown algorithms still pass — Keychain accounts are arbitrary
        // strings and rejecting future algorithms would be an upgrade footgun.
        assert!(validate_key_fingerprint("BLAKE3:xyz").is_ok());

        assert!(validate_key_fingerprint("").is_err());
        assert!(validate_key_fingerprint("   ").is_err());
        assert!(validate_key_fingerprint("no-colon-here").is_err());
        assert!(validate_key_fingerprint(":no-algo").is_err());
        assert!(validate_key_fingerprint("SHA256:").is_err());
        assert!(validate_key_fingerprint("SHA256:   ").is_err());
    }

    #[test]
    fn public_known_host_scan_smoke() {
        let Ok(hostname) = env::var("TERMSNIP_PUBLIC_SCAN_HOST") else {
            eprintln!("Skipping public known-host scan smoke; TERMSNIP_PUBLIC_SCAN_HOST is unset");
            return;
        };
        let port = env::var("TERMSNIP_PUBLIC_SCAN_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(22);

        let result = scan_known_host(&KnownHostScanRequest { hostname, port })
            .expect("public known-host scan should succeed");

        assert!(!result.entries.is_empty());
        assert!(result.entries.iter().all(|entry| {
            entry.port == port
                && !entry.algorithm.trim().is_empty()
                && !entry.public_key.trim().is_empty()
                && entry.fingerprint.starts_with("SHA256:")
        }));
    }
}
