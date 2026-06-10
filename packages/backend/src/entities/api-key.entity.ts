import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import type { ApiKeyScope } from '../auth/permissions';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  keyHash!: string;

  @Column({ type: 'varchar', nullable: true, default: 'rw' })
  scope!: ApiKeyScope | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'integer' })
  userId!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
