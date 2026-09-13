#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
pin=48b3e2d39513b9dd32ef1850877a29009bc807b9
if [[ ! -d namechain ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/ensdomains/namechain.git namechain
  git -C namechain checkout --detach "$pin"
fi
if [[ "$(git -C namechain rev-parse HEAD)" != "$pin" ]]; then
  echo "Existing namechain checkout must be at $pin; refusing to alter it." >&2
  exit 1
fi
npm ci
npm run build
