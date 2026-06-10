import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { User } from '../entities/user.entity';
import { NoteChange } from '../entities/note-change.entity';
import { canonicalizeEmail } from './email';
import { resolveJwtSecret } from './jwt-secret';
import { personalRootFor } from './visibility';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage';
import { EncryptingStorageAdapter } from '../storage/encrypting-fs.adapter';

/** Public, server-facing shape for vault-meta updates. All fields are base64-encoded. */
export interface VaultMetaUpdate {
  passphrase_wrapped_kek: string;
  passphrase_salt: string;
  recovery_wrapped_kek?: string | null;
  recovery_salt?: string | null;
}

interface ResetPayload {
  type: 'vault.reset';
  user_id: number;
  files_count: number;
  tombstone_path: string;
  tombstone_at: number;
  expires_at: number;
}

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

function decodeOpt(b64: string | null | undefined): Buffer | null {
  if (b64 == null) return null;
  return Buffer.from(b64, 'base64');
}

/**
 * Server-side custodian of the wrapped master-KEK blobs and the vault-reset
 * lifecycle. The server never sees the unwrapped master-KEK; it only stores
 * opaque bytes the client uploads, and serves them back on subsequent
 * unlocks. The reset path is the lost-passphrase escape hatch — destructive,
 * authenticated by session + typed-email, with a 24h soft-delete grace.
 */
