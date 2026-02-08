# Forge Deep-Dive Components Decision Memo

Status: Proposed v1 baseline  
Date: 2026-02-06  
Scope: Expand `vision.md` into an implementation-ready component strategy and contract set.

## 1. Context And Goals

Forge defines a spec-driven, gate-heavy delivery loop for agentic software development. The vision already defines stack and orchestration principles; this memo resolves implementation choices for four buildable components:

1. Project and module templates.
2. Skills/rules/config guidance pack.
3. Desktop orchestrator with plan-driven task execution.
4. A unifying control plane that glues all components together.

This memo is intentionally opinionated. It optimizes for deterministic execution, low ambiguity for agents, and clear upgrade paths.

### Goals

1. Standardize project bootstrap and module scaffolding for the Forge stack.
2. Define guidance as both a standalone artifact and a vendored project asset.
3. Deliver a desktop-first orchestrator with explicit plan/task contracts and check hooks.
4. Define stable interfaces so runtime adapters (Codex first, Claude-compatible) are swappable.
5. Provide a phased roadmap that can be implemented by separate teams without design churn.

### Non-Goals (For This Memo)

1. Implementing code in this document.
2. Finalizing every operational policy (for example cost governance).
3. Solving multi-repo orchestration in v1.
4. Locking to a single LLM provider forever.

## 2. Decision Summary

1. Template strategy: dual model (GitHub template repo + in-repo module scaffolder).
2. Generator for in-repo scaffolding: Plop as v1 default; Hygen kept as an alternative.
3. Guidance distribution: independent `forge-guidance-pack` artifact + vendored copy in each Forge project.
4. Orchestrator form factor: desktop app.
5. Desktop shell: Tauri + Vue + Vuetify; DAG visualization via Vue Flow.
6. Orchestrator core: runtime-agnostic adapter boundary with Codex first-class adapter and Claude-compatible adapter.
7. Plan model: tasks as primary execution unit; required `task_type`; optional `steps`.
8. Plan validation: JSON Schema 2020-12 + AJV + graph validation pass.
9. Main glue component: Forge Control Plane coordinating templates, guidance, plan lifecycle, execution, and evidence.

## 3. Component A: Project + Module Templates

### 3.1 Decision

Use a two-layer provisioning model:

1. Repository bootstrap from a GitHub template repository (`forge-template`).
2. In-repo scaffolding for modules and repeated architecture patterns (`forge scaffold module`).

This avoids overloading bootstrap tools with ongoing code generation concerns.

### 3.2 Why This Model

1. GitHub templates provide immediate repo-level standardization, CI setup, and baseline files.
2. In-repo scaffolders preserve architectural consistency as the codebase evolves.
3. Separation keeps project birth concerns (`forge init`) independent from iterative module growth (`forge scaffold module`).

### 3.3 v1 CLI Contracts

#### `forge init <project-name>`

Purpose: create a new repo that already conforms to Forge stack and architecture defaults.

Inputs:

1. `project-name` (required)
2. `--template <org/repo>` (optional override; default Forge official template)
3. `--runtime <bun-version>` (optional pin override)
4. `--ui <vuetify|none>` (optional; default `vuetify`)

Outputs:

1. Initialized project folder with lockfile and baseline scripts.
2. Canonical directories and starter module.
3. Installed guidance pack (unless skipped).

Exit behavior:

1. `0` on success.
2. Non-zero with machine-readable error code on failure.

#### `forge scaffold module <module-name>`

Purpose: create canonical modulith module structure and registration stubs.

Inputs:

1. `module-name` (required; kebab-case)
2. `--with-contract-test` (optional; default true)
3. `--with-property-test` (optional; default true)

Outputs:

1. Files under `modules/<module-name>/`:
   - `index.ts`
   - `routes.ts`
   - `container.ts`
   - `services/`
   - `domain/`
   - `infrastructure/`
2. Optional contract test in `contracts/`.

Exit behavior:

1. Fails if target module already exists (unless `--force` is explicitly supported later).

#### `forge install-guidance`

Purpose: install or update the guidance pack independently from app template updates.

Inputs:

1. `--version <semver|latest>` (optional)
2. `--source <registry|git|path>` (optional)

Outputs:

1. Guidance files copied/synced into project.
2. Local manifest updated with installed guidance version.

### 3.4 Tooling Choice For Scaffolding

Primary: Plop.

Decision reasons:

1. Good fit for repeated in-repo file and template generation.
2. Strong TypeScript/Node ecosystem familiarity.
3. Low cognitive overhead for contributors compared to bespoke generation logic.

Alternative retained:

1. Hygen remains viable when teams prefer filesystem-template-first workflows.
2. Not selected as default to avoid bifurcating scaffolding conventions in v1.

