# Decisions

Track repository-level technical decisions and rationale.

## 2026-02-07
- Enforced fake-first testing policy; mocks now require forge-mock annotations and are limited to adapter_boundary/failure_simulation.
- Standardized repo scripts, workflow gates, and CI on Bun (package manager + script runner) to align with Forge's Bun-first vision.
- Added required Vitest coverage reporting (text + lcov + HTML) with strict baseline thresholds and CI artifact upload.
- Committed Bun lockfile (`bun.lock`) and updated CI to use frozen installs when a Bun lockfile is present (`bun.lock` or legacy `bun.lockb`).
- Reworked CLI termination to throw a typed `CliExit` instead of calling `process.exit` inside Commander actions, improving testability while preserving exit codes in the bin wrapper.
- Added targeted CLI/guidance-pack tests and Vitest workspace source aliasing to meet coverage thresholds on a clean checkout (no pre-build required to run tests).
- Hardened guidance pack distribution: prevent zip symlink entries pre-extraction and install pack files as bytes to avoid corrupting non-UTF8 assets.
