'use strict';

// scripts/lib/api.js
// Minimal HTTPS (and HTTP, for local mock) JSON client.
// Pure Node stdlib (https, http, url).
//
// Behavior (per brief):
//   - 5s connect timeout, 10s total
//   - Retry once on network error (1s backoff)
//   - Retry twice on HTTP 5xx (1s, 2s backoff)
//   - NEVER retry on 4xx
//   - Always send "User-Agent: license-validator/1.0.0"

const https = require('https');
const http = require('http');
const urlMod = require('url');

const USER_AGENT = 'license-validator/1.0.0';
const CONNECT_TIMEOUT_MS = 5000;
const TOTAL_TIMEOUT_MS = 10000;

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'SOCKET_TIMEOUT',
]);

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom error with a `code` property so callers can branch on it cleanly.
 */
class ApiError extends Error {
  constructor(code, message, opts) {
    super(message);
    this.code = code;
    this.statusCode = opts && opts.statusCode;
    this.body = opts && opts.body;
  }
}

/**
 * Perform a single HTTPS POST (no retries). Returns { statusCode, body }
 * where body is the parsed JSON (or the raw string if JSON parsing fails).
 *
 * Rejects with ApiError on network failure or timeout.
 */
function postOnce(urlString, jsonBody) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new urlMod.URL(urlString);
    } catch (e) {
      return reject(new ApiError('MALFORMED_URL', `invalid url: ${urlString}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const payload = Buffer.from(JSON.stringify(jsonBody), 'utf8');

    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = raw;
        if (raw.length > 0) {
          try {
            body = JSON.parse(raw);
          } catch (_e) {
            body = raw;
          }
        }
        resolve({ statusCode: res.statusCode, body });
      });
      res.on('error', (err) => {
        reject(new ApiError('NETWORK_ERROR', err.message));
      });
    });

    // Connect timeout: if socket isn't connected within CONNECT_TIMEOUT_MS,
    // destroy and reject.
    const connectTimer = setTimeout(() => {
      req.destroy(new Error('connect timeout'));
    }, CONNECT_TIMEOUT_MS);

    req.once('socket', (socket) => {
      socket.once('connect', () => clearTimeout(connectTimer));
    });

    // Total timeout: kill the request entirely after TOTAL_TIMEOUT_MS.
    const totalTimer = setTimeout(() => {
      req.destroy(new Error('total timeout'));
    }, TOTAL_TIMEOUT_MS);

    req.on('error', (err) => {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      const code = err.code || (err.message === 'total timeout'
        ? 'SOCKET_TIMEOUT'
        : err.message === 'connect timeout'
          ? 'ETIMEDOUT'
          : 'NETWORK_ERROR');
      reject(new ApiError(code, err.message));
    });

    req.on('close', () => {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * POST JSON with the documented retry policy:
 *   - Network error: 1 retry, 1s backoff
 *   - HTTP 5xx:      2 retries, 1s then 2s backoff
 *   - HTTP 4xx:      no retry
 *
 * Returns { statusCode, body } on any HTTP response (including 4xx/5xx).
 * Throws ApiError only when all network retries are exhausted.
 */
async function postJson(urlString, jsonBody) {
  // First attempt + 1 network retry.
  let lastNetworkError = null;
  for (let networkAttempt = 0; networkAttempt < 2; networkAttempt += 1) {
    try {
      const initial = await postOnce(urlString, jsonBody);

      // 4xx: no retry, return immediately.
      if (initial.statusCode >= 400 && initial.statusCode < 500) {
        return initial;
      }

      // 5xx: up to 2 additional retries.
      if (initial.statusCode >= 500) {
        let last = initial;
        const backoffs = [1000, 2000];
        for (let i = 0; i < backoffs.length; i += 1) {
          await sleep(backoffs[i]);
          try {
            last = await postOnce(urlString, jsonBody);
            if (last.statusCode < 500) {
              return last;
            }
          } catch (e) {
            // Network error during 5xx retry: propagate as network failure.
            if (e instanceof ApiError && NETWORK_ERROR_CODES.has(e.code)) {
              lastNetworkError = e;
              continue;
            }
            throw e;
          }
        }
        return last;
      }

      // 2xx / 3xx: success, return.
      return initial;
    } catch (e) {
      if (e instanceof ApiError && NETWORK_ERROR_CODES.has(e.code)) {
        lastNetworkError = e;
        if (networkAttempt === 0) {
          await sleep(1000);
          continue;
        }
      }
      throw e;
    }
  }

  // Both network attempts failed.
  throw lastNetworkError || new ApiError('NETWORK_ERROR', 'request failed');
}

/**
 * Returns the configured API base URL. Defaults to production.
 * Customers / dev runs can override via CL_LICENSE_API.
 */
function apiBase() {
  return process.env.CL_LICENSE_API || 'https://api.chameleonlabs.ai';
}

module.exports = {
  postJson,
  apiBase,
  ApiError,
  USER_AGENT,
  // exported for testing:
  _postOnce: postOnce,
  _NETWORK_ERROR_CODES: NETWORK_ERROR_CODES,
};
