# Forge Monorepo v1 Implementation Plan (Phases 0-2)

## Summary
Implement all four proposed components in `/Users/simon/projects/forge` as a layered Bun workspace monorepo, scoped to Phases 0-2 from `/Users/simon/projects/forge/docs/components-deep-dive.md`: contracts/schema, template+scaffolder+guidance, and a functional desktop orchestrator MVP.  
Decisions locked from this thread: layered packages, local template source for `forge init`, functional desktop MVP, full Codex + Claude adapters, and prerequisite bootstrap first (Bun + Rust).

## Monorepo Structure
```text
/Users/simon/projects/forge/
  apps/
    desktop/                          # Tauri + Vue + Vuetify + Vue Flow UI
      src/
      src-tauri/
  packages/
    contracts/                        # Plan schema, TS domain contracts, validators
    control-plane/                    # Core orchestration engine (task state machine)
    adapter-codex/                    # Codex runtime adapter
    adapter-claude/                   # Claude runtime adapter
    check-runner/                     # task_type -> check script execution + normalization
    cli/                              # forge CLI surface
    guidance-pack/                    # distributable guidance artifact + install logic
    templates/                        # local template assets + module scaffolder templates
    shared-utils/                     # JSON IO, process, logging helpers
  checks/
    task-types/                       # canonical check scripts by task_type
  scripts/
    bootstrap-toolchain.sh            # install/verify Bun + Rust + project prerequisites
    verify-monorepo.sh
  docs/
    components-deep-dive.md
    vision.md
    architecture.md                   # implementation architecture notes
  package.json                        # Bun workspaces root
  bunfig.toml
  tsconfig.base.json
  eslint.config.ts
  vitest.workspace.ts
```

## Public APIs, Interfaces, and Types
1. CLI commands (public surface) in `@forge/cli`:
   - `forge init <project-name> [--template <name>] [--runtime <bun-version>] [--ui <vuetify|none>] [--json]`
   - `forge scaffold module <module-name> [--with-contract-test] [--with-property-test] [--json]`
   - `forge install-guidance [--version <semver|latest>] [--source <registry|git|path>] [--json]`
   - `forge plan validate --file <path> [--json]`
   - `forge run next --plan <path> [--adapter <codex|claude>] [--json]`
2. Plan schema and validator in `@forge/contracts`:
   - JSON Schema 2020-12 file: `plan.v1.schema.json`
   - TS types: `Plan`, `PlanTask`, `TaskType`, `ValidationIssue`
   - APIs: `validatePlanSchema(plan)`, `validatePlanGraph(plan)`, `loadPlan(path)`
3. Adapter contract (shared, implemented in both adapter packages):
   - `AgentAdapter.startRun(context)`, `streamEvents(runId)`, `resume(runId)`, `cancel(runId)`
   - event union exactly as deep-dive memo (`run.started`, `run.output`, `run.tool`, `run.completed`, `run.failed`)
4. Check runner contract in `@forge/check-runner`:
   - `runChecks(taskType, taskId, cwd): Promise<CheckResult[]>`
   - normalized statuses: `pass | fail | flaky | infra_error`
5. Desktop bridge commands (Tauri invoke API):
   - `plan_validate(filePath)`
   - `run_next(planPath, adapter)`
   - `pause_run(runId)`
   - `resume_run(runId)`
   - `get_evidence(taskId)`

## Implementation Sequence
1. Bootstrap and guardrails.
   - Add root workspace config, shared TS/ESLint/Vitest configs, and `scripts/bootstrap-toolchain.sh`.
   - Add preflight command that fails fast when Bun/Rust/toolchain are missing.
   - Acceptance: `scripts/bootstrap-toolchain.sh --check` passes locally.

2. Implement `@forge/contracts`.
   - Add normative `plan.v1.schema.json`, AJV-based schema validation, graph validation (unknown deps, cycles, duplicate IDs, unknown task_type).
   - Acceptance: contract tests for all required schema/graph failures and success path.

3. Implement `@forge/templates`.
   - Add local `forge-template` skeleton (modulith layout from vision) and module generator templates for `index.ts`, `routes.ts`, `container.ts`, and module subdirs.
   - Acceptance: scaffold snapshot tests verify canonical structure and naming.

