use axum::{
    extract::{ws::{Message, WebSocket}, Path as AxumPath, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use tower_http::services::ServeDir;

use crate::forge_cli::run_forge_json;
use crate::packs::{compute_update_status, download_and_install_pack, fetch_packs_index, merge_bundled_packs, read_bundled_packs, read_installed_packs};
use crate::terminal::TerminalManager;

#[derive(Clone)]
struct ServerState {
    app: AppHandle,
    frontend_dist: PathBuf,
    bundled_packs_dir: Option<PathBuf>,
    terminal: TerminalManager,
}

fn resolve_bundled_packs_dir(app: &AppHandle) -> Option<PathBuf> {
    // Dev: the guidance pack source is at packages/guidance-pack/src/assets/pack/manifest.json.
    // read_bundled_packs expects a dir whose subdirectories each contain manifest.json,
    // so we return the assets/ dir (which contains the "pack" subdirectory).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/guidance-pack/src/assets");
    if dev.join("pack").join("manifest.json").exists() {
        return Some(dev);
    }

    // Prod: check Tauri resource directory for bundled-packs/ (mapped in tauri.conf.json).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("bundled-packs");
        if bundled.exists() {
            return Some(bundled);
        }
    }

    None
}

fn resolve_frontend_dist_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("FORGE_DESKTOP_FRONTEND_DIST") {
        let path = PathBuf::from(value);
        if !path.join("index.html").exists() {
            return Err(format!(
                "FORGE_DESKTOP_FRONTEND_DIST is set but index.html is missing at {}",
                path.to_string_lossy()
            ));
        }
        return Ok(path);
    }

    // Dev: `apps/desktop/dist` relative to `apps/desktop/src-tauri`.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if cfg!(debug_assertions) {
        return Ok(dev);
    }

    // Prod: dist should be present inside the app bundle resources.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve resource dir: {error}"))?;

    let candidates = vec![resource_dir.clone(), resource_dir.join("dist")];
    for candidate in candidates {
        if candidate.join("index.html").exists() {
            return Ok(candidate);
        }
    }

    Err("could not resolve frontend dist directory (missing index.html)".to_string())
}

