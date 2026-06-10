import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('note_snapshots')
export class NoteSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar' })
  path!: string;

  @Index()
  @Column({ type: 'integer' })
  changeId!: number;

  @Column({ type: 'text' })
  content!: string;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}
