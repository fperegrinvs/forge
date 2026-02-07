use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

fn resolve_forge_bin_from_resources(app: &AppHandle) -> Option<PathBuf> {
  let resource_dir = app.path().resource_dir().ok()?;

  let candidates = if cfg!(windows) {
    vec![
      resource_dir.join("forge.exe"),
      resource_dir.join("bin").join("forge.exe"),
    ]
  } else {
    vec![resource_dir.join("forge"), resource_dir.join("bin").join("forge")]
  };

  candidates.into_iter().find(|path: &PathBuf| path.exists())
}

fn resolve_forge_command(app: &AppHandle) -> (PathBuf, Vec<String>) {
  if let Ok(value) = std::env::var("FORGE_DESKTOP_FORGE_BIN") {
    return (PathBuf::from(value), vec![]);
  }

  if let Ok(entry) = std::env::var("FORGE_DESKTOP_FORGE_ENTRY_JS") {
    let node = std::env::var("FORGE_DESKTOP_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    return (PathBuf::from(node), vec![entry]);
  }

  if let Some(bin) = resolve_forge_bin_from_resources(app) {
    return (bin, vec![]);
  }

  // Fall back to PATH.
  (PathBuf::from("forge"), vec![])
}

pub fn run_forge_json(app: &AppHandle, cwd: &Path, args: &[String]) -> Result<serde_json::Value, String> {
  let (bin, base_args) = resolve_forge_command(app);
  let output = Command::new(&bin)
    .current_dir(cwd)
    .args(base_args)
    .args(args)
    .output()
    .map_err(|error| format!("failed to start forge command {bin:?}: {error}"))?;

  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();

  if !output.status.success() {
    // The CLI uses exit code 2 for structured failures (e.g. validation failed)
    // where stdout still contains valid JSON with the result details.
    // Try to parse stdout first; only return an error if stdout isn't valid JSON.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stdout) {
      return Ok(value);
    }
    return Err(format!(
      "forge command failed (status={:?}). stderr: {}",
      output.status.code(),
      stderr.trim()
    ));
  }

  serde_json::from_str::<serde_json::Value>(&stdout)
    .map_err(|error| format!("forge did not return valid JSON: {error}. stdout: {}", stdout.trim()))
}
