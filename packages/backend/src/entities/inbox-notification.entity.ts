import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type InboxNotificationType = 'comment_mention' | 'doc_mention' | 'thread_reply' | 'share';

/**
 * One in-app notification for one recipient. Distinct from
 * `mention_notifications`, which is the email dedup ledger (see the
 * add-notification-inbox design). Keyed by canonical email, like grants.
 */
@Entity('notifications')
@Index('idx_notifications_recipient', ['recipientEmail', 'id'])
@Index('idx_notifications_recipient_unread', ['recipientEmail', 'readAt'])
// Unique: one item per recipient per comment (NULL commentIds don't collide).
@Index('idx_notifications_recipient_comment', ['recipientEmail', 'commentId'], { unique: true })
export class InboxNotification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  recipientEmail!: string;

  @Column({ type: 'varchar' })
  actorEmail!: string;

  @Column({ type: 'varchar' })
  type!: InboxNotificationType;

  /** Last known path. The current one is resolved from `handleId` at read time. */
  @Column({ type: 'varchar' })
  path!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  handleId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  threadId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  commentId!: string | null;

  /** Doc mentions: slug of the nearest heading above the mention. */
  @Column({ type: 'varchar', nullable: true })
  heading!: string | null;

  @Column({ type: 'text', nullable: true })
  snippet!: string | null;

  // unix ms
  @Column({ type: 'integer' })
  createdAt!: number;

  // unix ms; null = unread
  @Column({ type: 'integer', nullable: true })
  readAt!: number | null;
}
