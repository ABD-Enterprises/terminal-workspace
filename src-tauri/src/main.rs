#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    process::{Command, Output},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, Method};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

const SESSION_STREAM_EVENT_NAME: &str = "termsnip://session-stream";
const KEYCHAIN_PASSWORD_SERVICE: &str = "com.termsnip.runtime.password";
const KEYCHAIN_PASSPHRASE_SERVICE: &str = "com.termsnip.runtime.passphrase";
static SESSION_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);

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

#[derive(Clone)]
enum SessionStreamCommand {
    Close,
    Send(String),
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

#[derive(Serialize, Deserialize)]
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
    request: CreateBackendSessionRequest,
) -> Result<CreateSessionResponse, String> {
    proxy_json(
        &bridge,
        Method::POST,
        "/api/backend/sessions",
        Some(serde_json::to_value(request).map_err(|error| error.to_string())?),
    )
    .await
}

#[tauri::command]
async fn termsnip_close_backend_session(
    bridge: State<'_, BackendBridge>,
    request: SessionIdRequest,
) -> Result<BackendBooleanResponse, String> {
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
    request: ResizeBackendSessionRequest,
) -> Result<BackendBooleanResponse, String> {
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
    request: SessionStreamRequest,
) -> Result<SessionStreamOpenResponse, String> {
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
    request: SessionStreamSendRequest,
) -> Result<BackendBooleanResponse, String> {
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
    request: SessionStreamRequest,
) -> Result<BackendBooleanResponse, String> {
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
