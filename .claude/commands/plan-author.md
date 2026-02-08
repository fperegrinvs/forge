# plan-author

Default prompt: Draft or revise a Forge plan with complete task metadata, dependencies, verification commands, and documentation updates.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.
- Each phase ends with its gate passing AND a commit.
- Do not advance to the next phase until the gate passes (except diagnostic gates).

## Instructions
- Keep every task small enough for deterministic execution and review.
- For each non-documentation task, include at least one code-first BDD scenario.
- Describe property and contract tests when applicable; use empty arrays only if not relevant.
- Prefer fakes over mocks in planned tests; reserve mocks for adapter boundaries and failure simulation.
- Always include documentation updates and decision notes for each task.
- Use verification commands that can run unattended in CI.
