#!/usr/bin/env bash
set -euo pipefail

./scripts/bootstrap-toolchain.sh --check
bun run workflow:check-sync
bun run docs:check
bun run typecheck
bun run lint
bun run architecture:check
bun run test:coverage
bun run workflow:check
