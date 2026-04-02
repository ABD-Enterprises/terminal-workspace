#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    env,
    fs,
    io::{self, Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Output},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use reqwest::{Client, Method};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use ssh2::{Channel, Session};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{error::TryRecvError, unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

const SESSION_STREAM_EVENT_NAME: &str = "termsnip://session-stream";
const KEYCHAIN_PASSWORD_SERVICE: &str = "com.termsnip.runtime.password";
const KEYCHAIN_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.passphrase";
const DEFAULT_TERMINAL_COLS: u16 = 120;
const DEFAULT_TERMINAL_ROWS: u16 = 36;
const DEFAULT_TERMINAL_PIXEL_WIDTH: u16 = DEFAULT_TERMINAL_COLS * 8;
const DEFAULT_TERMINAL_PIXEL_HEIGHT: u16 = DEFAULT_TERMINAL_ROWS * 16;
const NATIVE_SESSION_READ_CHUNK_SIZE: usize = 4096;
const NATIVE_SESSION_PROMPT_WINDOW_SIZE: usize = 512;
const NATIVE_SESSION_POLL_INTERVAL_MS: u64 = 10;
const NATIVE_SESSION_BUFFER_LIMIT: usize = 128;
static SESSION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct BackendBridge {
    base_url: String,
    client: Client,
}

impl BackendBridge {
    fn new() -> Self {
        let base_url = std::env::var("TERMSNIP_BACKEND_BASE_URL").unwrap_or_else(|_| {
            let port = std::env::var("TERMSNIP_BACKEND_PORT").unwrap_or_else(|_| "8790".to_string());
            format!("http://127.0.0.1:{port}")
        });

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: Client::new(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn ws_url(&self, path: &str) -> String {
        let prefix = if self.base_url.starts_with("https://") {
            self.base_url.replacen("https://", "wss://", 1)
        } else {
            self.base_url.replacen("http://", "ws://", 1)
        };

        format!("{prefix}{path}")
    }
}

#[derive(Clone)]
struct SessionStreamBridge {
    sender: UnboundedSender<SessionStreamCommand>,
    stream_id: String,
}

#[derive(Clone, Default)]
struct SessionStreamRegistry {
    bridges: Arc<Mutex<HashMap<String, SessionStreamBridge>>>,
}

#[derive(Clone, Default)]
struct NativeSessionRegistry {
    sessions: Arc<Mutex<HashMap<String, NativeSessionHandle>>>,
}

#[derive(Clone)]
enum SessionStreamCommand {
    Close,
    Send(String),
}

#[derive(Clone)]
struct NativeSessionHandle {
    command_sender: UnboundedSender<NativeSessionCommand>,
    state: Arc<Mutex<NativeSessionState>>,
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendHostConnection {
    agent_forwarding: bool,
    auth_method: String,
    environment: Option<HashMap<String, String>>,
    hostname: String,
    jump_host: Option<Box<BackendHostConnection>>,
    known_host_algorithm: Option<String>,
    known_host_public_key: Option<String>,
    password: String,
    passphrase: String,
    port: u16,
    private_key_path: String,
    sftp_root: Option<String>,
    username: String,
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendBooleanResponse {
    ok: bool,
    pending: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendProxyRequest {
    body: Option<Value>,
    method: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendBinaryProxyResponse {
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

#[derive(Deserialize)]
struct RawBackendStatusResponse {
    ok: bool,
}

#[derive(Deserialize)]
struct BackendErrorBody {
    error: Option<String>,
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

fn extract_backend_error(status: reqwest::StatusCode, body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<BackendErrorBody>(body) {
        if let Some(error) = parsed.error {
            return error;
        }
    }

    if body.trim().is_empty() {
        format!("Backend request failed with status {status}")
    } else {
        body.to_string()
    }
}

fn parse_backend_method(value: &str) -> Result<Method, String> {
    Method::from_bytes(value.as_bytes()).map_err(|error| error.to_string())
}

fn expand_home(pathname: &str) -> PathBuf {
    if let Some(stripped) = pathname.strip_prefix("~/") {
        if let Some(home_dir) = env::var_os("HOME") {
            return PathBuf::from(home_dir).join(stripped);
        }
    }

    PathBuf::from(pathname)
}

fn is_valid_environment_key(value: &str) -> bool {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }

    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn get_channel_environment(
    environment: &Option<HashMap<String, String>>,
) -> Option<Vec<(String, String)>> {
    let environment = environment.as_ref()?;
    let entries = environment
        .iter()
        .filter(|(key, _)| is_valid_environment_key(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();

    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn encode_session_message(message_type: &str, payload: Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("type".to_string(), Value::String(message_type.to_string()));
    if let Value::Object(fields) = payload {
        object.extend(fields);
    }
    Value::Object(object).to_string()
}

fn escape_shell_value(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\"'\"'"#))
}

fn build_environment_export_prefix(environment: &Option<HashMap<String, String>>) -> String {
    get_channel_environment(environment)
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| format!("export {key}={}", escape_shell_value(&value)))
        .collect::<Vec<_>>()
        .join("; ")
}

fn build_interactive_shell_command(environment: &Option<HashMap<String, String>>) -> Option<String> {
    let export_prefix = build_environment_export_prefix(environment);
    if export_prefix.is_empty() {
        None
    } else {
        Some(format!(r#"{export_prefix}; exec "${{SHELL:-/bin/sh}}" -l"#))
    }
}

fn known_hosts_host_pattern(host: &BackendHostConnection) -> String {
    if host.port == 22 {
        host.hostname.clone()
    } else {
        format!("[{}]:{}", host.hostname, host.port)
    }
}

fn append_connection_chain<'a>(host: &'a BackendHostConnection, chain: &mut Vec<&'a BackendHostConnection>) {
    if let Some(jump_host) = host.jump_host.as_deref() {
        append_connection_chain(jump_host, chain);
    }

    chain.push(host);
}

fn build_connection_chain(host: &BackendHostConnection) -> Vec<&BackendHostConnection> {
    let mut chain = Vec::new();
    append_connection_chain(host, &mut chain);
    chain
}

fn build_ssh_host_alias(index: usize, last_index: usize) -> String {
    if index == last_index {
        "termsnip-target".to_string()
    } else {
        format!("termsnip-hop-{index}")
    }
}

fn build_prompt_responses(host: &BackendHostConnection) -> Vec<PromptResponse> {
    let mut responses = Vec::new();

    for connection in build_connection_chain(host) {
        if connection.auth_method == "privateKey" && !connection.passphrase.is_empty() {
            responses.push(PromptResponse {
                kind: PromptResponseKind::Passphrase,
                value: connection.passphrase.clone(),
            });
        }

        if connection.auth_method == "password" && !connection.password.is_empty() {
            responses.push(PromptResponse {
                kind: PromptResponseKind::Password,
                value: connection.password.clone(),
            });
        }
    }

    responses
}

fn detect_prompt_kind(buffer: &str) -> Option<PromptResponseKind> {
    let lowercase = buffer.to_ascii_lowercase();

    if lowercase.contains("enter passphrase for key") || lowercase.contains("passphrase for key") {
        return Some(PromptResponseKind::Passphrase);
    }

    if lowercase.contains("password:") {
        return Some(PromptResponseKind::Password);
    }

    None
}

fn take_prompt_response(
    responses: &mut Vec<PromptResponse>,
    kind: PromptResponseKind,
) -> Option<PromptResponse> {
    let index = responses.iter().position(|response| response.kind == kind)?;
    Some(responses.remove(index))
}

fn create_jump_ssh_session_dir(session_id: &str) -> Result<PathBuf, String> {
    let directory = env::temp_dir().join(format!("termsnip-native-jump-{session_id}"));
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn write_jump_session_known_hosts(
    host: &BackendHostConnection,
    session_dir: &PathBuf,
) -> Result<PathBuf, String> {
    let known_hosts_path = session_dir.join("known_hosts");
    let mut entries = Vec::new();

    for connection in build_connection_chain(host) {
        if let (Some(algorithm), Some(public_key)) = (
            connection.known_host_algorithm.as_ref(),
            connection.known_host_public_key.as_ref(),
        ) {
            entries.push(format!(
                "{} {} {}",
                known_hosts_host_pattern(connection),
                algorithm,
                public_key
            ));
        }
    }

    fs::write(&known_hosts_path, entries.join("\n")).map_err(|error| error.to_string())?;
    Ok(known_hosts_path)
}

fn build_jump_session_config(
    host: &BackendHostConnection,
    session_dir: &PathBuf,
    known_hosts_path: &PathBuf,
) -> Result<(PathBuf, String), String> {
    let config_path = session_dir.join("ssh_config");
    let chain = build_connection_chain(host);
    let last_index = chain.len().saturating_sub(1);
    let jump_aliases = chain
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != last_index)
        .map(|(index, _)| build_ssh_host_alias(index, last_index))
        .collect::<Vec<_>>();
    let target_alias = build_ssh_host_alias(last_index, last_index);
    let mut lines = Vec::new();

    for (index, connection) in chain.iter().enumerate() {
        let alias = build_ssh_host_alias(index, last_index);
        lines.push(format!("Host {alias}"));
        lines.push(format!("  HostName {}", connection.hostname));
        lines.push(format!("  User {}", connection.username));
        lines.push(format!("  Port {}", connection.port));
        lines.push("  RequestTTY force".to_string());
        lines.push("  LogLevel ERROR".to_string());
        lines.push("  BatchMode no".to_string());
        lines.push("  ServerAliveInterval 15".to_string());
        lines.push("  ServerAliveCountMax 3".to_string());
        lines.push("  GlobalKnownHostsFile /dev/null".to_string());
        lines.push(format!(
            "  UserKnownHostsFile {}",
            known_hosts_path.to_string_lossy()
        ));

        if connection.known_host_public_key.is_some() && connection.known_host_algorithm.is_some() {
            lines.push("  StrictHostKeyChecking yes".to_string());
        } else {
            lines.push("  StrictHostKeyChecking no".to_string());
        }

        if connection.agent_forwarding {
            lines.push("  ForwardAgent yes".to_string());
        } else {
            lines.push("  ForwardAgent no".to_string());
        }

        match connection.auth_method.as_str() {
            "privateKey" => {
                lines.push(format!(
                    "  IdentityFile {}",
                    expand_home(&connection.private_key_path).to_string_lossy()
                ));
                lines.push("  IdentitiesOnly yes".to_string());
                lines.push("  PreferredAuthentications publickey".to_string());
            }
            "password" => {
                lines.push("  PubkeyAuthentication no".to_string());
                lines.push("  PreferredAuthentications keyboard-interactive,password".to_string());
                lines.push("  NumberOfPasswordPrompts 1".to_string());
            }
            _ => {}
        }

        if index == last_index && !jump_aliases.is_empty() {
            lines.push(format!("  ProxyJump {}", jump_aliases.join(",")));
        }

        lines.push(String::new());
    }

    fs::write(&config_path, lines.join("\n")).map_err(|error| error.to_string())?;
    Ok((config_path, target_alias))
}

fn trim_security_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches(['\n', '\r'])
        .to_string()
}

fn format_security_error(output: &Output) -> String {
    let stderr = trim_security_output(&output.stderr);
    if stderr.is_empty() {
        format!("security exited with status {}", output.status)
    } else {
        stderr
    }
}

fn security_record_missing(output: &Output) -> bool {
    output.status.code() == Some(44) || format_security_error(output).contains("could not be found")
}

fn run_security_command(args: &[&str]) -> Result<Output, String> {
    Command::new("/usr/bin/security")
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run macOS security CLI: {error}"))
}

fn load_keychain_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    let output = run_security_command(&["find-generic-password", "-a", account, "-s", service, "-w"])?;
    if output.status.success() {
        return Ok(Some(trim_security_output(&output.stdout)));
    }

    if security_record_missing(&output) {
        return Ok(None);
    }

    Err(format_security_error(&output))
}

fn delete_keychain_secret(service: &str, account: &str) -> Result<(), String> {
    let output = run_security_command(&["delete-generic-password", "-a", account, "-s", service])?;
    if output.status.success() || security_record_missing(&output) {
        return Ok(());
    }

    Err(format_security_error(&output))
}

fn store_keychain_secret(service: &str, account: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return delete_keychain_secret(service, account);
    }

    let output = run_security_command(&[
        "add-generic-password",
        "-a",
        account,
        "-s",
        service,
        "-w",
        value,
        "-U",
    ])?;
    if output.status.success() {
        return Ok(());
    }

    Err(format_security_error(&output))
}

fn emit_session_stream_event(app: &AppHandle, event: SessionStreamEvent) {
    let _ = app.emit(SESSION_STREAM_EVENT_NAME, event);
}

fn get_session_stream(registry: &SessionStreamRegistry, session_id: &str) -> Option<SessionStreamBridge> {
    registry
        .bridges
        .lock()
        .expect("session stream registry lock poisoned")
        .get(session_id)
        .cloned()
}

fn insert_session_stream(
    registry: &SessionStreamRegistry,
    session_id: &str,
    bridge: SessionStreamBridge,
) {
    registry
        .bridges
        .lock()
        .expect("session stream registry lock poisoned")
        .insert(session_id.to_string(), bridge);
}

fn remove_session_stream_if_current(
    registry: &SessionStreamRegistry,
    session_id: &str,
    stream_id: &str,
) -> Option<SessionStreamBridge> {
    let mut registry = registry
        .bridges
        .lock()
        .expect("session stream registry lock poisoned");

    match registry.get(session_id) {
        Some(active_bridge) if active_bridge.stream_id == stream_id => registry.remove(session_id),
        _ => None,
    }
}

fn get_native_session(registry: &NativeSessionRegistry, session_id: &str) -> Option<NativeSessionHandle> {
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

fn remove_native_session(registry: &NativeSessionRegistry, session_id: &str) -> Option<NativeSessionHandle> {
    registry
        .sessions
        .lock()
        .expect("native session registry lock poisoned")
        .remove(session_id)
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
    host.auth_method != "none"
}

fn validate_session_host(host: &BackendHostConnection) -> Result<(), String> {
    if host.hostname.trim().is_empty() || host.username.trim().is_empty() || host.port == 0 {
        return Err("Missing host connection fields".to_string());
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

    Ok(())
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
    let mut channel = session.channel_session().map_err(|error| error.to_string())?;
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
    let tcp_stream = TcpStream::connect((host.hostname.as_str(), host.port))
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
    let mut writer = writer
        .lock()
        .expect("jump session writer lock poisoned");
    writer
        .write_all(input.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn resize_jump_session_pty(master: &mut Box<dyn MasterPty + Send>, cols: u16, rows: u16) -> Result<(), String> {
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
                        let Some(response) = take_prompt_response(&mut prompt_responses, kind) else {
                            break;
                        };

                        if write_jump_session_input(&writer, &format!("{}\n", response.value)).is_err() {
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

fn run_jump_host_session_loop(
    app: AppHandle,
    registry: NativeSessionRegistry,
    session_id: String,
    state: Arc<Mutex<NativeSessionState>>,
    host: BackendHostConnection,
    mut receiver: UnboundedReceiver<NativeSessionCommand>,
) {
    let session_dir = match create_jump_ssh_session_dir(&session_id) {
        Ok(path) => path,
        Err(error) => {
            emit_native_session_error(&app, &session_id, &state, error);
            set_native_session_connection_state(&app, &session_id, &state, "error");
            set_native_session_connection_state(&app, &session_id, &state, "disconnected");
            return;
        }
    };

    let result = (|| -> Result<(), String> {
        let known_hosts_path = write_jump_session_known_hosts(&host, &session_dir)?;
        let (config_path, target_alias) =
            build_jump_session_config(&host, &session_dir, &known_hosts_path)?;
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

        spawn_jump_session_reader(reader, writer.clone(), build_prompt_responses(&host), output_sender);
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

async fn proxy_json<T: DeserializeOwned>(
    bridge: &BackendBridge,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<T, String> {
    let mut request = bridge.client.request(method, bridge.url(path));
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;

    if !status.is_success() {
        return Err(extract_backend_error(status, &text));
    }

    serde_json::from_str(&text).map_err(|error| error.to_string())
}

async fn proxy_binary(
    bridge: &BackendBridge,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<BackendBinaryProxyResponse, String> {
    let mut request = bridge.client.request(method, bridge.url(path));
    if let Some(body) = body {
        request = request.json(&body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.map_err(|error| error.to_string())?;
        return Err(extract_backend_error(status, &text));
    }

    let headers = response.headers().clone();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;

    Ok(BackendBinaryProxyResponse {
        base64_body: BASE64_STANDARD.encode(bytes),
        content_disposition: headers
            .get("content-disposition")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
        content_type: headers
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string()),
    })
}

#[tauri::command]
fn termsnip_transport_info(bridge: State<'_, BackendBridge>) -> BackendTransportInfo {
    BackendTransportInfo {
        backend_base_url: bridge.base_url.clone(),
        session_bridge: "tauri-proxy",
    }
}

#[tauri::command]
async fn termsnip_backend_status(
    bridge: State<'_, BackendBridge>,
) -> Result<BackendStatusResponse, String> {
    let response =
        proxy_json::<RawBackendStatusResponse>(&bridge, Method::GET, "/api/backend/status", None)
            .await?;

    Ok(BackendStatusResponse {
        ok: response.ok,
        backend_base_url: bridge.base_url.clone(),
        transport: "tauri-proxy",
    })
}

#[tauri::command]
async fn termsnip_proxy_backend_json(
    bridge: State<'_, BackendBridge>,
    request: BackendProxyRequest,
) -> Result<Value, String> {
    proxy_json(
        &bridge,
        parse_backend_method(&request.method)?,
        &request.path,
        request.body,
    )
    .await
}

#[tauri::command]
async fn termsnip_proxy_backend_binary(
    bridge: State<'_, BackendBridge>,
    request: BackendProxyRequest,
) -> Result<BackendBinaryProxyResponse, String> {
    proxy_binary(
        &bridge,
        parse_backend_method(&request.method)?,
        &request.path,
        request.body,
    )
    .await
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
        store_keychain_secret(KEYCHAIN_PASSWORD_SERVICE, &request.host_id, &request.password)?;
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

#[tauri::command]
async fn termsnip_create_backend_session(
    bridge: State<'_, BackendBridge>,
    native_sessions: State<'_, NativeSessionRegistry>,
    app: AppHandle,
    request: CreateBackendSessionRequest,
) -> Result<CreateSessionResponse, String> {
    validate_session_host(&request.host)?;

    if !should_use_native_session(&request.host) {
        return proxy_json(
            &bridge,
            Method::POST,
            "/api/backend/sessions",
            Some(serde_json::to_value(request).map_err(|error| error.to_string())?),
        )
        .await;
    }

    let session_id = next_native_session_id();
    let state = Arc::new(Mutex::new(NativeSessionState {
        buffered_messages: Vec::new(),
        connection_state: "connecting".to_string(),
        stream_id: None,
    }));
    let native_registry = native_sessions.inner().clone();
    let host = request.host;
    let app_handle = app.clone();
    let session_id_for_thread = session_id.clone();
    let state_for_thread = state.clone();
    let command_sender = if host.jump_host.is_some() {
        let (command_sender, command_receiver) = unbounded_channel();
        let registry_for_thread = native_registry.clone();
        let thread_app = app_handle.clone();
        let thread_session_id = session_id_for_thread.clone();
        let thread_state = state_for_thread.clone();

        thread::spawn(move || {
            run_jump_host_session_loop(
                thread_app,
                registry_for_thread,
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
            let thread_app = app_handle.clone();
            let thread_session_id = session_id_for_thread.clone();
            let thread_state = state_for_thread.clone();

            thread::spawn(move || {
                run_native_session_loop(
                    thread_app,
                    registry_for_thread,
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
            state: state.clone(),
        },
    );
    set_native_session_connection_state(&app, &session_id, &state, "connected");

    Ok(CreateSessionResponse { session_id })
}

#[tauri::command]
async fn termsnip_close_backend_session(
    bridge: State<'_, BackendBridge>,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionIdRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(handle) = remove_native_session(native_sessions.inner(), &request.session_id) {
        let _ = handle.command_sender.send(NativeSessionCommand::Close);
        return Ok(BackendBooleanResponse {
            ok: true,
            pending: None,
        });
    }

    proxy_json(
        &bridge,
        Method::DELETE,
        &format!("/api/backend/sessions/{}", request.session_id),
        None,
    )
    .await
}

#[tauri::command]
async fn termsnip_resize_backend_session(
    bridge: State<'_, BackendBridge>,
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

    proxy_json(
        &bridge,
        Method::POST,
        &format!("/api/backend/sessions/{}/resize", request.session_id),
        Some(serde_json::to_value(request.payload).map_err(|error| error.to_string())?),
    )
    .await
}

#[tauri::command]
async fn termsnip_open_backend_session_stream(
    app: AppHandle,
    bridge: State<'_, BackendBridge>,
    registry: State<'_, SessionStreamRegistry>,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamRequest,
) -> Result<SessionStreamOpenResponse, String> {
    if get_native_session(native_sessions.inner(), &request.session_id).is_some() {
        return open_native_session_stream(&app, native_sessions.inner(), &request.session_id);
    }

    if let Some(active_bridge) = get_session_stream(&registry, &request.session_id) {
        return Ok(SessionStreamOpenResponse {
            ok: true,
            stream_id: active_bridge.stream_id,
        });
    }

    let stream_id = next_session_stream_id();
    let ws_url = bridge.ws_url(&format!("/ws/sessions/{}", request.session_id));
    let (backend_socket, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|error| error.to_string())?;
    let (sender, mut receiver) = unbounded_channel();

    insert_session_stream(
        &registry,
        &request.session_id,
        SessionStreamBridge {
            sender,
            stream_id: stream_id.clone(),
        },
    );

    let app_handle = app.clone();
    let registry_state = registry.inner().clone();
    let session_id = request.session_id.clone();
    let spawned_stream_id = stream_id.clone();

    tauri::async_runtime::spawn(async move {
        let (mut write, mut read) = backend_socket.split();

        loop {
            tokio::select! {
                maybe_command = receiver.recv() => match maybe_command {
                    Some(SessionStreamCommand::Send(data)) => {
                        if let Err(error) = write.send(Message::Text(data.into())).await {
                            emit_session_stream_event(
                                &app_handle,
                                SessionStreamEvent {
                                    data: None,
                                    kind: "error",
                                    message: Some(error.to_string()),
                                    session_id: session_id.clone(),
                                    stream_id: spawned_stream_id.clone(),
                                },
                            );
                            break;
                        }
                    }
                    Some(SessionStreamCommand::Close) | None => {
                        let _ = write.send(Message::Close(None)).await;
                        break;
                    }
                },
                maybe_message = read.next() => match maybe_message {
                    Some(Ok(Message::Text(text))) => {
                        emit_session_stream_event(
                            &app_handle,
                            SessionStreamEvent {
                                data: Some(text.to_string()),
                                kind: "message",
                                message: None,
                                session_id: session_id.clone(),
                                stream_id: spawned_stream_id.clone(),
                            },
                        );
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        match String::from_utf8(bytes.to_vec()) {
                            Ok(text) => emit_session_stream_event(
                                &app_handle,
                                SessionStreamEvent {
                                    data: Some(text),
                                    kind: "message",
                                    message: None,
                                    session_id: session_id.clone(),
                                    stream_id: spawned_stream_id.clone(),
                                },
                            ),
                            Err(error) => emit_session_stream_event(
                                &app_handle,
                                SessionStreamEvent {
                                    data: None,
                                    kind: "error",
                                    message: Some(error.to_string()),
                                    session_id: session_id.clone(),
                                    stream_id: spawned_stream_id.clone(),
                                },
                            ),
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = write.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        emit_session_stream_event(
                            &app_handle,
                            SessionStreamEvent {
                                data: None,
                                kind: "error",
                                message: Some(error.to_string()),
                                session_id: session_id.clone(),
                                stream_id: spawned_stream_id.clone(),
                            },
                        );
                        break;
                    }
                    None => {
                        break;
                    }
                }
            }
        }

        remove_session_stream_if_current(&registry_state, &session_id, &spawned_stream_id);
        emit_session_stream_event(
            &app_handle,
            SessionStreamEvent {
                data: None,
                kind: "close",
                message: None,
                session_id,
                stream_id: spawned_stream_id,
            },
        );
    });

    Ok(SessionStreamOpenResponse {
        ok: true,
        stream_id: stream_id,
    })
}

#[tauri::command]
fn termsnip_send_backend_session_stream(
    registry: State<'_, SessionStreamRegistry>,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamSendRequest,
) -> Result<BackendBooleanResponse, String> {
    if get_native_session(native_sessions.inner(), &request.session_id).is_some() {
        return send_native_session_stream(native_sessions.inner(), request);
    }

    let active_bridge = get_session_stream(&registry, &request.session_id)
        .ok_or_else(|| "Session stream not found".to_string())?;

    if active_bridge.stream_id != request.stream_id {
        return Err("Session stream is stale".to_string());
    }

    active_bridge
        .sender
        .send(SessionStreamCommand::Send(request.data))
        .map_err(|_| "Session stream is closed".to_string())?;

    Ok(BackendBooleanResponse {
        ok: true,
        pending: None,
    })
}

#[tauri::command]
fn termsnip_close_backend_session_stream(
    registry: State<'_, SessionStreamRegistry>,
    native_sessions: State<'_, NativeSessionRegistry>,
    request: SessionStreamRequest,
) -> Result<BackendBooleanResponse, String> {
    if let Some(response) = close_native_session_stream(native_sessions.inner(), request.clone()) {
        return Ok(response);
    }

    let bridge = match request.stream_id {
        Some(stream_id) => remove_session_stream_if_current(&registry, &request.session_id, &stream_id),
        None => get_session_stream(&registry, &request.session_id).and_then(|active_bridge| {
            remove_session_stream_if_current(&registry, &request.session_id, &active_bridge.stream_id)
        }),
    };

    if let Some(bridge) = bridge {
        let _ = bridge.sender.send(SessionStreamCommand::Close);
    }

    Ok(BackendBooleanResponse {
        ok: true,
        pending: None,
    })
}

fn main() {
    tauri::Builder::default()
        .manage(BackendBridge::new())
        .manage(SessionStreamRegistry::default())
        .manage(NativeSessionRegistry::default())
        .invoke_handler(tauri::generate_handler![
            termsnip_transport_info,
            termsnip_backend_status,
            termsnip_proxy_backend_json,
            termsnip_proxy_backend_binary,
            termsnip_load_host_secrets,
            termsnip_store_host_secrets,
            termsnip_clear_host_secrets,
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
mod tests {
    use super::*;
    use std::{
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn build_test_host_chain() -> BackendHostConnection {
        BackendHostConnection {
            agent_forwarding: true,
            auth_method: "password".to_string(),
            environment: Some(HashMap::from([("APP_ENV".to_string(), "production".to_string())])),
            hostname: "target.internal".to_string(),
            jump_host: Some(Box::new(BackendHostConnection {
                agent_forwarding: false,
                auth_method: "privateKey".to_string(),
                environment: None,
                hostname: "jump.internal".to_string(),
                jump_host: None,
                known_host_algorithm: Some("ssh-ed25519".to_string()),
                known_host_public_key: Some("AAAATESTJUMP".to_string()),
                password: "".to_string(),
                passphrase: "jump-passphrase".to_string(),
                port: 2222,
                private_key_path: "~/.ssh/jump".to_string(),
                sftp_root: None,
                username: "jump".to_string(),
            })),
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATESTTARGET".to_string()),
            password: "target-password".to_string(),
            passphrase: "".to_string(),
            port: 2223,
            private_key_path: "".to_string(),
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
    fn builds_known_hosts_patterns_for_nondefault_ports() {
        let host = build_test_host_chain();
        let chain = build_connection_chain(&host);

        assert_eq!(known_hosts_host_pattern(chain[0]), "[jump.internal]:2222");
        assert_eq!(known_hosts_host_pattern(chain[1]), "[target.internal]:2223");
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
}
