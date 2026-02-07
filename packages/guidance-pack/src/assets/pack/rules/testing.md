# Testing Rules

- require_bdd: true
- require_property_tests: true
- require_contract_tests: true

Use code-first BDD in test files with Given/When/Then comments.
Run gate:spec with: npm run typecheck && npm run test -- --runInBand --passWithNoTests=false
Run gate:green with: npm run test && npm run typecheck && npm run lint
Run gate:refactor with: npm run test && npm run typecheck && npm run lint
