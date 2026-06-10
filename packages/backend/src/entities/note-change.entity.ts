import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type NoteChangeOpType = 'insert' | 'delete' | 'replace';

@Entity('note_changes')
export class NoteChange {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar' })
  path!: string;

  /**
   * Standard file events (`created`/`modified`/`deleted`) plus admin/audit events
   * that share the change feed: `vault.reset` (a `_secure/` vault was tombstoned)
   * and `vault.reset.finalized` (the tombstone was unlinked after the 24h grace).
   * Audit rows always have `metadataOnly=1` and a synthetic path scoped to the user.
   */
  @Column({ type: 'varchar' })
  action!: 'created' | 'modified' | 'deleted' | 'vault.reset' | 'vault.reset.finalized';

  @Column({ type: 'text', nullable: true })
  diff!: string | null;

  @Index()
  @Column({ type: 'integer', nullable: true, default: null })
  userId!: number | null;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;

  /**
   * 1 when the row stores hashes/sizes only (E2E paths). Frontends MUST render a
   * "(content hidden)" placeholder rather than the diff. Wired in stage 1 but
   * never set; stage 2 flips `shouldIndexPlaintext` for `_secure/` paths.
   */
  @Column({ type: 'integer', default: 0 })
  metadataOnly!: number;

  @Column({ type: 'text', nullable: true })
  oldHash!: string | null;

  @Column({ type: 'text', nullable: true })
  newHash!: string | null;

  @Column({ type: 'text', nullable: true })
  opType!: NoteChangeOpType | null;
}
