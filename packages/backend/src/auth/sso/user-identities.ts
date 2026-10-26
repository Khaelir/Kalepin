import { Not, Repository } from 'typeorm';
import { UserIdentity } from '../../entities/user-identity.entity';
import type { ExternalIdentity } from './identity-provider';

export interface IdentityLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * Record a successful external sign-in (design D8), keyed by
 * (provider, issuer, subject): insert on first use, bump `lastLoginAt` on a
 * repeat, and re-point with a warning when the identity now resolves to a
 * different user. Observational only; nothing here blocks the sign-in.
 */
export async function recordIdentity(
  repo: Repository<UserIdentity>,
  p: { provider: string; identity: ExternalIdentity; userId: number; email: string; now?: Date },
  logger: IdentityLogger,
): Promise<UserIdentity> {
  const now = p.now ?? new Date();
  const key = { provider: p.provider, issuer: p.identity.issuer, subject: p.identity.subject };

  const existing = await repo.findOne({ where: key });
  if (existing) return update(repo, existing, p.userId, p.email, now, logger);

  const others = await repo.count({ where: { provider: p.provider, issuer: p.identity.issuer, userId: p.userId, subject: Not(p.identity.subject) } });
  if (others > 0) {
    logger.log(`SSO user ${p.userId} signed in with a new ${p.provider} identity ${p.identity.subject}`);
  }
  try {
    return await repo.save(repo.create({ ...key, userId: p.userId, emailAtLink: p.email, lastLoginAt: now }));
  } catch (err) {
    // A concurrent first sign-in of the same identity won the unique index.
    const raced = await repo.findOne({ where: key });
    if (!raced) throw err;
    return update(repo, raced, p.userId, p.email, now, logger);
  }
}

async function update(
  repo: Repository<UserIdentity>,
  row: UserIdentity,
  userId: number,
  email: string,
  now: Date,
  logger: IdentityLogger,
): Promise<UserIdentity> {
  if (row.userId !== userId) {
    logger.warn(`SSO identity ${row.provider}/${row.subject} moved from user ${row.userId} to user ${userId}`);
    row.userId = userId;
    row.emailAtLink = email;
  }
  row.lastLoginAt = now;
  await repo.update(row.id, { userId: row.userId, emailAtLink: row.emailAtLink, lastLoginAt: row.lastLoginAt });
  return row;
}
