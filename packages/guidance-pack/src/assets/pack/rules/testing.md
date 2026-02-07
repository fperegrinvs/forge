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

## Coverage

Coverage is required and enforced in CI.

Minimum thresholds:
- lines: 80%
- statements: 80%
- functions: 75%
- branches: 70%


## Property-Based Test Taxonomy

- round-trip — encode then decode returns original
- idempotence — applying operation twice equals applying once
- invariant — property holds for all valid inputs
- oracle — compare implementation against simple reference
- no-invalid-state — constructor/factory never produces invalid state


## Testing Patterns

- Test public interfaces at every level; avoid reaching into private implementation
- Use buildTestApp() to create a configured Fastify instance for integration tests

