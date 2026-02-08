# spec-bdd

Default prompt: Write failing tests first using Given/When/Then comments and align them to plan acceptance criteria.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.
- Each phase ends with its gate passing AND a commit.
- Do not advance to the next phase until the gate passes (except diagnostic gates).

## Instructions
- Write failing tests before implementation changes.
- Use Given/When/Then comments in test bodies.
- Favor behavior-focused assertions over implementation detail coupling.
- Use fakes by default; only use mocks for adapter boundaries or explicit failure simulation.
- When using mocks, annotate each call site with // forge-mock: adapter_boundary or // forge-mock: failure_simulation.
- Run the spec gate command after creating tests.
- If tests pass before implementation, strengthen the specification.
