# Workflow Discipline

Phases: spec -> implement -> refactor -> document -> commit

## BDD/TDD red-green-refactor

- NEVER write production code without a failing test. Tests come first, always.
- The spec phase produces RED tests — they must fail before any implementation.
- The implement phase produces GREEN tests — write only the minimum code to pass.
- The refactor phase keeps tests GREEN — improve structure without changing behavior.
- Each phase ends with its gate passing AND a commit. No silent phase transitions.
- If a gate fails, fix the issue in the current phase. Do not advance.
- If spec-phase tests pass immediately, the specification is too weak — strengthen it.

## Phase → Gate → Commit

| Phase | Gate | Commit | Prefix | Diagnostic |
|-------|------|--------|--------|------------|
| spec | spec | yes | spec | yes |
| implement | green | yes | implement | no |
| refactor | refactor | yes | refactor | no |
| document | docs | yes | docs | no |
| commit | verify | no | — | no |

- **Diagnostic gate**: run for observation (confirm red), not as a pass/fail blocker.
- **Non-diagnostic gate**: MUST pass before committing and advancing.
- **Commit**: create a commit with the phase prefix after the gate passes.
