#!/usr/bin/env bash
set -euo pipefail

# Ensure common local toolchain install locations are available in non-interactive shells.
if [[ -d "$HOME/.bun/bin" ]]; then
  export PATH="$HOME/.bun/bin:$PATH"
fi
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1090
  . "$HOME/.cargo/env"
fi

mode="check"
if [[ "${1:-}" == "--install" ]]; then
  mode="install"
fi

missing=()

check_tool() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    missing+=("$name")
    return 1
  fi
}

check_tool bun || true
check_tool rustc || true
check_tool cargo || true
check_tool node || true

if [[ "${#missing[@]}" -eq 0 ]]; then
  echo "Toolchain check passed: bun, rustc, cargo, node are available."
  exit 0
fi

if [[ "$mode" == "check" ]]; then
  echo "Missing required tools: ${missing[*]}"
  echo "Run with --install to print install hints."
  exit 1
fi

for tool in "${missing[@]}"; do
  case "$tool" in
    bun)
      echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
      ;;
    rustc|cargo)
      echo "Install Rust toolchain: curl https://sh.rustup.rs -sSf | sh"
      ;;
    node)
      echo "Install Node.js from https://nodejs.org or via your package manager."
      ;;
  esac
done

exit 1
