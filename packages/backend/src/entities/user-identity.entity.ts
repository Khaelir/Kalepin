import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './user.entity';

/**
 * Which external identity last signed in to which user. Observational only:
 * account resolution goes by email, never through this table.
 */
@Entity('user_identities')
@Index('idx_user_identities_subject', ['provider', 'issuer', 'subject'], { unique: true })
export class UserIdentity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar' })
  provider!: string;

  @Column({ type: 'varchar' })
  issuer!: string;

  /** Stable per-person id at the provider (Microsoft: `oid`). */
  @Column({ type: 'varchar' })
  subject!: string;

  @Column({ type: 'varchar' })
  emailAtLink!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime' })
  lastLoginAt!: Date;
}
