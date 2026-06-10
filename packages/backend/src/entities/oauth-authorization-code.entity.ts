import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('oauth_authorization_codes')
export class OAuthAuthorizationCode {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', unique: true })
  codeHash!: string;

  @Index()
  @Column({ type: 'integer' })
  userId!: number;

  @Index()
  @Column({ type: 'integer' })
  clientPk!: number;

  @Column({ type: 'varchar' })
  scope!: string;

  @Column({ type: 'varchar' })
  redirectUri!: string;

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
