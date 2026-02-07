#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Usage:
#   ./scripts/dev-desktop-tauri.sh            # watcher + tauri (2 processes)
#   ./scripts/dev-desktop-tauri.sh --oneshot  # build once + tauri (1 process)
ONESHOT=0
for arg in "$@"; do
  if [[ "$arg" == "--oneshot" ]]; then
    ONESHOT=1
  fi
done

if [[ "${FORGE_DESKTOP_ONESHOT:-}" == "1" ]]; then
  ONESHOT=1
fi

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
  if [[ "$ONESHOT" == "1" ]]; then
    bun run build
  else
    bun run dev:singleport &
  fi
else
  # Fallback (Bun not installed): use local Vite.
  if [[ "$ONESHOT" == "1" ]]; then
    ./node_modules/.bin/vite build
  else
    ./node_modules/.bin/vite build --watch &
  fi
fi

if [[ "$ONESHOT" == "1" ]]; then
  if [[ ! -f "$ROOT/apps/desktop/dist/index.html" ]]; then
    echo "error: expected $ROOT/apps/desktop/dist/index.html to exist after build" >&2
    exit 1
  fi
fi
if [[ "$ONESHOT" != "1" ]]; then
  WATCH_PID="$!"
  trap 'kill "$WATCH_PID" 2>/dev/null || true' EXIT
fi

cd "$ROOT/apps/desktop/src-tauri"
if [[ "$ONESHOT" == "1" ]]; then
  # Strip the flag so cargo/tauri doesn't see it.
  FILTERED=()
  for arg in "$@"; do
    if [[ "$arg" != "--oneshot" ]]; then
      FILTERED+=("$arg")
    fi
  done
  if (( ${#FILTERED[@]} )); then
    set -- "${FILTERED[@]}"
  else
    set --
  fi
fi
exec cargo tauri dev "$@"
