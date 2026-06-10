import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('ot_operation_history')
export class OTOperationHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  documentId!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column('simple-json')
  operations!: unknown;

  @Column({ type: 'integer' })
  userId!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
