# Forge Monorepo Architecture

This repository implements Phase 0-2 of Forge componentization.

## Layers

- `packages/contracts`: Plan schema and validation rules.
- `packages/templates`: Local project/module scaffolding.
- `packages/guidance-pack`: Guidance artifact and installation behavior. Registers skills as agent-native commands (`.claude/commands/` and `.agents/skills/`) during install.
- `packages/check-runner`: Task-type check execution and normalization.
- `packages/adapter-codex` and `packages/adapter-claude`: Runtime adapters with unified event contract.
- `packages/control-plane`: Plan lifecycle orchestration and evidence persistence.
- `packages/sidecar`: Internal Desktop sidecar process (JSON over stdin/stdout) that wraps package services.
- `apps/desktop`: Tauri + Vue UI with an embedded single-port HTTP server that serves both the Vite-built frontend and `/api/*` backend routes on one origin.

## Data Flow

1. Desktop calls `/api/plan/validate`, which spawns the sidecar and runs contracts validation.
2. Desktop calls `/api/workflow/auto/stream`, which spawns the sidecar to run control-plane orchestration + adapters + gates.
3. Control-plane selects runnable task from dependency DAG.
4. Control-plane delegates to selected adapter.
5. Control-plane runs checks via check-runner based on `task_type`.
6. Control-plane writes evidence artifacts to `.forge/evidence`.
7. Desktop UI calls `/api/*` endpoints on the same origin (single-port app-server in Tauri).
8. Desktop UI polls `/api/plans/list` and uses `modifiedMs` to surface both newly created and updated plan files during guided plan creation.

## Evidence Artifacts

Per task run, control-plane writes:

- `run-metadata.json`
- `adapter-events.jsonl`
- `checks.json`

## Constraints

- Monorepo-first, local template source for project initialization.
- Task execution is single-lane in v1.
- Runtime integration is adapter-based to keep core runtime-agnostic.

## Remaining Scope (After Phases 0-2)

The current repository implements only Phases 0-2 from `docs/components-deep-dive.md`.

### Phase 3: Hardening and Recovery UX (Not Implemented Yet)

- Robust failure classification tuning.
- Retry behavior tuning and stronger pause/resume recovery flows.
- Expanded `task_type` check mappings and governance.

### Phase 4: Forge Control Plane Distribution (Not Implemented Yet)

- Unified distribution/packaging for sidecar + guidance + desktop.
- Upgrade and compatibility policy.
- Standardized evidence export/import format for external consumers.
