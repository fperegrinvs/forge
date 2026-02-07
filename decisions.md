# Decisions

Track repository-level technical decisions and rationale.

## 2026-02-07
- Enforced fake-first testing policy; mocks now require forge-mock annotations and are limited to adapter_boundary/failure_simulation.
- Standardized repo scripts, workflow gates, and CI on Bun (package manager + script runner) to align with Forge's Bun-first vision.
- Added required Vitest coverage reporting (text + lcov + HTML) with strict baseline thresholds and CI artifact upload.
