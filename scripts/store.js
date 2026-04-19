#!/usr/bin/env node
'use strict';

// scripts/store.js
// CLI used by /cl:license set <key> [product].
//
// Writes the license key to ${LICENSE_DIR}/<product>.key with mode 0600.
// Atomic temp+rename. Validates the key format strictly before writing.
//
// Usage:
//   node store.js <key> [product]
//
// Exits 0 on success (prints redacted key + path).
// Exits 1 on bad input or write failure (prints a one-line error).

const fs = require('fs');
const path = require('path');

const paths = require('./lib/paths');
const errorsLib = require('./lib/errors');

const KEY_REGEX = /^cl_(live|test)_[A-Z0-9]{32}$/;
// Per-product slug must be safe for use as a filename component.
const PRODUCT_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function bail(message) {
  process.stderr.write(`store: ${message}\n`);
  process.exit(1);
}

function main() {
  const key = process.argv[2];
  const product = process.argv[3] || 'default';

  if (!key) {
    bail('usage: store.js <key> [product]');
  }
  // Trim defensively in case the user pasted with whitespace.
  const trimmed = key.trim();
  if (!KEY_REGEX.test(trimmed)) {
    // NEVER echo the key (even if invalid, it might be a real key with a typo).
    bail('invalid license key format. Expected: cl_(live|test)_<32 base32>');
  }
  if (!PRODUCT_REGEX.test(product)) {
    bail(`invalid product slug "${product}"`);
  }

  const dir = paths.licenseDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_e) {
    // ignore on platforms where chmod doesn't apply
  }

  const target =
    product === 'default' ? paths.defaultKeyPath() : paths.keyPath(product);
  const tmp = `${target}.tmp.${process.pid}`;

  try {
    fs.writeFileSync(tmp, trimmed, { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch (_e) {
      // ignore
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    // Best-effort cleanup of the temp file.
    try {
      fs.unlinkSync(tmp);
    } catch (_e) {
      // ignore
    }
    bail(`could not write key file: ${e.message}`);
  }

  const redacted = errorsLib.redactKey(trimmed);
  process.stdout.write(
    `Stored license key ${redacted} for product "${product}" at ${target}\n`,
  );
  process.exit(0);
}

try {
  main();
} catch (e) {
  bail((e && e.message) || 'unexpected error');
}

// silence "imported but unused" if path becomes unused after refactor
void path;
