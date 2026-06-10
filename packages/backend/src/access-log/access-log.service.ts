import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { NoteAccessLog, AccessLogAction } from '../entities';
import { hashIp, resolveIpSalt } from './ip-salt';

const DEDUP_WINDOWS_MS: Record<AccessLogAction, number> = {
  view: 5 * 60 * 1000,
  fetched: 5 * 60 * 1000,
  edit: 60 * 1000,
  comment: 60 * 1000,
  'share-link-resolved': 5 * 60 * 1000,
};

const LRU_MAX = 5000;

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);
  private readonly salt: Buffer;
  /** Insertion-ordered map: oldest entries at the head. */
  private readonly recent = new Map<string, number>();

  constructor(
    @InjectRepository(NoteAccessLog)
    private readonly repo: Repository<NoteAccessLog>,
  ) {
    this.salt = resolveIpSalt();
  }

  /**
   * Record an access. Applies an in-memory dedup window keyed by
   * `(path, viewer, action)` so rapid-fire edits / view scrolls collapse to a
   * single row. Returns the row when one is written, or null when deduped.
   */
  async record(
    path: string,
    viewer: string,
    action: AccessLogAction,
    ip: string | null | undefined,
    nowMs: number = Date.now(),
  ): Promise<NoteAccessLog | null> {
    if (this.shouldDedup(path, viewer, action, nowMs)) return null;
    const row = this.repo.create({
      path,
      viewerEmail: viewer,
      action,
      ipHash: hashIp(this.salt, ip ?? null),
      ts: nowMs,
    });
    try {
      return await this.repo.save(row);
    } catch (err) {
      this.logger.warn(`Failed to write access log for ${path}: ${String(err)}`);
      return null;
    }
  }

  async listForPath(
    path: string,
    since?: number,
    limit = 100,
  ): Promise<NoteAccessLog[]> {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.path = :path', { path });
    if (typeof since === 'number') {
      qb.andWhere('a.ts >= :since', { since });
    }
    return qb
      .orderBy('a.ts', 'DESC')
      .limit(Math.max(1, Math.min(limit, 1000)))
      .getMany();
  }

  /**
   * Aggregate access-log activity for a single path. The caller passes the
   * active-grant email set; viewers not in that set are dropped (revoked
   * grantees and the owner self-view leak through the log otherwise).
   *
   * Always emits a row for every active grantee — `view_count = 0` and
   * `last_view_at = null` when the grantee has no rows. The frontend uses
   * that to render "Not yet viewed" rather than "0 views".
   *
   * Pass `includeAnonymous: false` for E2E paths (share-links cannot exist
   * for those, so the public-link aggregate is meaningless there).
   */
  async summaryForPath(
    path: string,
    granteeEmails: string[],
    opts: { includeAnonymous?: boolean } = {},
  ): Promise<{
    rows: Array<{
      email: string;
      view_count: number;
      last_view_at: number | null;
      last_edit_at: number | null;
    }>;
    anonymous: { resolve_count: number; last_resolve_at: number | null } | null;
  }> {
    const includeAnonymous = opts.includeAnonymous !== false;
    const granteeSet = new Set(granteeEmails.map((e) => e.toLowerCase()));

    const aggregate = await this.repo
      .createQueryBuilder('a')
      .select('LOWER(a.viewer_email)', 'email')
      .addSelect(
        "SUM(CASE WHEN a.action IN ('view','fetched') THEN 1 ELSE 0 END)",
        'view_count',
      )
      .addSelect(
        "MAX(CASE WHEN a.action IN ('view','fetched') THEN a.ts END)",
        'last_view_at',
      )
      .addSelect("MAX(CASE WHEN a.action = 'edit' THEN a.ts END)", 'last_edit_at')
      .where('a.path = :path', { path })
      .andWhere("LOWER(a.viewer_email) <> 'anonymous'")
      .groupBy('LOWER(a.viewer_email)')
      .getRawMany<{
        email: string;
        view_count: number | string | null;
        last_view_at: number | string | null;
        last_edit_at: number | string | null;
      }>();

    const byEmail = new Map<
      string,
      { view_count: number; last_view_at: number | null; last_edit_at: number | null }
    >();
    for (const r of aggregate) {
      byEmail.set(r.email, {
        view_count: toInt(r.view_count) ?? 0,
        last_view_at: toInt(r.last_view_at),
        last_edit_at: toInt(r.last_edit_at),
      });
    }

    const rows = Array.from(granteeSet)
      .sort()
      .map((email) => {
        const hit = byEmail.get(email);
        return {
          email,
          view_count: hit?.view_count ?? 0,
          last_view_at: hit?.last_view_at ?? null,
          last_edit_at: hit?.last_edit_at ?? null,
        };
      });

    let anonymous: { resolve_count: number; last_resolve_at: number | null } | null = null;
    if (includeAnonymous) {
      const anon = await this.repo
        .createQueryBuilder('a')
        .select('COUNT(*)', 'resolve_count')
        .addSelect('MAX(a.ts)', 'last_resolve_at')
        .where('a.path = :path', { path })
        .andWhere("LOWER(a.viewer_email) = 'anonymous'")
        .andWhere("a.action = 'share-link-resolved'")
        .getRawOne<{ resolve_count: number | string | null; last_resolve_at: number | string | null }>();
      anonymous = {
        resolve_count: toInt(anon?.resolve_count) ?? 0,
        last_resolve_at: toInt(anon?.last_resolve_at),
      };
    }

    return { rows, anonymous };
  }

  /** GDPR right-to-erasure. Returns the count deleted. */
  async deleteForViewer(viewer: string): Promise<number> {
    const result = await this.repo.delete({ viewerEmail: viewer });
    return result.affected ?? 0;
  }

  /** Retention sweep. Deletes rows older than `cutoffMs`. */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.repo.delete({ ts: LessThan(cutoffMs) });
    return result.affected ?? 0;
  }

  /** Test-only escape hatch. */
  resetDedupForTests(): void {
    this.recent.clear();
  }

  private shouldDedup(
    path: string,
    viewer: string,
    action: AccessLogAction,
    nowMs: number,
  ): boolean {
    const key = `${action}\x00${viewer}\x00${path}`;
    const window = DEDUP_WINDOWS_MS[action];
    const last = this.recent.get(key);
    if (last !== undefined && nowMs - last < window) {
      return true;
    }
    if (this.recent.has(key)) this.recent.delete(key);
    this.recent.set(key, nowMs);
    if (this.recent.size > LRU_MAX) {
      const oldest = this.recent.keys().next().value;
      if (oldest !== undefined) this.recent.delete(oldest);
    }
    return false;
  }
}

function toInt(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
