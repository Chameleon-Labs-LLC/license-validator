'use strict';

// scripts/lib/errors.js
// Error code -> user-facing markdown message map (spec §7.4).
// All messages are formatted as markdown because verify.js stdout becomes
// session context per the SessionStart hook contract.

/**
 * Build the user-facing markdown for a given error code, optionally with
 * substitution context (product slug, device counts, free-form reason).
 *
 * @param {string} code - one of the documented error codes
 * @param {object} [ctx] - optional substitution values { product, n, reason, ... }
 * @returns {string} - markdown text, ready to print to stdout
 */
function messageFor(code, ctx) {
  const c = ctx || {};
  const product = c.product || 'this plugin';
  const reason = c.reason || 'unknown error';

  switch (code) {
    case 'NO_KEY':
      return [
        '**Chameleon Labs license required**',
        '',
        `No Chameleon Labs license key found for \`${product}\`.`,
        '',
        '- Run `/cl:license set <your-key>` to install one.',
        `- If you don't have a key yet, visit https://chameleonlabs.ai/${product}.`,
      ].join('\n');

    case 'KEY_NOT_FOUND':
      return [
        '**License not recognized**',
        '',
        'The license key on this machine is not recognized by the Chameleon Labs license server.',
        'It may have been rotated.',
        '',
        '- Check your email for a newer key, or run `/cl:license rotate`.',
      ].join('\n');

    case 'KEY_REVOKED':
      return [
        '**License revoked**',
        '',
        'This Chameleon Labs license has been revoked.',
        '',
        '- If you believe this is an error, contact support@chameleonlabs.ai.',
      ].join('\n');

    case 'KEY_EXPIRED':
      return [
        '**Subscription expired**',
        '',
        `Your Chameleon Labs subscription has expired. Renew at https://billing.chameleonlabs.ai to continue using \`${product}\`.`,
      ].join('\n');

    case 'NOT_ENTITLED':
      return [
        '**Not entitled**',
        '',
        `Your license is valid but does not include \`${product}\`.`,
        '',
        '- Add it to your plan at https://billing.chameleonlabs.ai.',
      ].join('\n');

    case 'DEVICE_LIMIT_EXCEEDED': {
      const n = typeof c.n === 'number' ? c.n : '?';
      const max = typeof c.max === 'number' ? c.max : n;
      return [
        '**Device limit reached**',
        '',
        `You've exceeded your device limit (${n} of ${max}).`,
        '',
        '- Deauthorize an old device at https://billing.chameleonlabs.ai',
        '- Or upgrade your plan for more seats.',
      ].join('\n');
    }

    case 'RATE_LIMITED':
      return [
        '**Too many verification attempts**',
        '',
        'Try again in an hour, or contact support@chameleonlabs.ai if this persists.',
      ].join('\n');

    case 'SIGNATURE_INVALID':
      return [
        '**License verification failed**',
        '',
        'The cached license token did not pass signature verification. This is unusual.',
        '',
        '- Check that your system clock is correct (NTP).',
        '- Report this to support@chameleonlabs.ai with the time of this error.',
      ].join('\n');

    case 'MALFORMED_REQUEST':
      return [
        '**License request malformed**',
        '',
        'The license verifier sent a request the server did not understand. Please report this to support@chameleonlabs.ai.',
      ].join('\n');

    case 'NETWORK_FAILURE':
      return [
        '**Could not reach license server**',
        '',
        `Unable to contact the Chameleon Labs license server: ${reason}`,
        '',
        '- Check your internet connection and try again.',
        '- If you were previously online, your cached token may have expired beyond the offline grace period.',
      ].join('\n');

    case 'USAGE':
      return [
        '**License verifier usage error**',
        '',
        'verify.js requires a product slug argument. This is a plugin bug; please report to support@chameleonlabs.ai.',
      ].join('\n');

    case 'VERIFY_FAILED':
    default:
      return [
        '**Could not verify license**',
        '',
        `Reason: ${reason}`,
        '',
        '- Check your internet connection.',
        '- Contact support@chameleonlabs.ai if this persists.',
      ].join('\n');
  }
}

/**
 * Map of HTTP error_code values from the API into client-facing codes.
 * Currently a 1:1 passthrough but kept as a function so we can normalize.
 */
function normalizeServerErrorCode(serverCode) {
  const known = new Set([
    'KEY_NOT_FOUND',
    'KEY_REVOKED',
    'KEY_EXPIRED',
    'NOT_ENTITLED',
    'DEVICE_LIMIT_EXCEEDED',
    'RATE_LIMITED',
    'MALFORMED_REQUEST',
    'SIGNATURE_INVALID',
  ]);
  if (typeof serverCode === 'string' && known.has(serverCode)) {
    return serverCode;
  }
  return 'VERIFY_FAILED';
}

/**
 * Redact a license key for safe display: first 8 chars + "..." + last 3.
 * If the key is too short to redact safely, returns "***".
 *
 * Examples:
 *   cl_test_K7M3N8P2Q5R6S9T4U7V2W5X8Y3Z6A9B2  ->  cl_test_K7M3...9B2
 */
function redactKey(key) {
  if (typeof key !== 'string' || key.length < 12) {
    return '***';
  }
  return `${key.slice(0, 8)}...${key.slice(-3)}`;
}

module.exports = {
  messageFor,
  normalizeServerErrorCode,
  redactKey,
};
