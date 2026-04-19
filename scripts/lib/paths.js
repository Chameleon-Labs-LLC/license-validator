'use strict';

// scripts/lib/paths.js
// Cross-platform path resolution for the Chameleon Labs license validator.
// Pure stdlib (os, path). Never hard-codes path separators.

const os = require('os');
const path = require('path');

/**
 * Returns the directory holding the customer's license keys and cached tokens.
 * - macOS / Linux: $HOME/.chameleonlabs/licenses
 * - Windows:       %USERPROFILE%\.chameleonlabs\licenses
 *
 * os.homedir() returns the right thing on every platform Node supports, so we
 * just join from there.
 */
function licenseDir() {
  return path.join(os.homedir(), '.chameleonlabs', 'licenses');
}

/**
 * Returns the absolute path to the on-disk key file for a given product.
 * Per-product keys override the default key.
 */
function keyPath(product) {
  return path.join(licenseDir(), `${product}.key`);
}

/**
 * Returns the absolute path to the default key file.
 */
function defaultKeyPath() {
  return path.join(licenseDir(), 'default.key');
}

/**
 * Returns the absolute path to the cached offline token file for a product.
 */
function tokenPath(product) {
  return path.join(licenseDir(), `${product}.token`);
}

/**
 * Returns the absolute path to the bundled server public key for a given kid.
 * The license-validator plugin ships:
 *   keys/server-pubkey.pem      → the dev key (kid = cl-license-signing-key-dev)
 *   keys/server-pubkey-v1.pem   → the prod key (kid = cl-license-signing-key-v1)
 *
 * If only one pubkey file is present (dev mode), the caller can fall back to
 * it for any kid. See crypto.loadPubkeyForKid for the resolution logic.
 */
function pubkeyPathForKid(kid) {
  const keysDir = path.join(__dirname, '..', '..', 'keys');
  if (kid === 'cl-license-signing-key-v1') {
    return path.join(keysDir, 'server-pubkey-v1.pem');
  }
  // Default + dev kid both map to server-pubkey.pem.
  return path.join(keysDir, 'server-pubkey.pem');
}

/**
 * Returns the path to the directory containing all bundled pubkeys.
 */
function keysDir() {
  return path.join(__dirname, '..', '..', 'keys');
}

module.exports = {
  licenseDir,
  keyPath,
  defaultKeyPath,
  tokenPath,
  pubkeyPathForKid,
  keysDir,
};
