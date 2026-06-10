import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('note_meta')
export class NoteMeta {
  @PrimaryColumn({ type: 'varchar' })
  path!: string;

  @Column({ type: 'varchar', nullable: true })
  pinHash!: string | null;

  @Column({ type: 'varchar', nullable: true })
  pinSetBy!: string | null;

  @Column({ type: 'integer', nullable: true })
  pinSetAt!: number | null;

  @Column({ type: 'integer', default: 0 })
  pinFailedAttempts!: number;

  @Column({ type: 'integer', nullable: true })
  pinLastAttemptAt!: number | null;

  @Column({ type: 'integer', nullable: true })
  pinFirstAttemptAtInWindow!: number | null;

  @Column({ type: 'integer', nullable: true })
  pinLockoutUntil!: number | null;
}