@Injectable()
export class SecureVaultService {
  private readonly logger = new Logger(SecureVaultService.name);
  private readonly serverSecret: string;
  private readonly transporter: nodemailer.Transporter;
  private readonly appUrl: string;
  private readonly mailFrom: string;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(NoteChange) private readonly changeRepo: Repository<NoteChange>,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly dataSource: DataSource,
  ) {
    this.serverSecret = resolveJwtSecret();
    this.appUrl = process.env.APP_URL || 'http://localhost:3000';
    this.mailFrom = process.env.SMTP_FROM || 'noreply@kalepin.app';
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'in-v3.mailjet.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    });
  }

  async getVaultMeta(userId: number): Promise<{
    passphrase_wrapped_kek: string | null;
    passphrase_salt: string | null;
    recovery_wrapped_kek: string | null;
    recovery_salt: string | null;
    vault_setup_at: number | null;
    vault_tombstone_at: number | null;
  }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('user not found');
    return {
      passphrase_wrapped_kek: user.passphraseWrappedKek ? Buffer.from(user.passphraseWrappedKek).toString('base64') : null,
      passphrase_salt: user.passphraseSalt ? Buffer.from(user.passphraseSalt).toString('base64') : null,
      recovery_wrapped_kek: user.recoveryWrappedKek ? Buffer.from(user.recoveryWrappedKek).toString('base64') : null,
      recovery_salt: user.recoverySalt ? Buffer.from(user.recoverySalt).toString('base64') : null,
      vault_setup_at: user.vaultSetupAt ?? null,
      vault_tombstone_at: user.vaultTombstoneAt ?? null,
    };
  }

  async putVaultMeta(userId: number, body: VaultMetaUpdate): Promise<{ ok: true; vault_setup_at: number }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('user not found');

    const passphraseKek = decodeOpt(body.passphrase_wrapped_kek);
    const passphraseSalt = decodeOpt(body.passphrase_salt);
    if (!passphraseKek || !passphraseSalt) {
      throw new BadRequestException('passphrase_wrapped_kek and passphrase_salt are required');
    }
    if (passphraseSalt.length !== 16) {
      throw new BadRequestException('passphrase_salt must be 16 bytes');
    }

    user.passphraseWrappedKek = passphraseKek;
    user.passphraseSalt = passphraseSalt;

    if (body.recovery_wrapped_kek !== undefined) {
      const recoveryKek = decodeOpt(body.recovery_wrapped_kek);
      const recoverySalt = decodeOpt(body.recovery_salt);
      if (recoveryKek && (!recoverySalt || recoverySalt.length !== 16)) {
        throw new BadRequestException('recovery_salt must be 16 bytes when recovery_wrapped_kek is set');
      }
      user.recoveryWrappedKek = recoveryKek;
      user.recoverySalt = recoverySalt;
    }

    if (!user.vaultSetupAt) {
      user.vaultSetupAt = Date.now();
    }
    // If a tombstone is pending, completing a fresh setup clears it.
    if (user.vaultTombstoneAt) {
      user.vaultTombstoneAt = null;
      user.vaultTombstonePath = null;
      user.vaultTombstoneSnapshot = null;
    }

    await this.userRepo.save(user);

    // Ensure the empty `_secure/` folder exists so the file tree surfaces it
    // before any file has been moved in. Idempotent — safe to call on rotate
    // / regenerate as well as first-time setup.
    if (this.storage.ensureSecureFolder) {
      try {
        await this.storage.ensureSecureFolder(user.email);
      } catch (err) {
        this.logger.warn(`ensureSecureFolder(${user.email}) failed: ${(err as Error).message}`);
      }
    }

    return { ok: true, vault_setup_at: user.vaultSetupAt! };
  }

  async resetVault(userId: number, confirmEmail: string): Promise<{ tombstone_path: string; expires_at: number; files_count: number }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('user not found');

    const expected = canonicalizeEmail(user.email);
    const provided = canonicalizeEmail(confirmEmail || '');
    // Constant-time compare with a length guard.
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      throw new BadRequestException('confirm_email does not match your account email');
    }

    const tombstoneAt = Date.now();
    const expiresAt = tombstoneAt + GRACE_PERIOD_MS;
    const personalRoot = personalRootFor(user.email);
    const securePath = `${personalRoot}/_secure`;
    const tombstonePath = `${personalRoot}/_secure.tombstone-${tombstoneAt}`;

    const filesCount = await this.countSecureFiles(securePath);

    // Snapshot the wrapped-KEK fields for undo.
    const snapshot = {
      passphraseWrappedKek: user.passphraseWrappedKek ? Buffer.from(user.passphraseWrappedKek).toString('base64') : null,
      recoveryWrappedKek: user.recoveryWrappedKek ? Buffer.from(user.recoveryWrappedKek).toString('base64') : null,
      passphraseSalt: user.passphraseSalt ? Buffer.from(user.passphraseSalt).toString('base64') : null,
      recoverySalt: user.recoverySalt ? Buffer.from(user.recoverySalt).toString('base64') : null,
      vaultSetupAt: user.vaultSetupAt ?? null,
    };

    // DB transaction: clear vault keys, tombstone state, audit row.
    await this.dataSource.transaction(async (m) => {
      await m.update(User, { id: userId }, {
        passphraseWrappedKek: null,
        recoveryWrappedKek: null,
        passphraseSalt: null,
        recoverySalt: null,
        vaultSetupAt: null,
        vaultTombstoneAt: tombstoneAt,
        vaultTombstonePath: tombstonePath,
        vaultTombstoneSnapshot: snapshot,
      });

      const payload: ResetPayload = {
        type: 'vault.reset',
        user_id: userId,
        files_count: filesCount,
        tombstone_path: tombstonePath,
        tombstone_at: tombstoneAt,
        expires_at: expiresAt,
      };
      await m.save(NoteChange, m.create(NoteChange, {
        path: `${personalRoot}/_secure`,
        action: 'vault.reset',
        diff: JSON.stringify(payload),
        userId,
        metadataOnly: 1,
        oldHash: null,
        newHash: null,
        opType: null,
      }));
    });

    // Disk rename — best-effort. If it fails the DB state still says
    // tombstoned; the user has lost access to the vault but the files remain
    // at the original path. The undo path can detect the inconsistency.
    if (await this.storage.exists(securePath)) {
      try {
        if (this.storage instanceof EncryptingStorageAdapter) {
          await this.storage.renameOpaque(securePath, tombstonePath);
        } else {
          await this.storage.move(securePath, tombstonePath);
        }
      } catch (err) {
        this.logger.error(`Failed to rename ${securePath} → ${tombstonePath}: ${err}`);
        // Best-effort revert of DB state; future undo cannot proceed otherwise.
        await this.userRepo.update({ id: userId }, {
          passphraseWrappedKek: snapshot.passphraseWrappedKek ? Buffer.from(snapshot.passphraseWrappedKek, 'base64') : null,
          recoveryWrappedKek: snapshot.recoveryWrappedKek ? Buffer.from(snapshot.recoveryWrappedKek, 'base64') : null,
          passphraseSalt: snapshot.passphraseSalt ? Buffer.from(snapshot.passphraseSalt, 'base64') : null,
          recoverySalt: snapshot.recoverySalt ? Buffer.from(snapshot.recoverySalt, 'base64') : null,
          vaultSetupAt: snapshot.vaultSetupAt,
          vaultTombstoneAt: null,
          vaultTombstonePath: null,
          vaultTombstoneSnapshot: null,
        });
        throw err;
      }
    }

    // Email — best-effort.
    const undoToken = this.signUndoToken(userId, tombstoneAt, expiresAt);
    void this.sendResetEmail(user.email, {
      tombstoneAt,
      filesCount,
      tombstonePath,
      expiresAt,
      undoUrl: `${this.appUrl}/api/users/me/secure-vault/reset/undo?token=${encodeURIComponent(undoToken)}`,
    });

    return { tombstone_path: tombstonePath, expires_at: expiresAt, files_count: filesCount };
  }

  async undoReset(token: string): Promise<{ ok: true; vault_setup_at: number | null }> {
    const decoded = this.verifyUndoToken(token);
    if (!decoded) throw new ForbiddenException('invalid or expired undo token');
    if (Date.now() > decoded.expiresAt) throw new BadRequestException('undo token expired');

    const user = await this.userRepo.findOneBy({ id: decoded.userId });
    if (!user) throw new NotFoundException('user not found');
    if (user.vaultTombstoneAt !== decoded.tombstoneAt) {
      throw new BadRequestException('tombstone state has changed since this token was issued');
    }
    if (!user.vaultTombstonePath || !user.vaultTombstoneSnapshot) {
      throw new BadRequestException('tombstone snapshot missing — cannot undo');
    }

    const personalRoot = personalRootFor(user.email);
    const securePath = `${personalRoot}/_secure`;
    const tombstonePath = user.vaultTombstonePath;

    if (!(await this.storage.exists(tombstonePath))) {
      throw new BadRequestException('tombstone directory has been finalized — cannot undo');
    }
    if (await this.storage.exists(securePath)) {
      throw new BadRequestException('a new vault has been created since the reset — cannot undo');
    }

    const snapshot = user.vaultTombstoneSnapshot;
    if (this.storage instanceof EncryptingStorageAdapter) {
      await this.storage.renameOpaque(tombstonePath, securePath);
    } else {
      await this.storage.move(tombstonePath, securePath);
    }
    await this.userRepo.update({ id: user.id }, {
      passphraseWrappedKek: snapshot.passphraseWrappedKek ? Buffer.from(snapshot.passphraseWrappedKek, 'base64') : null,
      recoveryWrappedKek: snapshot.recoveryWrappedKek ? Buffer.from(snapshot.recoveryWrappedKek, 'base64') : null,
      passphraseSalt: snapshot.passphraseSalt ? Buffer.from(snapshot.passphraseSalt, 'base64') : null,
      recoverySalt: snapshot.recoverySalt ? Buffer.from(snapshot.recoverySalt, 'base64') : null,
      vaultSetupAt: snapshot.vaultSetupAt,
      vaultTombstoneAt: null,
      vaultTombstonePath: null,
      vaultTombstoneSnapshot: null,
    });

    return { ok: true, vault_setup_at: snapshot.vaultSetupAt };
  }

  /**
   * One sweep iteration. Idempotent: re-running on a partially-finalized state
   * is safe. Designed to be called from a cron job or interval.
   */
  async runTombstoneSweep(now: number = Date.now()): Promise<{ finalized: number; failed: number }> {
    const candidates = await this.userRepo
      .createQueryBuilder('u')
      .where('u.vaultTombstoneAt IS NOT NULL')
      .andWhere('u.vaultTombstoneAt < :cutoff', { cutoff: now - GRACE_PERIOD_MS })
      .getMany();

    let finalized = 0;
    let failed = 0;
    for (const u of candidates) {
      try {
        if (u.vaultTombstonePath && (await this.storage.exists(u.vaultTombstonePath))) {
          await this.storage.delete(u.vaultTombstonePath);
        }
        const personalRoot = personalRootFor(u.email);
        const payload = {
          type: 'vault.reset.finalized',
          user_id: u.id,
          tombstone_path: u.vaultTombstonePath,
          finalized_at: now,
        };
        await this.changeRepo.save(this.changeRepo.create({
          path: `${personalRoot}/_secure`,
          action: 'vault.reset.finalized',
          diff: JSON.stringify(payload),
          userId: u.id,
          metadataOnly: 1,
          oldHash: null,
          newHash: null,
          opType: null,
        }));
        await this.userRepo.update({ id: u.id }, {
          vaultTombstoneAt: null,
          vaultTombstonePath: null,
          vaultTombstoneSnapshot: null,
        });
        finalized++;
      } catch (err) {
        this.logger.error(`Failed to finalize tombstone for user=${u.id}: ${err}`);
        failed++;
      }
    }
    return { finalized, failed };
  }

  private async countSecureFiles(securePath: string): Promise<number> {
    if (!(await this.storage.exists(securePath))) return 0;
    try {
      const entries = await this.storage.list(securePath);
      return countLeavesInTree(entries);
    } catch {
      return 0;
    }
  }

  private signUndoToken(userId: number, tombstoneAt: number, expiresAt: number): string {
    const body = `${userId}.${tombstoneAt}.${expiresAt}`;
    const sig = crypto.createHmac('sha256', this.serverSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyUndoToken(token: string): { userId: number; tombstoneAt: number; expiresAt: number } | null {
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [u, t, e, sig] = parts;
    const body = `${u}.${t}.${e}`;
    const expected = crypto.createHmac('sha256', this.serverSecret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const userId = parseInt(u, 10);
    const tombstoneAt = parseInt(t, 10);
    const expiresAt = parseInt(e, 10);
    if (!Number.isFinite(userId) || !Number.isFinite(tombstoneAt) || !Number.isFinite(expiresAt)) {
      return null;
    }
    return { userId, tombstoneAt, expiresAt };
  }

  private async sendResetEmail(toEmail: string, params: {
    tombstoneAt: number;
    filesCount: number;
    tombstonePath: string;
    expiresAt: number;
    undoUrl: string;
  }): Promise<void> {
    if (!process.env.SMTP_USER) {
      this.logger.log(
        `Vault reset email for ${toEmail}: files=${params.filesCount} expires=${new Date(params.expiresAt).toISOString()} undo=${params.undoUrl}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: toEmail,
        subject: 'Your _secure/ vault was reset',
        html: renderResetEmail(params),
      });
    } catch (err) {
      this.logger.error(`Failed to send vault-reset email to ${toEmail}: ${err}`);
    }
  }
}

function countLeavesInTree(entries: Array<{ type: 'file' | 'directory'; children?: any[] }>): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.type === 'file') count++;
    else if (entry.children) count += countLeavesInTree(entry.children);
  }
  return count;
}

function renderResetEmail(params: { tombstoneAt: number; filesCount: number; tombstonePath: string; expiresAt: number; undoUrl: string }): string {
  const tombstoneAtIso = new Date(params.tombstoneAt).toISOString();
  const expiresAtIso = new Date(params.expiresAt).toISOString();
  return `
    <!doctype html>
    <html>
      <body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 24px auto; color: #1a1a1a;">
        <h2 style="color: #b00020;">Your _secure/ vault was reset</h2>
        <p>You (or someone with access to your Kalepin session) triggered a vault reset on <strong>${tombstoneAtIso}</strong>.</p>
        <p>The contents of <code>_secure/</code> are end-to-end encrypted. Once the grace window closes, <strong>no Kalepin operator, admin, or staff member can recover them</strong>.</p>
        <ul>
          <li>Files queued for deletion: <strong>${params.filesCount}</strong></li>
          <li>Grace window expires: <strong>${expiresAtIso}</strong></li>
        </ul>
        <p>If this wasn't you, or you want to undo the reset, click the link below within 24 hours:</p>
        <p><a href="${params.undoUrl}" style="display: inline-block; padding: 10px 16px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 4px;">Undo this reset</a></p>
        <p style="color: #555; font-size: 12px;">After the grace window closes the data is permanently destroyed. There is no recovery path beyond the undo link in this email.</p>
      </body>
    </html>
  `;
}
