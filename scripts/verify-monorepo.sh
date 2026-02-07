#!/usr/bin/env bash
set -euo pipefail

./scripts/bootstrap-toolchain.sh --check
npm run workflow:check-sync
npm run typecheck
npm run lint
npm run test
npm run workflow:check
