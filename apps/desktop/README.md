# @forge/desktop

Tauri + Vue orchestrator UI for running Forge plans via the control-plane.

## Commands

From the repo root:

```bash
bun run --filter @forge/desktop dev
bun run --filter @forge/desktop build
bun run --filter @forge/desktop test
bun run --filter @forge/desktop typecheck
```

Notes:

- Tauri config lives in `apps/desktop/src-tauri/tauri.conf.json`.

## Packs + Guidance Updates

Forge Desktop can download non-executable "packs" (starting with `forge-guidance-pack`) from GitHub Releases and install them into a selected project directory.

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