### 3.5 Expected Project Shape After `forge init`

```text
<project>/
  modules/
    <starter-module>/
      index.ts
      routes.ts
      container.ts
      services/
      domain/
      infrastructure/
  shared/
    types.ts
    middleware/
  contracts/
  tests/
  checks/
  decisions/
  AGENTS.md
  package.json
  bun.lock
  tsconfig.json
  eslint.config.* 
```

## 4. Component B: Skills, Rules, And Config Pack

### 4.1 Decision

Publish guidance as an independent artifact named `forge-guidance-pack`, and also vendor it into each initialized project.

### 4.2 Why This Model

1. Independent versioning avoids forcing full template upgrades for guidance-only updates.
2. Projects can pin guidance versions while template evolves.
3. Local vendoring ensures offline availability and reproducible behavior.

### 4.3 Guidance Pack Layout (Normative)

```text
forge-guidance-pack/
  manifest.json
  AGENTS.md
  AGENTS.override.md
  skills/
    <skill-name>/
      SKILL.md
      scripts/        # optional
      references/     # optional
      assets/         # optional
  codex/
    config.json
  rules/
    architecture.md
    testing.md
```

### 4.4 Policy And Config Defaults

The pack must explicitly declare:

1. Input/context byte budget target for read operations.
2. Fallback filenames for planner and execution artifacts.
3. Default safety policy for tool usage.
4. Directory precedence rules for `AGENTS.md` and `AGENTS.override.md`.

Recommended config model:

```json
{
  "version": "1.0.0",
  "context": {
    "max_read_bytes": 262144
  },
  "fallback_files": {
    "plan": "PLAN.md",
    "execution_log": "EXECUTION_LOG.md",
    "decisions": "decisions.md"
  },
  "agents_precedence": [
    "global",
    "repo_root",
    "nearest_directory_override"
  ]
}
```

### 4.5 Guidance Installation Semantics

1. `forge install-guidance` installs to project root.
2. Existing local custom files are preserved unless explicitly replaced.
3. Upgrades produce a diff summary so users can review instruction changes.

## 5. Component C: Desktop Orchestrator

### 5.1 Decision

Build v1 as a desktop application with:

1. Tauri shell.
2. Vue + Vuetify frontend.
3. Vue Flow graph view for plan DAG.
4. Runtime-agnostic execution core via adapter contract.

### 5.2 Why Desktop-First

1. Rich controls and visibility beyond raw terminal flows.
2. Local-first execution aligns with filesystem-mediated recovery model in `vision.md`.
3. Easier distribution of a cohesive UX for plan editing, run control, logs, and evidence.

### 5.3 Runtime Architecture

```text
Desktop UI (Tauri + Vue/Vuetify)
  -> Forge Control Plane Core (local service inside app process boundary)
     -> Plan Validator (AJV + graph checks)
     -> Task Scheduler (dependency-aware, v1 sequential lane)
     -> Adapter Layer (Codex adapter, Claude-compatible adapter)
     -> Check Runner (task_type script mapping)
     -> Evidence Store (structured run artifacts)
```

### 5.4 Execution Model

1. Import plan.
2. Validate schema and dependency graph.
3. Select next runnable task.
4. Execute via adapter with constrained context.
5. Run checks linked to `task_type`.
6. Mark task status and persist evidence.
7. Pause on deterministic failures; allow resume after repair.

### 5.5 UI Controls (v1)

Buttons and states:

1. `Validate Plan`
2. `Run Next`
3. `Pause`
4. `Resume`
5. `Open Evidence`
6. `Revise Plan`

Panels:

1. DAG view and status legend.
2. Current task details.
3. Gate/check results.
4. Live execution log stream.
5. Evidence/history viewer.

### 5.6 Plan Data Model Decision

1. Required: `task_type`.
2. Optional: `steps`.
3. Dependencies define execution order as DAG.
4. If `steps` absent, task-level handler/check flow runs directly.

## 6. Component D: Forge Control Plane (Main Glue)

### 6.1 Decision

Define a single opinionated runtime component, **Forge Control Plane**, responsible for end-to-end orchestration across templates, guidance, planning, execution, and verification.

### 6.2 Responsibilities

1. Create projects from template.
2. Install/update guidance pack.
3. Load and validate plan artifacts.
4. Resolve next task by dependency state.
5. Execute task through selected runtime adapter.
6. Invoke task-type checks.
7. Persist structured evidence and status timeline.
8. Surface all state to desktop UI.

### 6.3 Explicit Boundaries

In scope:

1. Task-level orchestration and gating.
2. Adapter abstraction and run control.
3. Local evidence and state management.

Out of scope in v1:

1. Multi-repo orchestration.
2. Distributed queue-based execution.
3. Cloud-hosted multi-tenant control plane.

