import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar', nullable: true })
  displayName?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true, default: null })
  lastActiveAt?: Date | null;

  @Column({ type: 'simple-json', default: '[]' })
  completedTours!: { tourId: string; version: number }[];

  // ---- _secure/ vault state ----------------------------------------------
  // Server-opaque blobs: the master-KEK wrapped against passphrase-derived and
  // recovery-derived keys. The server never holds the unwrapped master-KEK.

  @Column({ type: 'blob', nullable: true, default: null })
  passphraseWrappedKek?: Buffer | null;

  @Column({ type: 'blob', nullable: true, default: null })
  recoveryWrappedKek?: Buffer | null;

  /** 16 bytes; per-user, per-derivation salt. */
  @Column({ type: 'blob', nullable: true, default: null })
  passphraseSalt?: Buffer | null;

  /** 16 bytes; distinct from `passphraseSalt`. */
  @Column({ type: 'blob', nullable: true, default: null })
  recoverySalt?: Buffer | null;

  /** Unix-ms timestamp when the user last completed `setupVault` for `_secure/`. */
  @Column({ type: 'bigint', nullable: true, default: null })
  vaultSetupAt?: number | null;

  /** Unix-ms timestamp when a vault-reset was triggered; non-null while in the 24h grace window. */
  @Column({ type: 'bigint', nullable: true, default: null })
  vaultTombstoneAt?: number | null;

  /** Virtual path of the renamed `_secure.tombstone-{ts}/` directory. */
  @Column({ type: 'varchar', nullable: true, default: null })
  vaultTombstonePath?: string | null;

  /** Snapshot of the wrapped-KEK fields at reset time, used by the undo path. */
  @Column({ type: 'simple-json', nullable: true, default: null })
  vaultTombstoneSnapshot?: {
    passphraseWrappedKek: string | null;
    recoveryWrappedKek: string | null;
    passphraseSalt: string | null;
    recoverySalt: string | null;
    vaultSetupAt: number | null;
  } | null;
}
