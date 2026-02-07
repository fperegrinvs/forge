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
Run gate:spec with: npm run typecheck && npm run test -- --runInBand --passWithNoTests=false
Run gate:green with: npm run test && npm run typecheck && npm run lint
Run gate:architecture with: npm run architecture:check
Run gate:refactor with: npm run test && npm run typecheck && npm run lint