## 7. Cross-Component Interfaces And Contracts

### 7.1 CLI Surface (Public)

Commands:

1. `forge init <project-name>`
2. `forge scaffold module <module-name>`
3. `forge install-guidance`
4. `forge plan validate --file <path>`
5. `forge run next --plan <path>`

Contract requirements:

1. Stable machine-readable output mode (`--json`) for UI integration.
2. Stable non-zero exit codes with categorized errors.
3. Idempotent behavior for validation commands.

### 7.2 Plan Schema (JSON Schema 2020-12 + AJV)

Schema contract (normative fields):

1. `Plan.metadata`
2. `Plan.context`
3. `Plan.tasks[]`
4. Per task:
   - `id`
   - `task_type`
   - `dependencies[]`
   - `files[]`
   - `acceptance_criteria[]`
   - `verification_command`
   - optional `steps[]`

Reference schema sketch:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://forge.dev/schema/plan.v1.json",
  "type": "object",
  "required": ["metadata", "context", "tasks"],
  "properties": {
    "metadata": {
      "type": "object",
      "required": ["project", "created", "last_updated", "spec_version", "approved"],
      "properties": {
        "project": { "type": "string", "minLength": 1 },
        "created": { "type": "string", "format": "date-time" },
        "last_updated": { "type": "string", "format": "date-time" },
        "spec_version": { "type": "string", "minLength": 1 },
        "approved": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "context": {
      "type": "object",
      "required": ["goals", "constraints", "tech_decisions", "architecture"],
      "properties": {
        "goals": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "constraints": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "tech_decisions": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "architecture": { "const": "modulith" }
      },
      "additionalProperties": false
    },
    "tasks": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "id",
          "task_type",
          "name",
          "description",
          "files",
          "dependencies",
          "acceptance_criteria",
          "verification_command"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-_]*$" },
          "task_type": { "type": "string", "minLength": 1 },
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string", "minLength": 1 },
          "files": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          },
          "dependencies": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "uniqueItems": true
          },
          "acceptance_criteria": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "minLength": 1 }
          },
          "verification_command": { "type": "string", "minLength": 1 },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": { "type": "string", "minLength": 1 },
                "name": { "type": "string", "minLength": 1 },
                "description": { "type": "string" }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

Graph validation (post-schema pass):

1. Reject unknown dependency IDs.
2. Reject cyclic dependency graphs.
3. Reject duplicate task IDs.
4. Reject task types missing handler/check registration.

### 7.3 Agent Adapter Interface (TypeScript)

```ts
export type RunId = string;

export type RunContext = {
  taskId: string;
  prompt: string;
  workingDirectory: string;
  allowedTools: string[];
  env?: Record<string, string>;
};

export type AdapterEvent =
  | { type: "run.started"; runId: RunId; at: string }
  | { type: "run.output"; runId: RunId; stream: "stdout" | "stderr"; chunk: string; at: string }
  | { type: "run.tool"; runId: RunId; tool: string; status: "started" | "completed" | "failed"; at: string }
  | { type: "run.completed"; runId: RunId; exitCode: number; at: string }
  | { type: "run.failed"; runId: RunId; reason: string; at: string };

export type RunHandle = {
  runId: RunId;
};

export interface AgentAdapter {
  startRun(context: RunContext): Promise<RunHandle>;
  streamEvents(runId: RunId): AsyncIterable<AdapterEvent>;
  resume(runId: RunId): Promise<RunHandle>;
  cancel(runId: RunId): Promise<void>;
}
```

### 7.4 Check Runner Contract

Task type registry:

```ts
export type CheckStatus = "pass" | "fail" | "flaky" | "infra_error";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  summary: string;
  evidencePath?: string;
  startedAt: string;
  finishedAt: string;
};

export type TaskCheckBinding = {
  taskType: string;
  scripts: string[]; // e.g. checks/<task_type>/gate-green.sh
};

export interface CheckRunner {
  runChecks(taskType: string, taskId: string, cwd: string): Promise<CheckResult[]>;
}
```

Normalization rules:

1. Any non-deterministic pass/fail in retry window may be marked `flaky`.
2. Missing script or runner crash is `infra_error`.
3. Hard validation failure is `fail`.

Evidence persistence:

1. One evidence directory per task run.
2. Minimum artifacts:
   - `run-metadata.json`
   - `adapter-events.jsonl`
   - `checks.json`
   - optional logs and diffs.

## 8. Validation And Test Strategy

### 8.1 Schema Validation Tests

Required tests:

1. Reject cyclic dependencies.
2. Reject unknown dependency IDs.
3. Reject missing `task_type`.
4. Reject unknown `task_type` without check registration.

### 8.2 Template Tests

