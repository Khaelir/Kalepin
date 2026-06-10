import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('failed_searches')
export class FailedSearch {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  query!: string;

  @CreateDateColumn()
  timestamp!: Date;

  @Column({ type: 'text' })
  source!: string;
}
