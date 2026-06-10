import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('mention_notifications')
@Index(['userId', 'type', 'docPath'])
@Index(['userId', 'sentAt'])
export class MentionNotification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'text' })
  type!: 'doc' | 'comment';

  @Column({ type: 'text' })
  docPath!: string;

  @Column({ type: 'text', nullable: true })
  threadId!: string | null;

  @Column({ type: 'text', nullable: true })
  commentId!: string | null;

  @CreateDateColumn()
  sentAt!: Date;
}
