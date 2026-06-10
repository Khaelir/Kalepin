import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Refresh-token rotation with 30-second leeway:
//   - replacedById points to the row that *replaced* this one in the rotation chain
//   - replacedWithAtId / replacedWithRtId remember the (access, refresh) pair issued
//     by the rotation, so a duplicate /oauth/token call within the leeway window can
//     re-emit them instead of triggering chain revocation. See design.md Decision 11.
@Entity('oauth_refresh_tokens')
export class OAuthRefreshToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'integer' })
  grantId!: number;

  @Index()
  @Column({ type: 'varchar', unique: true })
  tokenHash!: string;

  @Column({ type: 'integer', nullable: true })
  replacedById!: number | null;

  @Column({ type: 'integer', nullable: true })
  replacedWithAtId!: number | null;

  @Column({ type: 'integer', nullable: true })
  replacedWithRtId!: number | null;

  @Column({ type: 'datetime', nullable: true })
  replacedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @Index()
  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
