#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEV_SCRIPT="$ROOT/scripts/dev-desktop-tauri.sh"

# Usage:
#   ./scripts/dev-desktop-tauri-noreload.sh [tauri args...]
#
# Runs Forge Desktop without disruptive reloads:
# - frontend: builds once (no `vite build --watch`)
# - tauri/rust: disables the watcher (`cargo tauri dev --no-watch`)
exec "$DEV_SCRIPT" --oneshot --no-watch "$@"
