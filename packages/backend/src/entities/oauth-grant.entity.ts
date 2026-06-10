import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Active-grant uniqueness key. NULL device labels would slip past a plain unique
// index in SQLite (NULL ≠ NULL), so we materialize device_label as NOT NULL with
// '' as the sentinel for "no device label provided in DCR". See design.md Decision 14.
@Index('uq_oauth_grants_active', ['userId', 'clientPk', 'deviceLabel'], {
  unique: true,
  where: 'revokedAt IS NULL',
})
@Entity('oauth_grants')
export class OAuthGrant {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'integer' })
  userId!: number;

  @Index()
  @Column({ type: 'integer' })
  clientPk!: number;

  @Column({ type: 'varchar', default: '' })
  deviceLabel!: string;

  @Column({ type: 'varchar' })
  scope!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime' })
  absoluteExpiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @Index()
  @Column({ type: 'datetime', nullable: true })
  revokedAt!: Date | null;
}
