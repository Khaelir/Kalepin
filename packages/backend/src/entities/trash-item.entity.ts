import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

export type TrashItemKind = 'file' | 'folder';
export type TrashZone = 'shared' | 'personal';

/**
 * A note or folder moved to its zone's trash. The item lives on disk at
 * `trashPath` (`.trash/<id>/<basename>` or `_users/{email}/.trash/<id>/...`);
 * its share links, grants, stars, PIN and doc handles were re-pathed there
 * with it and come back on restore.
 */
@Entity('trash_items')
export class TrashItem {
  // 16 hex chars; also the item's sub-folder name under the trash root.
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id!: string;

  @Index('idx_trash_items_original_path')
  @Column({ type: 'varchar' })
  originalPath!: string;

  @Index('idx_trash_items_trash_path', { unique: true })
  @Column({ type: 'varchar' })
  trashPath!: string;

  @Column({ type: 'varchar' })
  kind!: TrashItemKind;

  @Column({ type: 'varchar' })
  zone!: TrashZone;

  // Personal-zone owner (canonical email); null for the shared vault.
  @Index('idx_trash_items_owner')
  @Column({ type: 'varchar', nullable: true })
  ownerEmail!: string | null;

  @Column({ type: 'varchar' })
  deletedByEmail!: string;

  @Column({ type: 'integer', nullable: true })
  deletedByUserId!: number | null;

  // unix ms
  @Index('idx_trash_items_deleted_at')
  @Column({ type: 'integer' })
  deletedAt!: number;

  // Files inside the item (1 for a file).
  @Column({ type: 'integer', default: 1 })
  itemCount!: number;
}
