set windows-shell := ["bash", "-c"]
set shell         := ["bash", "-c"]

# license-validator plugin — contributor/maintainer command runner.
# Run `just --list` to see everything.
#
# Customer-facing ops live in the plugin's slash commands
# (/cl:license:set | show | rotate | status). This file is for development:
# running tests, verifying the bundled pubkey, replaying the verify flow
# against a local or remote License API.

license_api    := env_var_or_default("CL_LICENSE_API", "http://127.0.0.1:4455")
license_store  := env_var_or_default("CL_LICENSE_STORE", join(env_var("HOME"), ".chameleonlabs", "licenses"))
dev_key_dir    := env_var_or_default("CL_DEV_KEY_DIR", join(env_var("HOME"), ".chameleonlabs", "license-dev"))
product        := env_var_or_default("CL_PRODUCT", "maestro")

default:
    @just --list --unsorted

# === Local verify / store flow ===============================================

# Install a plaintext key into ~/.chameleonlabs/licenses/default.key
set key:
    CL_LICENSE_API={{license_api}} node scripts/store.js {{key}}

# Run the plugin's SessionStart-style verify for a product slug
verify product=product:
    CL_LICENSE_API={{license_api}} node scripts/verify.js {{product}}

# Show the current license + cached token summary
show:
    CL_LICENSE_API={{license_api}} node scripts/show.js

# Rotate the current license key (server issues a new one, old one stays in
# grace for the deadline printed by the server)
rotate:
    CL_LICENSE_API={{license_api}} node scripts/rotate.js

# Print the server-side status for the currently stored key
status:
    CL_LICENSE_API={{license_api}} node scripts/status.js

# Wipe the local license store (keys + cached tokens)
clear:
    #!/usr/bin/env bash
    set -eo pipefail
    rm -rf "{{license_store}}"
    echo "cleared {{license_store}}"

# === Dev keypair helpers =====================================================

# Diff the bundled keys/server-pubkey.pem against the local dev pubkey.
# Useful after `sync-devkey` to confirm local smoke-testing is wired up.
check-pubkey:
    #!/usr/bin/env bash
    set -eo pipefail
    if ! [ -f "{{dev_key_dir}}/signing-pubkey.pem" ]; then
      echo "no local dev pubkey at {{dev_key_dir}}/signing-pubkey.pem"
      exit 1
    fi
    if diff -q keys/server-pubkey.pem "{{dev_key_dir}}/signing-pubkey.pem" >/dev/null; then
      echo "MATCH — bundled pubkey matches local dev pubkey (smoke-test mode)"
    else
      echo "DIFFER — bundled pubkey is production/committed key, not local dev key"
      echo "  bundled: $(openssl pkey -in keys/server-pubkey.pem -pubin -outform DER 2>/dev/null | sha256sum | head -c 16)..."
      echo "  local:   $(openssl pkey -in '{{dev_key_dir}}/signing-pubkey.pem' -pubin -outform DER 2>/dev/null | sha256sum | head -c 16)..."
    fi

# Overwrite keys/server-pubkey.pem with the local dev pubkey for smoke testing.
# WARNING: DO NOT COMMIT this change — revert with `just restore-pubkey`.
sync-devkey:
    #!/usr/bin/env bash
    set -eo pipefail
    if ! [ -f "{{dev_key_dir}}/signing-pubkey.pem" ]; then
      echo "no local dev pubkey at {{dev_key_dir}}/signing-pubkey.pem"
      echo "generate one first (e.g. in the ChameleonLabs repo: just license-devkey-gen)"
      exit 1
    fi
    cp "{{dev_key_dir}}/signing-pubkey.pem" keys/server-pubkey.pem
    echo "[local-smoke-test] keys/server-pubkey.pem overwritten with local dev pubkey"
    echo "   revert with:  just restore-pubkey"

# Revert the bundled pubkey to the committed (release) version
restore-pubkey:
    git checkout -- keys/server-pubkey.pem
    @echo "restored keys/server-pubkey.pem from HEAD"

# === Tests ===================================================================

# Run the plugin's own test suite (unit + integration)
test:
    npm test

# === Repo hygiene ===========================================================

# Show anything locally modified (useful before pushing)
stat:
    git status --short

# Refuse to push if keys/server-pubkey.pem differs from HEAD (smoke-test leak guard)
guard-pubkey:
    #!/usr/bin/env bash
    set -eo pipefail
    if ! git diff --quiet HEAD -- keys/server-pubkey.pem; then
      echo "ABORT: keys/server-pubkey.pem differs from HEAD."
      echo "If this is a deliberate prod-key swap, commit it explicitly."
      echo "If it's local smoke-test drift, run: just restore-pubkey"
      exit 1
    fi
    echo "ok — keys/server-pubkey.pem matches HEAD"
