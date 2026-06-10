## star-files

Allow users to star up to 5 files or folders for priority change notifications.

### Requirements

- New `starred_items` table: `id`, `userId`, `type` (file | folder), `path`, `createdAt`
- Unique constraint on `(userId, type, path)`
- Maximum 5 starred items per user, enforced at both API and UI level
- REST endpoints:
  - `GET /api/stars` — list current user's starred items
  - `POST /api/stars` — star a file or folder `{ type: "file" | "folder", path: string }`
  - `DELETE /api/stars/:id` — unstar an item
  - `POST /api/stars` returns 409 if at 5-item cap
- `GET /api/updates` response splits changes into two groups:
  - `starred: FolderGroup[]` — changes matching starred files or within starred folders
  - `other: FolderGroup[]` — everything else
- A change matches a folder star if its path starts with the starred folder path prefix
- A change matches a file star if its path equals the starred file path

### StarredItem Entity

```typescript
@Entity('starred_items')
export class StarredItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column()
  type!: 'file' | 'folder';

  @Column()
  path!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
```
