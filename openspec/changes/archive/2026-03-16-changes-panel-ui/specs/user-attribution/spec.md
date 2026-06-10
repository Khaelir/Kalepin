## user-attribution

Add user identity to change tracking so the changes panel can show who made each change and filter out the current user's own changes.

### Requirements

- `note_changes` table gains a nullable `userId` integer column referencing the `users` table
- `ChangeTrackingService.trackChange()` accepts an optional `userId` parameter
- OT flush path passes the userId of the last user who applied an operation to the document
- Non-OT write paths (files service create/update/delete) pass the authenticated userId from request context
- `GET /api/updates` response excludes changes where `userId = currentUser.id`
- `GET /api/updates` response includes a `user` field (email) on each file change entry for display
- Existing rows with `userId = null` are treated as "unknown user" and always shown

### Modified Response Shape

```typescript
interface FileChangeSummary {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  changes: number;
  lastChangedAt: string;
  user: string | null;      // email of last change author
  diffs: (string | null)[];
}
```
