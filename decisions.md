# Decisions

Track repository-level technical decisions and rationale.

## 2026-02-08 (desktop UX, Claude Code runs, and pre-push gates)
- Desktop now persists the last selected project root (localStorage) so users don't have to re-browse on restart.
- Folder pickers no longer open twice when clicking "Browse" (stop click propagation on the append button).
- Discovered plans are ordered newest-first (by file mtime descending) to surface the most likely plan.
- Removed the explicit "Validate Plan" button; validation happens automatically in the background and "Run" blocks when invalid.
- New Plan guided flow now detects and surfaces both newly created and updated plan files using `modifiedMs` from `/api/plans/list`.
- Renamed the desktop adapter label from "claude" to "Claude Code" (internal value remains `claude`).
- Claude adapter now runs Claude Code in non-interactive mode with explicit permissions/tool allowlist and better prompt/flag ordering; control-plane surfaces `claude --resume <id>` when a session ID is available.
- Stabilized the Codex terminal used by New Plan: keep PTY master alive across WS reconnects, buffer initial output until WS attach, and (macOS only) wrap `codex` in `/usr/bin/script` to avoid Codex aborting on stdout writes; also improved WS error reporting and focus.
- Added a pre-push git hook to run `typecheck` before pushing (configurable via env), shipped and auto-configured via guidance pack install when `.githooks/` is present and `core.hooksPath` is unset.
- Desktop Packs tab now supports selecting a pack name, downloading latest, selecting a downloaded version, and installing/updating/replacing the project pack; switching pack names warns about mixed state unless force replace is used.
- Guidance packs now provide default phase gate bindings via `manifest.json` (`default_phase_gate_bindings`) and ship policy-generated shell wrappers under `scripts/phase-gates/*.sh`.
- `installGuidance` seeds project-scoped `.forge/phase-gates.json` from the selected pack defaults when missing, and never overwrites an existing file.
- Desktop Packs tab now shows a selected pack's workflow phases/gates (as a simple ordered list) and allows binding per-phase validation scripts via a native file picker; bindings persist per project in `.forge/phase-gates.json`.
- `forge install-guidance` now writes best-effort `.forge/guidance.json` metadata recording the installed pack name/version/path and timestamp; Desktop surfaces this as the project's pack source.
- `forge run next --adapter codex` now performs a lightweight preflight to sync `skills/*/SKILL.md` into `.agents/skills/*/SKILL.md` so Codex-native skill discovery stays consistent.
- Added `forge workflow auto --plan <path>`: a Ralph-loop style runner that advances tasks through spec→implement→refactor→document→commit, runs phase gate scripts, commits after each successful phase, and updates `tasks[].status` in the plan file.
- Workflow auto uses `codex app-server` (JSON-RPC-over-JSONL) for Codex runs and an interactive Claude Code session wrapped via `/usr/bin/script` + hooks for lifecycle signaling.
- Claude hook bridge runner is now import-safe (only executes when run as a script), enabling unit tests while preserving hook CLI behavior; Claude PTY adapter gained small dependency injection points for faking spawn/interfaces in tests.
- Claude hook callback HTTP server calls `unref()` after listening so it won’t keep the process alive on its own (important for tests and short-lived CLI runs).
- Updated the spec gate wrapper script to succeed only when tests are RED (typecheck passes and test suite fails), aligning with the code-first BDD discipline.

## 2026-02-07 (unified Run action & schema improvements)
- Unified "Run Next" and "Resume" into a single "Run" action: `runNext()` now auto-resumes paused state (sets task from "paused" to "pending", clears `pausedRun`) instead of returning early, eliminating the need for a separate resume step.
- Removed the redundant `pausedRunId` field from `RuntimeState` (was always a copy of `pausedRun.runId`); kept a read-time migration in `loadState()` for existing state files.
- Removed `/api/run/resume` and `/api/run/pause` endpoints from the desktop Rust backend, and `resumeRun()`/`pauseRun()` from the frontend composable — `runNext` handles everything.
- Added optional `status` field to plan task schema for BDD phase tracking ("spec", "implement", "refactor", "document", "completed").
- Removed `unknown_task_type` validation from graph validator — task types are open-ended and not restricted to a check-runner registry.
- Embedded the authoritative JSON schema in `plan-constraints.md` with a sync test to keep it aligned with the contracts source of truth.
- NewPlanDialog now detects plans created during the terminal session, shows validation status inline, and offers a "Use Plan" button to select them.
- `forge_cli.rs` now treats CLI exit code 2 (structured validation failure) as valid JSON output instead of an error.

