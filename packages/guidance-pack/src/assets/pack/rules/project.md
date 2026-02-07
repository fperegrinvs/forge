# Project Context

**Forge**: Spec-driven development system powered by AI agents. Plan → Execute → Verify with quality gates at every step.

**Architecture**: TypeScript modulith on Bun. Monorepo with packages/ (domain libraries, adapters, CLI) and apps/ (desktop UI).

## Key Packages
- contracts - Plan schema and validation (JSON Schema 2020-12)
- guidance-pack - Workflow policy, rules, and skills (generated assets)
- check-runner - Task-type gate execution
- control-plane - Plan lifecycle orchestration
- adapter-claude / adapter-codex - Agent runtime adapters
- cli - Public forge CLI commands
- templates - Project and module scaffolding
