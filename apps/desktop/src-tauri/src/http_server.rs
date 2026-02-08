use axum::{
    extract::{ws::{Message, WebSocket}, Path as AxumPath, Query, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    response::sse::{Event, Sse},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::AppHandle;
use tauri::Manager;
use tower_http::services::ServeDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::forge_sidecar::{run_sidecar_json, spawn_sidecar_stream_with_env};
use crate::packs::{
    compute_update_status, download_and_install_pack, fetch_packs_index, merge_bundled_packs,
    read_bundled_packs, read_installed_packs, read_pack_content, PackContent,
};
use crate::phase_gates::{read_phase_gates, write_phase_gates, PhaseGateBindings};
use crate::terminal::TerminalManager;

#[derive(Clone)]
struct ServerState {
    app: AppHandle,
    frontend_dist: PathBuf,
    bundled_packs_dir: Option<PathBuf>,
    terminal: TerminalManager,
    run_streams: RunStreamHub,
}

#[derive(Clone, Default)]
struct RunStreamHub {
    inner: Arc<Mutex<HashMap<String, RunStreamControls>>>,
}

#[derive(Clone)]
struct RunStreamControls {
    input_tx: tokio::sync::mpsc::Sender<String>,
    cancel_tx: tokio::sync::watch::Sender<bool>,
}

impl RunStreamHub {
    fn insert(&self, id: String, controls: RunStreamControls) {
        let mut guard = self.inner.lock().expect("run streams lock poisoned");
        guard.insert(id, controls);
    }

    fn get(&self, id: &str) -> Option<RunStreamControls> {
        let guard = self.inner.lock().expect("run streams lock poisoned");
        guard.get(id).cloned()
    }

    fn remove(&self, id: &str) {
        let mut guard = self.inner.lock().expect("run streams lock poisoned");
        guard.remove(id);
    }
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

async fn write_start_command(stdin: &mut ChildStdin, start: &str) {
    let mut bytes = start.as_bytes().to_vec();
    if !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    let _ = stdin.write_all(&bytes).await;
    let _ = stdin.flush().await;
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanValidateRequest {
    project_root: String,
    plan_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanMigrateRequest {
    project_root: String,
    plan_path: String,
    #[serde(default)]
    write: bool,
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
        let request = serde_json::json!({
            "command": "plan.validate",
            "params": {
                "planPath": body.plan_path
            }
        });
        let value = run_sidecar_json(&app, &cwd, &request)?;
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

async fn plan_migrate(
    State(state): State<ServerState>,
    Json(body): Json<PlanMigrateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app = state.app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(body.project_root);
        let request = serde_json::json!({
            "command": "plan.migrate",
            "params": {
                "planPath": body.plan_path,
                "write": body.write
            }
        });
        run_sidecar_json(&app, &cwd, &request)
    })
    .await
    .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {error:?}")))?
    .map(Json)
    .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowAutoStreamQuery {
    project_root: String,
    plan_path: String,
    adapter: String,
    push: Option<bool>,
}

async fn workflow_auto_stream(
    State(state): State<ServerState>,
    Query(query): Query<WorkflowAutoStreamQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)>
{
    let stream_id = Uuid::new_v4().to_string();
    let (out_tx, out_rx) = tokio::sync::mpsc::channel::<String>(256);
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<String>(64);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel::<bool>(false);

    state.run_streams.insert(
        stream_id.clone(),
        RunStreamControls {
            input_tx,
            cancel_tx,
        },
    );

    let app = state.app.clone();
    let run_streams = state.run_streams.clone();
    tokio::spawn(async move {
        let _ = out_tx
            .send(
                serde_json::json!({
                    "type": "sse.meta",
                    "streamId": stream_id
                })
                .to_string(),
            )
            .await;

        let cwd = PathBuf::from(&query.project_root);
        let push_enabled = query.push != Some(false);
        let start = serde_json::json!({
            "command": "workflow.auto.stream",
            "params": {
                "planPath": query.plan_path,
                "adapter": query.adapter,
                "push": push_enabled
            }
        })
        .to_string();

        let mut child = match spawn_sidecar_stream_with_env(
            &app,
            &cwd,
            &[
                ("FORGE_INTERACTIVE", "1"),
                ("FORGE_DESKTOP", "1"),
            ],
        ) {
            Ok(c) => c,
            Err(error) => {
                let _ = out_tx
                    .send(
                        serde_json::json!({
                            "type": "sse.error",
                            "message": error
                        })
                        .to_string(),
                    )
                    .await;
                run_streams.remove(&stream_id);
                return;
            }
        };

        let mut stdin = match child.stdin.take() {
            Some(s) => s,
            None => {
                let _ = out_tx
                    .send(
                        serde_json::json!({
                            "type": "sse.error",
                            "message": "child stdin missing"
                        })
                        .to_string(),
                    )
                    .await;
                run_streams.remove(&stream_id);
                return;
            }
        };
        write_start_command(&mut stdin, &start).await;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut stdout_lines = stdout.map(|s| BufReader::new(s).lines());
        let mut stderr_lines = stderr.map(|s| BufReader::new(s).lines());

        let pid = child.id();
        let _ = out_tx
            .send(
                serde_json::json!({
                    "type": "process.spawned",
                    "pid": pid
                })
                .to_string(),
            )
            .await;

        loop {
            // Cancel takes precedence.
            if *cancel_rx.borrow() {
                let _ = child.start_kill();
                let _ = out_tx
                    .send(
                        serde_json::json!({
                            "type": "process.killed",
                        })
                        .to_string(),
                    )
                    .await;
                break;
            }

            tokio::select! {
                _ = cancel_rx.changed() => {
                    // Loop will observe borrow() and kill.
                }
                maybe_input = input_rx.recv() => {
                    if let Some(text) = maybe_input {
                        let mut bytes = text.into_bytes();
                        if !bytes.ends_with(b"\n") {
                            bytes.push(b'\n');
                        }
                        let _ = stdin.write_all(&bytes).await;
                        let _ = stdin.flush().await;
                    }
                }
                res = async {
                    if let Some(lines) = &mut stdout_lines {
                        lines.next_line().await
                    } else {
                        Ok(None)
                    }
                } => {
                    match res {
                        Ok(Some(text)) => {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let _ = out_tx.send(trimmed.to_string()).await;
                            }
                        }
                        Ok(None) => {
                            stdout_lines = None;
                        }
                        Err(error) => {
                            let _ = out_tx
                                .send(serde_json::json!({"type":"process.stdout_error","message": error.to_string()}).to_string())
                                .await;
                            stdout_lines = None;
                        }
                    }
                }
                res = async {
                    if let Some(lines) = &mut stderr_lines {
                        lines.next_line().await
                    } else {
                        Ok(None)
                    }
                } => {
                    match res {
                        Ok(Some(text)) => {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let _ = out_tx
                                    .send(serde_json::json!({"type":"process.stderr","line": trimmed}).to_string())
                                    .await;
                            }
                        }
                        Ok(None) => {
                            stderr_lines = None;
                        }
                        Err(error) => {
                            let _ = out_tx
                                .send(serde_json::json!({"type":"process.stderr_error","message": error.to_string()}).to_string())
                                .await;
                            stderr_lines = None;
                        }
                    }
                }
            }

            if stdout_lines.is_none() && stderr_lines.is_none() {
                break;
            }
        }

        let status = child.wait().await.ok();
        let code = status.as_ref().and_then(|s| s.code()).unwrap_or(-1);
        let _ = out_tx
            .send(
                serde_json::json!({
                    "type": "process.exit",
                    "code": code
                })
                .to_string(),
            )
            .await;

        run_streams.remove(&stream_id);
    });

    let stream = ReceiverStream::new(out_rx).map(|line| Ok(Event::default().data(line)));
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionStreamQuery {
    project_root: String,
    auto_skill: Option<String>,
}

async fn codex_session_stream(
    State(state): State<ServerState>,
    Query(query): Query<CodexSessionStreamQuery>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)>
{
    let stream_id = Uuid::new_v4().to_string();
    let (out_tx, out_rx) = tokio::sync::mpsc::channel::<String>(256);
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<String>(64);
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel::<bool>(false);

    state.run_streams.insert(
        stream_id.clone(),
        RunStreamControls {
            input_tx,
            cancel_tx,
        },
    );

    let app = state.app.clone();
    let run_streams = state.run_streams.clone();
    tokio::spawn(async move {
        let _ = out_tx
            .send(
                serde_json::json!({
                    "type": "sse.meta",
                    "streamId": stream_id
                })
                .to_string(),
            )
            .await;

        let cwd = PathBuf::from(&query.project_root);
        let start = serde_json::json!({
            "command": "codex.session.stream",
            "params": {
                "autoSkill": query.auto_skill.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty())
            }
        })
        .to_string();

        let mut child = match spawn_sidecar_stream_with_env(
            &app,
            &cwd,
            &[
                ("FORGE_INTERACTIVE", "1"),
                ("FORGE_DESKTOP", "1"),
            ],
        ) {
            Ok(c) => c,
            Err(error) => {
                let _ = out_tx
                    .send(
                        serde_json::json!({
                            "type": "sse.error",
                            "message": error
                        })
                        .to_string(),
                    )
                    .await;
                run_streams.remove(&stream_id);
                return;
            }
        };

        let mut stdin = match child.stdin.take() {
            Some(s) => s,
            None => {
                let _ = out_tx
                    .send(
                        serde_json::json!({
                            "type": "sse.error",
                            "message": "child stdin missing"
                        })
                        .to_string(),
                    )
                    .await;
                run_streams.remove(&stream_id);
                return;
            }
        };
        write_start_command(&mut stdin, &start).await;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut stdout_lines = stdout.map(|s| BufReader::new(s).lines());
        let mut stderr_lines = stderr.map(|s| BufReader::new(s).lines());

        let pid = child.id();
        let _ = out_tx
            .send(
                serde_json::json!({
                    "type": "process.spawned",
                    "pid": pid
                })
                .to_string(),
            )
            .await;

        loop {
            if *cancel_rx.borrow() {
                let _ = child.start_kill();
                let _ = out_tx
                    .send(serde_json::json!({ "type": "process.killed" }).to_string())
                    .await;
                break;
            }

            tokio::select! {
                _ = cancel_rx.changed() => {}
                maybe_input = input_rx.recv() => {
                    if let Some(text) = maybe_input {
                        let mut bytes = text.into_bytes();
                        if !bytes.ends_with(b"\\n") {
                            bytes.push(b'\n');
                        }
                        let _ = stdin.write_all(&bytes).await;
                        let _ = stdin.flush().await;
                    }
                }
                res = async {
                    if let Some(lines) = &mut stdout_lines {
                        lines.next_line().await
                    } else {
                        Ok(None)
                    }
                } => {
                    match res {
                        Ok(Some(text)) => {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let _ = out_tx.send(trimmed.to_string()).await;
                            }
                        }
                        Ok(None) => { stdout_lines = None; }
                        Err(error) => {
                            let _ = out_tx
                                .send(serde_json::json!({"type":"process.stdout_error","message": error.to_string()}).to_string())
                                .await;
                            stdout_lines = None;
                        }
                    }
                }
                res = async {
                    if let Some(lines) = &mut stderr_lines {
                        lines.next_line().await
                    } else {
                        Ok(None)
                    }
                } => {
                    match res {
                        Ok(Some(text)) => {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let _ = out_tx
                                    .send(serde_json::json!({"type":"process.stderr","line": trimmed}).to_string())
                                    .await;
                            }
                        }
                        Ok(None) => { stderr_lines = None; }
                        Err(error) => {
                            let _ = out_tx
                                .send(serde_json::json!({"type":"process.stderr_error","message": error.to_string()}).to_string())
                                .await;
                            stderr_lines = None;
                        }
                    }
                }
            }

            if stdout_lines.is_none() && stderr_lines.is_none() {
                break;
            }
        }

        let status = child.wait().await.ok();
        let code = status.as_ref().and_then(|s| s.code()).unwrap_or(-1);
        let _ = out_tx
            .send(serde_json::json!({ "type": "process.exit", "code": code }).to_string())
            .await;

        run_streams.remove(&stream_id);
    });

    let stream = ReceiverStream::new(out_rx).map(|line| Ok(Event::default().data(line)));
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowAutoPromptRespondRequest {
    stream_id: String,
    request_id: String,
    answers: serde_json::Value,
}

async fn workflow_auto_prompt_respond(
    State(state): State<ServerState>,
    Json(body): Json<WorkflowAutoPromptRespondRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let controls = state
        .run_streams
        .get(&body.stream_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "stream not found"))?;

    let line = serde_json::json!({
        "type": "user_input.response",
        "requestId": body.request_id,
        "answers": body.answers
    })
    .to_string();
    controls
        .input_tx
        .send(line)
        .await
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "stream input channel closed"))?;
    Ok(Json(true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowAutoStreamCancelRequest {
    stream_id: String,
}

async fn workflow_auto_stream_cancel(
    State(state): State<ServerState>,
    Json(body): Json<WorkflowAutoStreamCancelRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let controls = state
        .run_streams
        .get(&body.stream_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "stream not found"))?;
    controls
        .cancel_tx
        .send(true)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "stream cancel channel closed"))?;
    Ok(Json(true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionSendRequest {
    stream_id: String,
    text: String,
}

async fn codex_session_send(
    State(state): State<ServerState>,
    Json(body): Json<CodexSessionSendRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let controls = state
        .run_streams
        .get(&body.stream_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "stream not found"))?;
    controls
        .input_tx
        .send(body.text)
        .await
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "stream input channel closed"))?;
    Ok(Json(true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionPromptRespondRequest {
    stream_id: String,
    request_id: String,
    answers: serde_json::Value,
}

async fn codex_session_prompt_respond(
    State(state): State<ServerState>,
    Json(body): Json<CodexSessionPromptRespondRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let controls = state
        .run_streams
        .get(&body.stream_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "stream not found"))?;

    let line = serde_json::json!({
        "type": "user_input.response",
        "requestId": body.request_id,
        "answers": body.answers
    })
    .to_string();

    controls
        .input_tx
        .send(line)
        .await
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "stream input channel closed"))?;
    Ok(Json(true))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionCancelRequest {
    stream_id: String,
}

