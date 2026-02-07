#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;

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
    external_run_id: Option<String>,
    resume_command: Option<String>,
    message: String,
}

#[tauri::command]
fn plan_validate(file_path: String) -> ValidationResult {
    let content = fs::read_to_string(file_path);

    match content {
        Ok(raw) => {
            let parsed = serde_json::from_str::<serde_json::Value>(&raw);
            match parsed {
                Ok(value) => {
                    let valid = value.get("tasks").and_then(|tasks| tasks.as_array()).is_some();
                    if valid {
                        ValidationResult {
                            valid: true,
                            issues: Vec::new(),
                        }
                    } else {
                        ValidationResult {
                            valid: false,
                            issues: vec![ValidationIssue {
                                path: "/tasks".into(),
                                message: "Missing tasks array".into(),
                                code: "schema".into(),
                            }],
                        }
                    }
                }
                Err(_) => ValidationResult {
                    valid: false,
                    issues: vec![ValidationIssue {
                        path: "/".into(),
                        message: "Invalid JSON".into(),
                        code: "schema".into(),
                    }],
                },
            }
        }
        Err(_) => ValidationResult {
            valid: false,
            issues: vec![ValidationIssue {
                path: "/".into(),
                message: "Plan file not found".into(),
                code: "schema".into(),
            }],
        },
    }
}

#[tauri::command]
fn run_next(plan_path: String, adapter: String) -> RunNextResult {
    RunNextResult {
        state: "completed".into(),
        task_id: Some("task-1".into()),
        external_run_id: None,
        resume_command: None,
        message: format!("Run Next called for {} with adapter {}", plan_path, adapter),
    }
}

#[tauri::command]
fn pause_run(_run_id: String) -> bool {
    true
}

#[tauri::command]
fn resume_run(_run_id: String) -> bool {
    true
}

#[tauri::command]
fn get_evidence(task_id: String) -> Vec<String> {
    vec![format!("evidence-for-{}", task_id)]
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            plan_validate,
            run_next,
            pause_run,
            resume_run,
            get_evidence
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
