import { Entity, PrimaryColumn, Column } from 'typeorm';

export type EncryptionZoneName = 'personal' | 'shared';
export type MigrationState = 'idle' | 'encrypting' | 'decrypting';

@Entity('encryption_zones')
export class EncryptionZone {
  @PrimaryColumn({ type: 'varchar' })
  zone!: EncryptionZoneName;

  @Column({ type: 'integer', default: 0 })
  enabled!: number;

  @Column({ type: 'blob', nullable: true })
  kekFingerprint!: Buffer | null;

  @Column({ type: 'varchar', default: 'idle' })
  migrationState!: MigrationState;

  @Column({ type: 'integer', default: 0 })
  migrationProgress!: number;

  @Column({ type: 'integer', default: 0 })
  migrationTotal!: number;

  @Column({ type: 'integer', nullable: true })
  migrationStartedAt!: number | null;

  @Column({ type: 'integer' })
  updatedAt!: number;
}