async fn codex_session_cancel(
    State(state): State<ServerState>,
    Json(body): Json<CodexSessionCancelRequest>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let controls = state
        .run_streams
        .get(&body.stream_id)
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "stream not found"))?;
    controls
        .cancel_tx
        .send(true)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "stream cancel channel closed"))?;
    Ok(Json(true))
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
struct GuidanceSourcePack {
    name: String,
    version: String,
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuidanceSource {
    installed_at: String,
    pack: GuidanceSourcePack,
    force_replace: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectGuidanceStatus {
    installed: bool,
    manifest: Option<GuidanceManifest>,
    source: Option<GuidanceSource>,
}

async fn project_get_guidance_status(
    Query(query): Query<ProjectGuidanceStatusQuery>,
) -> Result<Json<ProjectGuidanceStatus>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = {
            let source_path = PathBuf::from(&query.project_root)
                .join(".forge")
                .join("guidance.json");
            if source_path.exists() {
                std::fs::read_to_string(&source_path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<GuidanceSource>(&raw).ok())
            } else {
                None
            }
        };

        let path = PathBuf::from(query.project_root).join("manifest.json");
        if !path.exists() {
            return Ok::<_, String>(ProjectGuidanceStatus {
                installed: false,
                manifest: None,
                source,
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
            source,
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
struct PackContentQuery {
    pack_path: String,
}

async fn packs_get_content(
    Query(query): Query<PackContentQuery>,
) -> Result<Json<PackContent>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(query.pack_path);
        read_pack_content(&dir)
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
        let request = serde_json::json!({
            "command": "guidance.installFromPack",
            "params": {
                "packPath": body.pack_path,
                "forceReplace": body.force_replace
            }
        });
        run_sidecar_json(&app, &cwd, &request)
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
        let request = serde_json::json!({
            "command": "project.init",
            "params": {
                "projectName": body.project_name,
                "template": body.template,
                "skipGuidance": body.skip_guidance
            }
        });

        match run_sidecar_json(&app, &cwd, &request) {
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectFileResult {
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectFileQuery {
    project_root: String,
}

async fn select_file(
    Query(query): Query<SelectFileQuery>,
) -> Result<Json<SelectFileResult>, (StatusCode, String)> {
    let project_root = PathBuf::from(query.project_root);
    let result = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("Select Validation Script")
            .set_directory(project_root)
            .add_filter("Shell Script", &["sh"])
            .pick_file()
    })
    .await
    .ok()
    .flatten();

    Ok(Json(SelectFileResult {
        path: result.map(|p| p.to_string_lossy().to_string()),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhaseGatesQuery {
    project_root: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PhaseGatesResponse {
    phases: std::collections::BTreeMap<String, Option<String>>,
}

fn bindings_to_response(bindings: PhaseGateBindings) -> PhaseGatesResponse {
    let mut phases = std::collections::BTreeMap::new();
    for (phase, path) in bindings.0 {
        phases.insert(phase, path.map(|p| p.to_string_lossy().to_string()));
    }
    PhaseGatesResponse { phases }
}

async fn phase_gates_get(
    Query(query): Query<PhaseGatesQuery>,
) -> Result<Json<PhaseGatesResponse>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(query.project_root);
        let bindings = read_phase_gates(&root)?;
        Ok::<_, String>(bindings_to_response(bindings))
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {e:?}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhaseGatesPutRequest {
    project_root: String,
    phases: std::collections::BTreeMap<String, Option<String>>,
}

fn validate_relative_no_traversal(path: &std::path::Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err("script path must be relative to project root".to_string());
    }
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("script path must not contain '..'".to_string());
        }
    }
    Ok(())
}

async fn phase_gates_put(
    Json(body): Json<PhaseGatesPutRequest>,
) -> Result<Json<PhaseGatesResponse>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&body.project_root);

        let mut out: std::collections::BTreeMap<String, Option<PathBuf>> = std::collections::BTreeMap::new();
        for (phase, path) in body.phases {
            let normalized = match path {
                None => None,
                Some(raw) => {
                    if raw.trim_start().starts_with('~') {
                        return Err("script path must be project-relative (no '~')".to_string());
                    }
                    let candidate = PathBuf::from(raw);
                    if candidate.is_absolute() {
                        let rel = candidate
                            .strip_prefix(&root)
                            .map_err(|_| "selected script must be inside the project root".to_string())?
                            .to_path_buf();
                        validate_relative_no_traversal(&rel)?;
                        Some(rel)
                    } else {
                        validate_relative_no_traversal(&candidate)?;
                        Some(candidate)
                    }
                }
            };
            out.insert(phase, normalized);
        }

        let bindings = PhaseGateBindings(out);
        write_phase_gates(&root, &bindings)?;
        Ok::<_, String>(bindings_to_response(bindings))
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {e:?}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlansListQuery {
    project_root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanFileEntry {
    filename: String,
    path: String,
    modified_ms: u64,
}

fn list_plans(project_root: &str) -> Result<Vec<PlanFileEntry>, String> {
    let plans_dir = PathBuf::from(project_root).join("plans");
    if !plans_dir.exists() {
        return Ok(vec![]);
    }

    struct PlanWithTime {
        entry: PlanFileEntry,
        modified_ms: u64,
    }

    let mut entries: Vec<PlanWithTime> = Vec::new();
    let read_dir = std::fs::read_dir(&plans_dir)
        .map_err(|e| format!("read plans dir: {e}"))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let modified_ms = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        entries.push(PlanWithTime {
            entry: PlanFileEntry {
                filename,
                path: path.to_string_lossy().to_string(),
                modified_ms,
            },
            modified_ms,
        });
    }

    // Newest first, stable tie-breaker by filename.
    entries.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.entry.filename.cmp(&b.entry.filename))
    });

    Ok(entries.into_iter().map(|e| e.entry).collect())
}

async fn plans_list(
    Query(query): Query<PlansListQuery>,
) -> Result<Json<Vec<PlanFileEntry>>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        list_plans(&query.project_root)
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {e:?}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[cfg(test)]
mod plans_list_tests {
    use super::list_plans;
    use std::fs;
    use std::thread;
    use std::time::Duration;
    use uuid::Uuid;

    #[test]
    fn sorts_plans_by_modified_desc() {
        let root = std::env::temp_dir().join(format!("forge-desktop-plans-{}", Uuid::new_v4()));
        let plans_dir = root.join("plans");
        fs::create_dir_all(&plans_dir).unwrap();

        let a = plans_dir.join("a.json");
        let b = plans_dir.join("b.json");

        fs::write(&a, r#"{"name":"a"}"#).unwrap();
        // Ensure the filesystem sees distinct mtimes even on coarse-resolution filesystems.
        thread::sleep(Duration::from_millis(1200));
        fs::write(&b, r#"{"name":"b"}"#).unwrap();

        let entries = list_plans(root.to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].filename, "b.json");
        assert_eq!(entries[1].filename, "a.json");
        assert!(entries[0].modified_ms > entries[1].modified_ms);

        let _ = fs::remove_dir_all(&root);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanStatusQuery {
    project_root: String,
    plan_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatus {
    id: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanStatusResult {
    tasks: Vec<TaskStatus>,
}

async fn plans_status(
    Query(query): Query<PlanStatusQuery>,
) -> Result<Json<PlanStatusResult>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let plan_path = {
            let p = PathBuf::from(&query.plan_path);
            if p.is_absolute() {
                p
            } else {
                PathBuf::from(&query.project_root).join(p)
            }
        };
        if !plan_path.exists() {
            return Ok::<_, String>(PlanStatusResult { tasks: vec![] });
        }
        let raw = std::fs::read_to_string(&plan_path)
            .map_err(|e| format!("read plan: {e}"))?;
        let value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("parse plan: {e}"))?;

        let tasks_value = value.get("tasks");
        let mut tasks = Vec::new();
        if let Some(items) = tasks_value.and_then(|v| v.as_array()) {
            for item in items {
                let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if id.is_empty() {
                    continue;
                }
                let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("");
                let state = if status.trim().is_empty() { "pending" } else { status }.to_string();
                tasks.push(TaskStatus { id, state });
            }
        }
        tasks.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(PlanStatusResult { tasks })
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {e:?}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanReadQuery {
    plan_path: String,
}

async fn plans_read(
    Query(query): Query<PlanReadQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&query.plan_path);
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("read plan: {e}"))?;
        let value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("parse plan: {e}"))?;
        Ok::<_, String>(value)
    })
    .await
    .map_err(|e| api_error(StatusCode::INTERNAL_SERVER_ERROR, format!("join failed: {e:?}")))?
    .map(Json)
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
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
    if !terminal.session_exists(&id) {
        return api_error(StatusCode::NOT_FOUND, format!("session not found: {id}")).into_response();
    }
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, terminal, id))
}

