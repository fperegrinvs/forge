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

Every plan must conform to the Forge plan schema v2 (bundled at `schemas/plan.v2.schema.json`). A valid plan contains three top-level fields: `metadata`, `context`, and `tasks`.

```json
{
  "metadata": {
    "project": "my-project",
    "created": "2025-01-15T10:00:00Z",
    "last_updated": "2025-01-15T10:00:00Z",
    "spec_version": "v2",
    "approved": false
  },
  "context": {
    "goals": ["Add user authentication"],
    "constraints": ["Must use existing user table"],
    "tech_decisions": { "auth": "JWT with refresh tokens" },
    "architecture": "modulith"
  },
  "tasks": [
    {
      "id": "define-auth-types",
      "task_type": "implementation",
      "name": "Define authentication domain types",
      "description": "Create Zod schemas and TS types for login request/response",
      "files": ["packages/auth/src/domain/types.ts"],
      "dependencies": [],
      "acceptance_criteria": [
        "Given a valid login payload, When validated, Then no errors are thrown"
      ],
      "verification_command": "bun run test && bun run typecheck",
      "tests": {
        "bdd_scenarios": ["login-payload-validation"],
        "property_invariants": ["round-trip: encode then decode returns original"],
        "contract_tests": []
      },
      "documentation": {
        "updates": ["docs/auth.md"],
        "decision_notes": "JWT chosen over session cookies for stateless scaling"
      }
    }
  ]
}
```

### Required Top-Level Fields

| Field | Required | Notes |
|-------|----------|-------|
| `metadata` | yes | Project name, timestamps, spec version, approval flag |
| `context` | yes | Goals, constraints, tech decisions, architecture |
| `tasks` | yes | Array of task objects (at least one) |

### Required Metadata Fields

| Field | Required | Notes |
|-------|----------|-------|
| `metadata.project` | yes | Project name |
| `metadata.created` | yes | ISO-8601 timestamp |
| `metadata.last_updated` | yes | ISO-8601 timestamp |
| `metadata.spec_version` | yes | Must be `"v2"` |
| `metadata.approved` | yes | Boolean approval flag |

### Required Context Fields

| Field | Required | Notes |
|-------|----------|-------|
| `context.goals` | yes | Array of goal strings |
| `context.constraints` | yes | Array of constraint strings |
| `context.tech_decisions` | yes | Object mapping decision names to rationale strings |
| `context.architecture` | yes | Must be `"modulith"` |

### Required Fields per Task

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Lowercase alphanumeric with hyphens/underscores |
| `task_type` | yes | e.g. `implementation`, `testing`, `documentation` |
| `name` | yes | Imperative verb phrase |
| `description` | yes | Context for the executing agent |
| `files` | yes | Array of file paths this task touches |
| `dependencies` | yes | Array of task IDs (empty for root tasks) |
| `acceptance_criteria` | yes | At least one BDD scenario for non-doc tasks |
| `verification_command` | yes | Single CI-runnable command string |
| `tests` | yes | Object with `bdd_scenarios`, `property_invariants`, `contract_tests` arrays |
| `documentation` | yes | Object with `updates` array and `decision_notes` string |
| `status` | no | BDD phase: "", "spec", "implement", "refactor", "document", "completed" |
| `steps` | no | Optional sub-step breakdown |

## Authoritative JSON Schema

The schema below is the single source of truth. A sync test in `packages/guidance-pack` verifies this block matches `packages/contracts/src/schema/plan.v1.schema.json`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://forge.dev/schema/plan.v1.json",
  "type": "object",
  "required": ["metadata", "context", "tasks"],
  "properties": {
    "metadata": {
      "type": "object",
      "required": ["project", "created", "last_updated", "spec_version", "approved"],
      "properties": {
        "project": { "type": "string", "minLength": 1 },
        "created": { "type": "string", "format": "date-time" },
        "last_updated": { "type": "string", "format": "date-time" },
        "spec_version": { "const": "v2" },
        "approved": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "context": {
      "type": "object",
      "required": ["goals", "constraints", "tech_decisions", "architecture"],
      "properties": {
        "goals": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "constraints": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "tech_decisions": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "architecture": { "const": "modulith" }
      },
      "additionalProperties": false
    },
    "tasks": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "id",
          "task_type",
          "name",
          "description",
          "files",
          "dependencies",
          "acceptance_criteria",
          "verification_command",
          "tests",
          "documentation"
        ],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-_]*$" },
          "task_type": { "type": "string", "minLength": 1 },
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string", "minLength": 1 },
          "files": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          },
          "dependencies": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "uniqueItems": true
          },
          "acceptance_criteria": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "minLength": 1 }
          },
          "verification_command": { "type": "string", "minLength": 1 },
          "tests": {
            "type": "object",
            "required": ["bdd_scenarios", "property_invariants", "contract_tests"],
            "properties": {
              "bdd_scenarios": {
                "type": "array",
                "items": { "type": "string", "minLength": 1 }
              },
              "property_invariants": {
                "type": "array",
                "items": { "type": "string", "minLength": 1 }
              },
              "contract_tests": {
                "type": "array",
                "items": { "type": "string", "minLength": 1 }
              }
            },
            "additionalProperties": false
          },
          "documentation": {
            "type": "object",
            "required": ["updates", "decision_notes"],
            "properties": {
              "updates": {
                "type": "array",
                "items": { "type": "string", "minLength": 1 }
              },
              "decision_notes": { "type": "string" }
            },
            "additionalProperties": false
          },
          "status": {
            "type": "string",
            "enum": ["", "spec", "implement", "refactor", "document", "completed"]
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "name"],
              "properties": {
                "id": { "type": "string", "minLength": 1 },
                "name": { "type": "string", "minLength": 1 },
                "description": { "type": "string" }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

## Well-Formed Task Example

```json
{
  "id": "add-login-endpoint",
  "task_type": "implementation",
  "name": "Add POST /api/auth/login endpoint",
  "description": "Create login route with Zod validation, JWT token generation, and password verification against the user repository.",
  "files": [
    "packages/auth/src/routes.ts",
    "packages/auth/src/services/login.ts"
  ],
  "dependencies": ["define-auth-domain-types"],
  "acceptance_criteria": [
    "Given valid credentials, When POST /api/auth/login is called, Then a 200 response with a JWT token is returned",
    "Given invalid credentials, When POST /api/auth/login is called, Then a 401 response is returned",
    "Given malformed body, When POST /api/auth/login is called, Then a 400 response with validation errors is returned"
  ],
  "verification_command": "bun run test && bun run typecheck && bun run lint",
  "tests": {
    "bdd_scenarios": [
      "valid-credentials-returns-jwt",
      "invalid-credentials-returns-401",
      "malformed-body-returns-400"
    ],
    "property_invariants": [
      "round-trip: JWT encode then decode returns original claims"
    ],
    "contract_tests": [
      "login-endpoint-conforms-to-openapi-spec"
    ]
  },
  "documentation": {
    "updates": ["docs/api.md"],
    "decision_notes": "JWT chosen for stateless auth; refresh token stored in httpOnly cookie"
  }
}
```

## Task Dependency Rules

- Tasks form a DAG (directed acyclic graph) — no circular dependencies
- Domain types must be defined before services that use them
- Infrastructure adapters are separate tasks from domain logic
- Documentation tasks depend on the implementation tasks they document
- Keep tasks small enough to complete and review independently
