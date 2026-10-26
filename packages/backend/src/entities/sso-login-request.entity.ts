import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One SSO sign-in attempt, from `/api/auth/sso/:provider/start` to its
 * callback. Single-use, 10-minute, and bound to the starting browser through
 * the `kp_sso` cookie, whose sha256 is `bindingHash`.
 */
@Entity('sso_login_requests')
export class SsoLoginRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', unique: true })
  state!: string;

  @Column({ type: 'varchar' })
  provider!: string;

  @Column({ type: 'varchar' })
  nonce!: string;

  /** PKCE verifier; never leaves the server. */
  @Column({ type: 'varchar' })
  codeVerifier!: string;

  @Column({ type: 'varchar' })
  bindingHash!: string;

  /** Already reduced by `safeReturnPath`. */
  @Column({ type: 'varchar' })
  returnTo!: string;

  @Index()
  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true, default: null })
  usedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
