# Test Patterns Reference

Reference patterns for writing tests in Forge projects. Loaded by the `spec-bdd` skill.

## BDD Test with Given/When/Then

```typescript
import { describe, it, expect } from "vitest";
import { ItemService } from "../services/item.service.js";
import { FakeItemRepository } from "./fakes/fake-item.repository.js";

describe("ItemService", () => {
  it("returns an item by id", async () => {
    // Given an item exists in the repository
    const repo = new FakeItemRepository();
    const existing = await repo.save({
      id: "abc-123",
      name: "Widget",
      createdAt: new Date(),
    });
    const service = new ItemService(repo);

    // When we request the item by id
    const result = await service.getById("abc-123");

    // Then we receive the stored item
    expect(result).toEqual(existing);
  });

  it("throws NotFoundError for missing items", async () => {
    // Given an empty repository
    const repo = new FakeItemRepository();
    const service = new ItemService(repo);

    // When we request a non-existent item
    // Then a NotFoundError is thrown
    await expect(service.getById("missing")).rejects.toThrow("not found");
  });
});
```

Key points:
- Given/When/Then as comments, not framework DSL
- Fakes over mocks — `FakeItemRepository` implements the same interface with in-memory state
- One behavior per test; test name describes the behavior

## Fake Implementation

```typescript
// tests/fakes/fake-item.repository.ts
import type { Item } from "../../domain/types.js";

export class FakeItemRepository {
  private items = new Map<string, Item>();

  async findById(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async findAll(): Promise<Item[]> {
    return [...this.items.values()];
  }

  async save(item: Item): Promise<Item> {
    this.items.set(item.id, item);
    return item;
  }
}
```

## Property-Based Tests by Taxonomy

### Round-trip

Encode then decode returns the original value.

```typescript
import { describe, it } from "vitest";
import fc from "fast-check";
import { ItemSchema } from "../domain/types.js";

describe("ItemSchema round-trip", () => {
  it("parse(serialize(item)) returns original", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 200 }),
          description: fc.option(fc.string(), { nil: undefined }),
          createdAt: fc.date(),
        }),
        (item) => {
          const serialized = JSON.parse(JSON.stringify(item));
          const parsed = ItemSchema.parse({
            ...serialized,
            createdAt: new Date(serialized.createdAt),
          });
          expect(parsed).toEqual(item);
        }
      )
    );
  });
});
```

### Idempotence

Applying the operation twice equals applying once.

```typescript
it("normalizing an item name is idempotent", () => {
  fc.assert(
    fc.property(fc.string(), (raw) => {
      const once = normalizeName(raw);
      const twice = normalizeName(once);
      expect(twice).toBe(once);
    })
  );
});
```

### Invariant

A property that holds for all valid inputs.

```typescript
it("created items always have a valid UUID id", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.string({ minLength: 1, maxLength: 200 }),
      }),
      async (input) => {
        const repo = new FakeItemRepository();
        const service = new ItemService(repo);
        const item = await service.create(input);
        expect(item.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      }
    )
  );
});
```

### Oracle

Compare implementation against a simple reference.

```typescript
it("sort matches Array.sort for comparable inputs", () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      const oracle = [...arr].sort((a, b) => a - b);
      const result = customSort(arr);
      expect(result).toEqual(oracle);
    })
  );
});
```

### No-invalid-state

Constructor or factory never produces invalid state.

```typescript
it("ItemSchema.parse never produces items with empty names", () => {
  fc.assert(
    fc.property(
      fc.record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 200 }),
        description: fc.option(fc.string(), { nil: undefined }),
        createdAt: fc.date(),
      }),
      (input) => {
        const item = ItemSchema.parse(input);
        expect(item.name.length).toBeGreaterThan(0);
      }
    )
  );
});
```

## Contract Test Structure

Contract tests verify that an adapter satisfies the interface contract expected by the domain.

```typescript
import { describe, it, expect } from "vitest";
import { FakeItemRepository } from "./fakes/fake-item.repository.js";

// The same suite runs against both fakes and real adapters.
// When running against real adapters, annotate with forge-mock if needed.
function itemRepositoryContract(createRepo: () => ItemRepository) {
  describe("ItemRepository contract", () => {
    it("save then findById returns the item", async () => {
      // Given a repository
      const repo = createRepo();
      const item = { id: "1", name: "Test", createdAt: new Date() };

      // When we save and retrieve
      await repo.save(item);
      const found = await repo.findById("1");

      // Then the retrieved item matches
      expect(found).toEqual(item);
    });

    it("findById returns undefined for missing items", async () => {
      const repo = createRepo();
      const found = await repo.findById("nonexistent");
      expect(found).toBeUndefined();
    });
  });
}

// Run against fake
itemRepositoryContract(() => new FakeItemRepository());

// Run against real adapter (in adapter package tests only)
// itemRepositoryContract(() => new SqliteItemRepository(testDb));
```

## Integration Test with buildTestApp

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "../test-utils/build-test-app.js";

describe("Items API integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/items creates an item", async () => {
    // Given a running app
    // When we create an item
    const response = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { name: "Widget" },
    });

    // Then it returns 201 with the created item
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("Widget");
    expect(body.id).toBeDefined();
  });
});
```

`buildTestApp()` creates a fully configured Fastify instance with DI container, all modules registered, and in-memory adapters — no external dependencies needed.
