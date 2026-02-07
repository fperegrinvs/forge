# Architecture Guide Reference

Reference for planning and reviewing module architecture. Loaded by the `plan-author` skill.

## Canonical Module Layout

Every module lives in `modules/<name>/` and follows this structure:

```
modules/items/
├── index.ts                          # Barrel: public API only
├── routes.ts                         # RouteRegistrar (Fastify plugin)
├── container.ts                      # registerItemModule(container)
├── domain/
│   └── types.ts                      # Zod schemas + inferred types
├── services/
│   └── item.service.ts               # Business logic, constructor injection
└── infrastructure/
    └── item.repository.ts            # Adapter implementation
```

### File Responsibilities

| File | Responsibility | Imports from |
|------|---------------|-------------|
| `index.ts` | Public barrel exports | `services/`, `domain/` |
| `routes.ts` | HTTP routing, request validation | `domain/` (Zod schemas), DI scope |
| `container.ts` | DI registration | `services/`, `infrastructure/` |
| `domain/types.ts` | Entity types, Zod schemas | External libs only (zod) |
| `services/*.ts` | Business logic | `domain/` types, interfaces |
| `infrastructure/*.ts` | External adapters | `domain/` types |

### Dependency Direction

```
infrastructure/ → services/ → domain/
```

Never import upward. `domain/` is the innermost layer — it knows nothing about services, infrastructure, or routes.

## Cross-Module Communication

Modules communicate through their barrel exports (`index.ts`). Never import directly from another module's internal files:

```typescript
// Correct
import { ItemService } from "../items/index.js";

// Wrong — reaching into another module's internals
import { ItemService } from "../items/services/item.service.js";
```

## Adding a New Module Checklist

1. Create the directory structure (all 6 canonical files)
2. Define domain types in `domain/types.ts` using Zod schemas
3. Implement service classes with constructor injection
4. Add infrastructure adapters (repository, client, etc.)
5. Wire DI in `container.ts` with `registerXModule(container)`
6. Define routes in `routes.ts` as a default-exported `RouteRegistrar`
7. Export public API from `index.ts`
8. Register module in composition root: call container registration + route plugin

## Task Sizing Rules

- A task should be completable and reviewable in isolation
- Each task must have at least one BDD scenario (unless documentation-only)
- If a task touches more than 3 modules, consider splitting
- Infrastructure adapters and their contract tests are separate tasks from domain logic
- Route + validation is a separate task from service logic

## ESLint Enforcement Coverage

The project's ESLint config enforces:
- No `any` types (`@typescript-eslint/no-explicit-any`)
- Import restrictions between modules (no deep imports across boundaries)
- Consistent file naming conventions

These are checked by `gate:green` (`bun run lint`).

## Shared Infrastructure

Framework-level types that span modules live in `shared/`:

```
shared/
└── types.ts      # RouteRegistrar, common framework contracts
```

Module-specific types stay within the module. Only promote to `shared/` when 3+ modules depend on the same type.
