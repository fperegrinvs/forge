# @forge/desktop

Tauri + Vue orchestrator UI for running Forge plans via the control-plane.

## Commands

From the repo root:

```bash
bun run --filter @forge/desktop dev
bun run --filter @forge/desktop dev:singleport
bun run dev:desktop:tauri
bun run dev:desktop:tauri:oneshot
bun run dev:desktop:tauri:noreload
bun run --filter @forge/desktop build
bun run --filter @forge/desktop test
bun run --filter @forge/desktop typecheck
```

Notes:

- Tauri config lives in `apps/desktop/src-tauri/tauri.conf.json`.
- `dev` runs the Vite dev server on port `5173` (useful for UI-only iteration).
- `dev:singleport` keeps `apps/desktop/dist/` up to date for the embedded app-server (port `1420`).
- The desktop UI talks to the backend via HTTP `/api/*` (single origin), not Tauri `invoke()`.
- `bun run dev:desktop:tauri` is the recommended way to start Tauri in dev (it starts the watcher + `cargo tauri dev`).
- `bun run dev:desktop:tauri:oneshot` runs a one-time frontend build then starts Tauri (no watch, single process after startup).
- `bun run dev:desktop:tauri:noreload` runs a one-time frontend build and starts Tauri with its watcher disabled (`cargo tauri dev --no-watch`).

## Plans

- The "New Plan" guided flow detects both newly created and updated plan files in `plans/` using the `modifiedMs` timestamps returned by `/api/plans/list`.

## Packs + Guidance Updates

Forge Desktop can download non-executable "packs" (starting with `forge-guidance-pack`) from GitHub Releases and install them into a selected project directory.

### Concepts

- **Downloaded pack**: A pack directory stored in the Desktop app data dir (fetched from GitHub Releases or bundled with the app). Desktop lists these under "Installed Packs".
- **Project-installed pack**: Guidance files copied into a specific project root (e.g. `manifest.json`, `AGENTS.md`, `rules/`, `skills/`). Desktop shows this under "Project Pack".
- **Project pack source metadata**: After installing into a project, Forge writes `.forge/guidance.json` recording which downloaded pack path was used (name/version/path + timestamp + whether forceReplace was used).
- **Phase gate bindings**: Per-project workflow validation script bindings stored at `.forge/phase-gates.json` (seeded from the selected pack defaults when missing). Desktop can edit these bindings from the Packs tab workflow panel.

### Typical Workflow (Desktop UI)

1. Select a **Project root**.
2. Go to the **Packs** tab and confirm the **Installed** project pack status.
3. Choose a **Pack** name.
4. Click **Check Updates** (populates latest versions from the remote index).
5. Click **Download Latest** (downloads the pack into the Desktop app data dir).
6. Choose a **Downloaded version** (or keep the default).
7. Click **Install/Update In Project**.

Notes:

- Switching pack names is supported. If you switch packs, consider enabling **Force replace local changes** to avoid a mixed configuration.
- Installing into a project runs `forge install-guidance` via the Desktop backend.

Configuration (optional):

- `FORGE_DESKTOP_PACKS_REPO`: GitHub repo in `owner/repo` form that hosts release assets (default: `forge/forge`).
- `FORGE_DESKTOP_FORGE_BIN`: Path to a `forge` executable to run from the desktop backend.
- `FORGE_DESKTOP_FORGE_ENTRY_JS`: Path to `packages/cli/dist/bin.js` (desktop will run `node <entry>`).

Expected release assets:

- `packs-index.json` at `releases/latest/download/packs-index.json`
- Pack archives referenced by `packs-index.json` entries via `asset` (supports `.zip`, `.tar.gz`, `.tgz`)

Minimal `packs-index.json` shape:

```json
{
  "packs": [
    {
      "name": "forge-guidance-pack",
      "version": "1.0.0",
      "asset": "forge-guidance-pack-1.0.0.zip",
      "sha256": "0123456789abcdef...64hex...",
      "workflowPolicyVersion": "1.1.0"
    }
  ]
}
```
