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
- Every plan must conform to Forge plan schema v2 — include metadata, context, and tasks fields.
- Include a context block with goals, constraints, tech_decisions, and architecture set to "modulith".
- Every non-documentation task must have at least one BDD acceptance criterion in Given/When/Then format.
- Set verification_command to a CI-runnable command (e.g. "bun run test && bun run typecheck && bun run lint").
- Include a tests object for every task with bdd_scenarios, property_invariants, and contract_tests arrays.
- Include a files array listing all file paths the task will touch.
- Include a documentation object with updates array and decision_notes string for every task.
- Ask the user to describe the feature before generating the plan — do not assume requirements.
- Keep tasks small, dependency-ordered, and independently verifiable.
