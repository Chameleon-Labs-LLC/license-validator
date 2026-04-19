---
name: license-troubleshoot
description: Use when the user describes a Chameleon Labs license error or a paid plugin failing to load. Triggers on phrases like "my plugin won't load", "license error", "key invalid", "device limit", "rate limited", "verification failed".
---

When this skill is active, a Chameleon Labs paid plugin failed to load or the customer is seeing a license error. Identify the error code from the message they pasted (or from the output of `/cl:license:status`) and walk them through the matching remediation.

The verify script emits one of the codes below. Match exactly, then follow the action.

| Error code | Cause | Remediation |
|------------|-------|-------------|
| `NO_KEY` | No license key is installed for this product. | Run `/cl:license:set <your-key>`. If the user has no key, point them to `https://chameleonlabs.ai/{product}` to purchase. |
| `KEY_NOT_FOUND` | The key on disk is unknown to the server, usually because it was rotated. | Check email for a newer key, then `/cl:license:set <new-key>`. If no email arrived, run `/cl:license:rotate`. |
| `KEY_REVOKED` | The license has been revoked (chargeback, abuse, or admin action). | Contact `support@chameleonlabs.ai`. Do not attempt to bypass — the plugin will not work until reinstated. |
| `KEY_EXPIRED` | The Stripe subscription lapsed. | Renew at `https://billing.chameleonlabs.ai`. Once the subscription is current, re-run any failed plugin to refresh the cached token. |
| `NOT_ENTITLED` | The key is valid but does not include this product. | Add the product to the plan at `https://billing.chameleonlabs.ai`. After purchase, the next verify call picks up the new entitlement automatically. |
| `DEVICE_LIMIT_EXCEEDED` | Too many devices registered against this license. | Deauthorize an old device at `https://billing.chameleonlabs.ai`, or upgrade the plan to a higher seat count. |
| `RATE_LIMITED` | Too many verify attempts in the last hour. | Wait one hour and retry. If it persists, contact `support@chameleonlabs.ai` — sustained rate limiting usually means a misconfigured automation loop. |
| `SIGNATURE_INVALID` | The cached token failed signature verification, or the system clock is off by more than 60 seconds. | Check that the system clock is accurate (NTP enabled). If the clock is correct, contact `support@chameleonlabs.ai` with the time of the error — this should not happen in normal operation. |
| `VERIFY_FAILED` | Generic network or server failure. | Check internet connectivity. If the network is fine, retry in a minute. If it persists more than ten minutes, contact `support@chameleonlabs.ai`. |

When in doubt, suggest `/cl:license:rotate` to get a fresh key, or escalate to `support@chameleonlabs.ai` with the exact error code and the timestamp of the failure.
