# Forge AGENTS

Workflow policy version: 1.2.0

## Required Workflow
- Follow phases in order: spec -> implement -> refactor -> document -> commit.
- Each phase ends with its gate passing AND a commit. No silent phase transitions.
- Do not advance to the next phase until the gate passes (except diagnostic gates).
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

## BDD/TDD red-green-refactor

- NEVER write production code without a failing test. Tests come first, always.
- The spec phase produces RED tests — they must fail before any implementation.
- The implement phase produces GREEN tests — write only the minimum code to pass.
- The refactor phase keeps tests GREEN — improve structure without changing behavior.
- Each phase ends with its gate passing AND a commit. No silent phase transitions.
- If a gate fails, fix the issue in the current phase. Do not advance.
- If spec-phase tests pass immediately, the specification is too weak — strengthen it.

## Phase → Gate → Commit

| Phase | Gate | Commit | Diagnostic |
|-------|------|--------|------------|
| spec | spec | yes | yes |
| implement | green | yes | no |
| refactor | refactor | yes | no |
| document | docs | yes | no |
| commit | verify | no | no |
