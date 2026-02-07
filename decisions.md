# Decisions

Track repository-level technical decisions and rationale.

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
