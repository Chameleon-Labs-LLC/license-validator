---
description: Show all Chameleon Labs license keys on this machine (redacted)
allowed-tools: Bash
---

List every license key currently installed on this machine, redacted.

Run:

```bash
node "${HOME}/.claude/plugins/license-validator/scripts/show.js"
```

The script returns a JSON array. Render it as a markdown table with these columns:

| Product | Key (redacted) | Tier | Expires | Last verified |
|---------|----------------|------|---------|---------------|

Use the `product`, `redacted_key`, `tier`, `expires_at` (formatted as `YYYY-MM-DD`), and `last_verified_at` (formatted as `YYYY-MM-DD HH:MM` UTC) fields from each entry. If the JSON is empty, say "No Chameleon Labs license keys are installed on this machine. Run `/cl:license:set <your-key>` to install one."

Do not call the API. This command is offline-only.
