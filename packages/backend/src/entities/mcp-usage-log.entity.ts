import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('mcp_usage_log')
export class McpUsageLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @CreateDateColumn()
  timestamp!: Date;

  @Index()
  @Column({ type: 'text' })
  toolName!: string;

  @Index()
  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'integer', nullable: true })
  apiKeyId!: number | null;

  @Index()
  @Column({ type: 'integer', nullable: true })
  grantId!: number | null;

  @Column({ type: 'integer' })
  durationMs!: number;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'integer', nullable: true })
  resultCount!: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;
}
