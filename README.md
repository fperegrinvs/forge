# Forge Monorepo

Forge monorepo implementing Phase 0-2 components from `docs/components-deep-dive.md`.

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

## Quickstart

1. Run `./scripts/bootstrap-toolchain.sh --check`.
2. Install dependencies using your package manager (`bun install` preferred).
3. Run `npm run verify`.

## Core Commands

- `forge init <project-name>`
- `forge scaffold module <module-name>`
- `forge install-guidance`
- `forge plan validate --file <path>`
- `forge run next --plan <path>`
