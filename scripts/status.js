#!/usr/bin/env node
'use strict';

// scripts/status.js
// CLI used by /cl:license status.
//
// Bypasses the local cache and calls POST /v1/licenses/verify fresh. Prints
// a human-readable summary of the live response. Does NOT cache the returned
// token (that's verify.js's job — status is purely diagnostic).
//
// Usage:
//   node status.js [product]
//
// Exits 0 on a valid response (even if the key is revoked — that's still a
// successful diagnostic). Exits 2 on transport failure.

const fs = require('fs');

const paths = require('./lib/paths');
const apiLib = require('./lib/api');
const tokenLib = require('./lib/token');
const fingerprintLib = require('./lib/fingerprint');
const errorsLib = require('./lib/errors');

const KEY_REGEX = /^cl_(live|test)_[A-Z0-9]{32}$/;
const PRODUCT_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function bail(message, exitCode) {
  process.stderr.write(`status: ${message}\n`);
  process.exit(typeof exitCode === 'number' ? exitCode : 1);
}

function readKey(product) {
  const candidates = [];
  if (product && product !== 'default') {
    candidates.push(paths.keyPath(product));
  }
  candidates.push(paths.defaultKeyPath());
  for (const p of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch (_e) {
      continue;
    }
    const trimmed = raw.trim();
    if (KEY_REGEX.test(trimmed)) {
      return { key: trimmed, source: p };
    }
  }
  return null;
}

function fmtTime(epochSec) {
  if (!epochSec || !isFinite(epochSec)) return 'unknown';
  return new Date(epochSec * 1000).toISOString();
}

async function main() {
  const product = process.argv[2] || 'default';
  if (!PRODUCT_REGEX.test(product)) {
    bail(`invalid product slug "${product}"`);
  }

  const keyRecord = readKey(product);
  if (!keyRecord) {
    process.stdout.write(
      `No license key found for product "${product}".\n` +
        'Run /cl:license set <your-key> to install one.\n',
    );
    process.exit(2);
    return;
  }

  const fingerprint = fingerprintLib.computeFingerprint();
  const url = `${apiLib.apiBase()}/v1/licenses/verify`;
  let res;
  try {
    res = await apiLib.postJson(url, {
      key: keyRecord.key,
      product,
      fingerprint,
      client_version: 'license-validator/1.0.0',
      // Hint to server (and intermediaries): this is a status check, do not
      // let any cache short-circuit it. Server treats as a normal verify.
      nocache: true,
    });
  } catch (e) {
    bail(`could not reach license server: ${e.message}`, 2);
  }

  const redacted = errorsLib.redactKey(keyRecord.key);

  if (res.statusCode >= 200 && res.statusCode < 300) {
    const body = (res.body && typeof res.body === 'object') ? res.body : {};
    if (body.valid !== true || typeof body.token !== 'string') {
      process.stdout.write(
        `License server returned an unexpected response (HTTP ${res.statusCode}).\n`,
      );
      process.exit(2);
      return;
    }
    // Parse the returned token for full visibility (signature is verified
    // here too, so we surface tamper or pubkey-mismatch loudly).
    const validation = tokenLib.validateWire(body.token, { product, fingerprint });
    const lines = [
      '**Chameleon Labs license status (live)**',
      '',
      `Key:           ${redacted}`,
      `Product:       ${body.product || product}`,
      `Tier:          ${body.tier || '(unknown)'}`,
      `Customer:      ${body.customer_email || '(unknown)'}`,
      `Expires at:    ${fmtTime(body.expires_at)}`,
      `Fingerprint:   ${fingerprint}`,
      '',
    ];
    if (validation.ok) {
      lines.push('Token signature: OK');
      lines.push(`Token kid:       ${validation.payload.kid}`);
      lines.push(`Token rev:       ${validation.payload.rev}`);
    } else {
      lines.push(`Token signature: FAILED (${validation.code}: ${validation.message})`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exit(0);
    return;
  }

  if (res.statusCode >= 400 && res.statusCode < 500) {
    const serverCode = res.body && res.body.error_code;
    const code = errorsLib.normalizeServerErrorCode(serverCode);
    const serverMessage =
      (res.body && res.body.message) || `HTTP ${res.statusCode}`;
    const lines = [
      '**Chameleon Labs license status (live)**',
      '',
      `Key:        ${redacted}`,
      `Product:    ${product}`,
      `Result:     ${code}`,
      `Server says: ${serverMessage}`,
      '',
      errorsLib.messageFor(code, { product, reason: serverMessage }),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
    // Status is diagnostic — exit 0 even on auth/entitlement failure so the
    // caller can render the output. Reserve exit 2 for transport failures.
    process.exit(0);
    return;
  }

  bail(`license server returned HTTP ${res.statusCode}`, 2);
}

main().catch((e) => bail((e && e.message) || 'unexpected error', 2));
