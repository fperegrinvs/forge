#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod forge_cli;
mod packs;
mod http_server;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;
use tauri::WebviewWindowBuilder;

use crate::forge_cli::run_forge_json;
use crate::packs::{compute_update_status, download_and_install_pack, fetch_packs_index, read_installed_packs};

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

#[tauri::command(rename_all = "camelCase")]
async fn plan_validate(
    app: tauri::AppHandle,
    project_root: String,
    plan_path: String
) -> Result<ValidationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Delegate to the Forge CLI sidecar for real validation (schema + graph + workflow).
        let cwd = PathBuf::from(project_root);
        let args = vec![
            "plan".to_string(),
            "validate".to_string(),
            "--file".to_string(),
            plan_path,
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

        Ok(ValidationResult { valid, issues })
    })
    .await
    .map_err(|error| format!("plan_validate task join failed: {error:?}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn run_next(
    app: tauri::AppHandle,
    project_root: String,
    plan_path: String,
    adapter: String
) -> Result<RunNextResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(project_root);
        let args = vec![
            "run".to_string(),
            "next".to_string(),
            "--plan".to_string(),
            plan_path,
            "--adapter".to_string(),
            adapter,
            "--json".to_string(),
        ];

        let value = run_forge_json(&app, &cwd, &args)?;
        Ok(RunNextResult {
            state: value.get("state").and_then(|v| v.as_str()).unwrap_or("failed").to_string(),
            task_id: value.get("taskId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            run_id: value.get("runId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            external_run_id: value.get("externalRunId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            resume_command: value.get("resumeCommand").and_then(|v| v.as_str()).map(|s| s.to_string()),
            message: value.get("message").and_then(|v| v.as_str()).unwrap_or("Run next").to_string(),
        })
    })
    .await
    .map_err(|error| format!("run_next task join failed: {error:?}"))?
}

#[tauri::command(rename_all = "camelCase")]
fn pause_run(_run_id: String) -> bool {
    // v1: pause is filesystem-mediated via the control-plane state; CLI pause isn't exposed yet.
    true
}

#[tauri::command(rename_all = "camelCase")]
async fn resume_run(
    app: tauri::AppHandle,
    project_root: String,
    plan_path: String,
    run_id: String,
    adapter: String
) -> Result<RunNextResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(project_root);
        let args = vec![
            "run".to_string(),
            "resume".to_string(),
            "--plan".to_string(),
            plan_path,
            "--run-id".to_string(),
            run_id,
            "--adapter".to_string(),
            adapter,
            "--json".to_string(),
        ];

        let value = run_forge_json(&app, &cwd, &args)?;
        Ok(RunNextResult {
            state: value.get("state").and_then(|v| v.as_str()).unwrap_or("failed").to_string(),
            task_id: value.get("taskId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            run_id: value.get("runId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            external_run_id: value.get("externalRunId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            resume_command: value.get("resumeCommand").and_then(|v| v.as_str()).map(|s| s.to_string()),
            message: value.get("message").and_then(|v| v.as_str()).unwrap_or("Resume").to_string(),
        })
    })
    .await
    .map_err(|error| format!("resume_run task join failed: {error:?}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn get_evidence(project_root: String, task_id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let evidence_root = PathBuf::from(project_root).join(".forge").join("evidence");
        if !evidence_root.exists() {
            return Ok(vec![]);
        }
        let index_path = evidence_root.join("index.json");
        let raw = fs::read_to_string(index_path).unwrap_or_else(|_| "[]".to_string());
        let parsed = serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_else(|_| serde_json::Value::Array(vec![]));
        let mut result = vec![];
        if let Some(items) = parsed.as_array() {
            for item in items {
                let item_task = item.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                if item_task != task_id {
                    continue;
                }
                if let Some(dir) = item.get("dir").and_then(|v| v.as_str()) {
                    result.push(dir.to_string());
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| format!("get_evidence task join failed: {error:?}"))?
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

#[tauri::command(rename_all = "camelCase")]
async fn project_get_guidance_status(project_root: String) -> Result<ProjectGuidanceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(project_root).join("manifest.json");
        if !path.exists() {
            return Ok(ProjectGuidanceStatus { installed: false, manifest: None });
        }
        let raw = fs::read_to_string(path).map_err(|error| format!("read manifest.json: {error}"))?;
        let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| format!("parse manifest.json: {error}"))?;

        Ok(ProjectGuidanceStatus {
            installed: true,
            manifest: Some(GuidanceManifest {
                name: value.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                version: value.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()),
                workflow_policy_version: value.get("workflow_policy_version").and_then(|v| v.as_str()).map(|s| s.to_string()),
                workflow_policy_hash: value.get("workflow_policy_hash").and_then(|v| v.as_str()).map(|s| s.to_string()),
            }),
        })
    })
    .await
    .map_err(|error| format!("project_get_guidance_status join failed: {error:?}"))?
}

