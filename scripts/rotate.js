#!/usr/bin/env node
'use strict';

// scripts/rotate.js
// CLI used by /cl:license rotate.
//
// Calls POST /v1/licenses/rotate with the current key. The server emails a
// new key to the customer and puts the current key in a 24-hour grace period.
// We never receive the new key in the response body — only confirmation.
//
// Usage:
//   node rotate.js [product]
//
// If [product] is omitted, the default key is used.

const fs = require('fs');

const paths = require('./lib/paths');
const apiLib = require('./lib/api');
const errorsLib = require('./lib/errors');

const KEY_REGEX = /^cl_(live|test)_[A-Z0-9]{32}$/;
const PRODUCT_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function bail(message, exitCode) {
  process.stderr.write(`rotate: ${message}\n`);
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

async function main() {
  const product = process.argv[2] || 'default';
  if (!PRODUCT_REGEX.test(product)) {
    bail(`invalid product slug "${product}"`);
  }

  const keyRecord = readKey(product);
  if (!keyRecord) {
    bail(
      `no license key found for product "${product}". Run /cl:license set <key> first.`,
      2,
    );
  }

  const url = `${apiLib.apiBase()}/v1/licenses/rotate`;
  let res;
  try {
    res = await apiLib.postJson(url, { key: keyRecord.key });
  } catch (e) {
    bail(`could not reach license server: ${e.message}`, 2);
  }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    const body = (res.body && typeof res.body === 'object') ? res.body : {};
    const grace = body.grace_until
      ? new Date(body.grace_until * 1000).toISOString()
      : '24 hours';
    const redacted = errorsLib.redactKey(keyRecord.key);
    process.stdout.write(
      [
        '**License rotation requested**',
        '',
        `Current key: ${redacted}`,
        `Stored at:   ${keyRecord.source}`,
        '',
        'A new key has been emailed to the customer address on file.',
        `Your current key still works until ${grace}.`,
        '',
        'When you receive the new key, run:',
        '    /cl:license set <new-key>',
      ].join('\n') + '\n',
    );
    process.exit(0);
    return;
  }

  // Non-2xx.
  if (res.statusCode >= 400 && res.statusCode < 500) {
    const serverCode = res.body && res.body.error_code;
    const code = errorsLib.normalizeServerErrorCode(serverCode);
    const msg = errorsLib.messageFor(code, {
      product,
      reason: (res.body && res.body.message) || `HTTP ${res.statusCode}`,
    });
    process.stdout.write(`${msg}\n`);
    process.exit(2);
    return;
  }
  bail(`license server returned HTTP ${res.statusCode}`, 2);
}

main().catch((e) => bail((e && e.message) || 'unexpected error', 2));
