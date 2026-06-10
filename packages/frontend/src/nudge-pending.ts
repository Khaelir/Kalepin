// In-memory registry for "share with X too?" nudges. The toast is recorded
// at create-time but only rendered when the user shows commitment to the
// note (first OT save with content, or rename away from "Untitled note").
//
// The registry is per-tab and intentionally non-persistent — a refresh cancels
// any pending nudge, which is fine: the user no longer has the editor open.

export interface NudgeIntent {
  grantee: string;
  permission: 'read' | 'comment' | 'write';
}

export class NudgeRegistry {
  private byPath = new Map<string, NudgeIntent>();

  /** Record a pending nudge for `path`. Overwrites any existing entry. */
  record(path: string, intent: NudgeIntent): void {
    this.byPath.set(path, intent);
  }

  /** Pop the pending nudge for `path` (if any). Returns null when there is
   *  no entry — every subsequent call for the same path also returns null,
   *  guaranteeing one nudge per `(parentPath, path)` pair per session. */
  take(path: string): NudgeIntent | null {
    const entry = this.byPath.get(path);
    if (!entry) return null;
    this.byPath.delete(path);
    return entry;
  }

  /** Move a pending nudge from `oldPath` to `newPath`. No-op when nothing is
   *  registered at `oldPath`. Used by the rename hook so a rename away from
   *  "Untitled note.md" carries the pending nudge to the new filename. */
  rekey(oldPath: string, newPath: string): boolean {
    const entry = this.byPath.get(oldPath);
    if (!entry) return false;
    this.byPath.delete(oldPath);
    this.byPath.set(newPath, entry);
    return true;
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  clear(): void {
    this.byPath.clear();
  }
}
