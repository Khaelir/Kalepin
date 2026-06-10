import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('note_links')
export class NoteLink {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar' })
  sourcePath!: string;

  @Index()
  @Column({ type: 'text', nullable: true })
  targetPath!: string | null;

  @Column({ type: 'varchar' })
  rawTarget!: string;

  @Column({ type: 'varchar' })
  linkType!: 'wikilink' | 'markdown';

  @Column({ type: 'integer' })
  lineNumber!: number;

  @Column({ type: 'text', nullable: true })
  context!: string | null;
}
