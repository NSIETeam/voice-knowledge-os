#!/usr/bin/env bash
# Run the opt-in MiMo Coding Plan smoke tests without putting the API key in
# shell history or command-line arguments. The secret is read silently from
# the terminal and exists only in this process environment for the test run.
set -euo pipefail

cd "$(dirname "$0")/.."

# Do not allow a caller's xtrace setting to print assignments or expansions.
set +x 2>/dev/null || true

if [[ -z "${MIMO_API_KEY:-}" ]]; then
  if [[ ! -t 0 ]]; then
    echo "error: run this script in a terminal so the API key can be entered silently" >&2
    exit 2
  fi
  read -r -s -p "MiMo API key (input hidden): " MIMO_API_KEY
  echo
  if [[ -z "$MIMO_API_KEY" ]]; then
    echo "error: API key cannot be empty" >&2
    exit 2
  fi
fi

export MIMO_API_KEY
export MIMO_BASE_URL="${MIMO_BASE_URL:-https://token-plan-cn.xiaomimimo.com/v1}"
if [[ "$MIMO_BASE_URL" != https://* || "$MIMO_BASE_URL" == *\?* || "$MIMO_BASE_URL" == *\#* ]]; then
  echo "error: MIMO_BASE_URL must be an HTTPS base URL without query or fragment" >&2
  exit 2
fi
trap 'unset MIMO_API_KEY MIMO_BASE_URL' EXIT

echo "Running MiMo live model-list and chat-stream smoke tests at $MIMO_BASE_URL"
cargo test --manifest-path src-tauri/Cargo.toml --lib live_mimo_coding_plan -- --ignored --test-threads=1
