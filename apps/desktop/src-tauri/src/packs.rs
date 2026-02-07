use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDescriptor {
  pub name: String,
  pub version: String,
  pub asset: String,
  pub sha256: String,
  #[serde(default)]
  pub workflow_policy_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PacksIndex {
  pub packs: Vec<PackDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
  pub name: String,
  pub version: String,
  pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackUpdateStatus {
  pub name: String,
  pub installed_version: Option<String>,
  pub latest_version: Option<String>,
  pub has_update: bool,
}

fn parse_semver(value: &str) -> Option<(u64, u64, u64)> {
  // Accept `x.y.z` and ignore prerelease/build metadata for now.
  let core = value.split('-').next()?.split('+').next()?;
  let mut parts = core.split('.');
  let major = parts.next()?.parse::<u64>().ok()?;
  let minor = parts.next()?.parse::<u64>().ok()?;
  let patch = parts.next()?.parse::<u64>().ok()?;
  Some((major, minor, patch))
}

fn newer_version(left: &str, right: &str) -> bool {
  match (parse_semver(left), parse_semver(right)) {
    (Some(l), Some(r)) => l > r,
    _ => left > right,
  }
}

pub fn packs_root(app_data_dir: &Path) -> PathBuf {
  app_data_dir.join("packs")
}

fn parse_repo_env() -> (String, String) {
  // `owner/repo` (default is intentionally generic; override in dev/prod).
  let value = std::env::var("FORGE_DESKTOP_PACKS_REPO").unwrap_or_else(|_| "forge/forge".to_string());
  let parts: Vec<&str> = value.split('/').collect();
  if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
    return (parts[0].to_string(), parts[1].to_string());
  }
  ("forge".to_string(), "forge".to_string())
}

pub fn packs_index_url() -> String {
  let (owner, repo) = parse_repo_env();
  format!(
    "https://github.com/{owner}/{repo}/releases/latest/download/packs-index.json"
  )
}

fn github_latest_asset_url(asset: &str) -> String {
  let (owner, repo) = parse_repo_env();
  format!(
    "https://github.com/{owner}/{repo}/releases/latest/download/{asset}"
  )
}

pub fn read_installed_packs(app_data_dir: &Path) -> Result<Vec<InstalledPack>, String> {
  let root = packs_root(app_data_dir);
  if !root.exists() {
    return Ok(vec![]);
  }

  let mut installed = vec![];
  let entries = fs::read_dir(&root).map_err(|error| format!("read packs dir: {error}"))?;
  for pack_entry in entries {
    let pack_entry = pack_entry.map_err(|error| format!("read packs dir entry: {error}"))?;
    if !pack_entry.file_type().map_err(|e| e.to_string())?.is_dir() {
      continue;
    }
    let pack_name = pack_entry.file_name().to_string_lossy().to_string();
    let versions = fs::read_dir(pack_entry.path()).map_err(|error| format!("read pack versions: {error}"))?;
    for version_entry in versions {
      let version_entry = version_entry.map_err(|error| format!("read version entry: {error}"))?;
      if !version_entry.file_type().map_err(|e| e.to_string())?.is_dir() {
        continue;
      }
      let version = version_entry.file_name().to_string_lossy().to_string();
      installed.push(InstalledPack {
        name: pack_name.clone(),
        version,
        path: version_entry.path().to_string_lossy().to_string(),
      });
    }
  }

  Ok(installed)
}

fn sha256_file(path: &Path) -> Result<String, String> {
  // macOS ships `shasum`. Avoid new Rust deps to keep builds offline-friendly.
  let output = Command::new("shasum")
    .args(["-a", "256", path.to_string_lossy().as_ref()])
    .output()
    .map_err(|error| format!("run shasum: {error}"))?;
  if !output.status.success() {
    return Err(format!(
      "shasum failed (status={:?}): {}",
      output.status.code(),
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let hash = stdout.split_whitespace().next().unwrap_or("").trim().to_string();
  if hash.len() != 64 {
    return Err(format!("unexpected shasum output: {}", stdout.trim()));
  }
  Ok(hash)
}

pub fn fetch_packs_index() -> Result<PacksIndex, String> {
  let url = packs_index_url();
  let output = Command::new("curl")
    .args(["-fsSL", "--connect-timeout", "15", "--max-time", "60", &url])
    .output()
    .map_err(|error| format!("fetch packs index via curl: {error}"))?;
  if !output.status.success() {
    return Err(format!(
      "curl packs index failed (status={:?}): {}",
      output.status.code(),
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  serde_json::from_slice::<PacksIndex>(&output.stdout)
    .map_err(|error| format!("parse packs index JSON: {error}"))
}

pub fn compute_update_status(index: &PacksIndex, installed: &[InstalledPack]) -> Vec<PackUpdateStatus> {
  let mut installed_latest: BTreeMap<String, String> = BTreeMap::new();
  for pack in installed {
    match installed_latest.get(&pack.name) {
      Some(existing) => {
        if newer_version(&pack.version, existing) {
          installed_latest.insert(pack.name.clone(), pack.version.clone());
        }
      }
      None => {
        installed_latest.insert(pack.name.clone(), pack.version.clone());
      }
    }
  }

  let mut latest_by_name: BTreeMap<String, String> = BTreeMap::new();
  for pack in &index.packs {
    match latest_by_name.get(&pack.name) {
      Some(existing) => {
        if newer_version(&pack.version, existing) {
          latest_by_name.insert(pack.name.clone(), pack.version.clone());
        }
      }
      None => {
        latest_by_name.insert(pack.name.clone(), pack.version.clone());
      }
    }
  }

  let mut names: Vec<String> = latest_by_name.keys().cloned().collect();
  names.sort();

  names
    .into_iter()
    .map(|name| {
      let installed_version = installed_latest.get(&name).cloned();
      let latest_version = latest_by_name.get(&name).cloned();
      let has_update = match (&installed_version, &latest_version) {
        (Some(i), Some(l)) => newer_version(l, i),
        (None, Some(_)) => true,
        _ => false,
      };
      PackUpdateStatus {
        name,
        installed_version,
        latest_version,
        has_update,
      }
    })
    .collect()
}

fn find_pack(index: &PacksIndex, name: &str, version: Option<&str>) -> Option<PackDescriptor> {
  let mut candidates: Vec<&PackDescriptor> = index.packs.iter().filter(|p| p.name == name).collect();
  if candidates.is_empty() {
    return None;
  }
  if let Some(version) = version {
    return candidates.into_iter().find(|p| p.version == version).cloned();
  }
  candidates.sort_by(|a, b| {
    match (parse_semver(&a.version), parse_semver(&b.version)) {
      (Some(av), Some(bv)) => av.cmp(&bv),
      _ => a.version.cmp(&b.version),
    }
  });
  candidates.last().cloned().cloned()
}

pub fn download_and_install_pack(app_data_dir: &Path, pack_name: &str, version: Option<&str>) -> Result<InstalledPack, String> {
  // Fetch index and resolve asset
  let index = fetch_packs_index()?;
  let pack = find_pack(&index, pack_name, version).ok_or_else(|| {
    format!(
      "pack not found in index: name={pack_name}{}",
      version.map(|v| format!(" version={v}")).unwrap_or_default()
    )
  })?;

  // Download archive to a temp file under app data dir
  let url = github_latest_asset_url(&pack.asset);
  let app_tmp = app_data_dir.join("tmp");
  fs::create_dir_all(&app_tmp).map_err(|error| format!("mkdir app tmp: {error}"))?;
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis();
  let ext = if pack.asset.ends_with(".zip") {
    "zip"
  } else if pack.asset.ends_with(".tar.gz") {
    "tar.gz"
  } else if pack.asset.ends_with(".tgz") {
    "tgz"
  } else {
    "bin"
  };
  let temp_path = app_tmp.join(format!("pack-{}-{}-{}.{}", pack_name, pack.version, now, ext));

  let status = Command::new("curl")
    .args(["-fsSL", "--connect-timeout", "15", "--max-time", "300", &url, "-o", temp_path.to_string_lossy().as_ref()])
    .status()
    .map_err(|error| format!("download pack archive via curl: {error}"))?;
  if !status.success() {
    let _ = fs::remove_file(&temp_path);
    return Err(format!("curl download failed (status={:?})", status.code()));
  }

  // Verify sha256
  let actual = sha256_file(&temp_path)?;
  let expected = pack.sha256.to_lowercase();
  if actual.to_lowercase() != expected {
    let _ = fs::remove_file(&temp_path);
    return Err(format!(
      "sha256 mismatch for {pack_name}@{}: expected={expected} actual={actual}",
      pack.version
    ));
  }

  // Extract to a staging directory inside the packs root, then move into place.
  let root = packs_root(app_data_dir);
  fs::create_dir_all(&root).map_err(|error| format!("mkdir packs root: {error}"))?;
  let staging = root.join(format!(
    ".staging-{}-{}-{}",
    pack_name,
    pack.version,
    std::process::id()
  ));
  if staging.exists() {
    fs::remove_dir_all(&staging).map_err(|error| format!("remove existing staging dir: {error}"))?;
  }
  fs::create_dir_all(&staging).map_err(|error| format!("mkdir staging dir: {error}"))?;

  let extract_result = if pack.asset.ends_with(".zip") {
    validate_zip_archive(&temp_path)
      .and_then(|_| extract_zip_archive(&temp_path, &staging))
      .and_then(|_| reject_symlinks_in_dir(&staging))
  } else {
    validate_tar_archive(&temp_path)
      .and_then(|_| extract_tar_archive(&temp_path, &staging))
  };

  if let Err(error) = extract_result {
    let _ = fs::remove_file(&temp_path);
    let _ = fs::remove_dir_all(&staging);
    return Err(error);
  }

  let _ = fs::remove_file(&temp_path);

  let final_dir = root.join(&pack.name).join(&pack.version);
  if final_dir.exists() {
    let _ = fs::remove_dir_all(&staging);
    return Ok(InstalledPack {
      name: pack.name,
      version: pack.version,
      path: final_dir.to_string_lossy().to_string(),
    });
  }

  // Basic sanity check: manifest exists.
  let manifest_path = staging.join("manifest.json");
  if !manifest_path.exists() {
    let _ = fs::remove_dir_all(&staging);
    return Err("downloaded pack is missing manifest.json".to_string());
  }

  fs::create_dir_all(final_dir.parent().unwrap()).map_err(|error| format!("mkdir pack dir: {error}"))?;
  fs::rename(&staging, &final_dir).map_err(|error| format!("move pack into place: {error}"))?;

  Ok(InstalledPack {
    name: pack.name,
    version: pack.version,
    path: final_dir.to_string_lossy().to_string(),
  })
}

fn validate_tar_archive(archive_path: &Path) -> Result<(), String> {
  // Given a tar.gz archive, list entries with file modes and reject path traversal and symlinks.
  let output = Command::new("tar")
    .args(["-tvzf", archive_path.to_string_lossy().as_ref()])
    .output()
    .map_err(|error| format!("tar list failed: {error}"))?;
  if !output.status.success() {
    return Err(format!(
      "tar list failed (status={:?}): {}",
      output.status.code(),
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }
  let stdout = String::from_utf8_lossy(&output.stdout);
  for line in stdout.lines() {
    // Typical format: "-rw-r--r-- user/group size date time path"
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    let file_type = trimmed.chars().next().unwrap_or('-');
    if file_type == 'l' {
      return Err(format!("tar contains symlink entry (rejected): {trimmed}"));
    }
    if file_type != '-' && file_type != 'd' {
      return Err(format!("tar contains unsupported entry type (rejected): {trimmed}"));
    }

    let path = trimmed
      .split_whitespace()
      .last()
      .ok_or_else(|| format!("unexpected tar listing line: {trimmed}"))?;
    validate_archive_entry_path(path)?;
  }
  Ok(())
}

fn validate_zip_archive(archive_path: &Path) -> Result<(), String> {
  // Given a zip archive, list entry names and reject path traversal.
  let output = Command::new("unzip")
    .args(["-Z1", archive_path.to_string_lossy().as_ref()])
    .output()
    .map_err(|error| format!("unzip list failed: {error}"))?;
  if !output.status.success() {
    return Err(format!(
      "unzip list failed (status={:?}): {}",
      output.status.code(),
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  for name in stdout.lines() {
    let trimmed = name.trim();
    if trimmed.is_empty() {
      continue;
    }
    validate_archive_entry_path(trimmed)?;
  }
  Ok(())
}

fn validate_archive_entry_path(entry_name: &str) -> Result<(), String> {
  let path = Path::new(entry_name);
  for component in path.components() {
    match component {
      Component::Prefix(_) => return Err(format!("archive entry uses a path prefix: {entry_name}")),
      Component::RootDir => return Err(format!("archive entry is absolute: {entry_name}")),
      Component::ParentDir => return Err(format!("archive entry escapes target dir: {entry_name}")),
      Component::CurDir | Component::Normal(_) => {}
    }
  }
  Ok(())
}

fn extract_tar_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
  let status = Command::new("tar")
    .args([
      "-xzf",
      archive_path.to_string_lossy().as_ref(),
      "-C",
      dest_dir.to_string_lossy().as_ref(),
    ])
    .status()
    .map_err(|error| format!("tar extract failed: {error}"))?;
  if !status.success() {
    return Err(format!("tar extract failed (status={:?})", status.code()));
  }
  Ok(())
}

fn extract_zip_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
  // Prefer `ditto` on macOS for zip extraction; fall back to `unzip`.
  let status = if cfg!(target_os = "macos") {
    Command::new("ditto")
      .args([
        "-x",
        "-k",
        archive_path.to_string_lossy().as_ref(),
        dest_dir.to_string_lossy().as_ref(),
      ])
      .status()
      .map_err(|error| format!("ditto extract failed: {error}"))?
  } else {
    Command::new("unzip")
      .args([
        "-q",
        archive_path.to_string_lossy().as_ref(),
        "-d",
        dest_dir.to_string_lossy().as_ref(),
      ])
      .status()
      .map_err(|error| format!("unzip extract failed: {error}"))?
  };

  if !status.success() {
    return Err(format!("zip extract failed (status={:?})", status.code()));
  }
  Ok(())
}

fn reject_symlinks_in_dir(root: &Path) -> Result<(), String> {
  fn walk(path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|error| format!("read dir {path:?}: {error}"))? {
      let entry = entry.map_err(|error| format!("read dir entry: {error}"))?;
      let meta = fs::symlink_metadata(entry.path())
        .map_err(|error| format!("stat {:?}: {error}", entry.path()))?;
      if meta.file_type().is_symlink() {
        return Err(format!("extracted pack contains symlink (rejected): {:?}", entry.path()));
      }
      if meta.is_dir() {
        walk(&entry.path())?;
      }
    }
    Ok(())
  }
  walk(root)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn compute_update_status_detects_update() {
    // Given an index with a newer pack version
    let index = PacksIndex {
      packs: vec![PackDescriptor {
        name: "forge-guidance-pack".to_string(),
        version: "2.0.0".to_string(),
        asset: "x.zip".to_string(),
        sha256: "00".to_string(),
        workflow_policy_version: None,
      }],
    };
    let installed = vec![InstalledPack {
      name: "forge-guidance-pack".to_string(),
      version: "1.0.0".to_string(),
      path: "/tmp/x".to_string(),
    }];

    // When update status is computed
    let status = compute_update_status(&index, &installed);

    // Then it reports an available update
    assert_eq!(status.len(), 1);
    assert_eq!(status[0].name, "forge-guidance-pack");
    assert_eq!(status[0].installed_version.as_deref(), Some("1.0.0"));
    assert_eq!(status[0].latest_version.as_deref(), Some("2.0.0"));
    assert!(status[0].has_update);
  }

  #[test]
  fn compute_update_status_no_update_when_installed_is_newer() {
    // Given the installed version is newer than the index version
    let index = PacksIndex {
      packs: vec![PackDescriptor {
        name: "forge-guidance-pack".to_string(),
        version: "1.0.0".to_string(),
        asset: "x.zip".to_string(),
        sha256: "00".to_string(),
        workflow_policy_version: None,
      }],
    };
    let installed = vec![InstalledPack {
      name: "forge-guidance-pack".to_string(),
      version: "2.0.0".to_string(),
      path: "/tmp/x".to_string(),
    }];

    // When update status is computed
    let status = compute_update_status(&index, &installed);

    // Then it does not report an update (installed is already newer)
    assert_eq!(status.len(), 1);
    assert!(!status[0].has_update);
  }

  #[test]
  fn compute_update_status_no_update_when_same_version() {
    // Given the installed version matches the index version
    let index = PacksIndex {
      packs: vec![PackDescriptor {
        name: "forge-guidance-pack".to_string(),
        version: "1.0.0".to_string(),
        asset: "x.zip".to_string(),
        sha256: "00".to_string(),
        workflow_policy_version: None,
      }],
    };
    let installed = vec![InstalledPack {
      name: "forge-guidance-pack".to_string(),
      version: "1.0.0".to_string(),
      path: "/tmp/x".to_string(),
    }];

    // When update status is computed
    let status = compute_update_status(&index, &installed);

    // Then it does not report an update
    assert_eq!(status.len(), 1);
    assert!(!status[0].has_update);
  }

  #[test]
  fn validate_archive_entry_path_rejects_traversal() {
    // Given an entry that would escape the destination
    // When the entry path is validated
    // Then validation fails
    assert!(validate_archive_entry_path("../escape.txt").is_err());
    assert!(validate_archive_entry_path("a/../../escape.txt").is_err());
    assert!(validate_archive_entry_path("/etc/passwd").is_err());
  }
}
