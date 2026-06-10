import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('oauth_authorization_requests')
export class OAuthAuthorizationRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', unique: true })
  requestId!: string;

  @Index()
  @Column({ type: 'integer' })
  clientPk!: number;

  @Column({ type: 'integer', nullable: true })
  userId!: number | null;

  @Column({ type: 'varchar' })
  redirectUri!: string;

  @Column({ type: 'varchar' })
  scope!: string;

  @Column({ type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ type: 'varchar' })
  codeChallenge!: string;

  @Index()
  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
