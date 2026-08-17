#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
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
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::mpsc::{
    channel,
    error::{TryRecvError, TrySendError},
    Receiver, Sender,
};

mod keychain_support;
mod native_host_keys;
mod native_transport;

use crate::native_host_keys::{HostKeyVerdict, NativeHostKeyStore, SharedNativeHostKeyStore};

use keychain_support::*;
use native_transport::*;

const SESSION_STREAM_EVENT_NAME: &str = "terminal_workspace://session-stream";
const KEYCHAIN_PASSWORD_SERVICE: &str = "com.termsnip.runtime.password";
/// Per-host passphrase entry. Retained for backward compatibility (older
/// builds wrote here) and as the migration source. New writes go to
/// `KEYCHAIN_KEY_PASSPHRASE_SERVICE` keyed by SSH key fingerprint so that
/// multiple hosts using the same private key share a single Keychain
/// entry. See parity-and-hardening-plan.md P1-S5.
const KEYCHAIN_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.passphrase";
/// Per-key-fingerprint passphrase entry. Account is the SSH public-key
/// fingerprint (`SHA256:<base64>` form). When a key is deleted from the
/// keys store, the renderer calls `terminal_workspace_clear_key_passphrase` to GC
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
/// #193: bound on the reader->loop hop for jump and external sessions.
///
/// 16 x the 4 KiB read chunk is 64 KiB — exactly one NATIVE_OUTPUT_COALESCE_MAX_BYTES
/// batch. Smaller would backpressure before the loop can assemble one normal
/// batch; larger just holds more output without improving latency or ordering.
const NATIVE_SESSION_EVENT_CHANNEL_CAPACITY: usize = 16;
/// #205: bound on the renderer -> session-loop input channel.
///
/// It was unbounded, so a renderer feeding a session whose write path is stalled
/// could queue keystrokes and resizes without limit. 32 holds roughly half a
/// second even at 60 input events per second — well past any human typing rate,
/// and an xterm paste arrives as ONE event rather than one per character. The
/// loops drain with an inner try_recv until empty, so they consume faster than
/// this fills. A full queue therefore means the session is genuinely stalled,
/// not merely busy, and more buffering would only postpone saying so.
const NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY: usize = 32;
const NATIVE_SESSION_POLL_INTERVAL_MS: u64 = 10;
/// Max time a write to an SSH channel may make NO progress before it is treated
/// as a stalled remote and aborted, so it cannot wedge the session loop. This is
/// an idle timeout — a slow-but-progressing transfer of any total duration is
/// fine. See write_all_with_deadline.
const NATIVE_SESSION_WRITE_TIMEOUT_MS: u64 = 10_000;
const NATIVE_SESSION_BUFFER_LIMIT: usize = 128;
/// Terminal-output coalescing bounds. Without these, a fast producer
/// (`yes`, `cat huge.log`) makes the session loop emit one Tauri event per
/// ~4KB read — thousands/sec — flooding the webview's event queue and xterm
/// write buffer until it can OOM. Consecutive output is concatenated and
/// emitted at most once per window, or once per accumulated MAX_BYTES,
/// whichever comes first, so emit throughput is capped by time/size rather
/// than by the producer's rate. Ordering and bytes are preserved (coalescing
/// concatenates; it never drops).
const NATIVE_OUTPUT_COALESCE_WINDOW_MS: u64 = 12;
const NATIVE_OUTPUT_COALESCE_MAX_BYTES: usize = 64 * 1024;

/// #194: decodes a byte stream as UTF-8 across arbitrary chunk boundaries.
///
/// Terminal output arrives in ~4KB reads that fall wherever the kernel puts
/// them, so a multi-byte character routinely straddles two reads. Decoding each
/// read on its own — which is what this code used to do — turns both halves
/// into U+FFFD permanently, because nothing downstream can tell a replacement
/// character apart from one the program really printed.
///
/// So an incomplete-but-still-valid trailing sequence is held back for the next
/// chunk instead of being decoded. Genuinely invalid bytes are NOT held: they
/// become U+FFFD immediately, so a stream that never produces valid UTF-8
/// cannot stall output waiting for a completion that will never come.
#[derive(Default)]
pub(crate) struct Utf8StreamDecoder {
    /// At most 3 bytes: a scalar is at most 4 bytes wide, so once 3 are held
    /// the next byte either completes it or makes it invalid. This is why the
    /// hold-back cannot grow without bound.
    incomplete: Vec<u8>,
}

impl Utf8StreamDecoder {
    /// Decode what is complete, retaining a valid-so-far trailing fragment.
    pub(crate) fn decode(&mut self, bytes: &[u8]) -> String {
        let mut buffer = std::mem::take(&mut self.incomplete);
        buffer.extend_from_slice(bytes);

        let mut decoded = String::new();
        let mut rest = &buffer[..];
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    decoded.push_str(text);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    // SAFETY-equivalent: valid_up_to() is by definition the
                    // length of a valid prefix.
                    decoded.push_str(&String::from_utf8_lossy(&rest[..valid_up_to]));
                    match error.error_len() {
                        // Genuinely malformed — emit the replacement now and
                        // carry on past it rather than waiting for more input.
                        Some(bad) => {
                            decoded.push('\u{FFFD}');
                            rest = &rest[valid_up_to + bad..];
                        }
                        // Truncated at the end of the input, still valid so far.
                        // Hold it for the next chunk.
                        None => {
                            self.incomplete.extend_from_slice(&rest[valid_up_to..]);
                            break;
                        }
                    }
                }
            }
        }
        decoded
    }

    /// End of stream: a fragment that never completed is malformed after all.
    /// Emitting it as U+FFFD keeps the last bytes of a session from vanishing.
    pub(crate) fn finish(&mut self) -> String {
        if self.incomplete.is_empty() {
            return String::new();
        }
        self.incomplete.clear();
        "\u{FFFD}".to_string()
    }

    fn buffered_len(&self) -> usize {
        self.incomplete.len()
    }
}

/// Accumulates terminal output and yields it in bounded, in-order flushes.
/// Deterministic and side-effect-free (the caller supplies `now` and performs
/// the emit) so the flush policy is unit-testable without a live session.
///
/// #194: buffers raw bytes and decodes once per flush, so the decoder above
/// sees a continuous stream rather than per-read fragments.
struct OutputCoalescer {
    pending: Vec<u8>,
    pending_since: Option<Instant>,
    window: Duration,
    max_bytes: usize,
    decoder: Utf8StreamDecoder,
}

impl OutputCoalescer {
    fn new(window: Duration, max_bytes: usize) -> Self {
        Self {
            pending: Vec::new(),
            pending_since: None,
            window,
            max_bytes,
            decoder: Utf8StreamDecoder::default(),
        }
    }

    /// Append a chunk. Returns the coalesced buffer to emit immediately when
    /// the size threshold is reached, else `None` (still accumulating).
    fn push(&mut self, chunk: &[u8], now: Instant) -> Option<String> {
        // Not `pending.is_empty()`: the decoder may still hold a fragment from
        // the previous flush, and that fragment is not what opens a window.
        if self.pending_since.is_none() {
            self.pending_since = Some(now);
        }
        self.pending.extend_from_slice(chunk);
        // Count held-back bytes too, so the threshold still bounds everything
        // buffered rather than just the part that happens to be decodable.
        if self.pending.len() + self.decoder.buffered_len() >= self.max_bytes {
            self.flush()
        } else {
            None
        }
    }

    /// Flush if the time window has elapsed since the first buffered byte.
    /// Caps latency for a producer that streams continuously without pausing.
    fn poll_flush(&mut self, now: Instant) -> Option<String> {
        match self.pending_since {
            Some(since) if now.duration_since(since) >= self.window => self.flush(),
            _ => None,
        }
    }

    /// Flush what decodes cleanly, keeping any truncated trailing character for
    /// the next chunk. Returns `None` when that leaves nothing to emit — a
    /// chunk consisting only of a partial character must not fire an empty
    /// event.
    fn flush(&mut self) -> Option<String> {
        self.pending_since = None;
        if self.pending.is_empty() {
            return None;
        }
        let bytes = std::mem::take(&mut self.pending);
        let decoded = self.decoder.decode(&bytes);
        if decoded.is_empty() {
            None
        } else {
            Some(decoded)
        }
    }

    /// Final flush for a closing session. Unlike `flush`, this does not keep a
    /// truncated character back — there is no next chunk, so holding it would
    /// silently drop the last bytes the program wrote.
    fn finish(&mut self) -> Option<String> {
        let mut decoded = self.flush().unwrap_or_default();
        decoded.push_str(&self.decoder.finish());
        if decoded.is_empty() {
            None
        } else {
            Some(decoded)
        }
    }
}
const NATIVE_SSH_CONTROL_READY_TIMEOUT_MS: u64 = 15_000;
/// Bound the native ssh2 connect/handshake/blocking-IO phases. Without these a
/// black-holed port (SYN dropped) or a server that completes TCP but stalls the
/// SSH banner pins the spawn_blocking worker until the OS TCP timeout (~75s+)
/// or forever, and repeated attempts exhaust the blocking pool. connect_timeout
/// bounds the TCP connect; Session::set_timeout bounds handshake, auth, and the
/// blocking channel reads (e.g. copy-key's read_to_string).
const NATIVE_SSH_CONNECT_TIMEOUT_MS: u64 = 15_000;
const NATIVE_SSH_IO_TIMEOUT_MS: u32 = 30_000;
const TERMSNIP_DATABASE_URL: &str = "sqlite:termsnip.db";
static SESSION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_FORWARD_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Acquire a lock, recovering from poisoning instead of propagating the
/// panic. A panic in one session's or forward's thread poisons the shared
/// registry/state mutex; without recovery, every subsequent IPC command that
/// touches that mutex would panic on `.expect()` too — one bad session would
/// brick *all* sessions until app restart. The guarded data here (session and
/// forward `HashMap`s, per-session `NativeSessionState`, the input writer) is
/// safe to continue from after a partial update, so we take the poisoned
/// guard's inner value rather than cascade the failure.
trait LockRecover<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockRecover<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            // Only fires on the poisoned path, so the happy path is unchanged
            // and this never spams. Surface it so the original panic that
            // poisoned the lock stays observable instead of being swallowed.
            eprintln!(
                "warning: recovered from a poisoned session-registry lock; a prior panic left it poisoned — continuing with recovered state"
            );
            poisoned.into_inner()
        })
    }
}

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
    command_sender: Sender<NativeSessionCommand>,
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
    // #194: raw bytes, not text. Decoding here would be per-read decoding by
    // another name, which is the bug. `Error` stays a String because it comes
    // from Rust error formatting, not the terminal stream.
    Output(Vec<u8>),
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
    !matches!(host.host_key_policy.as_deref(), Some("allowUnknown"))
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
    /// True when the keychain was locked or access was denied (as opposed to
    /// the secret simply being absent). Lets the renderer branch on a stable
    /// signal — surface an error / prompt for the secret — instead of parsing
    /// an opaque error string or treating a locked keychain as "no secret".
    keychain_unavailable: bool,
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

/// Reject control characters (newline, CR, NUL, …) in any field that flows into
/// the generated ssh_config or a spawned client's argv. Without this a
/// renderer-XSS could put a newline in a hostname/username and inject arbitrary
/// OpenSSH directives (ProxyCommand / LocalCommand → local code execution); see
/// build_native_ssh_config, which writes `HostName`/`User` lines verbatim.
fn reject_control_chars(field: &str, value: &str) -> Result<(), String> {
    if value.chars().any(char::is_control) {
        return Err(format!("{field} contains illegal control characters"));
    }
    Ok(())
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

    reject_control_chars("Hostname", &host.hostname)?;
    if require_username {
        reject_control_chars("Username", &host.username)?;
    }

    Ok(())
}

