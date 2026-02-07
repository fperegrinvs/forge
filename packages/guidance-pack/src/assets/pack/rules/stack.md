# Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict, no decorators) |
| Backend | Fastify |
| DI | awilix (scoped containers) |
| Validation | Zod |
| Frontend | Vue 3.5 + Vuetify |
| Bundler | Vite |
| Testing | Vitest + fast-check |

**Serving model**: Single-origin SPA: Fastify serves API routes + Vite build output

## Do Not Use

- Do not use Tailwind — Vuetify handles component styling
- Do not use Nuxt or SSR — single-origin SPA only
- Do not use Bun-native APIs (Bun.serve, Bun.file) — use Node-compatible APIs for portability
- Do not use decorators — use plain functions and constructor injection
- Do not use `any` — use `unknown` with type narrowing
