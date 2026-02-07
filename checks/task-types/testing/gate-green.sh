#!/usr/bin/env bash
set -euo pipefail
npm run test && npm run typecheck && npm run lint
