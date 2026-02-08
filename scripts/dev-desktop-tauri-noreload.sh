#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Usage:
#   ./scripts/dev-desktop-tauri-noreload.sh [tauri args...]
#
# Runs Forge Desktop without disruptive reloads:
# - frontend: builds once (no `vite build --watch`)
# - tauri/rust: disables the watcher (`cargo tauri dev --no-watch`)
exec "$ROOT/scripts/dev-desktop-tauri.sh" --oneshot --no-watch "$@"

