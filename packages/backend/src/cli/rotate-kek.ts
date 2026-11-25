/**
 * KEK rotation CLI.
 *
 *   node packages/backend/dist/backend/src/cli/rotate-kek.js --new-kek-file=/run/secrets/kalepin.kek.new
 *
 * Run it with the server stopped (it refuses while the server's heartbeat is
 * fresh): the server holds the old KEK in memory.
 *
 * Walks every encrypted file in both zones (personal + shared), unwraps the
 * CEK with the old KEK source (KALEPIN_KEK_FILE) and re-wraps it with the new
 * KEK from `--new-kek-file`. Bulk ciphertext bytes never move — only the small
 * wrapped-CEK header is rewritten. Per-file is atomic (write tmp + fsync +
 * rename) and idempotent (the fingerprint check skips already-rotated files),
 * so a mid-run crash is safe to resume by re-running.
 *
 * After all files are processed, the rotation updates `encryption_zones.kek_fingerprint`
 * for every zone whose `enabled=1`.
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as Database from 'better-sqlite3';
import {
  FileKEKSource,
  KEKSource,
  KEK_LENGTH_BYTES,
} from '../crypto/kek-source';
import {
  rewrapEnvelope,
  hasEnvelopeMagic,
  WrongKEKError,
} from '../crypto/envelope';
import { skipSweepEntry } from '../encryption/sweep-entry-filter';
import { isE2EPath, isE2ETombstonePath } from '../crypto/encryption-predicates';
import { PERSONAL_PREFIX } from '../auth/visibility';
import {
  HEARTBEAT_STALE_MS,
  readLiveServerHeartbeat,
  serverHeartbeatPath,
} from '../storage/server-heartbeat';

interface Args {
  newKekFile: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { newKekFile: '', yes: false };
  for (const arg of argv) {
    if (arg.startsWith('--new-kek-file=')) {
      args.newKekFile = arg.slice('--new-kek-file='.length);
    } else if (arg === '--yes' || arg === '-y') {
      args.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      'Usage: rotate-kek --new-kek-file=PATH [--yes]',
      '',
      'Required env: KALEPIN_KEK_FILE points to the current KEK.',
      '',
      'Stop the Kalepin server first: it keeps the current KEK in memory. The',
      'rotation refuses to start while the server heartbeat next to DB_PATH is',
      'fresh.',
      '',
      'Walks every encrypted file in VAULT_PATH and PERSONAL_PATH and re-wraps the',
      'CEK with the new KEK. Bulk ciphertext bytes are unchanged. Idempotent and',
      'crash-safe: re-running resumes by skipping files already wrapped by the new',
      'KEK fingerprint.',
    ].join('\n'),
  );
}

async function* walk(root: string, zone: 'personal' | 'shared'): AsyncGenerator<string> {
  const stack: string[] = [''];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Dot entries are skipped, except comment sidecars and the zone trash.
      if (skipSweepEntry(entry.name, entry.isDirectory(), rel, zone)) continue;
      if (entry.name.includes('.tmp.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        yield childRel;
      }
    }
  }
}

async function atomicWrite(absPath: string, content: Buffer): Promise<void> {
  const tmp = `${absPath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, absPath);
}

export interface ZoneRoot {
  zone: 'personal' | 'shared';
  root: string;
  /** Skip the reserved `_users/` segment under the shared root. */
  skipUsersAtRoot: boolean;
}

function resolveZoneRoots(): ZoneRoot[] {
  const roots: ZoneRoot[] = [];
  const personal = process.env.PERSONAL_PATH;
  if (personal && fs.existsSync(personal)) {
    roots.push({ zone: 'personal', root: personal, skipUsersAtRoot: false });
  }
  const shared = process.env.VAULT_PATH || './data/vault';
  if (fs.existsSync(shared)) {
    roots.push({ zone: 'shared', root: shared, skipUsersAtRoot: true });
  }
  return roots;
}

export async function rotateRoot(
  zr: ZoneRoot,
  oldKek: KEKSource,
  newKek: KEKSource,
): Promise<{ rewrapped: number; skipped: number; passthrough: number; endToEnd: number }> {
  let rewrapped = 0;
  let skipped = 0;
  let passthrough = 0;
  let endToEnd = 0;

  for await (const rel of walk(zr.root, zr.zone)) {
    if (zr.skipUsersAtRoot && rel.startsWith('_users/')) continue;
    if (zr.skipUsersAtRoot && rel === '_users') continue;
    // `_secure/` and vault-reset tombstones are wrapped by the user's
    // master-KEK, which the server never holds: nothing to rotate.
    const virtualPath = zr.zone === 'personal' ? `${PERSONAL_PREFIX}${rel}` : rel;
    if (isE2EPath(virtualPath) || isE2ETombstonePath(virtualPath)) {
      endToEnd++;
      continue;
    }
    const abs = path.join(zr.root, rel);

    let raw: Buffer;
    try {
      raw = await fsp.readFile(abs);
    } catch {
      continue;
    }

    if (!hasEnvelopeMagic(raw)) {
      passthrough++;
      continue;
    }

    try {
      const next = await rewrapEnvelope(raw, oldKek, newKek);
      if (next === raw) {
        skipped++;
        continue;
      }
      await atomicWrite(abs, next);
      rewrapped++;
    } catch (err) {
      if (err instanceof WrongKEKError) {
        console.error(
          `[rotate-kek] WRONG_KEK ${zr.zone}:${rel} envelope=${err.envelopeFingerprint} old=${err.currentFingerprint}`,
        );
      } else {
        console.error(
          `[rotate-kek] FAIL ${zr.zone}:${rel} ${(err as Error).message}`,
        );
      }
      throw err;
    }

    if ((rewrapped + skipped) % 100 === 0) {
      console.log(
        `[rotate-kek] ${zr.zone} progress: rewrapped=${rewrapped} skipped=${skipped}`,
      );
    }
  }

  return { rewrapped, skipped, passthrough, endToEnd };
}

