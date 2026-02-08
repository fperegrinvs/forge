use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

// This module is intentionally "API-only" for now and may not be referenced by the
// current desktop app yet. The crate is built with `#![deny(warnings)]`, so keep
// unused items quiet until the UI hooks them up.
#[allow(dead_code)]
/// Phase gate bindings stored under `.forge/phase-gates.json` in a workspace.
///
/// JSON shape (transparent map):
///
/// ```json
/// {
///   "phaseA": "scripts/phaseA.sh",
///   "phaseB": null
/// }
/// ```
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PhaseGateBindings(pub BTreeMap<String, Option<PathBuf>>);

#[allow(dead_code)]
fn phase_gates_path(project_root: &Path) -> PathBuf {
  project_root.join(".forge").join("phase-gates.json")
}

/// Reads `.forge/phase-gates.json` for the given `project_root`.
///
/// If the file does not exist (or is empty/whitespace), returns an empty map.
#[allow(dead_code)]
pub fn read_phase_gates(project_root: &Path) -> Result<PhaseGateBindings, String> {
  let path = phase_gates_path(project_root);
  if !path.exists() {
    return Ok(PhaseGateBindings::default());
  }

  let raw = fs::read_to_string(&path)
    .map_err(|error| format!("read phase gates {:?}: {error}", path))?;
  if raw.trim().is_empty() {
    return Ok(PhaseGateBindings::default());
  }

  serde_json::from_str::<PhaseGateBindings>(&raw)
    .map_err(|error| format!("parse phase gates JSON {:?}: {error}", path))
}

/// Writes `.forge/phase-gates.json` for the given `project_root`.
#[allow(dead_code)]
pub fn write_phase_gates(project_root: &Path, bindings: &PhaseGateBindings) -> Result<(), String> {
  let forge_dir = project_root.join(".forge");
  fs::create_dir_all(&forge_dir).map_err(|error| format!("mkdir {:?}: {error}", forge_dir))?;

  let path = phase_gates_path(project_root);
  let tmp_path = path.with_extension("json.tmp");

  let mut json = serde_json::to_string_pretty(bindings)
    .map_err(|error| format!("serialize phase gates JSON {:?}: {error}", path))?;
  json.push('\n');

  fs::write(&tmp_path, json)
    .map_err(|error| format!("write phase gates temp file {:?}: {error}", tmp_path))?;

  // Best-effort cross-platform replace.
  if path.exists() {
    let _ = fs::remove_file(&path);
  }
  fs::rename(&tmp_path, &path)
    .map_err(|error| format!("commit phase gates file {:?}: {error}", path))?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_project_root(prefix: &str) -> PathBuf {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{}", std::process::id(), now))
  }

  #[test]
  fn read_phase_gates_missing_returns_empty() {
    let root = temp_project_root("forge-test-phase-gates-missing");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let bindings = read_phase_gates(&root).unwrap();
    assert!(bindings.0.is_empty());

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn write_then_read_round_trips() {
    let root = temp_project_root("forge-test-phase-gates-roundtrip");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let mut map: BTreeMap<String, Option<PathBuf>> = BTreeMap::new();
    map.insert("phaseA".to_string(), Some(PathBuf::from("scripts/phaseA.sh")));
    map.insert("phaseB".to_string(), None);
    let bindings = PhaseGateBindings(map);

    write_phase_gates(&root, &bindings).unwrap();
    let reread = read_phase_gates(&root).unwrap();
    assert_eq!(reread, bindings);

    let _ = fs::remove_dir_all(&root);
  }
}