pub fn port() -> u16 {
    std::env::var("FORGE_DESKTOP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(1420)
}

fn api_error(status: StatusCode, message: impl Into<String>) -> (StatusCode, String) {
    (status, message.into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanValidateRequest {
    project_root: String,
    plan_path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationIssue {
    path: String,
    message: String,
    code: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidationResult {
    valid: bool,
    issues: Vec<ValidationIssue>,
}

async fn plan_validate(
    State(state): State<ServerState>,
    Json(body): Json<PlanValidateRequest>,
) -> Result<Json<ValidationResult>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(body.project_root);
        let args = vec![
            "plan".to_string(),
            "validate".to_string(),
            "--file".to_string(),
            body.plan_path,
            "--json".to_string(),
        ];

        let value = run_forge_json(&app, &cwd, &args)?;
        let valid = value.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
        let issues = value
            .get("issues")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(ValidationIssue {
                            path: item.get("path")?.as_str()?.to_string(),
                            message: item.get("message")?.as_str()?.to_string(),
                            code: item.get("code")?.as_str()?.to_string(),
                        })
                    })
                    .collect::<Vec<ValidationIssue>>()
            })
            .unwrap_or_default();

        Ok::<_, String>(ValidationResult { valid, issues })
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunNextRequest {
    project_root: String,
    plan_path: String,
    adapter: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunNextResult {
    state: String,
    task_id: Option<String>,
    run_id: Option<String>,
    external_run_id: Option<String>,
    resume_command: Option<String>,
    message: String,
}

async fn run_next(
    State(state): State<ServerState>,
    Json(body): Json<RunNextRequest>,
) -> Result<Json<RunNextResult>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(body.project_root);
        let args = vec![
            "run".to_string(),
            "next".to_string(),
            "--plan".to_string(),
            body.plan_path,
            "--adapter".to_string(),
            body.adapter,
            "--json".to_string(),
        ];

        let value = run_forge_json(&app, &cwd, &args)?;
        Ok::<_, String>(RunNextResult {
            state: value
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("failed")
                .to_string(),
            task_id: value.get("taskId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            run_id: value.get("runId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            external_run_id: value
                .get("externalRunId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            resume_command: value
                .get("resumeCommand")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            message: value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Run next")
                .to_string(),
        })
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeRunRequest {
    project_root: String,
    plan_path: String,
    run_id: String,
    adapter: String,
}

async fn resume_run(
    State(state): State<ServerState>,
    Json(body): Json<ResumeRunRequest>,
) -> Result<Json<RunNextResult>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(body.project_root);
        let args = vec![
            "run".to_string(),
            "resume".to_string(),
            "--plan".to_string(),
            body.plan_path,
            "--run-id".to_string(),
            body.run_id,
            "--adapter".to_string(),
            body.adapter,
            "--json".to_string(),
        ];

        let value = run_forge_json(&app, &cwd, &args)?;
        Ok::<_, String>(RunNextResult {
            state: value
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("failed")
                .to_string(),
            task_id: value.get("taskId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            run_id: value.get("runId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            external_run_id: value
                .get("externalRunId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            resume_command: value
                .get("resumeCommand")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            message: value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Resume")
                .to_string(),
        })
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceQuery {
    project_root: String,
    task_id: String,
}

async fn get_evidence(
    Query(query): Query<EvidenceQuery>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let evidence_root = PathBuf::from(query.project_root).join(".forge").join("evidence");
        if !evidence_root.exists() {
            return Ok::<_, String>(vec![]);
        }
        let index_path = evidence_root.join("index.json");
        let raw = std::fs::read_to_string(index_path).unwrap_or_else(|_| "[]".to_string());
        let parsed = serde_json::from_str::<serde_json::Value>(&raw)
            .unwrap_or_else(|_| serde_json::Value::Array(vec![]));
        let mut result = vec![];
        if let Some(items) = parsed.as_array() {
            for item in items {
                let item_task = item.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                if item_task != query.task_id {
                    continue;
                }
                if let Some(dir) = item.get("dir").and_then(|v| v.as_str()) {
                    result.push(dir.to_string());
                }
            }
        }
        Ok::<_, String>(result)
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectGuidanceStatusQuery {
    project_root: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuidanceManifest {
    name: Option<String>,
    version: Option<String>,
    workflow_policy_version: Option<String>,
    workflow_policy_hash: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectGuidanceStatus {
    installed: bool,
    manifest: Option<GuidanceManifest>,
}

async fn project_get_guidance_status(
    Query(query): Query<ProjectGuidanceStatusQuery>,
) -> Result<Json<ProjectGuidanceStatus>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(query.project_root).join("manifest.json");
        if !path.exists() {
            return Ok::<_, String>(ProjectGuidanceStatus {
                installed: false,
                manifest: None,
            });
        }
        let raw =
            std::fs::read_to_string(path).map_err(|error| format!("read manifest.json: {error}"))?;
        let value = serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|error| format!("parse manifest.json: {error}"))?;

        Ok::<_, String>(ProjectGuidanceStatus {
            installed: true,
            manifest: Some(GuidanceManifest {
                name: value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                version: value
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                workflow_policy_version: value
                    .get("workflow_policy_version")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                workflow_policy_hash: value
                    .get("workflow_policy_hash")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            }),
        })
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

async fn packs_list_installed(
    State(state): State<ServerState>,
) -> Result<Json<Vec<crate::packs::InstalledPack>>, (StatusCode, String)> {
    let app = state.app.clone();
    let bundled_dir = state.bundled_packs_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data dir: {error}"))?;
        let downloaded = read_installed_packs(&app_data)?;

        let bundled = match bundled_dir {
            Some(dir) => read_bundled_packs(&dir).unwrap_or_default(),
            None => vec![],
        };

        Ok::<_, String>(merge_bundled_packs(bundled, downloaded))
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

async fn packs_check_updates(
    State(state): State<ServerState>,
) -> Result<Json<Vec<crate::packs::PackUpdateStatus>>, (StatusCode, String)> {
    let app = state.app.clone();
    let bundled_dir = state.bundled_packs_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Fetch remote index; if offline, return empty update statuses gracefully.
        let index = match fetch_packs_index() {
            Ok(idx) => idx,
            Err(_) => return Ok::<_, String>(vec![]),
        };

        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data dir: {error}"))?;
        let downloaded = read_installed_packs(&app_data)?;
        let bundled = match bundled_dir {
            Some(dir) => read_bundled_packs(&dir).unwrap_or_default(),
            None => vec![],
        };
        let installed = merge_bundled_packs(bundled, downloaded);
        Ok::<_, String>(compute_update_status(&index, &installed))
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PacksDownloadRequest {
    pack_name: String,
    version: Option<String>,
}

async fn packs_download(
    State(state): State<ServerState>,
    Json(body): Json<PacksDownloadRequest>,
) -> Result<Json<crate::packs::InstalledPack>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data dir: {error}"))?;
        download_and_install_pack(&app_data, &body.pack_name, body.version.as_deref())
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInstallGuidanceRequest {
    project_root: String,
    pack_path: String,
    force_replace: bool,
}

async fn project_install_guidance(
    State(state): State<ServerState>,
    Json(body): Json<ProjectInstallGuidanceRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(body.project_root);
        let mut args = vec![
            "install-guidance".to_string(),
            "--source".to_string(),
            "path".to_string(),
            "--path".to_string(),
            body.pack_path,
            "--json".to_string(),
        ];
        if body.force_replace {
            args.push("--force-replace".to_string());
        }
        run_forge_json(&app, &cwd, &args)
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTemplate {
    id: String,
    name: String,
    description: String,
}

async fn list_templates() -> Json<Vec<ProjectTemplate>> {
    Json(vec![ProjectTemplate {
        id: "forge-template".to_string(),
        name: "Forge Template".to_string(),
        description: "Default project template with spec-driven workflow".to_string(),
    }])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInitRequest {
    parent_dir: String,
    project_name: String,
    template: Option<String>,
    #[serde(default)]
    skip_guidance: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInitResult {
    success: bool,
    project_root: Option<String>,
    message: Option<String>,
}

async fn project_init(
    State(state): State<ServerState>,
    Json(body): Json<ProjectInitRequest>,
) -> Result<Json<ProjectInitResult>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = PathBuf::from(&body.parent_dir).join(&body.project_name);
        let cwd = PathBuf::from(&body.parent_dir);
        let mut args = vec![
            "init".to_string(),
            body.project_name.clone(),
            "--json".to_string(),
        ];
        if let Some(ref template) = body.template {
            args.push("--template".to_string());
            args.push(template.clone());
        }
        if body.skip_guidance {
            args.push("--skip-guidance".to_string());
        }

        match run_forge_json(&app, &cwd, &args) {
            Ok(_) => Ok::<_, String>(ProjectInitResult {
                success: true,
                project_root: Some(project_root.to_string_lossy().to_string()),
                message: None,
            }),
            Err(error) => Ok(ProjectInitResult {
                success: false,
                project_root: None,
                message: Some(error),
            }),
        }
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectFolderResult {
    path: Option<String>,
}

async fn select_folder() -> Json<SelectFolderResult> {
    let result = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select Project Folder")
            .pick_folder()
    })
    .await
    .ok()
    .flatten();

    Json(SelectFolderResult {
        path: result.map(|p| p.to_string_lossy().to_string()),
    })
}

async fn pause_run(Json(_body): Json<serde_json::Value>) -> impl IntoResponse {
    // v1: pause is filesystem-mediated via the control-plane state; CLI pause isn't exposed yet.
    Json(true)
}

async fn terminal_spawn(
    State(state): State<ServerState>,
    Json(config): Json<crate::terminal::SpawnConfig>,
) -> Result<Json<crate::terminal::SpawnResult>, (StatusCode, String)> {
    let terminal = state.terminal.clone();
    tokio::task::spawn_blocking(move || {
        let session_id = terminal.spawn(config)?;
        Ok::<_, String>(crate::terminal::SpawnResult { session_id })
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join: {e}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn terminal_kill(
    State(state): State<ServerState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    state
        .terminal
        .kill(&id)
        .map(|()| Json(true))
        .map_err(|e| api_error(StatusCode::NOT_FOUND, e))
}

async fn terminal_resize(
    State(state): State<ServerState>,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<crate::terminal::ResizeRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    state
        .terminal
        .resize(&id, req.cols, req.rows)
        .map(|()| Json(true))
        .map_err(|e| api_error(StatusCode::NOT_FOUND, e))
}

async fn terminal_ws(
    State(state): State<ServerState>,
    AxumPath(id): AxumPath<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let terminal = state.terminal.clone();
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, terminal, id))
}

async fn handle_terminal_ws(socket: WebSocket, terminal: TerminalManager, id: String) {
    let (reader, writer) = match terminal.take_io(&id) {
        Ok(io) => io,
        Err(_) => return,
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();

    let (tx_to_ws, mut rx_to_ws) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let (tx_to_pty, rx_to_pty) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    // PTY reader → channel → WebSocket
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx_to_ws.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Channel → PTY writer
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut writer = writer;
        let mut rx = rx_to_pty;
        while let Some(data) = rx.blocking_recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    // Forward WebSocket messages → PTY stdin
    let ws_to_pty = async {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if tx_to_pty.send(text.into_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Binary(data) => {
                    if tx_to_pty.send(data.to_vec()).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };

    // Forward PTY stdout → WebSocket
    let pty_to_ws = async {
        while let Some(data) = rx_to_ws.recv().await {
            if ws_sender.send(Message::Binary(data)).await.is_err() {
                break;
            }
        }
    };

    tokio::select! {
        _ = ws_to_pty => {},
        _ = pty_to_ws => {},
    }
}

async fn spa_index(State(state): State<ServerState>) -> impl IntoResponse {
    let index_path = state.frontend_dist.join("index.html");
    match tokio::fs::read_to_string(index_path).await {
        Ok(html) => (
            StatusCode::OK,
            [("content-type", "text/html; charset=utf-8")],
            html,
        )
            .into_response(),
        Err(_) => (
            StatusCode::OK,
            [("content-type", "text/html; charset=utf-8")],
            format!(
                "<!doctype html><html><head><meta charset=\"utf-8\"><title>Forge Desktop</title></head><body><h1>Forge Desktop</h1><p>Frontend not built (index.html missing).</p><p><strong>Resolved dist:</strong> <code>{}</code></p><p>Run <code>bun run dev:singleport</code> in <code>apps/desktop</code>, or build once with <code>bun run --filter @forge/desktop build</code>.</p></body></html>",
                state.frontend_dist.to_string_lossy()
            ),
        )
            .into_response(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugStatus {
    port: u16,
    frontend_dist: String,
    index_exists: bool,
    assets_dir_exists: bool,
}

async fn debug_status(State(state): State<ServerState>) -> Json<DebugStatus> {
    let index_exists = state.frontend_dist.join("index.html").exists();
    let assets_dir_exists = state.frontend_dist.join("assets").is_dir();
    Json(DebugStatus {
        port: port(),
        frontend_dist: state.frontend_dist.to_string_lossy().to_string(),
        index_exists,
        assets_dir_exists,
    })
}

pub async fn serve(app: AppHandle) -> Result<(), String> {
    let frontend_dist = resolve_frontend_dist_dir(&app)?;

    let bundled_packs_dir = resolve_bundled_packs_dir(&app);

    let state = ServerState {
        app,
        frontend_dist: frontend_dist.clone(),
        bundled_packs_dir,
        terminal: TerminalManager::new(),
    };
    let api = Router::new()
        .route("/api/debug/status", get(debug_status))
        .route("/api/plan/validate", post(plan_validate))
        .route("/api/run/next", post(run_next))
        .route("/api/run/resume", post(resume_run))
        .route("/api/run/pause", post(pause_run))
        .route("/api/evidence", get(get_evidence))
        .route("/api/project/guidance-status", get(project_get_guidance_status))
        .route("/api/packs/installed", get(packs_list_installed))
        .route("/api/packs/updates", get(packs_check_updates))
        .route("/api/packs/download", post(packs_download))
        .route("/api/project/install-guidance", post(project_install_guidance))
        .route("/api/templates", get(list_templates))
        .route("/api/project/init", post(project_init))
        .route("/api/dialog/select-folder", get(select_folder))
        .route("/api/terminal/spawn", post(terminal_spawn))
        .route("/api/terminal/:id", delete(terminal_kill))
        .route("/api/terminal/:id/resize", post(terminal_resize))
        .route("/api/terminal/:id/ws", get(terminal_ws))
        .with_state(state.clone());

    let assets_dir = frontend_dist.join("assets");
    let assets = Router::new().nest_service("/assets", ServeDir::new(assets_dir));

    tokio::spawn(state.terminal.clone().run_cleanup_loop());

    let app = Router::new()
        .merge(api)
        .merge(assets)
        .fallback(get(spa_index))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port()));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("bind http server {addr}: {error}"))?;

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("http server failed: {error}"))
}
