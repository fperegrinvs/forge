# Architecture Rules

- Follow modulith module boundaries and import restrictions.
- Keep dependencies pointing inward: domain does not import infrastructure.
- Keep public module API in index.ts and route registration in routes.ts.
