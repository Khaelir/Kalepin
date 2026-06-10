// Per-tab registry of paths the user just wrote themselves. The backend's
// chokidar watcher fans out `file:changed` over WebSocket to every connected
// session of the owning user — including the originator. Without this carve-
// out the user gets a "File changed externally" toast every time they save a
// `_secure/` note (the secure-files endpoint bypasses OT, so the watcher is
// the only signal the gateway has).
//
// Entries auto-expire so a server fail or a missed event never silences
// future genuine remote changes for that path.

const SELF_SAVE_TTL_MS = 5_000;

const recent = new Map<string, number>();

/** Note that the current tab just wrote `path`. Subsequent file:changed for
 *  this path within the TTL is suppressed. */
export function markSelfSaved(path: string): void {
  recent.set(path, Date.now() + SELF_SAVE_TTL_MS);
}

/** Returns true if `path` was self-saved within the TTL; consumes the entry
 *  so a later, genuinely-external change still fires. */
export function consumeSelfSaved(path: string): boolean {
  const expiresAt = recent.get(path);
  if (expiresAt === undefined) return false;
  recent.delete(path);
  if (expiresAt < Date.now()) return false;
  return true;
}
