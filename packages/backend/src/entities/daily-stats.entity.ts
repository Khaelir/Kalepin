import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('daily_stats')
export class DailyStats {
  @PrimaryColumn({ type: 'text' })
  date!: string;

  @Column({ type: 'integer', default: 0 })
  active_users!: number;

  @Column({ type: 'integer', default: 0 })
  searches!: number;

  @Column({ type: 'integer', default: 0 })
  searches_empty!: number;

  @Column({ type: 'integer', default: 0 })
  notes_created!: number;

  @Column({ type: 'integer', default: 0 })
  notes_edited!: number;

  @Column({ type: 'integer', default: 0 })
  comments_added!: number;

  @Column({ type: 'integer', default: 0 })
  comments_resolved!: number;

  @Column({ type: 'integer', default: 0 })
  ot_concurrent_edits!: number;
}
