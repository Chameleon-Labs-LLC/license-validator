---
description: Rotate your Chameleon Labs license key (emails a new key, old key works for 24h)
allowed-tools: Bash
---

Rotate the user's Chameleon Labs license key.

Run:

```bash
node "${HOME}/.claude/plugins/license-validator/scripts/rotate.js"
```

The script returns JSON like `{ "rotated": true, "grace_until": 1745086400, "email_destination": "le...@chameleonlabs.ai" }`. Format the response as:

> A new license key has been emailed to **{email_destination}**.
> Your current key continues to work until **{grace_until formatted as YYYY-MM-DD HH:MM UTC}** (24-hour grace window).
> Once you receive the email, install the new key with `/cl:license:set <new-key>`.

Emphasize both the email destination and the grace window so the customer understands they have time to act and where to look.

If the script returns an error, surface its stderr verbatim and suggest the customer contact `support@chameleonlabs.ai` if rotation continues to fail.
