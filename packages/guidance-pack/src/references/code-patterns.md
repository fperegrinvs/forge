# Code Patterns Reference

Reference patterns for implementing Forge modules. Loaded by the `implement-green` skill.

## Route Handler with Zod Validation

```typescript
// modules/items/routes.ts
import { z } from "zod";
import type { RouteRegistrar } from "../../shared/types.js";

const CreateItemBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
});

const ItemParams = z.object({
  id: z.string().uuid(),
});

const routes: RouteRegistrar = async (app) => {
  app.get("/items", async (request) => {
    const itemService = request.diScope.resolve("itemService");
    return itemService.list();
  });

  app.get("/items/:id", async (request) => {
    const { id } = ItemParams.parse(request.params);
    const itemService = request.diScope.resolve("itemService");
    return itemService.getById(id);
  });

  app.post("/items", async (request, reply) => {
    const body = CreateItemBody.parse(request.body);
    const itemService = request.diScope.resolve("itemService");
    const item = await itemService.create(body);
    return reply.code(201).send(item);
  });
};

export default routes;
```

Key points:
- Zod schemas co-located with route definitions
- Services resolved from `request.diScope` (per-request awilix scope)
- `satisfies RouteRegistrar` or explicit type annotation on the `routes` const
- Default export — route files are always default-exported

## DI Registration with awilix

```typescript
// modules/items/container.ts
import { asClass, type AwilixContainer } from "awilix";
import { ItemService } from "./services/item.service.js";
import { ItemRepository } from "./infrastructure/item.repository.js";

export function registerItemModule(container: AwilixContainer): void {
  container.register({
    itemService: asClass(ItemService).scoped(),
    itemRepository: asClass(ItemRepository).scoped(),
  });
}
```

Key points:
- Function name: `register<ModuleName>Module`
- Takes `AwilixContainer` parameter — does not create its own container
- Uses `asClass().scoped()` for request-scoped services
- Called from the composition root (app entry point)

## Composition Root

```typescript
// app.ts (composition root)
import Fastify from "fastify";
import { createContainer, asClass } from "awilix";
import { diScopePlugin } from "./plugins/di-scope.js";
import { registerItemModule } from "./modules/items/container.js";
import itemRoutes from "./modules/items/routes.js";

export async function buildApp() {
  const container = createContainer({ injectionMode: "CLASSIC" });

  // Register all modules
  registerItemModule(container);

  const app = Fastify();

  // Attach per-request DI scope
  await app.register(diScopePlugin, { container });

  // Register module routes
  await app.register(itemRoutes, { prefix: "/api" });

  return app;
}
```

## Service with Constructor Injection

```typescript
// modules/items/services/item.service.ts
import type { Item, CreateItemInput } from "../domain/types.js";
import type { ItemRepository } from "../infrastructure/item.repository.js";

export class ItemService {
  constructor(private readonly itemRepository: ItemRepository) {}

  async list(): Promise<Item[]> {
    return this.itemRepository.findAll();
  }

  async getById(id: string): Promise<Item> {
    const item = await this.itemRepository.findById(id);
    if (!item) {
      throw new NotFoundError(`Item ${id} not found`);
    }
    return item;
  }

  async create(input: CreateItemInput): Promise<Item> {
    return this.itemRepository.save({
      id: crypto.randomUUID(),
      ...input,
    });
  }
}
```

Key points:
- Constructor parameters match awilix registration names (camelCase)
- No `@inject` decorators — awilix resolves by parameter name in CLASSIC mode
- Services import from `domain/` and depend on interfaces, not concrete infrastructure

## Domain Types with Zod

```typescript
// modules/items/domain/types.ts
import { z } from "zod";

export const ItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  createdAt: z.date(),
});

export type Item = z.infer<typeof ItemSchema>;

export const CreateItemInputSchema = ItemSchema.omit({
  id: true,
  createdAt: true,
});

export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;
```

Key points:
- Zod schema is the single source of truth; TypeScript type derived via `z.infer<>`
- Schema and type live together in `domain/types.ts`
- Derive sub-schemas with `.omit()`, `.pick()`, `.extend()` — don't duplicate

## Barrel Export

```typescript
// modules/items/index.ts
export { ItemService } from "./services/item.service.js";
export type { Item, CreateItemInput } from "./domain/types.js";
```

Only export the public API. Internal infrastructure, repository implementations, and helper functions stay private to the module.

## Vue Component with provide/inject

```typescript
// frontend: composables/useItems.ts
import { inject } from "vue";
import type { ItemApi } from "../api/items.api.js";

export const ITEM_API_KEY = Symbol("itemApi");

export function useItems() {
  const api = inject<ItemApi>(ITEM_API_KEY);
  if (!api) throw new Error("ItemApi not provided");
  return api;
}
```

```typescript
// frontend: App.vue setup
import { provide } from "vue";
import { ITEM_API_KEY } from "./composables/useItems.js";
import { createItemApi } from "./api/items.api.js";

provide(ITEM_API_KEY, createItemApi());
```

## Vite Proxy Configuration

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
```

In production, Fastify serves the Vite build output directly — no proxy needed.
