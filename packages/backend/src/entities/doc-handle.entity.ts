import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * Stable, opaque per-file handle. The id is a 16-char base32 (`A-Z2-7`)
 * crypto-random token that survives rename/move; only file deletion sets
 * `tombstoneAt`. The row is never deleted: a tombstoned id resolves to
 * `410 { tombstoned: true }` so stale internal URLs render a "no longer
 * exists" card instead of a generic 404.
 */
@Entity('doc_handles')
export class DocHandle {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id!: string;

  @Index('idx_doc_handles_path', { unique: true })
  @Column({ type: 'varchar' })
  path!: string;

  // unix ms; immutable once set.
  @Column({ type: 'integer' })
  createdAt!: number;

  // unix ms; null = active. Set on file delete.
  @Column({ type: 'integer', nullable: true })
  tombstoneAt!: number | null;
}
