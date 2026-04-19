'use strict';

// scripts/lib/fingerprint.js
// Cross-platform device fingerprint per spec section 8.3:
//
//   sha256(machine_id || hostname || username)
//
// machine_id source:
//   - Linux:   /etc/machine-id
//   - macOS:   `ioreg -rd1 -c IOPlatformExpertDevice` -> IOPlatformUUID
//   - Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid via `reg query`
//
// Implementation note: we use child_process.execFileSync (NOT exec) so no
// shell is involved and there is no command-injection surface — all argv
// values are static literals defined in this file.
//
// If machine_id read fails for any reason, we silently fall back to
//   sha256(hostname || username || os.platform())
// per the brief. No logging on fallback.

const os = require('os');
const fs = require('fs');
const childProcess = require('child_process');
const crypto = require('crypto');

/**
 * Best-effort read of the system's stable machine identifier.
 * Returns the raw machine_id string on success, or null on failure.
 *
 * Each branch is wrapped in try/catch so any unexpected failure (missing
 * binary, permission denied, malformed output) returns null without throwing.
 */
function readMachineId() {
  const platform = os.platform();
  try {
    if (platform === 'linux') {
      const raw = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      return raw || null;
    }
    if (platform === 'darwin') {
      // execFileSync, not exec — no shell, fixed argv.
      const out = childProcess.execFileSync(
        'ioreg',
        ['-rd1', '-c', 'IOPlatformExpertDevice'],
        { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      return match ? match[1] : null;
    }
    if (platform === 'win32') {
      // reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid
      // Output ends with a line like:
      //   MachineGuid    REG_SZ    abcdef01-2345-...
      const out = childProcess.execFileSync(
        'reg',
        [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
        ],
        { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      return match ? match[1] : null;
    }
  } catch (_err) {
    // Silent fallback per brief.
    return null;
  }
  return null;
}

/**
 * Compute the device fingerprint as "sha256:<hex>".
 *
 * If machine_id is available:    sha256(machine_id || hostname || username)
 * If machine_id is unavailable:  sha256(hostname || username || platform)
 *
 * "||" here is string concatenation, matching spec section 8.3.
 */
function computeFingerprint() {
  const hostname = os.hostname() || '';
  let username = '';
  try {
    username = (os.userInfo() || {}).username || '';
  } catch (_err) {
    username = '';
  }
  const platform = os.platform();

  const machineId = readMachineId();
  const material = machineId
    ? `${machineId}${hostname}${username}`
    : `${hostname}${username}${platform}`;

  const digest = crypto.createHash('sha256').update(material, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

module.exports = {
  computeFingerprint,
  // exported for testing only:
  _readMachineId: readMachineId,
};
