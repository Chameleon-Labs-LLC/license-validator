---
description: Check Chameleon Labs license status (live API call, bypasses cache)
allowed-tools: Bash
---

Fetch live license status from the Chameleon Labs license server, bypassing any locally cached token.

Run:

```bash
node "${HOME}/.claude/plugins/license-validator/scripts/status.js"
```

The script returns a JSON object with fields like `valid`, `customer_email`, `entitlements` (an object keyed by product slug, each with `tier` and `expires_at`), `device_seats`, `fingerprints` (array), and `status`.

Format it as a status report:

> **License status:** {valid ? "Active" : "Invalid"}
> **Customer:** {customer_email}
> **Plan status:** {status}
> **Devices:** {fingerprints.length} of {device_seats} registered
>
> **Entitlements:**
> | Product | Tier | Expires |
> |---------|------|---------|
> | ... one row per entry in `entitlements` ... |

Format `expires_at` as `YYYY-MM-DD`. If `valid` is false, surface the `error_code` and `message` fields prominently and suggest the next step from the troubleshoot skill (`/cl:license:rotate`, contact support, or visit `https://billing.chameleonlabs.ai`).
