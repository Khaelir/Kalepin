import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type GrantPermission = 'read' | 'comment' | 'write';

@Entity('document_grants')
@Index('idx_grants_grantee_active', ['granteeEmail', 'revokedAt', 'expiresAt'])
@Index('idx_grants_path_active', ['path', 'revokedAt'])
@Index('idx_grants_grantor', ['grantorEmail', 'revokedAt'])
export class DocumentGrant {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  grantorEmail!: string;

  @Column({ type: 'varchar' })
  granteeEmail!: string;

  @Column({ type: 'varchar' })
  path!: string;

  @Column({ type: 'varchar' })
  permission!: GrantPermission;

  @Column({ type: 'integer', nullable: true })
  expiresAt!: number | null;

  @Column({ type: 'integer' })
  createdAt!: number;

  @Column({ type: 'integer', nullable: true })
  revokedAt!: number | null;
}
