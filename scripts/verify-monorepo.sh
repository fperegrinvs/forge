#!/usr/bin/env bash
set -euo pipefail

./scripts/bootstrap-toolchain.sh --check
bun run workflow:check-sync
bun run typecheck
bun run lint
bun run test
bun run workflow:check
