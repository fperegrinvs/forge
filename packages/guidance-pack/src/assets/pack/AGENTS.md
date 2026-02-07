# Forge AGENTS

Workflow policy version: 1.1.0

## Required Workflow
- Follow phases in order: spec -> implement -> refactor -> document -> commit.
- Before starting work: fetch latest (`git fetch origin`) and rebase onto `origin/main`.
- Use code-first BDD with Given/When/Then comments in tests.
- Prefer fakes over mocks. Mocks require annotation (forge-mock) and are only for adapter_boundary or failure_simulation.
- Keep modulith boundaries and import restrictions intact.
- Update documentation and decisions together with code changes.
- Never commit or push directly to `main`. Work on a `codex/*` branch and open a PR.

## Canonical Gates
- gate:spec -> bun run typecheck && bun run test
- gate:green -> bun run test && bun run typecheck && bun run lint
- gate:refactor -> bun run test && bun run typecheck && bun run lint
- gate:architecture -> bun run architecture:check
- gate:coverage -> bun run test:coverage
- gate:docs -> bun run docs:check
- gate:commit -> git status --porcelain
- gate:verify -> bun run test:coverage && bun run typecheck && bun run lint && bun run architecture:check
