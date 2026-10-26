import { Entity, Column, Index, PrimaryColumn } from 'typeorm';

/**
 * One row per distinct tag per note. Only the literal tag is stored
 * (`project/kalepin`, not also `project`); ancestors are expanded at query
 * time. Maintained by TagIndexService.
 */
@Entity('note_tags')
export class NoteTag {
  @PrimaryColumn({ type: 'varchar' })
  path!: string;

  /** Lowercase key used for matching. */
  @Index()
  @PrimaryColumn({ type: 'varchar' })
  tag!: string;

  /** The tag as written in this note (casing preserved). */
  @Column({ type: 'varchar' })
  display!: string;
}
