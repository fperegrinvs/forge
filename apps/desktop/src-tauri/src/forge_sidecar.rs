use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

fn resolve_sidecar_bin_from_resources(app: &AppHandle) -> Option<PathBuf> {
  let resource_dir = app.path().resource_dir().ok()?;
  let candidates = vec![
    resource_dir.join("sidecar").join("entry.js"),
    resource_dir.join("sidecar-entry.js"),
    resource_dir.join("entry.js"),
  ];
  candidates.into_iter().find(|path| path.exists())
}

fn resolve_sidecar_command(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
  if let Ok(value) = std::env::var("FORGE_DESKTOP_SIDECAR_BIN") {
    return Ok((PathBuf::from(value), vec![]));
  }

  if let Ok(entry) = std::env::var("FORGE_DESKTOP_SIDECAR_ENTRY_JS") {
    let node = std::env::var("FORGE_DESKTOP_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    return Ok((PathBuf::from(node), vec![entry]));
  }

  if let Some(entry) = resolve_sidecar_bin_from_resources(app) {
    let node = std::env::var("FORGE_DESKTOP_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    return Ok((PathBuf::from(node), vec![entry.to_string_lossy().to_string()]));
  }

  Err("Unable to resolve Forge sidecar entry. Set FORGE_DESKTOP_SIDECAR_ENTRY_JS.".to_string())
}

fn augmented_path() -> String {
  let current = std::env::var("PATH").unwrap_or_default();
  let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
  // GUI apps on macOS don't inherit the user's shell PATH.
  // Prepend common tool directories so gate scripts can find bun, cargo, etc.
  let extras = [
    format!("{home}/.bun/bin"),
    format!("{home}/.cargo/bin"),
    format!("{home}/.local/bin"),
    "/usr/local/bin".to_string(),
  ];
  let mut parts: Vec<String> = extras
    .into_iter()
    .filter(|p| std::path::Path::new(p).is_dir())
    .collect();
  if !current.is_empty() {
    parts.push(current);
  }
  parts.join(":")
}

pub fn run_sidecar_json(
  app: &AppHandle,
  cwd: &Path,
  request: &serde_json::Value,
) -> Result<serde_json::Value, String> {
  let (bin, base_args) = resolve_sidecar_command(app)?;
  let mut child = Command::new(&bin)
    .current_dir(cwd)
    .env("PATH", augmented_path())
    .args(base_args)
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .spawn()
    .map_err(|error| format!("failed to start sidecar command {bin:?}: {error}"))?;

  let line = format!("{}\n", request);
  child
    .stdin
    .as_mut()
    .ok_or_else(|| "child stdin missing".to_string())?
    .write_all(line.as_bytes())
    .map_err(|error| format!("failed to write to sidecar stdin: {error}"))?;

  let output = child
    .wait_with_output()
    .map_err(|error| format!("failed to wait for sidecar: {error}"))?;

  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();

  if !output.status.success() {
    // Sidecar uses exit code 2 for structured failures where stdout still contains valid JSON.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stdout) {
      return Ok(value);
    }
    return Err(format!(
      "sidecar command failed (status={:?}). stderr: {}",
      output.status.code(),
      stderr.trim()
    ));
  }

  serde_json::from_str::<serde_json::Value>(&stdout)
    .map_err(|error| format!("sidecar did not return valid JSON: {error}. stdout: {}", stdout.trim()))
}

pub fn spawn_sidecar_stream_with_env(
  app: &AppHandle,
  cwd: &Path,
  extra_env: &[(&str, &str)],
) -> Result<tokio::process::Child, String> {
  let (bin, base_args) = resolve_sidecar_command(app)?;
  let mut cmd = tokio::process::Command::new(&bin);
  cmd.current_dir(cwd)
    .env("PATH", augmented_path())
    .args(base_args)
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

  for (k, v) in extra_env {
    cmd.env(k, v);
  }

  cmd.spawn()
    .map_err(|error| format!("failed to spawn sidecar command {bin:?}: {error}"))
}

