#!/usr/bin/env node
'use strict';

// scripts/verify.js
// Main entrypoint called from a paid plugin's SessionStart hook.
//
// Usage:
//   node verify.js <product-slug>
//
// Behavior:
//   1. Resolve the license key for <product-slug> (per-product key overrides default).
//   2. Try to verify a cached offline token against the bundled pubkey.
//      On success: export entitlement env vars, exit 0.
//   3. Otherwise call POST /v1/licenses/verify online.
//      On success: cache the new token, export env vars, exit 0.
//      On 4xx:     exit 2 with the appropriate friendly message.
//   4. On network failure with a cached token < 7 days old: print a grace
//      warning, export env vars from the cached token, exit 0.
//   5. On any other failure: print a friendly markdown message to stdout,
//      exit 2.
//
// Stdout becomes session context per the SessionStart hook contract, so on
// failure the LAST line written to stdout is the user-facing message.
//
// Pure Node stdlib. No npm dependencies.

const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('./lib/paths');
const tokenLib = require('./lib/token');
const fingerprintLib = require('./lib/fingerprint');
const apiLib = require('./lib/api');
const errorsLib = require('./lib/errors');
const cryptoLib = require('./lib/crypto');

const KEY_REGEX = /^cl_(live|test)_[A-Z0-9]{32}$/;
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const VERBOSE = process.env.CL_LICENSE_VERBOSE === '1';

/**
 * Print a markdown error message to stdout and exit 2.
 * The message becomes the last thing in the session context.
 */
function fail(code, ctx) {
  const msg = errorsLib.messageFor(code, ctx || {});
  // Final stdout line per brief.
  process.stdout.write(`${msg}\n`);
  process.exit(2);
}

/**
 * Read the license key for a product. Per-product key overrides default.
 * Returns null if no key file exists.
 *
 * The key file content is the plaintext key (potentially with a trailing
 * newline from a text editor). We trim and validate the format.
 */
function readKey(product) {
  const candidates = [paths.keyPath(product), paths.defaultKeyPath()];
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
    // Don't fail outright on invalid format — the user might have a default
    // key that's invalid but a per-product key that's valid. Continue.
  }
  return null;
}

/**
 * Read and parse the cached token for a product, if any.
 * Returns { wire, mtimeMs, payload } on success (where payload is the parsed
 * but UNVERIFIED payload), or null if no cached token exists / file unreadable.
 */
function readCachedToken(product) {
  const p = paths.tokenPath(product);
  let stat;
  try {
    stat = fs.statSync(p);
  } catch (_e) {
    return null;
  }
  let wire;
  try {
    wire = fs.readFileSync(p, 'utf8').trim();
  } catch (_e) {
    return null;
  }
  if (!wire) return null;
  let payload = null;
  try {
    const parsed = tokenLib.parseToken(wire);
    payload = parsed.payload;
  } catch (_e) {
    payload = null;
  }
  return { wire, mtimeMs: stat.mtimeMs, payload };
}

/**
 * Atomically write the token wire string to disk with 0600 perms.
 * Also ensures the parent dir exists with 0700 perms.
 */
function writeToken(product, wire) {
  const dir = paths.licenseDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Best-effort tighten perms on existing dir (mkdirSync only sets mode on
  // creation).
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_e) {
    // ignore on platforms where chmod doesn't apply
  }

  const target = paths.tokenPath(product);
  // Use process.pid to avoid collisions if two verify runs race.
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, wire, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch (_e) {
    // ignore
  }
  fs.renameSync(tmp, target);
}

/**
 * Write entitlement env vars to ${CLAUDE_ENV_FILE} if set.
 * Also prints a one-line success summary to stdout iff CL_LICENSE_VERBOSE=1.
 */
function exportEnv(payload, product) {
  const lines = [
    'CL_LICENSE_VALID=1',
    `CL_LICENSE_PRODUCT=${payload.product || product}`,
    `CL_LICENSE_TIER=${payload.tier || ''}`,
    `CL_LICENSE_EXPIRES=${payload.exp}`,
    `CL_LICENSE_CUSTOMER_EMAIL=${payload.customer_email || ''}`,
    `CL_LICENSE_ENTITLEMENTS_HASH=${payload.entitlements_hash || ''}`,
  ];
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile) {
    try {
      // Append in case the harness has already written something.
      fs.appendFileSync(envFile, `${lines.join('\n')}\n`);
    } catch (_e) {
      // Non-fatal: env file may be read-only or absent. We still exit 0.
    }
  }
  if (VERBOSE) {
    const expiry = new Date(payload.exp * 1000).toISOString();
    process.stdout.write(
      `Chameleon Labs license OK: ${payload.product} (${payload.tier}) expires ${expiry}\n`,
    );
  }
}

/**
 * Call POST /v1/licenses/verify with the given key + fingerprint.
 *
 * Returns the parsed JSON body on 2xx, or throws an Error with .code set.
 *   - On 4xx the error code mirrors the server's error_code (normalized).
 *   - On 5xx (after retries) the error code is 'VERIFY_FAILED'.
 *   - On network failure (after retries) the error code is 'NETWORK_FAILURE'.
 */