/// #152(a): telnet takes the hostname as a bare positional argument
/// (`main.rs`'s telnet branch does `command.arg(host.hostname)`), so a hostname
/// beginning with `-` is handed to the client where it reads a flag.
///
/// Rejecting is deliberate rather than inserting a `--` separator. Apple's
/// telnet uses getopt and would honour `--`, but `TERMSNIP_TELNET_PATH` lets an
/// operator substitute a different client whose parser we have not verified —
/// and a value that must never be a flag is better refused than escaped for one
/// specific implementation. No DNS name, IPv4 or IPv6 literal can begin with a
/// dash, so nothing legitimate is lost.
fn validate_telnet_host(host: &BackendHostConnection) -> Result<(), String> {
    validate_network_host(host, false)?;

    if host.hostname.starts_with('-') {
        return Err("Telnet hostname cannot start with '-'".to_string());
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

    if !host.private_key_path.trim().is_empty() {
        reject_control_chars("Private key path", &host.private_key_path)?;
    }

    // Defense-in-depth: mirror validate_ssh_host — a mosh host that requires a
    // trusted key must not fall through to the accept-new TOFU branch in
    // build_mosh_ssh_command when no key has been pinned.
    if host_requires_trusted_key(host) && host.known_host_public_key.is_none() {
        return Err(format!(
            "Trusted host key required for {}:{} but none was provided. Scan and trust the host first.",
            host.hostname, host.port
        ));
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
                // #152(a): the configured device is data even when its name
                // begins with '-'. screen's parser consumes `--` and stops
                // reading options, so the device cannot be taken as a flag.
                command.arg("--");
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
    // Log a dropped emit instead of swallowing it: losing a "close" event, for
    // example, leaves the UI showing a connected tab for a session that has
    // actually ended. `kind` is a &'static str, so capturing it before the move
    // adds no allocation on the hot output path.
    let kind = event.kind;
    if let Err(error) = app.emit(SESSION_STREAM_EVENT_NAME, event) {
        eprintln!("warning: dropped '{kind}' session stream event: {error}");
    }
}

fn get_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
) -> Option<NativeSessionHandle> {
    registry.sessions.lock_recover().get(session_id).cloned()
}

fn insert_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
    handle: NativeSessionHandle,
) {
    registry
        .sessions
        .lock_recover()
        .insert(session_id.to_string(), handle);
}

fn remove_native_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
) -> Option<NativeSessionHandle> {
    registry.sessions.lock_recover().remove(session_id)
}

/// #148: how many native SSH sessions are currently live. Used to refuse an
/// update-install-and-restart that would tear them down without the user
/// knowing. Sessions are removed from the registry on close, so the map's
/// length is the live count.
fn live_native_session_count(registry: &NativeSessionRegistry) -> usize {
    registry.sessions.lock_recover().len()
}

fn insert_native_forward(
    registry: &NativeForwardRegistry,
    forward_id: &str,
    handle: NativeForwardHandle,
) {
    registry
        .forwards
        .lock_recover()
        .insert(forward_id.to_string(), handle);
}

fn remove_native_forward(
    registry: &NativeForwardRegistry,
    forward_id: &str,
) -> Option<NativeForwardHandle> {
    registry.forwards.lock_recover().remove(forward_id)
}

fn list_native_forwards(
    registry: &NativeForwardRegistry,
    session_id: &str,
) -> Vec<PortForwardRecord> {
    registry
        .forwards
        .lock_recover()
        .values()
        .filter(|handle| handle.record.session_id == session_id)
        .map(|handle| handle.record.clone())
        .collect()
}

fn close_native_forward_handle(handle: NativeForwardHandle) {
    let mut killer = handle.killer.lock_recover();
    let _ = killer.kill();
}

fn close_native_forwards_for_session(registry: &NativeForwardRegistry, session_id: &str) {
    let forward_ids = registry
        .forwards
        .lock_recover()
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
        let mut state = state.lock_recover();
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
        let mut state = state.lock_recover();
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

    reject_control_chars("Hostname", &host.hostname)?;
    reject_control_chars("Username", &host.username)?;
    if !host.private_key_path.trim().is_empty() {
        reject_control_chars("Private key path", &host.private_key_path)?;
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
        "telnet" => validate_telnet_host(host),
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

/// Resolve `hostname:port` and TCP-connect with a bounded deadline so an
/// unreachable-but-routable host (dropped SYN) fails fast instead of hanging on
/// the OS TCP timeout. Tries each resolved address until one connects.
fn connect_tcp_with_timeout(
    hostname: &str,
    port: u16,
    timeout: Duration,
) -> Result<TcpStream, String> {
    let addrs = (hostname, port)
        .to_socket_addrs()
        .map_err(|error| format!("could not resolve {hostname}:{port}: {error}"))?;
    let mut last_error = format!("no addresses resolved for {hostname}:{port}");
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!(
        "could not connect to {hostname}:{port}: {last_error}"
    ))
}

/// #151: the single host-key decision for the direct ssh2 path.
///
/// An explicit pin from the renderer (requireTrusted, or a host the user has
/// scanned and trusted) always wins and is checked exactly as before. When there
/// is no explicit pin, `allowUnknown` used to mean "skip verification entirely",
/// which left the host MITM-able on every connect. It now means trust-on-first-use
/// against a durable store: pin what the server first presents, and refuse if it
/// ever changes.
///
/// Called after `handshake()` and BEFORE any authentication, so credentials are
/// never sent to a host that failed this check.
fn verify_native_host_key(
    session: &Session,
    host: &BackendHostConnection,
    store: &NativeHostKeyStore,
) -> Result<(), String> {
    let (actual_key, key_type) = session
        .host_key()
        .ok_or_else(|| "SSH server did not present a host key".to_string())?;
    let presented = BASE64_STANDARD.encode(actual_key);

    if let Some(expected_key) = host.known_host_public_key.as_ref() {
        if presented != *expected_key {
            return Err(format!(
                "Trusted host key mismatch for {}:{}.",
                host.hostname, host.port
            ));
        }
        return Ok(());
    }

    if host_requires_trusted_key(host) {
        // Defence in depth: validate_ssh_host already refuses this combination.
        return Err(format!(
            "Trusted host key required for {}:{} but none was provided. Scan and trust the host first.",
            host.hostname, host.port
        ));
    }

    let algorithm = host_key_algorithm_name(key_type);
    let pattern = known_hosts_host_pattern(host);
    match store.verify_or_pin(&pattern, algorithm, &presented)? {
        HostKeyVerdict::Pinned | HostKeyVerdict::Matches => Ok(()),
        HostKeyVerdict::Mismatch { .. } => Err(format!(
            "Host key verification failed for {}:{}: the presented host key does not match the \
             one first seen for this host. Credentials were not sent. This may indicate a \
             machine-in-the-middle attack, or the host may have been rebuilt — re-scan and \
             explicitly trust the replacement key before reconnecting.",
            host.hostname, host.port
        )),
    }
}

/// ssh2 reports the key type as an enum; the store records an OpenSSH-style
/// algorithm name so the file is readable and comparable to `known_hosts`.
/// An unrecognised type fails closed rather than being written ambiguously.
fn host_key_algorithm_name(key_type: ssh2::HostKeyType) -> &'static str {
    match key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        ssh2::HostKeyType::Unknown => "unknown",
    }
}

fn connect_native_session(
    host: &BackendHostConnection,
    store: &NativeHostKeyStore,
) -> Result<(Session, Channel), String> {
    let port =
        u16::try_from(host.port).map_err(|_| "SSH port must be between 1 and 65535".to_string())?;
    let tcp_stream = connect_tcp_with_timeout(
        &host.hostname,
        port,
        Duration::from_millis(NATIVE_SSH_CONNECT_TIMEOUT_MS),
    )?;
    let _ = tcp_stream.set_nodelay(true);

    let mut session = Session::new().map_err(|error| error.to_string())?;
    session.set_tcp_stream(tcp_stream);
    // Bound handshake/auth (and any blocking channel IO before the loop switches
    // the session to non-blocking) so a stalled SSH banner cannot hang forever.
    session.set_timeout(NATIVE_SSH_IO_TIMEOUT_MS);
    session.handshake().map_err(|error| error.to_string())?;

    verify_native_host_key(&session, host, store)?;

    authenticate_native_session(&mut session, host)?;
    let channel = open_native_channel(&session, host)?;
    session.set_blocking(false);

    Ok((session, channel))
}

fn write_jump_session_input(
    writer: &Arc<Mutex<Box<dyn Write + Send>>>,
    input: &str,
) -> Result<(), String> {
    // Unlike the registry/state locks, the writer wraps a live byte stream:
    // recovering a lock poisoned mid-write and continuing would interleave
    // this input with a half-written frame and desync the session. Fail this
    // one write cleanly instead (the caller surfaces the Err); a poisoned
    // writer does not cascade because each session owns its own writer.
    let mut writer = writer
        .lock()
        .map_err(|_| "jump session writer lock poisoned".to_string())?;
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

/// #193: lets the two readers serve both a bounded live-session channel and the
/// unbounded channels the short-lived capture loops in `native_transport` use,
/// without duplicating the reader bodies.
trait JumpSessionEventSender: Send + 'static {
    /// `Err` means the receiver is gone — for a bounded sender this also wakes a
    /// send that was blocked on a full queue, so it is an exit signal, not a
    /// reason to retry.
    fn send_event(&self, event: JumpSessionEvent) -> Result<(), ()>;
}

impl JumpSessionEventSender for std::sync::mpsc::Sender<JumpSessionEvent> {
    fn send_event(&self, event: JumpSessionEvent) -> Result<(), ()> {
        self.send(event).map_err(|_| ())
    }
}

impl JumpSessionEventSender for std::sync::mpsc::SyncSender<JumpSessionEvent> {
    fn send_event(&self, event: JumpSessionEvent) -> Result<(), ()> {
        self.send(event).map_err(|_| ())
    }
}

/// The bounded channel a live session loop reads from. Blocking the reader's
/// send is the point: it stops draining the PTY, which pushes backpressure down
/// to the remote producer instead of queueing its output in this process.
fn native_session_event_channel() -> (
    std::sync::mpsc::SyncSender<JumpSessionEvent>,
    std::sync::mpsc::Receiver<JumpSessionEvent>,
) {
    std::sync::mpsc::sync_channel(NATIVE_SESSION_EVENT_CHANNEL_CAPACITY)
}

fn spawn_jump_session_reader<S: JumpSessionEventSender>(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    mut prompt_responses: Vec<PromptResponse>,
    sender: S,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];
        // #194: bytes, not String. Trimming this window by a byte count used to
        // panic outright — `String::drain` asserts the range lands on a
        // character boundary, and the arithmetic below has no reason to. One
        // line of CJK overflows the 512-byte window at a non-boundary and kills
        // this thread, taking the session's output with it.
        let mut prompt_window: Vec<u8> = Vec::new();
        let reusable_responses = prompt_responses.clone();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send_event(JumpSessionEvent::Eof);
                    break;
                }
                Ok(count) => {
                    let output = buffer[..count].to_vec();
                    prompt_window.extend_from_slice(&output);
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

                    // The writer guard from any prompt response above is already
                    // released here, and must stay that way: this send can block
                    // on a full queue, and the loop may need that same mutex
                    // before it can drain. Sending while holding it is the one
                    // way to turn this into a deadlock.
                    //
                    // #193: a FAILED send is deliberately ignored rather than
                    // ending the thread, which looks like a leak and is not.
                    // with_native_ssh_control_session leaves its ControlMaster
                    // child running on purpose and drops this receiver when it
                    // returns (native_transport.rs:1424). Nothing else drains
                    // that PTY, so a reader that stopped here would let its
                    // buffer fill, block `ssh` on write, and hang every later
                    // operation multiplexed over that control socket. Draining
                    // until EOF is the job; the thread ends when the PTY closes.
                    let _ = sender.send_event(JumpSessionEvent::Output(output));
                }
                Err(error) => {
                    let _ = sender.send_event(JumpSessionEvent::Error(error.to_string()));
                    break;
                }
            }
        }
    });
}