#[tauri::command]
async fn packs_list_installed(app: tauri::AppHandle) -> Result<Vec<crate::packs::InstalledPack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app.path().app_data_dir().map_err(|error| format!("resolve app data dir: {error}"))?;
        read_installed_packs(&app_data)
    })
    .await
    .map_err(|error| format!("packs_list_installed join failed: {error:?}"))?
}

#[tauri::command]
async fn packs_check_updates(app: tauri::AppHandle) -> Result<Vec<crate::packs::PackUpdateStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let index = fetch_packs_index()?;
        let app_data = app.path().app_data_dir().map_err(|error| format!("resolve app data dir: {error}"))?;
        let installed = read_installed_packs(&app_data)?;
        Ok(compute_update_status(&index, &installed))
    })
    .await
    .map_err(|error| format!("packs_check_updates join failed: {error:?}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn packs_download(
    app: tauri::AppHandle,
    pack_name: String,
    version: Option<String>
) -> Result<crate::packs::InstalledPack, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app.path().app_data_dir().map_err(|error| format!("resolve app data dir: {error}"))?;
        download_and_install_pack(&app_data, &pack_name, version.as_deref())
    })
    .await
    .map_err(|error| format!("packs_download join failed: {error:?}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn project_install_guidance(
    app: tauri::AppHandle,
    project_root: String,
    pack_path: String,
    force_replace: bool
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = PathBuf::from(project_root);
        let mut args = vec![
            "install-guidance".to_string(),
            "--source".to_string(),
            "path".to_string(),
            "--path".to_string(),
            pack_path,
            "--json".to_string(),
        ];
        if force_replace {
            args.push("--force-replace".to_string());
        }
        run_forge_json(&app, &cwd, &args)
    })
    .await
    .map_err(|error| format!("project_install_guidance join failed: {error:?}"))?
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let http_port = crate::http_server::port();
            let window_config = app
                .config()
                .app
                .windows
                .get(0)
                .cloned()
                .ok_or_else(|| "missing app.windows[0] in tauri.conf.json".to_string())?;

            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::http_server::serve(handle).await {
                    eprintln!("forge desktop http server failed: {error}");
                }
            });

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait briefly for the server to bind before creating the main window.
                for _ in 0..60 {
                    if tokio::net::TcpStream::connect(("127.0.0.1", http_port)).await.is_ok() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }

                if handle.get_webview_window(&window_config.label).is_some() {
                    return;
                }

                if let Err(error) = WebviewWindowBuilder::from_config(&handle, &window_config)
                    .and_then(|builder| builder.build())
                {
                    eprintln!("failed to create main window: {error}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            plan_validate,
            run_next,
            pause_run,
            resume_run,
            get_evidence,
            project_get_guidance_status,
            packs_list_installed,
            packs_check_updates,
            packs_download,
            project_install_guidance
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
