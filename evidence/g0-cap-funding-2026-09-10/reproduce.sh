#!/usr/bin/env bash
# Reproduce the G0 cap/funding decisive cases.
# Read-only with respect to the repository: builds into a scratch directory outside it.
# No broadcast, no key, no .env, no network access required.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${1:-/tmp/proofkey-g0-repro-$$}"
BUNDLE="$REPO/evidence/g0-cap-funding-2026-09-10"

export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null || { echo "forge not found; install Foundry (this repo used 1.8.1)"; exit 2; }

echo "== repository:      $REPO"
echo "== scratch harness: $WORK"

echo "== verifying the inspected sources still match the tested snapshot"
( cd "$REPO" && shasum -a 256 -c "$BUNDLE/source-snapshot.sha256" ) \
  || { echo "SOURCE DRIFT: src/*.sol differ from the snapshot these results were produced against."; exit 3; }

echo "== verifying the harness itself is unmodified"
shasum -a 256 -c "$BUNDLE/harness.sha256"

rm -rf "$WORK"
mkdir -p "$WORK/test"
ln -s "$REPO/src"          "$WORK/src"
ln -s "$REPO/lib"          "$WORK/lib"
ln -s "$REPO/node_modules" "$WORK/node_modules"
cp "$BUNDLE/harness/foundry.toml"            "$WORK/foundry.toml"
cp "$BUNDLE/harness/test/G0CapFunding.t.sol" "$WORK/test/G0CapFunding.t.sol"

cd "$WORK"
forge test -vv

echo
echo "== expected: 7 passed; 0 failed; 0 skipped"
echo "== reference log: $BUNDLE/logs/g0-forge-test.log"
echo "== scratch harness left at $WORK (safe to delete)"
