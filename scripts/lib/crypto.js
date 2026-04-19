'use strict';

// scripts/lib/crypto.js
// Ed25519 verification, sha256 hashing, base64url helpers.
// Pure Node stdlib (crypto, fs, path).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

/**
 * Encode a Buffer or string as base64url (RFC 4648 §5).
 */
function b64uEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Decode a base64url string into a Buffer.
 * Throws on invalid input.
 */
function b64uDecode(input) {
  if (typeof input !== 'string') {
    throw new Error('b64uDecode: input must be a string');
  }
  // Restore padding.
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

/**
 * Returns sha256(input) as a lowercase hex string.
 */
function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Convenience: returns "sha256:<hex>" tagged form used in token payloads.
 */
function sha256Tagged(input) {
  return `sha256:${sha256Hex(input)}`;
}

/**
 * Loads the bundled public key matching the given kid.
 * Resolution rules (matches design doc §5):
 *   1. If kid === 'cl-license-signing-key-v1', try keys/server-pubkey-v1.pem.
 *   2. If kid === 'cl-license-signing-key-dev' (or anything else), try keys/server-pubkey.pem.
 *   3. If the kid-specific file is absent but exactly one pubkey file exists in
 *      keys/, use it for any kid (dev fallback).
 *
 * Returns a crypto.KeyObject suitable for crypto.verify(). Throws if no
 * pubkey can be resolved.
 */
function loadPubkeyForKid(kid) {
  const explicit = paths.pubkeyPathForKid(kid);
  if (fs.existsSync(explicit)) {
    return crypto.createPublicKey(fs.readFileSync(explicit));
  }

  // Fallback: enumerate keys/ and use the sole pubkey if there is exactly one.
  const dir = paths.keysDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.pem'));
  } catch (e) {
    throw new Error(`crypto: cannot read keys directory ${dir}: ${e.message}`);
  }
  if (entries.length === 1) {
    return crypto.createPublicKey(fs.readFileSync(path.join(dir, entries[0])));
  }
  throw new Error(
    `crypto: no public key found for kid="${kid}" (looked at ${explicit}; ` +
      `${entries.length} candidate(s) in ${dir})`,
  );
}

/**
 * Verifies an Ed25519 signature.
 * @param {Buffer|string} message - the bytes that were signed
 * @param {Buffer} signature - raw signature bytes
 * @param {crypto.KeyObject} pubkey - public key to verify against
 * @returns {boolean}
 */
function verifyEd25519(message, signature, pubkey) {
  const data = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  try {
    return crypto.verify(null, data, pubkey, signature);
  } catch (_err) {
    return false;
  }
}

module.exports = {
  b64uEncode,
  b64uDecode,
  sha256Hex,
  sha256Tagged,
  loadPubkeyForKid,
  verifyEd25519,
};
