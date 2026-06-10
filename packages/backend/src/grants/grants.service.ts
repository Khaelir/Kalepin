import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentGrant, GrantPermission } from '../entities/document-grant.entity';

export interface MintInput {
  grantorEmail: string;
  granteeEmail: string;
  path: string;
  permission: GrantPermission;
  expiresAt?: number | null;
}

export type ActiveGrant = DocumentGrant;

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);

  constructor(
    @InjectRepository(DocumentGrant)
    private readonly repo: Repository<DocumentGrant>,
  ) {}

  async mint(input: MintInput): Promise<DocumentGrant> {
    // Upsert on (path, granteeEmail) when an active grant already exists.
    // Re-sharing with the same person is the user's signal "make this their
    // permission now", not "create a parallel grant" — the share dialog
    // would otherwise list the same grantee twice.
    const existing = await this.repo
      .createQueryBuilder('g')
      .where('g.path = :path', { path: input.path })
      .andWhere('g.granteeEmail = :grantee', { grantee: input.granteeEmail })
      .andWhere('g.revokedAt IS NULL')
      .getOne();
    if (existing) {
      existing.permission = input.permission;
      existing.expiresAt = input.expiresAt ?? null;
      return this.repo.save(existing);
    }
    const row = this.repo.create({
      grantorEmail: input.grantorEmail,
      granteeEmail: input.granteeEmail,
      path: input.path,
      permission: input.permission,
      expiresAt: input.expiresAt ?? null,
      createdAt: Date.now(),
      revokedAt: null,
    });
    return this.repo.save(row);
  }

  async revoke(id: number, now: number = Date.now()): Promise<DocumentGrant | null> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return null;
    if (row.revokedAt !== null) return row;
    row.revokedAt = now;
    return this.repo.save(row);
  }

  async findById(id: number): Promise<DocumentGrant | null> {
    return (await this.repo.findOne({ where: { id } })) ?? null;
  }

  /** Update an active grant's permission and/or expiry. Throws if revoked or missing. */
  async update(id: number, patch: { permission?: GrantPermission; expiresAt?: number | null }): Promise<DocumentGrant | null> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || row.revokedAt !== null) return null;
    if (patch.permission !== undefined) row.permission = patch.permission;
    if (patch.expiresAt !== undefined) row.expiresAt = patch.expiresAt;
    return this.repo.save(row);
  }

  /** Active grants for a path — used by the per-note share panel. */
  async listForPath(path: string, now: number = Date.now()): Promise<DocumentGrant[]> {
    return this.repo
      .createQueryBuilder('g')
      .where('g.path = :path', { path })
      .andWhere('g.revokedAt IS NULL')
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now })
      .orderBy('g.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Returns the highest-permission active grant for (path, grantee) — `write`
   * dominates `comment` dominates `read`. Active = `revoked_at IS NULL AND
   * (expires_at IS NULL OR expires_at > now)`.
   */
  async findActive(path: string, granteeEmail: string, now: number = Date.now()): Promise<DocumentGrant | null> {
    const rows = await this.repo
      .createQueryBuilder('g')
      .where('g.path = :path', { path })
      .andWhere('g.granteeEmail = :grantee', { grantee: granteeEmail })
      .andWhere('g.revokedAt IS NULL')
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now })
      .getMany();
    if (rows.length === 0) return null;
    return rows.reduce((best, cur) => (rank(cur.permission) > rank(best.permission) ? cur : best));
  }

  async listForGrantee(granteeEmail: string, now: number = Date.now()): Promise<DocumentGrant[]> {
    return this.repo
      .createQueryBuilder('g')
      .where('g.granteeEmail = :grantee', { grantee: granteeEmail })
      .andWhere('g.revokedAt IS NULL')
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now })
      .orderBy('g.createdAt', 'DESC')
      .getMany();
  }

  async listForGrantor(grantorEmail: string, includeInactive = false, now: number = Date.now()): Promise<DocumentGrant[]> {
    const qb = this.repo
      .createQueryBuilder('g')
      .where('g.grantorEmail = :grantor', { grantor: grantorEmail });
    if (!includeInactive) {
      qb.andWhere('g.revokedAt IS NULL').andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now });
    }
    qb.orderBy('g.createdAt', 'DESC');
    return qb.getMany();
  }

  /** Update active grants whose path = src or path STARTSWITH src + '/'. */
  async cascadeRename(src: string, dest: string): Promise<void> {
    const exact = await this.repo
      .createQueryBuilder('g')
      .where('g.path = :src', { src })
      .andWhere('g.revokedAt IS NULL')
      .getMany();
    const subtree = await this.repo
      .createQueryBuilder('g')
      .where('g.path LIKE :prefix', { prefix: src + '/%' })
      .andWhere('g.revokedAt IS NULL')
      .getMany();
    for (const row of exact) {
      row.path = dest;
      await this.repo.save(row);
    }
    for (const row of subtree) {
      row.path = dest + row.path.slice(src.length);
      await this.repo.save(row);
    }
  }

  /** Soft-revoke active grants on the path or its descendants. */
  async cascadeDelete(path: string, now: number = Date.now()): Promise<number> {
    const subtree = await this.repo
      .createQueryBuilder('g')
      .where('(g.path = :path OR g.path LIKE :prefix)', { path, prefix: path + '/%' })
      .andWhere('g.revokedAt IS NULL')
      .getMany();
    for (const row of subtree) {
      row.revokedAt = now;
      await this.repo.save(row);
    }
    return subtree.length;
  }
}

function rank(p: GrantPermission): number {
  return p === 'write' ? 3 : p === 'comment' ? 2 : 1;
}
