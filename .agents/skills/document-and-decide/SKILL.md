---
name: document-and-decide
description: Update task documentation and decision records to match implementation. Use during the documentation phase before commit.
---

# document-and-decide

Default prompt: Update docs and decision notes so they accurately describe implemented behavior and interfaces.

## Workflow
- Follow phases: spec -> implement -> refactor -> document -> commit.
- Keep changes deterministic and aligned with policy gates.
- Each phase ends with its gate passing AND a commit.
- Do not advance to the next phase until the gate passes (except diagnostic gates).

## Instructions
- Update affected docs files and keep wording implementation-accurate.
- Update decisions.md with rationale for meaningful technical decisions.
- Ensure public interfaces include concise documentation comments.
- Run the docs gate after documentation edits.
- Reject completion if code and documentation diverge.
