# Documentation Standards Reference

Reference for documentation and decision records. Loaded by the `document-and-decide` skill.

## Documentation Update Checklist

When implementation changes behavior or interfaces:

- [ ] Update affected files in `docs/` to match new behavior
- [ ] Record rationale in `decisions.md` for meaningful technical decisions
- [ ] Ensure public barrel exports have concise JSDoc comments
- [ ] Verify Zod schemas serve as living documentation (type + validation in one place)
- [ ] Run `bun run docs:check` to verify consistency

## Decision Record Format

```markdown
## <Date> — <Title>

**Status**: Accepted | Superseded by <link> | Deprecated

**Context**: What is the situation that requires a decision?

**Decision**: What did we decide?

**Consequences**: What are the trade-offs? What becomes easier or harder?
```

### Example

```markdown
## 2025-03-15 — Use awilix for DI instead of manual wiring

**Status**: Accepted

**Context**: As the number of modules grows, manual constructor wiring in the composition root
becomes error-prone. We need a DI container that supports scoped lifetimes for request-scoped services.

**Decision**: Use awilix with CLASSIC injection mode. Each module exports a `registerXModule(container)` function.

**Consequences**:
- Constructor parameter names must match registration names (enforced by convention)
- No decorator dependency; aligns with our no-decorators rule
- Scoped containers give us per-request isolation for free
```

## Zod as Living Documentation

Zod schemas serve as both validation and documentation. When you update a domain type:

1. Update the Zod schema first — it is the source of truth
2. The TypeScript type (`z.infer<>`) updates automatically
3. Validation rules embedded in the schema document constraints that prose docs often miss

```typescript
// This schema documents: id is UUID, name is 1-200 chars, description is optional
export const ItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  createdAt: z.date(),
});
```

## What Belongs in docs/ vs decisions.md

| Content | Location |
|---------|----------|
| System architecture overview | `docs/architecture.md` |
| API contracts and module boundaries | `docs/architecture.md` |
| Technology choice rationale | `decisions.md` |
| Design trade-off decisions | `decisions.md` |
| Pattern changes and why | `decisions.md` |
| Setup and onboarding instructions | `docs/` |
