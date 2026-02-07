# Forge Desktop Packs Hub (macOS) Plan

Date: 2026-02-07

## Summary
Use the existing Tauri desktop app (`apps/desktop`) as a stable distribution hub that:

- Ships a stable execution core (Forge CLI sidecar) inside the notarized desktop app bundle.
- Downloads frequently-updated, non-executable "packs" (starting with `forge-guidance-pack`) from GitHub Releases.
- Installs pack contents into a selected project via the bundled Forge CLI in JSON mode.

v1 explicitly avoids downloading/executing updated binaries outside the app bundle to reduce macOS Gatekeeper/quarantine/notarization friction.

## Goals
- One installer for end users: Forge Desktop (macOS app).
- In-app updates for guidance (rules/skills/config) without updating the desktop app itself.
- Pack integrity verification (hash) and safe extraction (path traversal and symlink rejection).

## Non-goals (v1)
- In-app executable updates (CLI/control-plane) downloaded from the internet.
- Open third-party plugin ecosystem (arbitrary repos) without allowlisting and stronger trust model.

## Distribution Model

### Executable Core (Bundled With App)
- Forge Desktop runs `forge` via a sidecar command runner (JSON output).
- Supported resolution:
  - `FORGE_DESKTOP_FORGE_BIN` points at a `forge` executable, or
  - `FORGE_DESKTOP_FORGE_ENTRY_JS` points at `packages/cli/dist/bin.js` and desktop runs `node <entry>`.

### Packs (Downloaded From GitHub Releases)
- Desktop downloads `packs-index.json` from the configured repo's "latest" release.
- Desktop downloads pack archives referenced by `packs-index.json` entries.
- Desktop stores extracted packs under app data:
  - `~/Library/Application Support/Forge/packs/<packName>/<version>/`

Minimal index shape:
```json
{
  "packs": [
    {
      "name": "forge-guidance-pack",
      "version": "1.0.0",
      "asset": "forge-guidance-pack-1.0.0.zip",
      "sha256": "64-hex-sha256",
      "workflowPolicyVersion": "1.1.0"
    }
  ]
}
```

## Pack Spec (v1)
- A pack is an extracted directory with a required `manifest.json` at the root.
- `forge-guidance-pack` pack contents match the normative guidance layout:
  - `manifest.json`, `AGENTS.md`, `AGENTS.override.md`, `skills/`, `rules/`, `codex/config.json`

## Safety Requirements
- Verify pack archive SHA-256 against `packs-index.json`.
- Safe extraction:
  - Reject path traversal (no `..`, no absolute paths).
  - Reject symlinks (tar listing rejects symlink entries; zip extraction rejects symlinks after extraction by scanning).
- Allowlist pack source repo (configurable, but not arbitrary by default).

## Desktop Backend API (Tauri Commands)
- `plan_validate(projectRoot, planPath) -> { valid, issues[] }`
- `run_next(projectRoot, planPath, adapter) -> run result`
- `resume_run(projectRoot, planPath, runId, adapter) -> run result`
- `get_evidence(projectRoot, taskId) -> string[]`

- `project_get_guidance_status(projectRoot) -> { installed, manifest? }`
- `packs_list_installed() -> InstalledPack[]`
- `packs_check_updates() -> PackUpdateStatus[]`
- `packs_download(packName, version?) -> InstalledPack`
- `project_install_guidance(projectRoot, packPath, forceReplace) -> JSON`

## UI (v1)
- Orchestrate tab: project root, plan path, validate/run/resume/evidence.
- Packs tab: show installed guidance version in project, check updates, download latest guidance pack, install into project, toggle force replace.

## Acceptance / Test Scenarios
- Given a project without guidance, when guidance is installed from a downloaded pack, then `manifest.json` and guidance files exist in the project root.
- Given a project with locally modified guidance files, when guidance is installed without force replace, then local edits are preserved.
- Given a tampered pack archive, when sha256 does not match, then installation is blocked.
- Given an archive with path traversal entries, when extracted, then installation is blocked.

