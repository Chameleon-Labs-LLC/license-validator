# license-validator

Shared license verification for Chameleon Labs commercial plugins.

## What this is

`license-validator` is the open-source plugin that gates every paid Chameleon Labs plugin behind a license key. Customers install it once. Any paid Chameleon Labs plugin you install afterwards declares a `SessionStart` hook that calls into this plugin's verify script, checks your license against the Chameleon Labs license API, and either grants access or fails the session with a friendly error.

The plugin itself is MIT-licensed and contains no proprietary logic — every line is auditable. The economic value lives on Chameleon Labs' servers (entitlement data, signing keys, the Stripe relationship). The plugin is a thin, trustworthy client.

## Install

```
/plugin install license-validator@chameleon-labs
```

Marketplace listing is pending; until then, install locally:

```
/plugin install /path/to/license-validator
```

## Quick start

1. Buy a Chameleon Labs paid plugin (for example, Maestro AI). You will receive a license key by email within 60 seconds.
2. Install it on this machine:
   ```
   /cl:license:set cl_live_K7M3N8P2Q5R6S9T4U7V2W5X8Y3Z6A9B2
   ```
3. Install the paid plugin you bought. It will pick up your license automatically on the next session.

## Slash commands

| Command | What it does |
|---------|--------------|
| `/cl:license:set <key>` | Install or replace your license key on this machine. |
| `/cl:license:show` | List every key on this machine, redacted, with product, tier, and expiry. |
| `/cl:license:rotate` | Rotate your key. A new key is emailed; the old key works for 24 hours. |
| `/cl:license:status` | Live API call to check your current entitlements, bypasses the local cache. |

## How it works

Every paid Chameleon Labs plugin declares a `SessionStart` hook (see "For plugin authors" below) that runs `verify.js` from this plugin. `verify.js` reads `~/.chameleonlabs/licenses/<product>.key`, looks for a cached signed offline token in `~/.chameleonlabs/licenses/<product>.token`, and exits 0 if the token is valid for this product, this device, and this moment. Cache hits are silent and add no measurable latency to session startup.

On cache miss or expiry, `verify.js` POSTs to `api.chameleonlabs.ai/v1/licenses/verify` over TLS 1.3, receives a fresh Ed25519-signed token, and writes it to disk with `0600` permissions. Tokens last 24 hours and are refreshed any time the cached copy is more than 12 hours old. This means most sessions that do hit the network are refreshing a recent token, not re-authenticating from scratch.

If the network is unreachable and the cached token has expired, the plugin enters degraded mode and continues to honor the expired token for up to 7 days. Beyond that, the customer is asked to reconnect. Server-side revocation propagates within 1 hour worst case and immediately on the next online verify in abuse cases (the server returns `KEY_REVOKED` and the plugin exits 2 regardless of the cached token).

## For plugin authors

Add this `hooks/hooks.json` to your commercial Chameleon Labs plugin. Replace `<product-slug>` with your plugin's slug.

```json
{
  "description": "Chameleon Labs license verification",
  "hooks": {
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"${HOME}/.claude/plugins/license-validator/scripts/verify.js\" <product-slug>"
      }]
    }]
  }
}
```

On success, `verify.js` exports environment variables (`CL_LICENSE_VALID`, `CL_LICENSE_TIER`, `CL_LICENSE_PRODUCT`, `CL_LICENSE_EXPIRES`, `CL_LICENSE_CUSTOMER_EMAIL`, `CL_LICENSE_ENTITLEMENTS_HASH`) that your skills, commands, and agents can read to gate features. On failure, it exits 2 and the session is blocked with a friendly error message in the transcript.

## Privacy and security

What is stored locally in `~/.chameleonlabs/licenses/`:

- Your plaintext license key in `<product>.key` (mode `0600`).
- The most recent signed offline token in `<product>.token` (mode `0600`).

What is sent to the Chameleon Labs license server on each verify:

- Your license key.
- The product slug being verified (e.g., `maestro`).
- A device fingerprint computed as `sha256(machine_id + hostname + username)`.
- The validator client version (e.g., `license-validator/1.0.0`).

What is **not** sent:

- File contents from your project.
- Conversation transcripts or prompts.
- Project paths or working directory.
- Any data beyond the four fields above.

Transport is TLS 1.3 only. Keys are stored on the server as `sha256(plaintext)` only — the plaintext key never enters a database, log, or error response.

## License

MIT. See `LICENSE`.