fn spawn_local_session_reader<S: JumpSessionEventSender>(
    mut reader: Box<dyn Read + Send>,
    sender: S,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send_event(JumpSessionEvent::Eof);
                    break;
                }
                Ok(count) => {
                    // #193: see spawn_jump_session_reader — a failed send must
                    // NOT end this thread. Draining the PTY until EOF is what
                    // keeps its writer from blocking.
                    let _ = sender.send_event(JumpSessionEvent::Output(buffer[..count].to_vec()));
                }
                Err(error) => {
                    let _ = sender.send_event(JumpSessionEvent::Error(error.to_string()));
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
    mut receiver: Receiver<NativeSessionCommand>,
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
        // #143 bounded the emit path with OutputCoalescer. #193 bounds this hop
        // too: a reader that outpaces the loop's drain used to queue Output
        // events without limit and could exhaust memory on its own. A full queue
        // now blocks the reader's send, which stops it draining the PTY and
        // pushes backpressure to the remote producer — output is delayed, never
        // dropped.
        let (output_sender, output_receiver) = native_session_event_channel();

        if prompt_responses.is_empty() {
            spawn_local_session_reader(reader, output_sender);
        } else {
            spawn_jump_session_reader(reader, writer.clone(), prompt_responses, output_sender);
        }
        set_native_session_connection_state(&app, &session_id, &state, "connected");

        let mut coalescer = OutputCoalescer::new(
            Duration::from_millis(NATIVE_OUTPUT_COALESCE_WINDOW_MS),
            NATIVE_OUTPUT_COALESCE_MAX_BYTES,
        );
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
                        // Flush buffered output before propagating a write error
                        // so the `?` early-return cannot drop pending bytes.
                        if let Err(error) = write_jump_session_input(&writer, &input) {
                            if let Some(flushed) = coalescer.finish() {
                                emit_native_session_output(&app, &session_id, &state, flushed);
                            }
                            return Err(error);
                        }
                    }
                    Ok(NativeSessionCommand::Resize { cols, rows }) => {
                        did_work = true;
                        if let Err(error) = resize_jump_session_pty(&mut master, cols, rows) {
                            if let Some(flushed) = coalescer.finish() {
                                emit_native_session_output(&app, &session_id, &state, flushed);
                            }
                            return Err(error);
                        }
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
                        if let Some(flushed) = coalescer.push(&output, Instant::now()) {
                            emit_native_session_output(&app, &session_id, &state, flushed);
                        }
                    }
                    Ok(JumpSessionEvent::Error(error)) => {
                        // Emit any output received before the error first, so the
                        // terminal shows it in order ahead of the error notice.
                        if let Some(flushed) = coalescer.finish() {
                            emit_native_session_output(&app, &session_id, &state, flushed);
                        }
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

            if let Some(flushed) = coalescer.poll_flush(Instant::now()) {
                emit_native_session_output(&app, &session_id, &state, flushed);
            }

            if !did_work && !should_close {
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
        }

        if let Some(flushed) = coalescer.finish() {
            emit_native_session_output(&app, &session_id, &state, flushed);
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
        let mut state = state.lock_recover();
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
    mut receiver: Receiver<NativeSessionCommand>,
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
        // #143 bounded the emit path with OutputCoalescer. #193 bounds this hop
        // too: a reader that outpaces the loop's drain used to queue Output
        // events without limit and could exhaust memory on its own. A full queue
        // now blocks the reader's send, which stops it draining the PTY and
        // pushes backpressure to the remote producer — output is delayed, never
        // dropped.
        let (output_sender, output_receiver) = native_session_event_channel();

        spawn_jump_session_reader(
            reader,
            writer.clone(),
            build_prompt_responses(&host),
            output_sender,
        );
        set_native_session_connection_state(&app, &session_id, &state, "connected");

        let mut coalescer = OutputCoalescer::new(
            Duration::from_millis(NATIVE_OUTPUT_COALESCE_WINDOW_MS),
            NATIVE_OUTPUT_COALESCE_MAX_BYTES,
        );
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
                        // Flush buffered output before propagating a write error
                        // so the `?` early-return cannot drop pending bytes.
                        if let Err(error) = write_jump_session_input(&writer, &input) {
                            if let Some(flushed) = coalescer.finish() {
                                emit_native_session_output(&app, &session_id, &state, flushed);
                            }
                            return Err(error);
                        }
                    }
                    Ok(NativeSessionCommand::Resize { cols, rows }) => {
                        did_work = true;
                        if let Err(error) = resize_jump_session_pty(&mut master, cols, rows) {
                            if let Some(flushed) = coalescer.finish() {
                                emit_native_session_output(&app, &session_id, &state, flushed);
                            }
                            return Err(error);
                        }
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
                        if let Some(flushed) = coalescer.push(&output, Instant::now()) {
                            emit_native_session_output(&app, &session_id, &state, flushed);
                        }
                    }
                    Ok(JumpSessionEvent::Error(error)) => {
                        // Emit any output received before the error first, so the
                        // terminal shows it in order ahead of the error notice.
                        if let Some(flushed) = coalescer.finish() {
                            emit_native_session_output(&app, &session_id, &state, flushed);
                        }
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

            if let Some(flushed) = coalescer.poll_flush(Instant::now()) {
                emit_native_session_output(&app, &session_id, &state, flushed);
            }

            if !did_work && !should_close {
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
        }

        if let Some(flushed) = coalescer.finish() {
            emit_native_session_output(&app, &session_id, &state, flushed);
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
        let mut state = state.lock_recover();
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

/// Write all bytes, retrying on WouldBlock, bounded by an *idle* deadline: the
/// clock is the time spent making NO progress. Without a bound, a stalled remote
/// (a full SSH window whose peer has stopped reading — e.g. a large paste) makes
/// the loop busy-wait on WouldBlock forever, wedging the session and blocking any
/// Close queued behind this write. Because the timer resets on every byte
/// written, a legitimately slow-but-progressing link is never cut off no matter
/// how long the whole transfer takes — only a genuine stall (no progress for the
/// deadline) errors out, letting the loop unwind and process the Close. Generic
/// over `Write` so the policy is testable without a live SSH channel.
fn write_all_with_deadline<W: Write>(
    writer: &mut W,
    input: &[u8],
    idle_deadline: Duration,
) -> Result<(), String> {
    let mut written = 0;
    let mut last_progress = Instant::now();
    while written < input.len() {
        match writer.write(&input[written..]) {
            Ok(0) => return Err("SSH session is closed".to_string()),
            Ok(count) => {
                written += count;
                last_progress = Instant::now();
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if last_progress.elapsed() >= idle_deadline {
                    return Err(format!(
                        "Timed out writing to the SSH session: no progress for {}ms; the remote stopped accepting input.",
                        idle_deadline.as_millis()
                    ));
                }
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    // Guard the flush with the same idle deadline: a flush that blocks on a
    // stalled remote would otherwise reintroduce the very wedge we just avoided.
    let flush_start = Instant::now();
    loop {
        match writer.flush() {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if flush_start.elapsed() >= idle_deadline {
                    return Err(format!(
                        "Timed out flushing the SSH session after {}ms; the remote stopped accepting input.",
                        idle_deadline.as_millis()
                    ));
                }
                thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn write_native_session_input(channel: &mut Channel, input: &[u8]) -> Result<(), String> {
    write_all_with_deadline(
        channel,
        input,
        Duration::from_millis(NATIVE_SESSION_WRITE_TIMEOUT_MS),
    )
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

// #157: this is the ownership boundary where eight independent values are moved
// into one session worker. Bundling them into a one-use argument struct would
// hide that handoff behind a type rather than reduce coupling, so the lint is
// allowed here rather than designed around.
#[allow(clippy::too_many_arguments)]
fn run_native_session_loop(
    app: AppHandle,
    registry: NativeSessionRegistry,
    forward_registry: NativeForwardRegistry,
    session_id: String,
    state: Arc<Mutex<NativeSessionState>>,
    session: Session,
    mut channel: Channel,
    mut receiver: Receiver<NativeSessionCommand>,
) {
    // The direct-SSH connect already succeeded before this loop was spawned, so
    // the session is connected the moment we start. Emit it here (like the
    // external/jump loops) rather than from the spawning task: spawn_blocking
    // returns as soon as this thread is spawned, so a caller-side "connected"
    // could race — and lose to — an instant EOF that makes this loop emit
    // "disconnected" first, leaving the UI stuck "connected" on a dead session.
    set_native_session_connection_state(&app, &session_id, &state, "connected");

    let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];
    let mut coalescer = OutputCoalescer::new(
        Duration::from_millis(NATIVE_OUTPUT_COALESCE_WINDOW_MS),
        NATIVE_OUTPUT_COALESCE_MAX_BYTES,
    );

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
                if let Some(flushed) = coalescer.push(&buffer[..count], Instant::now()) {
                    emit_native_session_output(&app, &session_id, &state, flushed);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => {
                if let Some(flushed) = coalescer.finish() {
                    emit_native_session_output(&app, &session_id, &state, flushed);
                }
                emit_native_session_error(&app, &session_id, &state, error.to_string());
                break;
            }
        }

        // Cap latency for a producer that never pauses: flush once the window
        // has elapsed. Bursts are otherwise coalesced by the size threshold in
        // `push`, and anything still buffered at close is flushed post-loop.
        if let Some(flushed) = coalescer.poll_flush(Instant::now()) {
            emit_native_session_output(&app, &session_id, &state, flushed);
        }

        if channel.eof() {
            break;
        }

        if !did_work {
            thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
        }
    }

    // Flush any remaining coalesced output before the session closes, on every
    // break path (eof, close command, read error), so no bytes are lost.
    if let Some(flushed) = coalescer.finish() {
        emit_native_session_output(&app, &session_id, &state, flushed);
    }

    let _ = channel.close();
    let _ = channel.wait_close();
    let _ = session.disconnect(None, "Terminal Workspace session closed", None);
    close_native_forwards_for_session(&forward_registry, &session_id);
    remove_native_session(&registry, &session_id);
    set_native_session_connection_state(&app, &session_id, &state, "disconnected");

    let stream_id = {
        let mut state = state.lock_recover();
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
        let mut state = handle.state.lock_recover();
        let stream_id = state
            .stream_id
            .clone()
            .unwrap_or_else(next_session_stream_id);
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

    let active_stream_id = handle.state.lock_recover().stream_id.clone();

    if active_stream_id.as_deref() != Some(request.stream_id.as_str()) {
        return Err("Session stream is stale".to_string());
    }

    // #205: try_send, never blocking. Close and Resize are async commands that
    // Tauri spawns onto the tokio runtime, where a blocking send panics; this
    // one is synchronous and would instead freeze the IPC thread for as long as
    // the session stays stalled. Neither is acceptable, so a full queue is
    // reported rather than waited on.
    //
    // The error deliberately does NOT include the rejected input: it is
    // keystrokes, which may be a password being typed at a prompt.
    handle
        .command_sender
        .try_send(NativeSessionCommand::Input(request.data))
        .map_err(|error| match error {
            TrySendError::Full(_) => {
                "Session input queue is full; the session is not draining input".to_string()
            }
            TrySendError::Closed(_) => "Session stream is closed".to_string(),
        })?;

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
    let mut state = handle.state.lock_recover();

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
fn terminal_workspace_transport_info() -> BackendTransportInfo {
    BackendTransportInfo {
        backend_base_url: String::new(),
        session_bridge: "tauri-native",
    }
}

#[tauri::command]
fn terminal_workspace_protocol_runtime_status(
    request: ProtocolRuntimeStatusRequest,
) -> ProtocolRuntimeStatusResponse {
    build_protocol_runtime_status(&request.protocol)
}

/// Backend status check. P2-NET: the native shell owns SSH/SFTP/forwarding,
/// snippets, key tooling, and persistence, so no Node backend is contacted.
#[tauri::command]
async fn terminal_workspace_backend_status() -> Result<BackendStatusResponse, String> {
    Ok(BackendStatusResponse {
        ok: true,
        backend_base_url: String::new(),
        transport: "tauri-native",
    })
}

#[tauri::command]
async fn terminal_workspace_inspect_private_key(
    request: KeyPathRequest,
) -> Result<KeyMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_private_key(&request.path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_generate_private_key(
    request: GenerateKeyRequest,
) -> Result<KeyMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || generate_key_pair(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPrivateKeyFromBodyRequest {
    path: String,
    body: String,
}

/// M01 / #83: paste-from-clipboard private key import. Writes the
/// pasted body to disk with 0600 perms, then runs inspect to surface
/// the same KeyMetadata shape as the path-only import.
#[tauri::command]
async fn terminal_workspace_import_private_key_from_body(
    request: ImportPrivateKeyFromBodyRequest,
) -> Result<KeyMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_private_key_from_body(&request.path, &request.body)
    })
    .await
    .map_err(|error| error.to_string())?
}

// BackendHostConnection (the existing renderer-side struct) doesn't
// derive Debug — adding it here directly would touch a lot of unrelated
// fields. Just drop the Debug derive on this request struct.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyKeyToHostRequest {
    private_key_path: String,
    host: BackendHostConnection,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyKeyToHostResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

fn copy_key_to_host_blocking(
    request: &CopyKeyToHostRequest,
    store: &NativeHostKeyStore,
) -> Result<CopyKeyToHostResponse, String> {
    // Validate the target host BEFORE any connect or authentication. This was
    // the one host-consuming command that skipped the gate, so an allowUnknown
    // or requireTrusted-without-pinned-key host would have its auth password
    // sent to an unverified server (host-key MITM); validate_ssh_host also
    // rejects control-char injection into the generated ssh_config. Surface the
    // rejection as a normal ok:false response so the renderer shows the reason
    // consistently with this command's other failures.
    if let Err(reason) = validate_ssh_host(&request.host) {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(reason),
        });
    }

    if request.private_key_path.trim().is_empty() {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some("A private key path is required".to_string()),
        });
    }
    if request.host.hostname.is_empty() {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some("A target host is required".to_string()),
        });
    }

    // Read <privateKeyPath>.pub through the same allowlist gate the
    // inspect path uses.
    let pub_path_string = format!("{}.pub", request.private_key_path);
    let pub_path = expand_home(&pub_path_string);
    validate_user_owned_key_path(&pub_path)?;
    let pub_body = match std::fs::read_to_string(&pub_path) {
        Ok(body) => body.trim().to_string(),
        Err(error) => {
            return Ok(CopyKeyToHostResponse {
                ok: false,
                reason: Some(format!(
                    "Could not read public key at {}: {}",
                    pub_path.display(),
                    error
                )),
            });
        }
    };
    if pub_body.is_empty() {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!("Public key at {} is empty", pub_path.display())),
        });
    }

    // Open a one-shot SSH session. Mirrors connect_native_session but
    // skips the shell-channel open at the end — we want a fresh channel
    // for exec.
    let port = match u16::try_from(request.host.port) {
        Ok(p) => p,
        Err(_) => {
            return Ok(CopyKeyToHostResponse {
                ok: false,
                reason: Some("SSH port must be between 1 and 65535".to_string()),
            });
        }
    };
    let tcp_stream = match connect_tcp_with_timeout(
        request.host.hostname.as_str(),
        port,
        Duration::from_millis(NATIVE_SSH_CONNECT_TIMEOUT_MS),
    ) {
        Ok(stream) => stream,
        Err(error) => {
            return Ok(CopyKeyToHostResponse {
                ok: false,
                reason: Some(format!("TCP connect failed: {}", error)),
            });
        }
    };
    let _ = tcp_stream.set_nodelay(true);

    let mut session = match Session::new() {
        Ok(s) => s,
        Err(error) => {
            return Ok(CopyKeyToHostResponse {
                ok: false,
                reason: Some(format!("ssh2 session new: {}", error)),
            });
        }
    };
    session.set_tcp_stream(tcp_stream);
    // Bound handshake, auth, and the blocking read_to_string below so a stalled
    // banner or an unresponsive-but-connected host cannot hang this command.
    session.set_timeout(NATIVE_SSH_IO_TIMEOUT_MS);
    if let Err(error) = session.handshake() {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!("SSH handshake failed: {}", error)),
        });
    }

    // Honor known_host_public_key the same way connect_native_session
    // does. requireTrusted defaults are enforced by the renderer +
    // launch-host-session gate; we still re-check here.
    // #151: same host-key decision as the direct session path, including TOFU
    // for allowUnknown. Copying a key to a host authenticates, so it must not
    // skip verification either.
    if let Err(reason) = verify_native_host_key(&session, &request.host, store) {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(reason),
        });
    }

    if let Err(error) = authenticate_native_session(&mut session, &request.host) {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!("Authentication failed: {}", error)),
        });
    }

    let mut channel = match session.channel_session() {
        Ok(c) => c,
        Err(error) => {
            return Ok(CopyKeyToHostResponse {
                ok: false,
                reason: Some(format!("Channel open failed: {}", error)),
            });
        }
    };

    // Public key body is single-quote-escaped so a comment with shell
    // special chars can't break out. We trail "echo OK" so we can
    // confirm the chained append + chmod actually completed.
    let quoted = shell_single_quote(&pub_body);
    let command = format!(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && printf '%s\\n' {} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo OK",
        quoted
    );
    if let Err(error) = channel.exec(&command) {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!("exec failed: {}", error)),
        });
    }

    let mut stdout = String::new();
    if let Err(error) = std::io::Read::read_to_string(&mut channel, &mut stdout) {
        return Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!("Read stdout failed: {}", error)),
        });
    }
    let _ = channel.wait_close();
    let exit_status = channel.exit_status().unwrap_or(-1);

    if exit_status == 0 && stdout.trim().ends_with("OK") {
        Ok(CopyKeyToHostResponse {
            ok: true,
            reason: None,
        })
    } else {
        Ok(CopyKeyToHostResponse {
            ok: false,
            reason: Some(format!(
                "Remote command exited with status {} (stdout: {})",
                exit_status,
                stdout.trim()
            )),
        })
    }
}

