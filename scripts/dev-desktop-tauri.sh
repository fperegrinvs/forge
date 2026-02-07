#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer running the local CLI build via Node so the desktop backend can always
# resolve `forge` during development without requiring a globally installed binary.
export FORGE_DESKTOP_NODE_BIN="${FORGE_DESKTOP_NODE_BIN:-node}"
export FORGE_DESKTOP_FORGE_ENTRY_JS="${FORGE_DESKTOP_FORGE_ENTRY_JS:-$ROOT/packages/cli/dist/bin.js}"

if [[ ! -f "$FORGE_DESKTOP_FORGE_ENTRY_JS" ]]; then
  echo "warning: $FORGE_DESKTOP_FORGE_ENTRY_JS not found (desktop may fail to run forge commands)." >&2
  echo "hint: build it with: ./node_modules/.bin/tsc -b packages/cli" >&2
fi

cd "$ROOT/apps/desktop/src-tauri"

# Keep `apps/desktop/dist` up to date for the embedded single-port server.
cd "$ROOT/apps/desktop"
if command -v bun >/dev/null 2>&1; then
  bun run dev:singleport &
else
  # Fallback (Bun not installed): use local Vite.
  ./node_modules/.bin/vite build --watch &
fi
WATCH_PID="$!"
trap 'kill "$WATCH_PID" 2>/dev/null || true' EXIT

cd "$ROOT/apps/desktop/src-tauri"
exec cargo tauri dev "$@"
