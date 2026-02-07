#!/usr/bin/env bash
set -euo pipefail
bun run test && bun run typecheck && bun run lint
