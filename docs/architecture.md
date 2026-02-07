# Forge Monorepo Architecture

This repository implements Phase 0-2 of Forge componentization.

## Layers

- `packages/contracts`: Plan schema and validation rules.
- `packages/templates`: Local project/module scaffolding.
- `packages/guidance-pack`: Guidance artifact and installation behavior.
- `packages/check-runner`: Task-type check execution and normalization.
- `packages/adapter-codex` and `packages/adapter-claude`: Runtime adapters with unified event contract.
- `packages/control-plane`: Plan lifecycle orchestration and evidence persistence.
- `packages/cli`: Public command surface (`forge ...`) wrapping package services.
- `apps/desktop`: Tauri + Vue UI that calls control-plane bridge commands.

## Data Flow

1. `forge plan validate` calls contracts schema + graph validation.
2. `forge run next` calls control-plane.
3. Control-plane selects runnable task from dependency DAG.
4. Control-plane delegates to selected adapter.
5. Control-plane runs checks via check-runner based on `task_type`.
6. Control-plane writes evidence artifacts to `.forge/evidence`.
7. Desktop UI invokes bridge commands for validate/run/pause/resume/evidence.

## Evidence Artifacts

Per task run, control-plane writes:

- `run-metadata.json`
- `adapter-events.jsonl`
- `checks.json`

## Constraints

- Monorepo-first, local template source for `forge init`.
- Task execution is single-lane in v1.
- Runtime integration is adapter-based to keep core runtime-agnostic.

## Remaining Scope (After Phases 0-2)

The current repository implements only Phases 0-2 from `docs/components-deep-dive.md`.

### Phase 3: Hardening and Recovery UX (Not Implemented Yet)

- Robust failure classification tuning.
- Retry behavior tuning and stronger pause/resume recovery flows.
- Expanded `task_type` check mappings and governance.

### Phase 4: Forge Control Plane Distribution (Not Implemented Yet)

- Unified distribution/packaging for CLI + guidance + desktop.
- Upgrade and compatibility policy.
- Standardized evidence export/import format for external consumers.
