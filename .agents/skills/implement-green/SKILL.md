---
name: implement-green
description: Implement the minimum code to satisfy Forge test gates while preserving modulith boundaries. Use during implementation and refactor phases.
---

# implement-green

Default prompt: Implement the smallest change set that turns failing tests green and passes architecture checks.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.
- Each phase ends with its gate passing AND a commit.
- Do not advance to the next phase until the gate passes (except diagnostic gates).

## Instructions
- Implement domain-first and preserve module boundaries.
- Avoid introducing any or bypassing lint/type checks.
- Keep test doubles fake-first; allow mocks only for adapter boundaries and failure simulation.
- If a mock is unavoidable, annotate call sites with // forge-mock: adapter_boundary or // forge-mock: failure_simulation.
- Run green and refactor gates after implementation updates.
- Keep public APIs stable unless the plan explicitly includes a breaking change.
- Record constraints discovered during implementation in decision notes.