/// M02 / #84: ssh-copy-id equivalent. Reads `<private_key_path>.pub`,
/// opens a one-shot SSH session using the same host config the
/// runtime would, and appends the public key to ~/.ssh/authorized_keys
/// with the canonical permission tighten-down.
#[tauri::command]
async fn terminal_workspace_copy_key_to_host(
    native_host_keys: State<'_, SharedNativeHostKeyStore>,
    request: CopyKeyToHostRequest,
) -> Result<CopyKeyToHostResponse, String> {
    let host_key_store = native_host_keys.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        copy_key_to_host_blocking(&request, host_key_store.as_ref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDockBadgeRequest {
    count: i64,
}

/// M03 / #85: macOS dock badge for the active session count. Tauri 2
/// surfaces this as `WebviewWindow::set_badge_count(Option<i64>)`. A
/// `count` of 0 (or negative) clears the badge.
#[tauri::command]
async fn terminal_workspace_set_dock_badge(
    request: SetDockBadgeRequest,
    app: AppHandle,
) -> Result<(), String> {
    let count_opt = if request.count > 0 {
        Some(request.count)
    } else {
        None
    };
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count(count_opt)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckRequest {}

/// #148: `app.restart()` tears down every live SSH session. Installing used to
/// do that with no warning, so an update accepted from the banner could drop a
/// half-finished remote command. The install command now refuses while sessions
/// are open unless the caller has confirmed with the user and set `force`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallUpdateRequest {
    #[serde(default)]
    force: bool,
}

/// Marker the renderer matches on to tell "you have N live sessions" apart from
/// any other install failure. Kept in sync with LIVE_SESSIONS_MARKER in
/// apps/desktop/src/lib/auto-update.ts.
const LIVE_SESSIONS_REFUSAL_MARKER: &str = "live-sessions:";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResult {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

/// #86: auto-update check via tauri-plugin-updater. Queries the configured
/// release endpoint (GitHub `latest.json`), verifies the update's signature
/// against the embedded pubkey, and reports availability to the renderer's
/// UpdateAvailableBanner (#97). A network/parse failure surfaces as `Err` so
/// the Settings "Check for updates" button can show the reason; "no update"
/// is the success case `{ available: false }`.
#[tauri::command]
async fn terminal_workspace_check_for_updates(
    app: tauri::AppHandle,
    _request: UpdateCheckRequest,
) -> Result<UpdateCheckResult, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|error| error.to_string())?;
    match updater.check().await.map_err(|error| error.to_string())? {
        Some(update) => Ok(UpdateCheckResult {
            available: true,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
        }),
        None => Ok(UpdateCheckResult {
            available: false,
            version: None,
            notes: None,
        }),
    }
}

/// #86: download + install the available update, then relaunch into it.
/// Re-checks rather than caching the `Update` across IPC calls, so a stale
/// renderer can't trigger an install of an update that no longer applies.
/// `app.restart()` never returns (it relaunches the process).
#[tauri::command]
async fn terminal_workspace_install_update_and_restart(
    app: tauri::AppHandle,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: InstallUpdateRequest,
) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    // #148: the session count is checked TWICE, and the second one is the one
    // that matters. Checking only up front looks right but loses the race the
    // guard exists to close: the user confirms with nothing open, the download
    // runs for tens of seconds, they open a session in the meantime, and the
    // restart kills it silently — exactly the harm this ticket is about.
    //
    // The pre-download check is only an optimisation: fail fast instead of
    // spending the user's bandwidth on an update we are about to refuse.
    // Counted via lock_recover(), the idiom the rest of the registry uses, so a
    // poisoned lock cannot turn "sessions are open" into "no sessions".
    if !request.force {
        let live = live_native_session_count(native_sessions.inner());
        if live > 0 {
            return Err(format!(
                "Installing this update restarts the app and will close {live} live SSH \
                 session(s). Confirm to continue. {LIVE_SESSIONS_REFUSAL_MARKER}{live}"
            ));
        }
    }

    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available to install".to_string())?;
    update
        .download_and_install(|_downloaded, _total| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    // #148: re-check immediately before the restart. The update is downloaded
    // and staged at this point, so refusing here is not a failure — Tauri applies
    // a staged update on the next launch. Telling the user that and letting them
    // finish their work is strictly better than relaunching out from under a live
    // session, which is why this returns Err rather than restarting anyway.
    if !request.force {
        let live = live_native_session_count(native_sessions.inner());
        if live > 0 {
            return Err(format!(
                "The update is downloaded and will be applied the next time you quit and \
                 reopen the app. Restarting now would close {live} live SSH session(s). \
                 {LIVE_SESSIONS_REFUSAL_MARKER}{live}"
            ));
        }
    }

    app.restart();
}

#[tauri::command]
async fn terminal_workspace_scan_known_host(
    request: KnownHostScanRequest,
) -> Result<KnownHostScanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || scan_known_host(&request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_list_directory(
    request: SftpPathRequest,
) -> Result<SftpDirectoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_create_directory(
    request: SftpPathRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_rename_entry(
    request: SftpRenameRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_delete_entry(
    request: SftpDeleteRequest,
) -> Result<BackendBooleanResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_upload_file(
    request: SftpUploadRequest,
) -> Result<BackendPathResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_sftp_download_file(
    request: SftpPathRequest,
) -> Result<BackendBinaryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn terminal_workspace_list_session_forwards(
    native_forwards: State<'_, NativeForwardRegistry>,
    request: SessionIdRequest,
) -> ListForwardsResponse {
    list_session_forwards(native_forwards.inner(), &request.session_id)
}

#[tauri::command]
async fn terminal_workspace_create_forward(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    request: CreateForwardPayload,
) -> Result<PortForwardRecord, String> {
    let native_sessions = native_sessions.inner().clone();
    let native_forwards = native_forwards.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        create_native_forward(&native_sessions, &native_forwards, request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn terminal_workspace_delete_forward(
    native_forwards: State<'_, NativeForwardRegistry>,
    request: ForwardIdRequest,
) -> BackendBooleanResponse {
    delete_native_forward(native_forwards.inner(), &request.forward_id)
}

#[tauri::command]
async fn terminal_workspace_execute_snippet_on_hosts(
    request: SnippetExecutionRequest,
) -> Result<SnippetExecutionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || execute_native_snippet_request(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_load_host_secrets(
    request: HostSecretsRequest,
) -> Result<HostSecretsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let password = read_keychain_secret(KEYCHAIN_PASSWORD_SERVICE, &request.host_id);
        let passphrase = read_keychain_secret(KEYCHAIN_PASSPHRASE_SERVICE, &request.host_id);
        // A locked/denied keychain must not masquerade as "no secret stored"
        // (which would silently drop to an empty password and then fail auth
        // with no explanation). Surface it so the renderer can prompt instead.
        let keychain_unavailable = matches!(password, KeychainRead::Unavailable(_))
            || matches!(passphrase, KeychainRead::Unavailable(_));
        Ok(HostSecretsResponse {
            password: match password {
                KeychainRead::Found(value) => value,
                KeychainRead::Missing | KeychainRead::Unavailable(_) => String::new(),
            },
            passphrase: match passphrase {
                KeychainRead::Found(value) => value,
                KeychainRead::Missing | KeychainRead::Unavailable(_) => String::new(),
            },
            keychain_unavailable,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_workspace_store_host_secrets(
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
async fn terminal_workspace_clear_host_secrets(
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
async fn terminal_workspace_load_key_passphrase(
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
async fn terminal_workspace_store_key_passphrase(
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
async fn terminal_workspace_clear_key_passphrase(
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
async fn terminal_workspace_load_identity_passphrase(
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
async fn terminal_workspace_store_identity_passphrase(
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
async fn terminal_workspace_clear_identity_passphrase(
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
async fn terminal_workspace_read_ssh_config_file(
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobSshConfigFilesRequest {
    pattern: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SshConfigGlobMatch {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GlobSshConfigFilesResponse {
    matches: Vec<SshConfigGlobMatch>,
}

/// Defensive cap on how many files one glob may expand to, so a pathological
/// pattern over a huge directory can't pin the UI or balloon the import.
const SSH_CONFIG_GLOB_MAX_MATCHES: usize = 256;

/// Minimal shell-style matcher for the final path component of an `Include`
/// glob. Supports `*` (any run) and `?` (any single char) — the shapes that
/// cover real OpenSSH configs (`conf.d/*`, `*.conf`, `10-*`). `[` is treated
/// literally; bracket classes in Include patterns are vanishingly rare.
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star_pattern: Option<usize> = None;
    let mut star_text = 0usize;
    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star_pattern = Some(pi);
            star_text = ti;
            pi += 1;
        } else if let Some(start) = star_pattern {
            pi = start + 1;
            star_text += 1;
            ti = star_text;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

/// Expand an `Include` glob (e.g. `~/.ssh/conf.d/*`) to the files it matches,
/// each with its content. Security boundary mirrors the single-file reader:
/// the glob's directory and every match are canonicalized and must live under
/// `~/.ssh/`; matches outside it are dropped. Only the final component may be
/// a glob — a glob in a directory component is refused.
#[tauri::command]
async fn terminal_workspace_glob_ssh_config_files(
    request: GlobSshConfigFilesRequest,
) -> Result<GlobSshConfigFilesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || glob_ssh_config_files_blocking(&request.pattern))
        .await
        .map_err(|error| error.to_string())?
}

fn glob_ssh_config_files_blocking(raw_pattern: &str) -> Result<GlobSshConfigFilesResponse, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME env var is not set".to_string())?;
    let ssh_root = home
        .join(".ssh")
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize ~/.ssh: {error}"))?;

    let expanded = expand_home(raw_pattern);
    let file_pattern = expanded
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid glob pattern {raw_pattern}"))?
        .to_string();
    let parent = expanded
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));

    // Only the final component may contain glob metacharacters.
    let parent_text = parent.to_string_lossy();
    if parent_text.contains('*') || parent_text.contains('?') || parent_text.contains('[') {
        return Err("glob in a directory component is not supported".to_string());
    }

    let parent_canonical = parent
        .canonicalize()
        .map_err(|error| format!("cannot canonicalize {}: {error}", parent.display()))?;
    if !parent_canonical.starts_with(&ssh_root) {
        return Err(format!(
            "glob directory {} is not under {}",
            parent_canonical.display(),
            ssh_root.display()
        ));
    }

    let entries = std::fs::read_dir(&parent_canonical)
        .map_err(|error| format!("cannot read {}: {error}", parent_canonical.display()))?;

    let mut matches: Vec<SshConfigGlobMatch> = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(name) => name,
            None => continue,
        };
        if !glob_match(&file_pattern, name) {
            continue;
        }
        let canonical = match entry.path().canonicalize() {
            Ok(canonical) => canonical,
            Err(_) => continue,
        };
        if !canonical.starts_with(&ssh_root) {
            continue;
        }
        let metadata = match std::fs::metadata(&canonical) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.is_file() || metadata.len() > SSH_CONFIG_MAX_BYTES {
            continue;
        }
        let content = match std::fs::read_to_string(&canonical) {
            Ok(content) => content,
            Err(_) => continue,
        };
        matches.push(SshConfigGlobMatch {
            path: canonical.to_string_lossy().to_string(),
            content,
        });
        if matches.len() >= SSH_CONFIG_GLOB_MAX_MATCHES {
            break;
        }
    }

    // OpenSSH applies glob matches in lexical order.
    matches.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(GlobSshConfigFilesResponse { matches })
}

#[cfg(test)]
mod ssh_config_glob_tests {
    use super::{glob_match, glob_ssh_config_files_blocking};

    #[test]
    fn glob_match_supports_star_and_question() {
        assert!(glob_match("*.conf", "app.conf"));
        assert!(glob_match("10-*", "10-staging"));
        assert!(glob_match("conf?", "conf1"));
        assert!(glob_match("*", "anything"));
        assert!(!glob_match("*.conf", "app.cfg"));
        assert!(!glob_match("conf?", "conf12"));
        assert!(!glob_match("10-*", "20-prod"));
    }

    #[test]
    fn glob_refuses_directory_outside_ssh() {
        // A pattern that resolves outside ~/.ssh must be rejected (either
        // because the directory is not under ~/.ssh, or because ~/.ssh itself
        // cannot be canonicalized in this environment — both are errors).
        assert!(glob_ssh_config_files_blocking("/etc/*.conf").is_err());
    }
}

#[tauri::command]
async fn terminal_workspace_create_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    // #151: the TOFU store is Tauri state rather than something resolved inside
    // the connect path, so connect_native_session needs no AppHandle.
    native_host_keys: State<'_, SharedNativeHostKeyStore>,
    app: AppHandle,
    request: CreateBackendSessionRequest,
) -> Result<CreateSessionResponse, String> {
    let host_key_store = native_host_keys.inner().clone();
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
    // Create the command channel and insert the session handle BEFORE spawning
    // any loop thread. Previously the loop was spawned first and the handle
    // inserted afterwards, so a loop that failed and exited immediately called
    // remove_native_session for an id not yet in the registry (a no-op) and the
    // late insert then left a permanently-orphaned dead handle; the blanket
    // "connected" below could also overwrite the loop's terminal state on an
    // instant failure. Inserting first makes the loop's remove-on-exit correct,
    // and each loop now owns its own connected/disconnected transitions.
    let (command_sender, command_receiver) = channel(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);
    insert_native_session(
        native_sessions.inner(),
        &session_id,
        NativeSessionHandle {
            command_sender,
            host: session_host,
            state: state.clone(),
        },
    );

    let is_external = matches!(
        host.protocol.as_str(),
        "localShell" | "telnet" | "serial" | "mosh"
    );
    let has_jump_host = host.jump_host.is_some();

    if is_external {
        thread::spawn(move || {
            run_external_command_session_loop(
                app_handle,
                native_registry,
                forward_registry,
                session_id_for_thread,
                state_for_thread,
                host,
                command_receiver,
            );
        });
        // Stays "connecting" until the loop emits "connected" once the process
        // is actually up.
    } else if has_jump_host {
        thread::spawn(move || {
            run_jump_host_session_loop(
                app_handle,
                native_registry,
                forward_registry,
                session_id_for_thread,
                state_for_thread,
                host,
                command_receiver,
            );
        });
        // Stays "connecting" until the loop establishes the jump chain.
    } else {
        // Direct SSH connects synchronously. On failure, remove the handle we
        // pre-inserted so a failed connect leaves no orphan, then report it.
        let connect_result = tauri::async_runtime::spawn_blocking(move || {
            let (session, channel) = connect_native_session(&host, host_key_store.as_ref())?;
            thread::spawn(move || {
                run_native_session_loop(
                    app_handle,
                    native_registry,
                    forward_registry,
                    session_id_for_thread,
                    state_for_thread,
                    session,
                    channel,
                    command_receiver,
                );
            });
            Ok::<(), String>(())
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|inner| inner);

        if let Err(error) = connect_result {
            remove_native_session(native_sessions.inner(), &session_id);
            return Err(error);
        }
        // Direct SSH is connected once connect_native_session returns; the
        // spawned run_native_session_loop emits "connected" from its own thread
        // so it cannot race (and lose to) an instant-EOF "disconnected".
    }

    Ok(CreateSessionResponse { session_id })
}

#[tauri::command]
async fn terminal_workspace_close_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    native_forwards: State<'_, NativeForwardRegistry>,
    request: SessionIdRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(handle) = remove_native_session(native_sessions.inner(), &request.session_id) {
        close_native_forwards_for_session(native_forwards.inner(), &request.session_id);
        // #205: still fire-and-forget, and still correct on a bounded channel.
        // Close is a promptness optimisation, not the shutdown guarantee: the
        // handle was just removed from the registry above, so once it and any
        // transient clone drop, the channel disconnects and every loop already
        // treats TryRecvError::Disconnected as close.
        let _ = handle.command_sender.try_send(NativeSessionCommand::Close);
        return Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        });
    }

    Err("Session not found in native runtime".to_string())
}

#[tauri::command]
async fn terminal_workspace_resize_backend_session(
    native_sessions: State<'_, NativeSessionRegistry>,
    request: ResizeBackendSessionRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(handle) = get_native_session(native_sessions.inner(), &request.session_id) {
        handle
            .command_sender
            .try_send(NativeSessionCommand::Resize {
                cols: request.payload.cols,
                rows: request.payload.rows,
            })
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    "Session input queue is full; the session is not draining input".to_string()
                }
                TrySendError::Closed(_) => "Session stream is closed".to_string(),
            })?;

        return Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        });
    }

    Err("Session not found in native runtime".to_string())
}

#[tauri::command]
async fn terminal_workspace_open_backend_session_stream(
    app: AppHandle,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamRequest,
) -> Result<SessionStreamOpenResponse, String> {
    open_native_session_stream(&app, native_sessions.inner(), &request.session_id)
}

#[tauri::command]
fn terminal_workspace_send_backend_session_stream(
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamSendRequest,
) -> Result<BackendBooleanResponse, String> {
    send_native_session_stream(native_sessions.inner(), request)
}

#[tauri::command]
fn terminal_workspace_close_backend_session_stream(
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
const MENU_EVENT_NAME: &str = "terminal_workspace://menu-event";

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
        description: "create_terminal_workspace_persistence_tables",
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
        // #86: auto-updater. Endpoints + signing pubkey come from
        // tauri.conf.json#plugins.updater; the commands below drive it.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(NativeSessionRegistry::default())
        .manage(NativeForwardRegistry::default())
        .setup(|app| {
            // #151: resolve the durable host-key store once, through Tauri, so it
            // follows the bundle identifier and never lands in the per-session
            // temp roots that get deleted on teardown. Folded into THIS setup
            // block deliberately — Builder::setup keeps only one closure, so a
            // second .setup() call would silently replace the menu wiring below.
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("could not resolve the app data directory: {error}"))?;
            let host_key_store = NativeHostKeyStore::new(&data_dir)?;
            // #151 slice 2: publish the same path for the OpenSSH-driven jump
            // path, which needs the location but not the store itself.
            native_host_keys::publish_durable_known_hosts_path(host_key_store.path().to_path_buf());
            app.manage(SharedNativeHostKeyStore::new(host_key_store));

            let handle = app.handle();
            let menu = build_app_menu(handle)?;
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
            terminal_workspace_transport_info,
            terminal_workspace_protocol_runtime_status,
            terminal_workspace_backend_status,
            terminal_workspace_inspect_private_key,
            terminal_workspace_generate_private_key,
            terminal_workspace_scan_known_host,
            terminal_workspace_sftp_list_directory,
            terminal_workspace_sftp_create_directory,
            terminal_workspace_sftp_rename_entry,
            terminal_workspace_sftp_delete_entry,
            terminal_workspace_sftp_upload_file,
            terminal_workspace_sftp_download_file,
            terminal_workspace_list_session_forwards,
            terminal_workspace_create_forward,
            terminal_workspace_delete_forward,
            terminal_workspace_execute_snippet_on_hosts,
            terminal_workspace_load_host_secrets,
            terminal_workspace_store_host_secrets,
            terminal_workspace_clear_host_secrets,
            terminal_workspace_load_key_passphrase,
            terminal_workspace_store_key_passphrase,
            terminal_workspace_clear_key_passphrase,
            terminal_workspace_load_identity_passphrase,
            terminal_workspace_store_identity_passphrase,
            terminal_workspace_clear_identity_passphrase,
            terminal_workspace_read_ssh_config_file,
            terminal_workspace_glob_ssh_config_files,
            terminal_workspace_create_backend_session,
            terminal_workspace_close_backend_session,
            terminal_workspace_resize_backend_session,
            terminal_workspace_open_backend_session_stream,
            terminal_workspace_send_backend_session_stream,
            terminal_workspace_close_backend_session_stream,
            terminal_workspace_import_private_key_from_body,
            terminal_workspace_copy_key_to_host,
            terminal_workspace_set_dock_badge,
            terminal_workspace_check_for_updates,
            terminal_workspace_install_update_and_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod native_transport_conformance_tests;

#[cfg(test)]
mod native_transport_fixtures;

#[cfg(test)]
mod tests {
    /// #151: the two copy-key refusal tests exercise validation that happens
    /// BEFORE any connect, so they never reach the store. A throwaway one keeps
    /// them honest about that rather than mocking the type away.
    /// #274: counter, not clock — see native_transport's test_suffix.
    static KEYCHAIN_ACCOUNT_SEQ: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);
    static COPYKEY_ROOT_SEQ: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    fn throwaway_host_key_store(label: &str) -> NativeHostKeyStore {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let seq = COPYKEY_ROOT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "tw-copykey-{label}-{}-{nanos}-{seq}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("test root should be created");
        NativeHostKeyStore::new(&root).expect("store")
    }

    use super::*;

    /// A writer that never accepts data — models a stalled remote / full SSH
    /// window whose peer has stopped reading.
    struct StalledWriter;
    impl std::io::Write for StalledWriter {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "stalled",
            ))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn write_all_with_deadline_gives_up_on_stalled_remote() {
        // The paste-against-stalled-remote case: the write must return an error
        // within the deadline rather than busy-wait forever and wedge the loop.
        let mut writer = StalledWriter;
        let start = Instant::now();
        let result =
            write_all_with_deadline(&mut writer, b"a large paste", Duration::from_millis(50));
        let elapsed = start.elapsed();
        assert!(result.is_err(), "a stalled write must return Err, not hang");
        assert!(
            elapsed >= Duration::from_millis(50),
            "must respect the deadline"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "must not hang well past the deadline; took {elapsed:?}"
        );
    }

    #[test]
    fn write_all_with_deadline_writes_all_bytes_when_accepted() {
        // A writer that accepts everything completes without hitting the deadline.
        let mut buffer: Vec<u8> = Vec::new();
        write_all_with_deadline(&mut buffer, b"hello world", Duration::from_secs(1))
            .expect("an accepting writer should succeed");
        assert_eq!(buffer, b"hello world");
    }

    /// Accepts one byte per call, returning WouldBlock on alternate calls — a
    /// slow link that keeps making progress.
    struct SlowProgressWriter {
        accepted: Vec<u8>,
        block_next: bool,
    }
    impl std::io::Write for SlowProgressWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.block_next {
                self.block_next = false;
                return Err(std::io::Error::new(std::io::ErrorKind::WouldBlock, "slow"));
            }
            self.block_next = true;
            self.accepted.push(buf[0]);
            Ok(1)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn write_all_with_deadline_survives_slow_but_progressing_writes() {
        // Progress resets the idle timer, so a transfer whose TOTAL time far
        // exceeds the deadline still succeeds as long as no single stall does.
        // 20 bytes * (~10ms poll per blocked call) is well over the 50ms idle
        // deadline in total, but no individual stall reaches it.
        let input = b"twenty-byte payload!";
        assert!(input.len() as u128 * NATIVE_SESSION_POLL_INTERVAL_MS as u128 > 50);
        let mut writer = SlowProgressWriter {
            accepted: Vec::new(),
            block_next: false,
        };
        write_all_with_deadline(&mut writer, input, Duration::from_millis(50))
            .expect("a slow-but-progressing write must not be cut off");
        assert_eq!(writer.accepted, input);
    }

    use std::{
        env, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn test_registry_survives_poisoned_lock() {
        let registry = NativeSessionRegistry::default();

        // Poison the shared registry mutex the way a real crash would: a
        // thread panics while holding the lock. join() returns Err (the
        // panic is contained to that thread, not the test process).
        let poisoner = {
            let sessions = registry.sessions.clone();
            thread::spawn(move || {
                let _guard = sessions.lock_recover();
                panic!("intentional poison for test_registry_survives_poisoned_lock");
            })
        };
        assert!(poisoner.join().is_err(), "poisoner thread should panic");
        assert!(
            registry.sessions.is_poisoned(),
            "registry mutex should be poisoned after the panic"
        );

        // A normal registry operation must still succeed via lock_recover
        // instead of cascading the panic — one bad session does not brick
        // the rest.
        assert!(
            get_native_session(&registry, "missing").is_none(),
            "registry read should recover from poisoning"
        );

        let (command_sender, _command_receiver) = channel(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);
        insert_native_session(
            &registry,
            "s1",
            NativeSessionHandle {
                command_sender,
                host: minimal_ssh_host(),
                state: Arc::new(Mutex::new(NativeSessionState::default())),
            },
        );
        assert!(
            get_native_session(&registry, "s1").is_some(),
            "registry write/read should still work after poisoning"
        );
    }

    #[test]
    fn test_connect_timeout_fails_fast_on_black_hole() {
        // 192.0.2.1 is in TEST-NET-1 (RFC 5737): guaranteed non-routable, so a
        // SYN is dropped and the connect must hit the deadline rather than hang
        // on the OS TCP timeout. (A network that replies with an ICMP
        // unreachable instead just makes it fail faster — still Err, still
        // bounded.)
        let start = Instant::now();
        let result = connect_tcp_with_timeout("192.0.2.1", 22, Duration::from_millis(300));
        let elapsed = start.elapsed();
        assert!(
            result.is_err(),
            "connect to a black-hole address must fail, got {result:?}"
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "connect must resolve within the bounded deadline; took {elapsed:?}"
        );
    }

    #[test]
    fn test_connect_timeout_rejects_unresolvable_host() {
        let result =
            connect_tcp_with_timeout("no-such-host.invalid", 22, Duration::from_millis(300));
        assert!(result.is_err(), "an unresolvable host must return Err");
    }

    #[test]
    fn test_output_coalescing() {
        // Many small chunks that all arrive within one window must coalesce
        // into a single emitted message, not one emit per chunk.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let t0 = Instant::now();
        let mut flushes: Vec<String> = Vec::new();
        for i in 0..100 {
            if let Some(flushed) = c.push(format!("chunk{i};").as_bytes(), t0) {
                flushes.push(flushed);
            }
        }
        // Under the size threshold and within the window: nothing emitted yet.
        assert!(flushes.is_empty(), "no emit before window/size threshold");

        // Once the window elapses, the whole burst leaves as exactly one emit.
        if let Some(flushed) = c.poll_flush(t0 + Duration::from_millis(12)) {
            flushes.push(flushed);
        }
        assert_eq!(flushes.len(), 1, "100 chunks in one window => 1 emit");
        let expected: String = (0..100).map(|i| format!("chunk{i};")).collect();
        assert_eq!(flushes[0], expected);
    }

    #[test]
    fn test_output_no_loss_or_reorder() {
        // The concatenation of every flush (size-triggered plus the final
        // take) must equal the exact input byte sequence, in order.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 32);
        let t0 = Instant::now();
        let inputs = [
            "alpha", "-", "beta", "-", "gamma", "-", "delta", "-", "epsilon",
        ];
        let mut out = String::new();
        for chunk in inputs {
            if let Some(flushed) = c.push(chunk.as_bytes(), t0) {
                out.push_str(&flushed);
            }
        }
        if let Some(flushed) = c.finish() {
            out.push_str(&flushed);
        }
        assert_eq!(out, inputs.concat());
    }

    #[test]
    fn test_output_size_threshold_flushes_immediately() {
        // A single chunk (or run) crossing the size threshold flushes on push,
        // bounding memory for a producer that never pauses.
        let mut c = OutputCoalescer::new(Duration::from_millis(10_000), 8);
        let t0 = Instant::now();
        assert!(c.push(b"1234567", t0).is_none(), "7 bytes < threshold");
        assert_eq!(c.push(b"89", t0), Some("123456789".to_string()));
        // Buffer is empty again after the size flush.
        assert!(c.finish().is_none());
    }

    #[test]
    fn test_output_no_flush_before_window() {
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let t0 = Instant::now();
        c.push(b"hello", t0);
        assert!(
            c.poll_flush(t0 + Duration::from_millis(11)).is_none(),
            "before the window elapses, nothing flushes"
        );
        assert_eq!(
            c.poll_flush(t0 + Duration::from_millis(12)),
            Some("hello".to_string())
        );
    }

    /// #193: the readers MUST keep draining after their receiver is gone, and
    /// must stop only at EOF.
    ///
    /// This looks like a thread leak and is not. `with_native_ssh_control_session`
    /// deliberately leaves its ControlMaster child running and drops the receiver
    /// when it returns (native_transport.rs:1424); nothing else drains that PTY.
    /// A reader that exited on the first failed send let the buffer fill, blocked
    /// `ssh` on write, and hung every later operation multiplexed over that
    /// control socket — which is exactly how it presented: the localhost sshd
    /// fixture timed out after 30 minutes in CI while the whole suite passed
    /// locally in a second.
    #[test]
    fn test_readers_keep_draining_after_their_receiver_is_gone() {
        /// Yields a fixed number of chunks, then EOF, counting reads.
        struct CountingReader {
            remaining: usize,
            reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        }

        impl std::io::Read for CountingReader {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if self.remaining == 0 {
                    return Ok(0);
                }
                self.remaining -= 1;
                buf[0] = b'x';
                Ok(1)
            }
        }

        for jump in [false, true] {
            let reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let (sender, receiver) = native_session_event_channel();
            // The receiver is gone before a single byte is read, so EVERY send
            // fails. The reader still has to consume all 8 chunks.
            drop(receiver);

            let reader = Box::new(CountingReader {
                remaining: 8,
                reads: reads.clone(),
            });
            if jump {
                let writer: Arc<Mutex<Box<dyn std::io::Write + Send>>> =
                    Arc::new(Mutex::new(Box::new(std::io::sink())));
                spawn_jump_session_reader(reader, writer, Vec::new(), sender);
            } else {
                spawn_local_session_reader(reader, sender);
            }

            // 8 chunks plus the read that returns EOF.
            let deadline = Instant::now() + Duration::from_secs(5);
            while reads.load(std::sync::atomic::Ordering::SeqCst) < 9 && Instant::now() < deadline {
                thread::yield_now();
            }
            assert_eq!(
                reads.load(std::sync::atomic::Ordering::SeqCst),
                9,
                "reader (jump={jump}) must drain to EOF even with no receiver"
            );
        }
    }

    #[test]
    fn test_session_event_channel_backpressures_instead_of_queueing() {
        // #193: the queue must stop accepting at its bound rather than growing.
        let (sender, receiver) = native_session_event_channel();
        for index in 0..NATIVE_SESSION_EVENT_CHANNEL_CAPACITY {
            sender
                .try_send(JumpSessionEvent::Output(vec![index as u8; 4096]))
                .expect("the queue accepts up to its capacity");
        }

        assert!(
            matches!(
                sender.try_send(JumpSessionEvent::Output(vec![0xff; 4096])),
                Err(std::sync::mpsc::TrySendError::Full(_))
            ),
            "past capacity the queue must refuse, not grow"
        );

        // And nothing was dropped or reordered on the way in.
        for index in 0..NATIVE_SESSION_EVENT_CHANNEL_CAPACITY {
            // Deliberately not asserting via Debug: JumpSessionEvent carries raw
            // terminal bytes, and deriving Debug on it would put a typed
            // password one stray log line away from disk.
            match receiver.recv().expect("queued event") {
                JumpSessionEvent::Output(bytes) => {
                    assert_eq!(bytes.len(), 4096);
                    assert_eq!(bytes[0], index as u8, "events must arrive in order");
                }
                _ => panic!("expected an Output event"),
            }
        }
    }

    #[test]
    fn test_a_blocked_send_completes_once_the_loop_drains() {
        // Backpressure has to be a pause, not a loss: the blocked send must
        // deliver its event as soon as space appears.
        let (sender, receiver) = native_session_event_channel();
        for _ in 0..NATIVE_SESSION_EVENT_CHANNEL_CAPACITY {
            sender.try_send(JumpSessionEvent::Eof).expect("fill");
        }

        let blocked = thread::spawn(move || {
            sender.send(JumpSessionEvent::Output(b"after-the-block".to_vec()))
        });

        // Draining one slot is what releases it.
        let mut seen = Vec::new();
        for _ in 0..=NATIVE_SESSION_EVENT_CHANNEL_CAPACITY {
            seen.push(receiver.recv().expect("event"));
        }

        blocked
            .join()
            .expect("thread")
            .expect("the blocked send delivers");
        match seen.last().expect("last event") {
            JumpSessionEvent::Output(bytes) => assert_eq!(bytes, b"after-the-block"),
            _ => panic!("the blocked event must arrive last and intact"),
        }
    }

    #[test]
    fn test_output_three_byte_scalar_survives_a_split() {
        // The actual bug: a 3-byte character straddling a read boundary used to
        // become two replacement characters, permanently. Feeding it one byte
        // per flush is the worst case.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let euro = "€".as_bytes();
        assert_eq!(euro.len(), 3);
        let mut t = Instant::now();
        let mut out = String::new();

        for byte in euro {
            c.push(&[*byte], t);
            t += Duration::from_millis(12);
            if let Some(flushed) = c.poll_flush(t) {
                out.push_str(&flushed);
            }
        }

        assert_eq!(
            out, "€",
            "a split scalar must survive intact, not become U+FFFD"
        );
    }

    #[test]
    fn test_output_four_byte_scalar_survives_three_boundaries() {
        // A 4-byte scalar can straddle more than one boundary, so holding back
        // has to survive being asked twice in a row.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let emoji = "🦀".as_bytes();
        assert_eq!(emoji.len(), 4);
        let mut t = Instant::now();
        let mut out = String::new();

        for byte in emoji {
            c.push(&[*byte], t);
            t += Duration::from_millis(12);
            if let Some(flushed) = c.poll_flush(t) {
                out.push_str(&flushed);
            }
        }

        assert_eq!(out, "🦀");
    }

    #[test]
    fn test_output_invalid_bytes_do_not_stall_the_stream() {
        // Genuinely malformed input must not be mistaken for "incomplete" and
        // held: that would let a bad stream freeze the terminal.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let t0 = Instant::now();

        c.push(&[0xff], t0);
        let first = c
            .poll_flush(t0 + Duration::from_millis(12))
            .expect("an invalid byte flushes immediately rather than being held");
        assert_eq!(first, "\u{FFFD}");

        c.push(b"ok", t0 + Duration::from_millis(12));
        assert_eq!(
            c.poll_flush(t0 + Duration::from_millis(24)),
            Some("ok".to_string()),
            "the stream keeps working after invalid input"
        );
    }

    #[test]
    fn test_output_finish_does_not_drop_a_truncated_tail() {
        // At close there is no next chunk, so a held-back fragment has to be
        // surfaced rather than silently discarded.
        let mut c = OutputCoalescer::new(Duration::from_millis(12), 64 * 1024);
        let t0 = Instant::now();

        // First two bytes of a 3-byte scalar, then the session ends.
        c.push(&"€".as_bytes()[..2], t0);
        assert_eq!(
            c.poll_flush(t0 + Duration::from_millis(12)),
            None,
            "an incomplete scalar alone emits nothing yet"
        );
        assert_eq!(c.finish(), Some("\u{FFFD}".to_string()));
        assert_eq!(c.finish(), None, "finishing twice is harmless");
    }

    #[test]
    fn test_output_size_threshold_counts_source_bytes() {
        // max_bytes is a byte budget, not a character count.
        let mut c = OutputCoalescer::new(Duration::from_millis(10_000), 6);
        let t0 = Instant::now();

        assert!(c.push("€".as_bytes(), t0).is_none(), "3 bytes < 6");
        assert_eq!(c.push("€".as_bytes(), t0), Some("€€".to_string()));
    }

    #[test]
    fn test_prompt_window_trimming_survives_multibyte_output() {
        // Regression for the panic this ticket uncovered: the window used to be
        // a String trimmed by a byte count, and String::drain asserts the range
        // lands on a character boundary. CJK is 3 bytes wide and the window is
        // 512, so the very first overflow lands mid-character and killed the
        // reader thread.
        let mut prompt_window: Vec<u8> = Vec::new();
        prompt_window.extend_from_slice("日本語の出力".repeat(40).as_bytes());
        assert!(prompt_window.len() > NATIVE_SESSION_PROMPT_WINDOW_SIZE);

        // The exact maintenance spawn_jump_session_reader performs.
        let excess = prompt_window.len() - NATIVE_SESSION_PROMPT_WINDOW_SIZE;
        prompt_window.drain(0..excess);
        assert_eq!(prompt_window.len(), NATIVE_SESSION_PROMPT_WINDOW_SIZE);

        // And a prompt arriving after that trim is still detected, even though
        // the window now starts mid-character.
        prompt_window.extend_from_slice(b"user@host's password:");
        assert_eq!(
            detect_prompt_kind(&prompt_window),
            Some(PromptResponseKind::Password)
        );
    }

    #[test]
    fn test_prompt_detected_when_split_across_reads() {
        // The prompt window exists because a prompt can straddle two reads.
        let mut prompt_window: Vec<u8> = Vec::new();
        prompt_window.extend_from_slice(b"user@host's pass");
        assert_eq!(detect_prompt_kind(&prompt_window), None);
        prompt_window.extend_from_slice(b"word:");
        assert_eq!(
            detect_prompt_kind(&prompt_window),
            Some(PromptResponseKind::Password)
        );
    }

    /// #205: the renderer -> loop input channel is bounded, so a session whose
    /// write path has stalled cannot let the renderer queue keystrokes without
    /// limit. Past capacity the send is REFUSED rather than dropped — silently
    /// discarding a keystroke is the one outcome the ticket forbids.
    #[tokio::test]
    async fn input_channel_refuses_rather_than_growing_without_limit() {
        let (sender, mut receiver) =
            channel::<NativeSessionCommand>(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);

        for index in 0..NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY {
            sender
                .try_send(NativeSessionCommand::Input(format!("keystroke-{index}")))
                .expect("the queue accepts up to its capacity");
        }

        let overflow = sender
            .try_send(NativeSessionCommand::Input("one too many".to_string()))
            .expect_err("past capacity the queue must refuse, not grow");
        assert!(matches!(overflow, TrySendError::Full(_)));

        // Nothing already accepted was lost, and order is preserved.
        for index in 0..NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY {
            match receiver.recv().await.expect("queued input") {
                NativeSessionCommand::Input(data) => {
                    assert_eq!(data, format!("keystroke-{index}"));
                }
                _ => panic!("expected an Input command"),
            }
        }

        // And draining frees capacity again, so a stall that clears resumes.
        sender
            .try_send(NativeSessionCommand::Input("after drain".to_string()))
            .expect("capacity returns once the loop drains");
    }

    /// #205: Close is fire-and-forget and stays that way on a bounded channel.
    ///
    /// It is a promptness optimisation, not the shutdown guarantee. Dropping
    /// the sender disconnects the channel, and every session loop already
    /// treats a disconnected receiver as close — so a Close that cannot be
    /// queued still terminates the session.
    #[tokio::test]
    async fn a_dropped_sender_still_closes_a_session_whose_queue_is_full() {
        let (sender, mut receiver) =
            channel::<NativeSessionCommand>(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);
        for _ in 0..NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY {
            sender
                .try_send(NativeSessionCommand::Input("filler".to_string()))
                .expect("fill");
        }

        // The registry has already removed the handle at this point, so the
        // Close that cannot fit is discarded exactly as production discards it.
        assert!(matches!(
            sender.try_send(NativeSessionCommand::Close),
            Err(TrySendError::Full(_))
        ));
        drop(sender);

        // Drain what was queued, then observe the disconnect the loops act on.
        for _ in 0..NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY {
            receiver.recv().await.expect("queued filler");
        }
        assert!(
            receiver.recv().await.is_none(),
            "a dropped sender must surface as disconnect, which is what closes the loop"
        );
    }

    #[test]
    fn test_registry_insert_remove_leaves_no_orphan() {
        // create_backend_session now inserts the handle BEFORE spawning the loop
        // and removes it if a direct-SSH connect fails. Both that failure path
        // and every loop's remove-on-exit rely on the registry ending empty with
        // no orphaned handle, and on a racing double-remove being a harmless
        // no-op. This pins that invariant.
        let registry = NativeSessionRegistry::default();
        let (command_sender, _command_receiver) = channel(NATIVE_SESSION_COMMAND_CHANNEL_CAPACITY);
        insert_native_session(
            &registry,
            "s1",
            NativeSessionHandle {
                command_sender,
                host: minimal_ssh_host(),
                state: Arc::new(Mutex::new(NativeSessionState::default())),
            },
        );
        assert!(get_native_session(&registry, "s1").is_some());

        assert!(
            remove_native_session(&registry, "s1").is_some(),
            "the inserted handle should be removed"
        );
        assert!(
            get_native_session(&registry, "s1").is_none(),
            "no orphan should remain after remove"
        );
        // A second remove (a fast loop exit racing the failure cleanup) is safe.
        assert!(remove_native_session(&registry, "s1").is_none());
    }

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

    fn minimal_ssh_host() -> BackendHostConnection {
        BackendHostConnection {
            agent_forwarding: false,
            auth_method: "password".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "host.internal".to_string(),
            jump_host: None,
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATEST".to_string()),
            password: "pw".to_string(),
            passphrase: "".to_string(),
            port: 22,
            private_key_path: "".to_string(),
            protocol: "ssh".to_string(),
            sftp_root: None,
            username: "deploy".to_string(),
        }
    }

    #[test]
    fn copy_key_to_host_refuses_untrusted_host_before_connect() {
        // A requireTrusted host (the default policy) with no pinned key must be
        // refused by the top-of-function validate_ssh_host gate — returning Err
        // BEFORE any TCP connect or authentication, so the auth password never
        // reaches an unverified server. No network or key file is touched.
        let mut host = minimal_ssh_host();
        host.host_key_policy = None; // default => requireTrusted
        host.known_host_public_key = None; // no pinned key
        let request = CopyKeyToHostRequest {
            private_key_path: "~/.ssh/id_ed25519".to_string(),
            host,
        };
        let response = copy_key_to_host_blocking(&request, &throwaway_host_key_store("refusal"))
            .expect("returns a structured response, not Err");
        assert!(!response.ok, "the host must be refused");
    }

    #[test]
    fn copy_key_to_host_refuses_control_char_hostname() {
        // The same gate also blocks ssh_config injection via a newline in the
        // hostname before any connect.
        let mut host = minimal_ssh_host();
        host.hostname = "evil.com\n  ProxyCommand sh -c 'id'".to_string();
        let request = CopyKeyToHostRequest {
            private_key_path: "~/.ssh/id_ed25519".to_string(),
            host,
        };
        let response = copy_key_to_host_blocking(&request, &throwaway_host_key_store("refusal"))
            .expect("returns a structured response, not Err");
        assert!(!response.ok, "the host must be refused");
    }

    #[test]
    fn validate_ssh_host_rejects_control_chars_blocking_config_injection() {
        // A newline in hostname/username would inject OpenSSH directives
        // (ProxyCommand/LocalCommand → local RCE) into the generated ssh_config.
        let mut host = minimal_ssh_host();
        host.hostname = "evil.com\n  ProxyCommand sh -c 'id'".to_string();
        assert!(validate_ssh_host(&host).is_err());

        let mut host = minimal_ssh_host();
        host.username = "deploy\n  LocalCommand id".to_string();
        assert!(validate_ssh_host(&host).is_err());

        // A clean host still validates.
        assert!(validate_ssh_host(&minimal_ssh_host()).is_ok());
    }

    #[test]
    fn validate_mosh_host_requires_trusted_key_by_default() {
        let mut host = minimal_ssh_host();
        host.protocol = "mosh".to_string();

        // requireTrusted (default) + no pinned key → rejected (no accept-new TOFU).
        host.known_host_public_key = None;
        host.known_host_algorithm = None;
        assert!(validate_mosh_host(&host).is_err());

        // With a pinned key → ok.
        host.known_host_public_key = Some("AAAATEST".to_string());
        host.known_host_algorithm = Some("ssh-ed25519".to_string());
        assert!(validate_mosh_host(&host).is_ok());

        // Explicit allowUnknown opts the host out → ok without a key.
        host.known_host_public_key = None;
        host.known_host_algorithm = None;
        host.host_key_policy = Some("allowUnknown".to_string());
        assert!(validate_mosh_host(&host).is_ok());
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
            detect_prompt_kind(b"Enter passphrase for key '/tmp/id_fixture_ed25519':"),
            Some(PromptResponseKind::Passphrase)
        );
        assert_eq!(
            detect_prompt_kind(b"Enter passphrase for key '/tmp/id_fixture_ed25519"),
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
        assert_eq!(
            resolve_remote_path("/srv/sftp", "uploads/../etc/passwd"),
            "/srv/sftp/etc/passwd"
        );
    }

    #[test]
    fn async_sftp_command_rejects_non_ssh_host_before_sftp_work() {
        let mut host = minimal_ssh_host();
        host.protocol = "telnet".to_string();

        let result = tauri::async_runtime::block_on(terminal_workspace_sftp_list_directory(
            SftpPathRequest {
                host,
                path: "../../etc/passwd".to_string(),
            },
        ));

        match result {
            Ok(_) => panic!("non-SSH SFTP host should be rejected"),
            Err(error) => assert_eq!(error, "Unsupported SSH transport protocol: telnet"),
        }
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
            // Mosh shares SSH's host-key trust gate: a trusted-by-default host
            // needs a pinned key to validate (no accept-new TOFU at connect).
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATESTOPS".to_string()),
            ..telnet_host.clone()
        };

        assert!(should_use_native_session(&telnet_host));
        assert!(should_use_native_session(&serial_host));
        assert!(should_use_native_session(&mosh_host));
        assert!(validate_session_target(&telnet_host).is_ok());
        assert!(validate_session_target(&serial_host).is_ok());
        assert!(validate_session_target(&mosh_host).is_ok());
    }

    /// #152(a): telnet takes the hostname as a bare positional argument, so a
    /// hostname beginning with `-` reaches the client where it reads a flag.
    /// Against the pre-fix code this passes validation and `--version` would be
    /// handed to telnet as an option.
    #[test]
    fn rejects_a_telnet_hostname_that_would_read_as_a_flag() {
        let host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "none".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "--version".to_string(),
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

        let error = validate_session_target(&host)
            .expect_err("a leading-dash telnet hostname must be refused");
        assert!(error.contains("cannot start with"), "{error}");

        // A single dash is enough to be read as an option cluster.
        let short = BackendHostConnection {
            hostname: "-l".to_string(),
            ..host.clone()
        };
        assert!(validate_session_target(&short).is_err());

        // And an ordinary hostname is untouched — nothing legitimate starts
        // with a dash.
        let ordinary = BackendHostConnection {
            hostname: "legacy.internal".to_string(),
            ..host.clone()
        };
        assert!(validate_session_target(&ordinary).is_ok());

        // Serial is deliberately NOT covered by this rule: `screen` gets a `--`
        // separator instead, and `cu`'s shape (`-l <device>`) already consumes
        // the value as an argument rather than an option. Verified against the
        // installed cu: `cu -l --version -s 9600` reports "--version: Line in
        // use", i.e. it took it as a device name.
        let serial = BackendHostConnection {
            hostname: "-dev-oddly-named".to_string(),
            port: 115200,
            protocol: "serial".to_string(),
            ..host.clone()
        };
        assert!(validate_session_target(&serial).is_ok());
    }

    /// #152(a): the serial device is data even when its name begins with `-`,
    /// so the screen invocation must carry a `--` separator ahead of it.
    #[test]
    fn serial_screen_invocation_separates_options_from_the_device() {
        let host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "none".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "/dev/cu.usbserial-1410".to_string(),
            jump_host: None,
            known_host_algorithm: None,
            known_host_public_key: None,
            password: "".to_string(),
            passphrase: "".to_string(),
            port: 115200,
            private_key_path: "".to_string(),
            protocol: "serial".to_string(),
            sftp_root: None,
            username: "".to_string(),
        };

        let Ok(spec) = build_external_command_session_spec(&host, "test-serial-argv") else {
            // Neither screen nor cu installed — nothing to assert on this host.
            return;
        };
        let argv: Vec<String> = spec
            .command
            .get_argv()
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        // Which branch ran is decided by what is installed, so establish it from
        // argv[0] rather than assuming. `contains` not `ends_with`: the fixtures
        // point TERMSNIP_SCREEN_PATH at a `screen-fixture` stub, and an
        // ends_with guard silently matched neither branch — a test that no-ops
        // is worse than no test.
        let executable = argv.first().expect("argv always has the executable");
        let device = argv
            .iter()
            .position(|value| value == "/dev/cu.usbserial-1410")
            .expect("the device must be present in argv");

        if executable.contains("screen") {
            let separator = argv
                .iter()
                .position(|value| value == "--")
                .expect("screen must receive a -- separator before the device");
            assert!(
                separator < device,
                "the separator must precede the device: {argv:?}"
            );
        } else {
            // The cu branch: `-l <device>` already consumes the value as an
            // argument, so no separator is expected or wanted.
            assert!(
                executable.contains("cu"),
                "unexpected serial runtime: {argv:?}"
            );
            assert_eq!(
                argv.get(device - 1).map(String::as_str),
                Some("-l"),
                "{argv:?}"
            );
        }
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
    // #101: keychain round-trips hit the real macOS login keychain, which is
    // unreliable on a headless CI runner (the login keychain may be locked).
    // Ignored so routine PR validation is deterministic; run them on an
    // interactive machine with `cargo test -- --include-ignored`.
    #[ignore = "requires an interactive/unlocked macOS login keychain; flaky on headless CI"]
    fn keychain_secret_round_trip() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        // #274: same reason as the filesystem roots — pid is shared and the
        // clock is coarse, so the counter is what keeps concurrent tests from
        // sharing a keychain account.
        let seq = KEYCHAIN_ACCOUNT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let account = format!("termsnip-test-{}-{unique_suffix}-{seq}", process::id());
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
    #[ignore = "requires an interactive/unlocked macOS login keychain; flaky on headless CI"]
    fn keychain_key_passphrase_round_trip() {
        // Same shape as the per-host round-trip but exercises the new
        // fingerprint-keyed service so a regression in the constant or in
        // the per-fingerprint command path surfaces here. See
        // parity-and-hardening-plan.md P1-S5.
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let seq = KEYCHAIN_ACCOUNT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let fingerprint = format!(
            "SHA256:term-snip-test-{}-{unique_suffix}-{seq}",
            process::id()
        );
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
    #[ignore = "requires an interactive/unlocked macOS login keychain; flaky on headless CI"]
    fn keychain_identity_passphrase_round_trip() {
        // Same shape as the per-host and per-fingerprint round-trips,
        // exercising the new per-identity service introduced by P2-DM1
        // batch 3. Catches regressions in either the constant or the
        // command-level wrapper.
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let seq = KEYCHAIN_ACCOUNT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let identity_id = format!(
            "termsnip-identity-test-{}-{unique_suffix}-{seq}",
            process::id()
        );
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
