#!/usr/bin/env node
'use strict';

// scripts/show.js
// CLI used by /cl:license show.
//
// Lists every key + cached token in the local license dir, redacted.
// Does NOT call the API. Pure local read-only.
//
// Output format: human-readable, one product per block. Stdout-only.

const fs = require('fs');
const path = require('path');

const paths = require('./lib/paths');
const tokenLib = require('./lib/token');
const errorsLib = require('./lib/errors');

function safeReadKey(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch (_e) {
    return null;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch (_e) {
    return null;
  }
}

function fmtTime(ms) {
  if (!ms || !isFinite(ms)) return 'unknown';
  return new Date(ms).toISOString();
}

function main() {
  const dir = paths.licenseDir();
  const dirStat = safeStat(dir);
  if (!dirStat || !dirStat.isDirectory()) {
    process.stdout.write(
      `No Chameleon Labs license directory at ${dir}.\n` +
        'Run /cl:license set <your-key> to install one.\n',
    );
    process.exit(0);
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    process.stdout.write(`Could not read ${dir}: ${e.message}\n`);
    process.exit(1);
    return;
  }

  const keyFiles = entries.filter((f) => f.endsWith('.key'));
  const tokenFiles = entries.filter((f) => f.endsWith('.token'));
  if (keyFiles.length === 0) {
    process.stdout.write(
      'No license keys installed.\n' +
        'Run /cl:license set <your-key> to install one.\n',
    );
    process.exit(0);
    return;
  }

  process.stdout.write(`License directory: ${dir}\n`);
  process.stdout.write(`Keys installed: ${keyFiles.length}\n`);
  process.stdout.write('\n');

  for (const file of keyFiles.sort()) {
    const product = file.replace(/\.key$/, '');
    const fullPath = path.join(dir, file);
    const stat = safeStat(fullPath);
    const key = safeReadKey(fullPath);

    process.stdout.write(`Product: ${product}\n`);
    process.stdout.write(`  Key:        ${key ? errorsLib.redactKey(key) : '(unreadable)'}\n`);
    process.stdout.write(`  Stored at:  ${fullPath}\n`);
    if (stat) {
      const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
      process.stdout.write(`  Modified:   ${fmtTime(stat.mtimeMs)} (mode ${mode})\n`);
    }

    // Look for a matching cached token.
    const tokenName = `${product}.token`;
    if (tokenFiles.includes(tokenName)) {
      const tokenPath = path.join(dir, tokenName);
      const tokenStat = safeStat(tokenPath);
      let wire = null;
      try {
        wire = fs.readFileSync(tokenPath, 'utf8').trim();
      } catch (_e) {
        wire = null;
      }
      let parsed = null;
      let parseError = null;
      if (wire) {
        try {
          parsed = tokenLib.parseToken(wire);
        } catch (e) {
          parseError = e.message;
        }
      }
      if (parsed) {
        const expiry = parsed.payload.exp
          ? fmtTime(parsed.payload.exp * 1000)
          : 'unknown';
        const issued = parsed.payload.iat
          ? fmtTime(parsed.payload.iat * 1000)
          : 'unknown';
        process.stdout.write(`  Cached token:\n`);
        process.stdout.write(`    Tier:       ${parsed.payload.tier || '(none)'}\n`);
        process.stdout.write(`    Issued:     ${issued}\n`);
        process.stdout.write(`    Expires:    ${expiry}\n`);
        process.stdout.write(`    Customer:   ${parsed.payload.customer_email || '(none)'}\n`);
        process.stdout.write(`    Kid:        ${parsed.payload.kid}\n`);
        if (tokenStat) {
          process.stdout.write(`    File mtime: ${fmtTime(tokenStat.mtimeMs)}\n`);
        }
      } else {
        process.stdout.write(`  Cached token: (unparseable${parseError ? `: ${parseError}` : ''})\n`);
      }
    } else {
      process.stdout.write('  Cached token: (none)\n');
    }
    process.stdout.write('\n');
  }

  process.exit(0);
}

try {
  main();
} catch (e) {
  process.stderr.write(`show: ${(e && e.message) || 'unexpected error'}\n`);
  process.exit(1);
}
