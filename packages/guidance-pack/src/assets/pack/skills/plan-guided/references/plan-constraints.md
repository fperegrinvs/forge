# Plan Constraints Reference

Reference for guided plan creation. Loaded by the `plan-guided` skill.

## Plan File Location

Save all plans to the `plans/` directory at the project root. Use descriptive filenames:

```
plans/
├── add-user-auth.json
├── refactor-database-layer.json
└── fix-checkout-flow.json
```

## Plan JSON Structure (Schema v2)

Every plan must conform to the Forge plan schema v2. A valid plan contains:

```json
{
  "schema": "forge-plan-v2",
  "metadata": {
    "title": "Feature title",
    "description": "Why this plan exists",
    "created": "ISO-8601 timestamp"
  },
  "tasks": [
    {
      "id": "task-1",
      "title": "Descriptive task title",
      "type": "implementation",
      "description": "What this task accomplishes",
      "dependencies": [],
      "acceptance_criteria": [
        "Given/When/Then scenario"
      ],
      "verification": {
        "commands": ["bun run test", "bun run typecheck"],
        "coverage_target": 80
      },
      "documentation_updates": ["docs/feature.md"]
    }
  ]
}
```

### Required Fields per Task

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique within the plan |
| `title` | yes | Imperative verb phrase |
| `type` | yes | `implementation`, `testing`, or `documentation` |
| `description` | yes | Context for the executing agent |
| `dependencies` | yes | Array of task IDs (empty for root tasks) |
| `acceptance_criteria` | yes | At least one BDD scenario for non-doc tasks |
| `verification.commands` | yes | CI-runnable commands |
| `verification.coverage_target` | no | Default: 80% lines |
| `documentation_updates` | yes | Files to update (empty array if none) |

## Coverage Thresholds

All plans must target these minimums:

- Lines: 80%
- Statements: 80%
- Functions: 75%
- Branches: 70%

## Well-Formed Task Example

```json
{
  "id": "add-login-endpoint",
  "title": "Add POST /api/auth/login endpoint",
  "type": "implementation",
  "description": "Create login route with Zod validation, JWT token generation, and password verification against the user repository.",
  "dependencies": ["define-auth-domain-types"],
  "acceptance_criteria": [
    "Given valid credentials, When POST /api/auth/login is called, Then a 200 response with a JWT token is returned",
    "Given invalid credentials, When POST /api/auth/login is called, Then a 401 response is returned",
    "Given malformed body, When POST /api/auth/login is called, Then a 400 response with validation errors is returned"
  ],
  "verification": {
    "commands": [
      "bun run test",
      "bun run typecheck",
      "bun run lint"
    ],
    "coverage_target": 80
  },
  "documentation_updates": [
    "docs/api.md"
  ]
}
```

## Task Dependency Rules

- Tasks form a DAG (directed acyclic graph) — no circular dependencies
- Domain types must be defined before services that use them
- Infrastructure adapters are separate tasks from domain logic
- Documentation tasks depend on the implementation tasks they document
- Keep tasks small enough to complete and review independently
