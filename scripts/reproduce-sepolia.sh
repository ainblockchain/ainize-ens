#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ required")'
bash scripts/setup.sh
npm test
node --test scripts/*.test.mjs
node scripts/deploy-sepolia.mjs --check "$@"
