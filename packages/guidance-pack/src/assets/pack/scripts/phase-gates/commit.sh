#!/usr/bin/env bash
set -euo pipefail
bun run test:coverage && bun run typecheck && bun run lint && bun run architecture:check
