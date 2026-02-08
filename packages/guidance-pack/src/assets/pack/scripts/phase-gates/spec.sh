#!/usr/bin/env bash
set -euo pipefail
bun run typecheck
if bun run test; then
  echo "Spec gate requires RED tests (tests must fail before implementation)." >&2
  exit 1
fi