## 2026-02-07 (agent-native skill commands & dialog UX)
- `installGuidance` now registers skills as agent-native commands: `.claude/commands/<name>.md` for Claude Code (YAML frontmatter stripped) and `.agents/skills/<name>/SKILL.md` for Codex (full content preserved). This lets both agents discover Forge skills as native slash commands without manual setup.
- Added `stripFrontmatter` helper to remove YAML frontmatter blocks from SKILL.md files, since Claude Code commands don't use frontmatter.
- `registerSkillCommands` is idempotent — identical files are skipped via SHA-1 hash comparison, matching the existing `installGuidanceFromPackRoot` pattern.
- NewPlanDialog instruction text is now adapter-conditional: Claude users see `/plan-guided`, Codex users see `$plan-guided`, matching each agent's native command syntax.
- NewPlanDialog instructions panel is collapsible via a chevron toggle, expanding the terminal to full dialog width when hidden.
- NewPlanDialog is now resizable via CSS `resize: both` on the card, constrained to 90vw/90vh.

## 2026-02-07 (planning agent with embedded terminal)
- Added `plan-guided` skill to the guidance pack — extends `plan-author` with enforced constraints for interactive plan creation: schema v2 compliance, BDD acceptance criteria required, 80% coverage targets, save to `plans/` directory.
- Chose `portable-pty` (Rust crate) for cross-platform PTY spawning — supports macOS, Linux, and Windows without platform-specific code.
- Terminal I/O streams over Axum WebSocket (`GET /api/terminal/:id/ws`) rather than Tauri IPC — natural fit for high-frequency bidirectional streaming on the existing single-origin HTTP server.
- Created `TerminalManager` in `terminal.rs` with spawn/kill/resize/take_io lifecycle and a 30-minute session timeout to prevent orphaned PTY processes.
- Frontend uses xterm.js (`@xterm/xterm`) with FitAddon and WebLinksAddon — industry-standard terminal emulator for web, with ResizeObserver for automatic PTY resize on container changes.
- `useTerminal.ts` composable follows the same fetch-wrapper pattern as `useControlPlane.ts` — separate concern (interactive sessions) from plan orchestration (request/response API).
- `NewPlanDialog.vue` follows the `CreateProjectDialog.vue` pattern — persistent Vuetify dialog, spawns PTY on open, kills on close, with error state handling and single WS reconnect retry.

## 2026-02-07 (desktop: project creation & bundled packs)
- Bundled the guidance pack as a Tauri resource so the Packs tab shows `forge-guidance-pack` immediately on app startup without requiring a GitHub release download.
- In dev mode, bundled packs resolve via `CARGO_MANIFEST_DIR` relative path to `packages/guidance-pack/src/assets/`; in production, via the Tauri resource directory (`bundled-packs/`).
- Bundled packs merge with downloaded packs at runtime; downloaded versions take precedence over bundled ones with the same name.
- Added native folder picker via the `rfd` crate exposed through `GET /api/dialog/select-folder`.
- Added `GET /api/templates` (hardcoded forge-template for now) and `POST /api/project/init` (delegates to `forge init` CLI) for project creation from the desktop UI.
- Offline-resilient: `packs_check_updates` returns empty gracefully when the GitHub releases index is unreachable.

## 2026-02-07 (single-port & workflow discipline)
- Desktop app uses a Rust HTTP server embedded in Tauri (`http_server.rs`) to serve both static frontend assets and `/api/*` routes on a single port (1420), eliminating CORS and multi-origin issues.
- Desktop UI communicates with the backend via HTTP `/api/*` on the same origin instead of Tauri `invoke()` commands, simplifying the frontend code.
- Added `dev:singleport`, `dev:desktop:tauri`, and `dev:desktop:tauri:oneshot` scripts for desktop development workflows.
- Registered Vuetify components/directives explicitly and added `@mdi/font` for icon support.
- Workflow policy v1.2.0: each phase now maps to a named gate with commit and diagnostic semantics; BDD/TDD red-green-refactor discipline is enforced in AGENTS.md and all skill files.

## 2026-02-07 (monorepo-v1)
- Enforced fake-first testing policy; mocks now require forge-mock annotations and are limited to adapter_boundary/failure_simulation.
- Standardized repo scripts, workflow gates, and CI on Bun (package manager + script runner) to align with Forge's Bun-first vision.
- Added required Vitest coverage reporting (text + lcov + HTML) with strict baseline thresholds and CI artifact upload.
- Committed Bun lockfile (`bun.lock`) and updated CI to use frozen installs when a Bun lockfile is present (`bun.lock` or legacy `bun.lockb`).
- Reworked CLI termination to throw a typed `CliExit` instead of calling `process.exit` inside Commander actions, improving testability while preserving exit codes in the bin wrapper.
- Added targeted CLI/guidance-pack tests and Vitest workspace source aliasing to meet coverage thresholds on a clean checkout (no pre-build required to run tests).
- Hardened guidance pack distribution: prevent zip symlink entries pre-extraction and install pack files as bytes to avoid corrupting non-UTF8 assets.