export function updateZoneFingerprints(dbPath: string, newFp: Buffer): void {
  const db = new Database(dbPath);
  try {
    // Column names follow the TypeORM entity (EncryptionZone): camelCase.
    const stmt = db.prepare(
      'UPDATE encryption_zones SET "kekFingerprint" = ?, "updatedAt" = ? WHERE enabled = 1',
    );
    stmt.run(newFp, Date.now());
  } finally {
    db.close();
  }
}

function loadFreshKekFile(p: string): FileKEKSource {
  const stat = fs.statSync(p);
  if (!stat.isFile()) throw new Error(`new KEK path is not a regular file: ${p}`);
  const buf = fs.readFileSync(p);
  if (buf.length !== KEK_LENGTH_BYTES) {
    throw new Error(`new KEK file ${p} is ${buf.length} bytes; expected ${KEK_LENGTH_BYTES}`);
  }
  return new FileKEKSource(p);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.newKekFile) {
    console.error('error: --new-kek-file=PATH is required');
    printHelp();
    process.exit(2);
  }

  const oldKekPath = process.env.KALEPIN_KEK_FILE;
  if (!oldKekPath) {
    console.error('error: KALEPIN_KEK_FILE env var must be set to the current KEK path');
    process.exit(2);
  }

  // The server unwraps with the KEK it loaded at boot: notes rotated under it
  // become unreadable to it, and its saves race the rewrap.
  const heartbeatFile = serverHeartbeatPath();
  const live = readLiveServerHeartbeat(heartbeatFile);
  if (live) {
    const age = Math.max(0, Math.round((Date.now() - live.heartbeatAt) / 1000));
    console.error(
      [
        `error: the Kalepin server is running (heartbeat ${age}s ago in ${heartbeatFile}` +
          `${live.pid ? `, pid ${live.pid}` : ''}${live.host ? ` on ${live.host}` : ''}).`,
        'Stop it, rotate, then start it with the new KEK.',
        `If it is already stopped, retry in ${Math.max(1, HEARTBEAT_STALE_MS / 1000 - age)}s or delete that file.`,
      ].join('\n'),
    );
    process.exit(2);
  }

  const oldKek = new FileKEKSource(oldKekPath);
  const newKek = loadFreshKekFile(args.newKekFile);

  if (oldKek.fingerprint.equals(newKek.fingerprint)) {
    console.log('[rotate-kek] new KEK matches the current KEK; nothing to do.');
    return;
  }

  console.log(
    `[rotate-kek] old fingerprint=${oldKek.fingerprint.toString('hex')} new fingerprint=${newKek.fingerprint.toString('hex')}`,
  );

  const roots = resolveZoneRoots();
  if (!roots.length) {
    console.warn('[rotate-kek] no zone roots configured; nothing to walk.');
    return;
  }

  let totalRewrapped = 0;
  let totalSkipped = 0;
  let totalPassthrough = 0;
  for (const zr of roots) {
    console.log(`[rotate-kek] walking zone=${zr.zone} root=${zr.root}`);
    const stats = await rotateRoot(zr, oldKek, newKek);
    console.log(
      `[rotate-kek] zone=${zr.zone} rewrapped=${stats.rewrapped} skipped=${stats.skipped} passthrough=${stats.passthrough} end-to-end=${stats.endToEnd}`,
    );
    totalRewrapped += stats.rewrapped;
    totalSkipped += stats.skipped;
    totalPassthrough += stats.passthrough;
  }

  const dbPath = process.env.DB_PATH;
  if (dbPath && fs.existsSync(dbPath)) {
    updateZoneFingerprints(dbPath, newKek.fingerprint);
    console.log('[rotate-kek] encryption_zones.kek_fingerprint updated for enabled zones.');
  } else {
    console.warn(
      `[rotate-kek] DB_PATH=${dbPath ?? '(unset)'} not found; skipping encryption_zones update.`,
    );
  }

  console.log(
    `[rotate-kek] complete: rewrapped=${totalRewrapped} skipped=${totalSkipped} passthrough=${totalPassthrough}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[rotate-kek] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