async function verifyOnline(key, product, fingerprint) {
  const url = `${apiLib.apiBase()}/v1/licenses/verify`;
  let res;
  try {
    res = await apiLib.postJson(url, {
      key,
      product,
      fingerprint,
      client_version: 'license-validator/1.0.0',
    });
  } catch (e) {
    const err = new Error(e.message || 'network failure');
    err.code = 'NETWORK_FAILURE';
    err.cause = e;
    throw err;
  }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    if (!res.body || typeof res.body !== 'object') {
      const err = new Error('server returned non-JSON body');
      err.code = 'VERIFY_FAILED';
      throw err;
    }
    if (res.body.valid !== true || typeof res.body.token !== 'string') {
      const err = new Error('server response missing token');
      err.code = 'VERIFY_FAILED';
      throw err;
    }
    return res.body;
  }

  if (res.statusCode >= 400 && res.statusCode < 500) {
    const serverCode = res.body && res.body.error_code;
    const code = errorsLib.normalizeServerErrorCode(serverCode);
    const err = new Error((res.body && res.body.message) || `HTTP ${res.statusCode}`);
    err.code = code;
    err.serverBody = res.body;
    throw err;
  }

  // 5xx after retries.
  const err = new Error(`HTTP ${res.statusCode} from license server`);
  err.code = 'VERIFY_FAILED';
  err.serverBody = res.body;
  throw err;
}

/**
 * Returns true iff the cached token's mtime is within the 7-day grace window.
 * (Fall-back used when the network is unreachable.)
 */
function withinGrace(cached) {
  if (!cached) return false;
  const ageSec = (Date.now() - cached.mtimeMs) / 1000;
  return ageSec >= 0 && ageSec <= SEVEN_DAYS_SECONDS;
}

/**
 * Validate a cached token end-to-end against the current device.
 * Returns { ok: true, payload } or { ok: false, code, message, payload? }.
 */
function validateCached(cached, product, fingerprint) {
  if (!cached || !cached.wire) {
    return { ok: false, code: 'NO_CACHE', message: 'no cached token' };
  }
  return tokenLib.validateWire(cached.wire, { product, fingerprint });
}

async function main() {
  const product = process.argv[2];
  if (!product || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(product)) {
    fail('USAGE');
    return;
  }

  const keyRecord = readKey(product);
  if (!keyRecord) {
    fail('NO_KEY', { product });
    return;
  }

  const fingerprint = fingerprintLib.computeFingerprint();
  const cached = readCachedToken(product);

  // Step 1: try cache.
  const cacheCheck = validateCached(cached, product, fingerprint);
  if (cacheCheck.ok) {
    exportEnv(cacheCheck.payload, product);
    process.exit(0);
    return;
  }

  // Step 2: fresh online verify.
  let online;
  try {
    online = await verifyOnline(keyRecord.key, product, fingerprint);
  } catch (e) {
    // Step 3: network failure → maybe grace mode.
    if (e.code === 'NETWORK_FAILURE') {
      if (cached && cached.payload && withinGrace(cached)) {
        const expiry = new Date((cached.payload.exp || 0) * 1000).toISOString();
        // Per brief: grace warning to stdout, exit 0.
        process.stdout.write(
          `\u26a0 Could not reach license server \u2014 using cached token (expires ${expiry}).\n`,
        );
        exportEnv(cached.payload, product);
        process.exit(0);
        return;
      }
      fail('NETWORK_FAILURE', { reason: e.message, product });
      return;
    }
    // 4xx error: surface as user-facing message.
    fail(e.code || 'VERIFY_FAILED', {
      product,
      reason: e.message,
      n: e.serverBody && e.serverBody.fingerprints && e.serverBody.fingerprints.length,
      max: e.serverBody && e.serverBody.device_seats,
    });
    return;
  }

  // Verify the freshly issued token before trusting it.
  const freshCheck = tokenLib.validateWire(online.token, { product, fingerprint });
  if (!freshCheck.ok) {
    // The server gave us a token that doesn't validate locally. Treat as fatal.
    fail(freshCheck.code === 'TOKEN_WRONG_DEVICE' ? 'SIGNATURE_INVALID' : 'SIGNATURE_INVALID', {
      product,
      reason: freshCheck.message,
    });
    return;
  }

  // Cache and succeed.
  try {
    writeToken(product, online.token);
  } catch (e) {
    // Caching failure shouldn't block the session — we've already verified.
    if (VERBOSE) {
      process.stdout.write(`(warning: could not cache token: ${e.message})\n`);
    }
  }
  exportEnv(freshCheck.payload, product);
  process.exit(0);
}

// Surface unexpected errors with a friendly message rather than a stack dump.
main().catch((e) => {
  fail('VERIFY_FAILED', { reason: (e && e.message) || 'unexpected error' });
});

// Silence unused-import warnings — these modules are imported for side-effect
// completeness even though some are only used by the helpers above.
void os;
void path;
void cryptoLib;
