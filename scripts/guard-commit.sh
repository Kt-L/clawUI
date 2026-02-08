#!/usr/bin/env bash
set -euo pipefail

root_dir="$(git rev-parse --show-toplevel)"
cd "$root_dir"

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"

if echo "$staged_files" | grep -qE '^node_modules/'; then
  echo "Commit blocked: do not commit node_modules/. Use npm ci on each machine instead."
  exit 1
fi

if ! echo "$staged_files" | grep -qE '^package-lock\.json$'; then
  exit 0
fi

expected_node="v$(tr -d '[:space:]' < .nvmrc)"
expected_npm="$(node -p "require('./package.json').packageManager.split('@')[1]")"

actual_os="$(uname -s)"
actual_arch="$(uname -m)"
actual_node="$(node -v)"
actual_npm="$(npm -v)"

errors=()

if [[ "$actual_os" != "Linux" ]]; then
  errors+=("OS must be Linux (current: $actual_os)")
fi

if [[ "$actual_arch" != "x86_64" ]]; then
  errors+=("Arch must be x86_64 (current: $actual_arch)")
fi

if [[ "$actual_node" != "$expected_node" ]]; then
  errors+=("Node must be $expected_node (current: $actual_node)")
fi

if [[ "$actual_npm" != "$expected_npm" ]]; then
  errors+=("npm must be $expected_npm (current: $actual_npm)")
fi

if [[ "${#errors[@]}" -gt 0 ]]; then
  echo "Commit blocked: package-lock.json can only be updated in the pinned Linux environment."
  for err in "${errors[@]}"; do
    echo "- $err"
  done
  echo "Run dependency updates only from this environment, then commit again."
  exit 1
fi