4. Implement `@forge/guidance-pack`.
   - Add normative pack layout (`manifest.json`, `AGENTS.md`, `AGENTS.override.md`, `skills/`, `codex/config.json`, `rules/`).
   - Add installer/update logic with diff summary and non-destructive merge defaults.
   - Acceptance: precedence tests and skill discovery tests pass.

5. Implement `@forge/check-runner`.
   - Add `task_type` registry loading from `/Users/simon/projects/forge/checks/task-types`.
   - Execute scripts, classify failures, normalize to `CheckResult`.
   - Acceptance: tests for pass/fail/flaky/infra_error normalization and missing-script behavior.

6. Implement adapters.
   - `@forge/adapter-codex`: non-interactive run start, event stream parsing, resume/cancel.
   - `@forge/adapter-claude`: same contract and parity behavior.
   - Acceptance: unit tests with mocked process streams and fixture JSONL events for both runtimes.

7. Implement `@forge/control-plane`.
   - Add plan lifecycle orchestration: load -> validate -> select runnable task (single lane) -> adapter run -> checks -> evidence persist -> status updates.
   - Persist artifacts per task run: `run-metadata.json`, `adapter-events.jsonl`, `checks.json`.
   - Add deterministic failure handling policy from vision (transient/structural/semantic/infrastructure actions).
   - Acceptance: orchestration tests for happy path, failed check pause, adapter failure classification, resume from filesystem state.

8. Implement `@forge/cli`.
   - Wire public commands to templates/guidance/contracts/control-plane packages.
   - Implement stable `--json` output and categorized non-zero exit codes.
   - Acceptance: command smoke tests for `init`, `scaffold module`, `install-guidance`, `plan validate`, `run next`.

9. Implement desktop app MVP (`apps/desktop`).
   - Tauri + Vue + Vuetify shell.
   - Plan import/validation screen, DAG rendering with Vue Flow, task details panel, gate/check panel, log stream view, evidence/history viewer.
   - Run controls: `Validate Plan`, `Run Next`, `Pause`, `Resume`, `Open Evidence`, `Revise Plan`.
   - Desktop calls Tauri bridge commands that invoke control-plane actions.
   - Acceptance: desktop e2e tests for plan import/validation, DAG/status transitions, and run-control button flows.

10. End-to-end integration and docs.
    - Add `/Users/simon/projects/forge/docs/architecture.md` and root README with monorepo usage.
    - Add CI workflow to run typecheck, lint, tests, and desktop test subset.
    - Acceptance: one full dry run from `forge init` to `forge run next` with evidence persisted and visible in desktop.

## Test Cases and Scenarios
1. Schema validation rejects cyclic dependencies.
2. Schema validation rejects unknown dependency IDs.
3. Schema validation rejects missing `task_type`.
4. Graph validation rejects unknown `task_type` without check binding.
5. `forge init` creates expected baseline files and scripts.
6. `forge scaffold module` generates canonical modulith module shape.
7. Guidance precedence resolves `global -> repo_root -> nearest_directory_override`.
8. Skill discovery validates required `SKILL.md` and optional `scripts/references/assets`.
9. `Run Next` completes one runnable task and updates status.
10. Failed check pauses progression and records normalized failure.
11. Resume after manual repair continues from filesystem state, not stale session.
12. Desktop imports/validates plan, renders DAG, and updates task status on `Run Next`.
13. Desktop `Pause`/`Resume` buttons correctly control run state.
14. Adapter parity tests confirm both Codex and Claude adapters emit contract-compliant events.

## Assumptions and Defaults
1. Scope is explicitly Phases 0-2 only; Phases 3-4 remain backlog.
2. Local template source is authoritative in v1; remote template fetch is deferred.
3. Bun workspaces are the only monorepo orchestrator (no Nx/Turborepo).
4. Desktop is a functional MVP, not advanced UX (no sidecar/multiplexing features in this pass).
5. Toolchain bootstrap is part of implementation because Bun/Rust are currently missing.
6. Runtime portability is preserved by keeping core logic in TypeScript packages and using adapter boundaries.
7. All public command output supports machine-readable JSON for desktop integration.
8. Evidence storage is local filesystem-first under a deterministic per-run directory layout.
