---
name: plan-author
description: Create or revise Forge plan artifacts with dependency-aware tasks, explicit tests metadata, and documentation updates. Use when planning or re-planning work before implementation.
---

# plan-author

Default prompt: Draft or revise a Forge plan with complete task metadata, dependencies, verification commands, and documentation updates.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.

## Instructions
- Keep every task small enough for deterministic execution and review.
- For each non-documentation task, include at least one code-first BDD scenario.
- Describe property and contract tests when applicable; use empty arrays only if not relevant.
- Always include documentation updates and decision notes for each task.
- Use verification commands that can run unattended in CI.