Required tests:

1. `forge init` smoke test creates expected stack files and baseline scripts.
2. `forge scaffold module` produces canonical module structure from `vision.md`.

### 8.3 Guidance-Pack Tests

Required tests:

1. AGENTS precedence resolution test:
   - global instructions
   - repo-root instructions
   - nearest directory override.
2. Skill discovery test validates:
   - required `SKILL.md`
   - optional `scripts/`, `references/`, `assets/`.

### 8.4 Orchestrator Tests

Required tests:

1. `Run Next` happy path completes one runnable task and updates state.
2. Failed check pauses progression and records failure.
3. Resume after manual repair continues from filesystem state.
4. Adapter failure classification and retry policy behave deterministically.

### 8.5 Desktop App E2E

Required tests:

1. Plan import and validation UX.
2. DAG rendering and task status transitions.
3. Button-driven run control (`Run Next`, `Pause`, `Resume`).

## 9. Phased Delivery Roadmap

### Phase 0: Contracts And Schema

Deliverables:

1. Finalized JSON Schema.
2. Adapter and check-runner interfaces.
3. CLI contract docs.

Exit criteria:

1. All contract tests green for schema validation and graph rules.

### Phase 1: Template + Scaffolder + Guidance

Deliverables:

1. `forge init`, `forge scaffold module`, `forge install-guidance`.
2. `forge-guidance-pack` with manifest and versioning.

Exit criteria:

1. Template and guidance smoke tests are green in CI.

### Phase 2: Desktop Orchestrator MVP

Deliverables:

1. Tauri desktop shell with Vue/Vuetify UI.
2. Plan load/validate screen.
3. Single-lane `Run Next` execution.
4. Evidence persistence and status board.

Exit criteria:

1. Orchestrator and desktop e2e MVP tests pass.

### Phase 3: Hardening And Recovery UX

Deliverables:

1. Robust failure classification.
2. Retry tuning and pause/resume flows.
3. Expanded task-type check mappings.

Exit criteria:

1. Deterministic recovery scenarios pass.

### Phase 4: Forge Control Plane Distribution

Deliverables:

1. Unified packaging of CLI + guidance + desktop orchestrator.
2. Upgrade and compatibility policy.
3. Standardized evidence export format.

Exit criteria:

1. Users can bootstrap, execute plan tasks, and verify with one integrated distribution.

## 10. Risks And Open Questions

1. Adapter behavior differences across agent runtimes may affect reliability.
2. Task-type taxonomy might drift without governance; define ownership early.
3. Large plans may create UI complexity in DAG visualization; pagination or clustering may be required.
4. Guidance upgrades can conflict with local customizations; diff-first upgrade flow is mandatory.
5. Future durability backend choice (BullMQ vs Temporal) remains intentionally optional until single-host reliability baselines are measured.

## 11. Implementation Defaults And Assumptions

1. Decision memo style is authoritative for v1.
2. Orchestrator is desktop-first.
3. Core execution remains runtime-agnostic.
4. Plan granularity is task plus `task_type`; `steps` are optional.
5. Any quantified benchmark claim requires explicit citation and date.

## 12. Source Links

### Vision Baseline

1. [Forge vision baseline](vision.md)

### Bootstrap, Templates, And Generators

1. [Bun quickstart (`bun init` templates)](https://bun.sh/docs/quickstart)
2. [Bun + Vite (`bun create vite`)](https://bun.sh/guides/ecosystem/vite)
3. [GitHub repository templates](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)
4. [Plop micro-generator](https://github.com/plopjs/plop)
5. [Hygen project-local generators](https://github.com/jondot/hygen)
6. [npm init/create initializer mapping](https://docs.npmjs.com/cli/v10/commands/npm-init/)

### Codex Guidance, Skills, And Runtime

1. [Codex AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md/)
2. [Codex skills model](https://developers.openai.com/codex/skills)
3. [Codex non-interactive mode (`codex exec`, legacy)](https://developers.openai.com/codex/noninteractive/)
4. [Codex app-server for rich clients](https://developers.openai.com/codex/app-server)
5. [Codex SDK](https://developers.openai.com/codex/sdk/)

### Desktop UI And Plan Modeling

1. [Tauri overview](https://tauri.app/start/)
2. [Tauri create project](https://v2.tauri.app/start/create-project/)
3. [Electron platform overview](https://www.electronjs.org/)
4. [Electron first app tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app)
5. [Vue Flow](https://vueflow.dev/)
6. [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)
7. [AJV validator](https://ajv.js.org/)

### Optional Future Workflow Backends

1. [BullMQ flows](https://docs.bullmq.io/guide/flows)
2. [Temporal TypeScript docs](https://docs.temporal.io/develop/typescript/timers)
