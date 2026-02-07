# Testing Rules

- require_bdd: true
- require_property_tests: true
- require_contract_tests: true
- mock_policy: strict_boundary

Use code-first BDD in test files with Given/When/Then comments.
Prefer fakes for test doubles.
Only use mocks when allowed by policy and annotate each mock call site.
Annotation format: // forge-mock: <reason>
Allowed reasons:
- adapter_boundary
- failure_simulation
Adapter-boundary reason is allowed only in:
- apps/**/*.test.ts
- packages/adapter-*/**/*.test.ts
- packages/**/src/**/*adapter*.test.ts
Run gate:spec with: bun run typecheck && bun run test
Run gate:green with: bun run test && bun run typecheck && bun run lint
Run gate:architecture with: bun run architecture:check
Run gate:refactor with: bun run test && bun run typecheck && bun run lint

## Coverage

Coverage is required and enforced in CI.
Run gate:coverage with: bun run test:coverage

Minimum thresholds:
- lines: 80%
- statements: 80%
- functions: 75%
- branches: 70%