async fn handle_terminal_ws(socket: WebSocket, terminal: TerminalManager, id: String) {
    eprintln!("terminal: ws attach {id}");
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Flush any output that happened before a WS receiver existed.
    // Loop to catch output generated while we are still flushing.
    for _ in 0..32 {
        let buffered = match terminal.drain_output_buffer(&id) {
            Ok(b) => b,
            Err(_) => return,
        };
        if buffered.is_empty() {
            break;
        }
        for chunk in buffered {
            if ws_sender.send(Message::Binary(chunk)).await.is_err() {
                return;
            }
        }
    }

    let attach = match terminal.attach(&id) {
        Ok(a) => a,
        Err(_) => return,
    };

    // Catch the small race window between final pre-flush and subscribe.
    if let Ok(buffered) = terminal.drain_output_buffer(&id) {
        for chunk in buffered {
            if ws_sender.send(Message::Binary(chunk)).await.is_err() {
                return;
            }
        }
    }

    // Forward WebSocket messages → PTY stdin
    let ws_to_pty = async {
        let input_tx = attach.input_tx;
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if input_tx.send(text.into_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Binary(data) => {
                    if input_tx.send(data.to_vec()).await.is_err() {
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
        let mut output_rx = attach.output_rx;
        loop {
            match output_rx.recv().await {
                Ok(data) => {
                    if ws_sender.send(Message::Binary(data)).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };

    tokio::select! {
        _ = ws_to_pty => {},
        _ = pty_to_ws => {},
    }

    eprintln!("terminal: ws detach {id}");
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

async fn get_cwd() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cwd = std::env::current_dir()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "cwd": cwd.to_string_lossy() })))
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
        run_streams: RunStreamHub::default(),
    };
    let api = Router::new()
        .route("/api/cwd", get(get_cwd))
        .route("/api/debug/status", get(debug_status))
        .route("/api/plan/validate", post(plan_validate))
        .route("/api/plan/migrate", post(plan_migrate))
        .route("/api/workflow/auto/stream", get(workflow_auto_stream))
        .route("/api/workflow/auto/prompt/respond", post(workflow_auto_prompt_respond))
        .route("/api/workflow/auto/cancel", post(workflow_auto_stream_cancel))
        .route("/api/codex/session/stream", get(codex_session_stream))
        .route("/api/codex/session/send", post(codex_session_send))
        .route("/api/codex/session/prompt/respond", post(codex_session_prompt_respond))
        .route("/api/codex/session/cancel", post(codex_session_cancel))
        .route("/api/evidence", get(get_evidence))
        .route("/api/project/guidance-status", get(project_get_guidance_status))
        .route("/api/packs/installed", get(packs_list_installed))
        .route("/api/packs/updates", get(packs_check_updates))
        .route("/api/packs/download", post(packs_download))
        .route("/api/packs/content", get(packs_get_content))
        .route("/api/project/install-guidance", post(project_install_guidance))
        .route("/api/templates", get(list_templates))
        .route("/api/project/init", post(project_init))
        .route("/api/plans/list", get(plans_list))
        .route("/api/plans/status", get(plans_status))
        .route("/api/plans/read", get(plans_read))
        .route("/api/dialog/select-folder", get(select_folder))
        .route("/api/dialog/select-file", get(select_file))
        .route("/api/phase-gates", get(phase_gates_get).put(phase_gates_put))
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
