---
name: license-status
description: Use when the user asks about their Chameleon Labs license status, entitlements, expiry, tier, or device count. Triggers on phrases like "what's my license status", "am I licensed for X", "when does my license expire", "what tier am I on".
---

When this skill is active, the user is asking a question about their current Chameleon Labs license. Answer with live data, never with a guess.

First, invoke the `/cl:license:status` slash command. That command makes a live call to the Chameleon Labs license server and returns a parsed status report. If the slash command is unavailable in the current context, fall back to running the script directly:

```bash
node "${HOME}/.claude/plugins/license-validator/scripts/status.js"
```

Parse the JSON result and present a friendly summary tailored to what the user asked:

- "What's my status?" — give the full report (customer, plan status, entitlements table, device count).
- "Am I licensed for X?" — check whether `entitlements[X]` exists and answer yes/no with the tier and expiry; do not list other products.
- "When does my license expire?" — list each entitled product and its `expires_at` formatted as `YYYY-MM-DD`.
- "What tier am I on?" — list each product and its tier.
- "How many devices?" — report `fingerprints.length` of `device_seats` and link to `https://billing.chameleonlabs.ai` if the user wants to deauthorize one.

Never echo the license key itself. The script does not return the plaintext key; do not infer or reconstruct it. If the API call fails, surface the error code and suggest the `license-troubleshoot` skill or `/cl:license:rotate`.
