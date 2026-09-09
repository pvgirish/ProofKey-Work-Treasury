#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PROOFKEY_FORGE="${PROOFKEY_FORGE:-$(command -v forge || true)}"
if [[ -z "$PROOFKEY_FORGE" && -x "$HOME/.foundry/bin/forge" ]]; then PROOFKEY_FORGE="$HOME/.foundry/bin/forge"; fi
if [[ -z "$PROOFKEY_FORGE" ]]; then echo 'Install Foundry to build the contracts.' >&2; exit 1; fi
if [[ -x .toolchain/solc-0.8.28 ]]; then
  export FOUNDRY_SOLC="$PWD/.toolchain/solc-0.8.28"
fi
exec "$PROOFKEY_FORGE" "$@"
