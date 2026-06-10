import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

@Entity('starred_items')
@Unique(['userId', 'type', 'path'])
export class StarredItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar' })
  type!: 'file' | 'folder';

  @Column({ type: 'varchar' })
  path!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
