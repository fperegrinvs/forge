# Forge Monorepo

Forge monorepo implementing Phase 0-2 components from `docs/components-deep-dive.md`.

## Scope Status

- Implemented in this repo: Phases `0-2` (contracts/schema, template+guidance, desktop orchestrator MVP).
- Remaining backlog: Phases `3-4` (hardening/recovery UX and unified distribution).
- See `docs/architecture.md` for explicit remaining work details.

## Packages

- `@forge/contracts`: Plan schema, validators, graph rules.
- `@forge/templates`: Local project and module scaffolding.
- `@forge/guidance-pack`: Guidance artifact + installer.
- `@forge/check-runner`: Task type check execution.
- `@forge/adapter-codex`: Codex adapter implementation.
- `@forge/adapter-claude`: Claude adapter implementation.
- `@forge/control-plane`: Plan execution orchestration and evidence.
- `@forge/cli`: Public `forge` CLI commands.
- `@forge/desktop`: Tauri + Vue orchestrator UI.

## Modules

- Desktop app: `apps/desktop/README.md`
- `@forge/contracts`: `packages/contracts/README.md`
- `@forge/templates`: `packages/templates/README.md`
- `@forge/guidance-pack`: `packages/guidance-pack/README.md`
- `@forge/check-runner`: `packages/check-runner/README.md`
- `@forge/adapter-codex`: `packages/adapter-codex/README.md`
- `@forge/adapter-claude`: `packages/adapter-claude/README.md`
- `@forge/control-plane`: `packages/control-plane/README.md`
- `@forge/cli`: `packages/cli/README.md`
- `@forge/shared-utils`: `packages/shared-utils/README.md`

## Quickstart

1. Run `./scripts/bootstrap-toolchain.sh --check`.
2. Install dependencies with `bun install` (this should generate `bun.lock`; commit it).
3. Synchronize workflow assets with `bun run workflow:sync`.
4. Run `bun run verify`.

## Core Commands

- `forge init <project-name>`
- `forge scaffold module <module-name>`
- `forge install-guidance`
- `forge plan validate --file <path>`
- `forge plan migrate --file <path> --write`
- `forge run next --plan <path>`
- `forge run resume --plan <path> --run-id <id>`
- `forge workflow check --plan <path>`

## Workflow Enforcement

- Canonical policy: `packages/guidance-pack/src/policy/workflow-policy.v1.json`
- Sync generated assets and repo-level guidance links: `bun run workflow:sync`
- Verify generated assets are up to date: `bun run workflow:check-sync`
- Run hard-fail workflow checks for this repo: `bun run workflow:check`
- Run architecture constraints check: `bun run architecture:check`
- Install repo-managed git hooks: `bun run hooks:install`
- Repo-local guidance is exposed via symlinks: `AGENTS.md`, `skills/`, `rules/`, `codex/`.
- Claude compatibility symlinks are maintained: `CLAUDE.md` and `.claude/{CLAUDE.md,skills,rules}`.
- Testing policy is fake-first. Mocks are restricted to `adapter_boundary` or `failure_simulation`.
- Every mock call site must include an adjacent annotation:
  - `// forge-mock: adapter_boundary`
  - `// forge-mock: failure_simulation`

## CI

- GitHub Actions pipeline: `/Users/simon/projects/forge/.github/workflows/ci.yml`
- GitLab CI pipeline: `/Users/simon/projects/forge/.gitlab-ci.yml`
- Both pipelines run the same critical gates: toolchain preflight, workflow sync check, workflow check, and full verify.
