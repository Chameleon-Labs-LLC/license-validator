---
description: Install or replace your Chameleon Labs license key on this machine
argument-hint: <key>
allowed-tools: Bash
---

Install the license key the user provided as `$ARGUMENTS`.

1. Run the store script:

   ```bash
   node "${HOME}/.claude/plugins/license-validator/scripts/store.js" "$ARGUMENTS"
   ```

2. Immediately confirm it works by running verify in default mode:

   ```bash
   node "${HOME}/.claude/plugins/license-validator/scripts/verify.js" default
   ```

Display only redacted output. Never print `$ARGUMENTS` itself or any line that contains the full key — `store.js` already redacts in its own output, so just relay what it prints.

On success, format the result like this:

> License installed: `cl_live_K7M3N8P2...9B2`
> Verified against the Chameleon Labs license server. You can now use any paid Chameleon Labs plugin you are entitled to.

On error, surface the script's stderr verbatim inside a fenced block, then suggest the user run `/cl:license:status` for more detail or contact `support@chameleonlabs.ai` if the error is `SIGNATURE_INVALID` or `VERIFY_FAILED`.
