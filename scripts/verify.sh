#!/usr/bin/env bash
# scripts/verify.sh
# Thin wrapper that delegates to verify.js. Works on bash and zsh.
#
# Usage: verify.sh <product-slug>
#
# We do NOT replicate the verification logic in shell; Ed25519 verification
# in pure bash is impractical. The only job of this script is to find Node and
# exec verify.js with the same argv.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
**Chameleon Labs license verifier could not start**

Node.js was not found on PATH. Claude Code requires Node 18+.

- Install Node from https://nodejs.org or via your package manager.
- Restart your terminal after installation.
EOF
  exit 2
fi

exec node "${SCRIPT_DIR}/verify.js" "$@"
