import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('oauth_clients')
export class OAuthClient {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', unique: true })
  clientId!: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  softwareId!: string | null;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'simple-json' })
  redirectUris!: string[];

  @Column({ type: 'varchar', nullable: true })
  clientUri!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  dcrMetadata!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
