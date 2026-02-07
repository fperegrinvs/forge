# Forge AGENTS

Workflow policy version: 1.0.0

## Required Workflow
- Follow phases in order: spec -> implement -> refactor -> document -> commit.
- Use code-first BDD with Given/When/Then comments in tests.
- Keep modulith boundaries and import restrictions intact.
- Update documentation and decisions together with code changes.

## Canonical Gates
- gate:spec -> npm run typecheck && npm run test -- --runInBand --passWithNoTests=false
- gate:green -> npm run test && npm run typecheck && npm run lint
- gate:refactor -> npm run test && npm run typecheck && npm run lint
- gate:docs -> npm run docs:check
- gate:commit -> git status --porcelain
- gate:verify -> npm run test && npm run typecheck && npm run lint && npm run test:desktop
