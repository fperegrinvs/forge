#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git config core.hooksPath "${repo_root}/.githooks"
echo "Installed git hooks: core.hooksPath=.githooks"

