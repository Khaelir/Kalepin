import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('short_links')
export class ShortLink {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  code!: string;

  @Index('idx_short_links_path')
  @Column({ type: 'varchar' })
  path!: string;

  @CreateDateColumn()
  createdAt!: Date;

  // unix ms; null = never. Legacy rows default to null and keep their
  // pre-migration behaviour.
  @Column({ type: 'integer', nullable: true })
  expiresAt!: number | null;

  // Canonical email of the user who minted this code. Null on legacy rows
  // (auto-minted before the explicit-mint contract); used by the legacy-expiry
  // CLI to identify rows that are safe to bulk-expire.
  @Column({ type: 'varchar', nullable: true })
  createdByEmail!: string | null;

  // unix ms; null = active. Setting this is how revoke() works.
  @Column({ type: 'integer', nullable: true })
  revokedAt!: number | null;

  // When true, anonymous viewers may post comments via the guest endpoint.
  // The link creator (or admin) flips this via PATCH /api/share-links/:code.
  // Off by default — guest commenting is opt-in per link.
  @Column({ type: 'boolean', default: false })
  allowGuestComments!: boolean;
}
