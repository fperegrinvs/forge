#!/usr/bin/env bash
set -euo pipefail

./scripts/bootstrap-toolchain.sh --check
npm run typecheck
npm run lint
npm run test
