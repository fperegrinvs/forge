# Architecture Rules

## Module Layout

Every module directory contains:

- index.ts — barrel exports of public API only
- routes.ts — default-exports RouteRegistrar (Fastify plugin)
- container.ts — exports registerXModule(container) for DI registration
- services/ — business logic classes with constructor injection
- domain/ — types, schemas, validation; no infrastructure imports
- infrastructure/ — repository implementations, external adapters

## Dependency Direction

`infrastructure/ → services/ → domain/ (never reverse)`

Cross-module imports go through index.ts only.

## DI Pattern

registerXModule(container) in container.ts, called from composition root; use asClass().scoped() for request-scoped services.

## Route Pattern

routes.ts default-exports RouteRegistrar (async Fastify plugin); resolve services via diScope.

## Shared Types

Framework contracts (RouteRegistrar) in shared/types.ts; module types via barrel exports.
