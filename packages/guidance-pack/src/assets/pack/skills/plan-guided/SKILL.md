---
name: plan-guided
description: Guided plan creation with enforced quality constraints. Extends plan-author with schema compliance, BDD requirements, coverage targets, and save-location conventions. Use from an interactive terminal session.
---

# plan-guided

Default prompt: Create a new Forge plan interactively. Ask the user to describe the feature, then produce a schema-v2-compliant plan saved to the plans/ directory.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.
- Each phase ends with its gate passing AND a commit.
- Do not advance to the next phase until the gate passes (except diagnostic gates).

## Instructions
- Save all plans to the plans/ directory with a descriptive filename (e.g. plans/add-user-auth.json).
- Every plan must conform to Forge plan schema v2 — include schema, metadata, and tasks fields.
- Every non-documentation task must have at least one BDD acceptance criterion in Given/When/Then format.
- Set verification.coverage_target to at least 80 for every implementation task.
- Include documentation_updates for every task — even if the array is empty.
- Verification commands must be CI-runnable (bun run test, bun run typecheck, bun run lint).
- Ask the user to describe the feature before generating the plan — do not assume requirements.
- Keep tasks small, dependency-ordered, and independently verifiable.
