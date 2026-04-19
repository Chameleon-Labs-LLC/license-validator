'use strict';

// scripts/lib/token.js
// Parse and validate cached offline tokens (spec §6).
//
// Wire format: `<base64url(JSON.stringify(payload))>.<base64url(ed25519_sig)>`
// Signature is Ed25519 over the UTF-8 bytes of `JSON.stringify(payload)`.

const cryptoLib = require('./crypto');

const REQUIRED_FIELDS = [
  'v',
  'kid',
  'sub',
  'product',
  'tier',
  'entitlements_hash',
  'customer_email',
  'fp',
  'iat',
  'exp',
  'rev',
];

const CLOCK_SKEW_SECONDS = 60;

class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Parse a wire-format token string into { payload, signature, payloadBytes }.
 * Throws TokenError on malformed input.
 */
function parseToken(wire) {
  if (typeof wire !== 'string' || wire.length === 0) {
    throw new TokenError('TOKEN_MALFORMED', 'token is empty or not a string');
  }
  const trimmed = wire.trim();
  const dot = trimmed.indexOf('.');
  if (dot < 0 || dot === trimmed.length - 1) {
    throw new TokenError('TOKEN_MALFORMED', 'token missing "." separator');
  }
  const payloadB64 = trimmed.slice(0, dot);
  const sigB64 = trimmed.slice(dot + 1);

  let payloadBytes;
  let signature;
  try {
    payloadBytes = cryptoLib.b64uDecode(payloadB64);
  } catch (e) {
    throw new TokenError('TOKEN_MALFORMED', `payload not base64url: ${e.message}`);
  }
  try {
    signature = cryptoLib.b64uDecode(sigB64);
  } catch (e) {
    throw new TokenError('TOKEN_MALFORMED', `signature not base64url: ${e.message}`);
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch (e) {
    throw new TokenError('TOKEN_MALFORMED', `payload is not JSON: ${e.message}`);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TokenError('TOKEN_MALFORMED', 'payload is not a JSON object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in payload)) {
      throw new TokenError('TOKEN_MALFORMED', `payload missing required field "${field}"`);
    }
  }

  return { payload, signature, payloadBytes };
}

/**
 * Verify a parsed token's signature against the bundled pubkey for its kid.
 * Throws TokenError on signature failure or missing pubkey.
 */
function verifySignature(parsed) {
  let pubkey;
  try {
    pubkey = cryptoLib.loadPubkeyForKid(parsed.payload.kid);
  } catch (e) {
    throw new TokenError('SIGNATURE_INVALID', `cannot load pubkey: ${e.message}`);
  }
  const ok = cryptoLib.verifyEd25519(parsed.payloadBytes, parsed.signature, pubkey);
  if (!ok) {
    throw new TokenError('SIGNATURE_INVALID', 'Ed25519 signature did not verify');
  }
}

/**
 * Returns true iff the token's exp claim is in the future, within
 * CLOCK_SKEW_SECONDS tolerance. (i.e. exp > now - skew → still valid).
 *
 * Note: per spec §6.3, the check is `exp > now + CLOCK_SKEW_TOLERANCE`,
 * which is the strict reading. We implement the strict form: a token is
 * "valid" only if it has at least 60s of life remaining. That gives us
 * a safety margin against client clock drift.
 */
function isUnexpired(payload, nowSec) {
  const now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
  return typeof payload.exp === 'number' && payload.exp > now + CLOCK_SKEW_SECONDS;
}

/**
 * Returns true iff the token claims to be for the given product slug.
 */
function matchesProduct(payload, product) {
  return payload.product === product;
}

/**
 * Returns true iff the token's fp claim matches the current device fingerprint.
 */
function matchesFingerprint(payload, fingerprint) {
  return payload.fp === fingerprint;
}

/**
 * Convenience: full validation pipeline for a wire-format token.
 *
 * Returns { ok: true, payload } if everything checks out.
 * Returns { ok: false, code, message } on any failure.
 *
 * On `code === 'TOKEN_EXPIRED'` callers may consult the grace-period logic
 * before deciding whether to fail.
 */
function validateWire(wire, opts) {
  const o = opts || {};
  let parsed;
  try {
    parsed = parseToken(wire);
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }

  try {
    verifySignature(parsed);
  } catch (e) {
    return { ok: false, code: e.code, message: e.message, payload: parsed.payload };
  }

  if (o.product && !matchesProduct(parsed.payload, o.product)) {
    return {
      ok: false,
      code: 'TOKEN_WRONG_PRODUCT',
      message: `token is for "${parsed.payload.product}", not "${o.product}"`,
      payload: parsed.payload,
    };
  }

  if (o.fingerprint && !matchesFingerprint(parsed.payload, o.fingerprint)) {
    return {
      ok: false,
      code: 'TOKEN_WRONG_DEVICE',
      message: 'token fp does not match this device',
      payload: parsed.payload,
    };
  }

  if (!isUnexpired(parsed.payload, o.now)) {
    return {
      ok: false,
      code: 'TOKEN_EXPIRED',
      message: `token expired at ${parsed.payload.exp}`,
      payload: parsed.payload,
    };
  }

  return { ok: true, payload: parsed.payload };
}

module.exports = {
  parseToken,
  verifySignature,
  isUnexpired,
  matchesProduct,
  matchesFingerprint,
  validateWire,
  TokenError,
  CLOCK_SKEW_SECONDS,
  REQUIRED_FIELDS,
};
