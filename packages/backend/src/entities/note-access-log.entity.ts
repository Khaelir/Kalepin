import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type AccessLogAction =
  | 'view'
  | 'edit'
  | 'comment'
  | 'share-link-resolved'
  | 'fetched';

@Entity('note_access_log')
@Index('idx_access_log_path_ts', ['path', 'ts'])
@Index('idx_access_log_viewer_ts', ['viewerEmail', 'ts'])
export class NoteAccessLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  path!: string;

  @Column({ type: 'varchar', name: 'viewer_email' })
  viewerEmail!: string;

  @Column({ type: 'varchar' })
  action!: AccessLogAction;

  @Column({ type: 'varchar', name: 'ip_hash', nullable: true })
  ipHash!: string | null;

  @Column({ type: 'integer' })
  ts!: number;
}
