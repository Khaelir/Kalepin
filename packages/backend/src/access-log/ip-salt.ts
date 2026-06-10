import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Resolve the per-deployment HMAC salt used to hash IPs in `note_access_log`.
 *
 * Resolution order:
 *  1. `ACCESS_LOG_IP_SALT` env (hex or base64; must decode to ≥16 bytes)
 *  2. Persisted file at `data/.access-log-salt` (binary)
 *  3. Generate a fresh 32-byte random salt and persist it to (2)
 *
 * Per-deployment scope is intentional: rotating the salt periodically is
 * acceptable (it severs old correlations); per-user salt is not, because the
 * point of the hash is "weird-login" detection (multiple distinct IP hashes
 * for one user in a short window), which requires deployment-scoped consistency.
 */
export function resolveIpSalt(saltFilePath?: string): Buffer {
  const fromEnv = process.env.ACCESS_LOG_IP_SALT;
  if (fromEnv && fromEnv.trim()) {
    const buf = decodeSaltString(fromEnv.trim());
    if (buf.length >= 16) return buf;
  }
  const filePath = saltFilePath ?? defaultSaltPath();
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length >= 16) return buf;
  } catch {
    // fall through to generation
  }
  const fresh = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fresh, { mode: 0o600 });
  } catch {
    // Non-fatal: in containerized prod the salt directory may be ephemeral.
    // The runtime salt is still usable for the lifetime of this process.
  }
  return fresh;
}

function decodeSaltString(s: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    return Buffer.from(s, 'hex');
  }
  try {
    return Buffer.from(s, 'base64');
  } catch {
    return Buffer.from(s, 'utf8');
  }
}

function defaultSaltPath(): string {
  const dataDir = process.env.DB_PATH
    ? path.dirname(process.env.DB_PATH)
    : path.resolve(process.cwd(), 'data');
  return path.join(dataDir, '.access-log-salt');
}

export function hashIp(salt: Buffer, ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto
    .createHmac('sha256', salt)
    .update(ip)
    .digest('hex')
    .slice(0, 16); // 8 bytes (16 hex chars)
}
