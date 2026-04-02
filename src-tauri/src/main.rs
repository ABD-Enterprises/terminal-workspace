#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::{Client, Method};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

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
    environment: Option<std::collections::HashMap<String, String>>,
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

#[derive(Deserialize)]
struct RawBackendStatusResponse {
    ok: bool,
}

#[derive(Deserialize)]
struct BackendErrorBody {
    error: Option<String>,
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
    let response = proxy_json::<RawBackendStatusResponse>(
        &bridge,
        Method::GET,
        "/api/backend/status",
        None,
    )
    .await?;

    Ok(BackendStatusResponse {
        ok: response.ok,
        backend_base_url: bridge.base_url.clone(),
        transport: "tauri-proxy",
    })
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

fn main() {
    tauri::Builder::default()
        .manage(BackendBridge::new())
        .invoke_handler(tauri::generate_handler![
            termsnip_transport_info,
            termsnip_backend_status,
            termsnip_create_backend_session,
            termsnip_close_backend_session,
            termsnip_resize_backend_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
