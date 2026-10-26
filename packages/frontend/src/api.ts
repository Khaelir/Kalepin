import { authHeaders, clearToken } from './auth';
import { isE2EEncrypted } from './crypto/path-predicates';
import { markSelfSaved } from './self-saved-paths';
import type { FileEntry, CommentThread } from '@kalepin/shared';

const baseHeaders = () => ({
  ...authHeaders(),
  'Content-Type': 'application/json',
});

function checkAuth(res: Response): Response {
  if (res.status === 401) {
    clearToken();
    window.location.reload();
  }
  return res;
}

export async function fetchFileTree(): Promise<FileEntry[]> {
  const res = checkAuth(await fetch('/api/files/tree', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to fetch file tree');
  return res.json();
}

export interface DocHandleEcho {
  id: string;
  path: string;
}

export interface ReadFileResult {
  content: string;
  handle: DocHandleEcho;
  path: string;
}

/** Thrown when /api/files/read?handle=<id> resolves to a tombstoned row. The
 * frontend renders the "this note no longer exists" card distinct from the
 * share-link 410 card. */
export class DocTombstonedError extends Error {
  constructor(public readonly handleId: string) {
    super(`doc-tombstoned:${handleId}`);
    this.name = 'DocTombstonedError';
  }
}

/** Read by either a path or a handle id. The response always carries the
 * handle so callers can normalize the address bar to /doc/<id>. */
export async function readFile(
  input: { path: string } | { handleId: string },
): Promise<ReadFileResult> {
  const qs =
    'path' in input
      ? `path=${encodeURIComponent(input.path)}`
      : `handle=${encodeURIComponent(input.handleId)}`;
  const res = await fetch(`/api/files/read?${qs}`, {
    headers: authHeaders(),
    credentials: 'same-origin',
  });
  if (res.status === 423) {
    const refPath =
      'path' in input ? input.path : (await res.json().catch(() => ({}))).path ?? '';
    throw new PinLockedError(refPath);
  }
  if (res.status === 410) {
    const body = await res.json().catch(() => ({}));
    if (body && (body.tombstoned === true || body.message?.tombstoned === true)) {
      const id = 'handleId' in input ? input.handleId : '';
      throw new DocTombstonedError(id);
    }
    throw new Error('Gone');
  }
  if (res.status === 404) throw new Error('File not found');
  if (!res.ok) throw new Error('Failed to read file');
  const data = await res.json();
  return {
    content: data.content,
    handle: data.handle,
    path: data.path,
  };
}

/** Backwards-compatible thin shim — older call-sites that only need content
 * keep working. New code should call `readFile(...)` and use the handle. */
export async function readFileContent(path: string): Promise<string> {
  const result = await readFile({ path });
  return result.content;
}

export async function createFile(path: string, content = ''): Promise<void> {
  // Mirror server-side `.md` enforcement so the self-saved key matches the
  // watcher event path. The watcher's chokidar emits the resolved filename;
  // suppression depends on an exact-string match.
  const targetPath = path.endsWith('.md') ? path : `${path}.md`;
  markSelfSaved(targetPath);
  const res = checkAuth(await fetch('/api/files/create', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, content }),
  }));
  if (!res.ok) throw new Error('Failed to create file');
}

export async function deleteFile(path: string): Promise<void> {
  const res = checkAuth(await fetch(`/api/files/delete?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to delete file');
}

export async function moveFile(src: string, dest: string): Promise<void> {
  markSelfSaved(dest);
  const res = checkAuth(await fetch('/api/files/move', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ src, dest }),
  }));
  if (!res.ok) {
    // Surface the server's reason (e.g. 409 "… already exists").
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.message === 'string' ? body.message : 'Failed to move file');
  }
}

export async function deleteDirectory(path: string): Promise<void> {
  const res = checkAuth(await fetch(`/api/files/directory?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to delete directory');
}

export async function createDirectory(path: string): Promise<void> {
  const res = checkAuth(await fetch('/api/files/directory', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path }),
  }));
  if (!res.ok) throw new Error('Failed to create directory');
}

export async function createVaultItem(
  kind: 'note' | 'folder',
  parentPath: string,
  name?: string,
): Promise<{ path: string }> {
  // E2E `_secure/` paths cannot use the unified server-side create — the
  // server can't synthesize an envelope with the user's master-KEK. Notes go
  // through the dedicated secure endpoint with a client-built envelope;
  // folders are still created server-side (the encrypting adapter passes
  // empty placeholder writes through unencrypted), but the name-collision
  // dance must run on the client because each candidate path is opaque.
  if (isE2EEncrypted(parentPath)) {
    return createSecureVaultItem(kind, parentPath, name);
  }
  const res = checkAuth(await fetch('/api/vault/items', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ kind, parent_path: parentPath, name }),
  }));
  if (!res.ok) throw new Error(`Failed to create ${kind}`);
  const out = (await res.json()) as { path: string };
  // The server resolves the final filename (collision-renames "Untitled note 2.md")
  // so we can only register the self-saved key after the response. Chokidar
  // typically fans out the event ~100ms later (default atomic-write debounce),
  // which is well within the 5s TTL.
  if (kind === 'note') markSelfSaved(out.path);
  return out;
}

async function createSecureVaultItem(
  kind: 'note' | 'folder',
  parentPath: string,
  name: string | undefined,
): Promise<{ path: string }> {
  const fallback = kind === 'note' ? 'Untitled note' : 'New folder';
  const base = ((name ?? '').trim() || fallback).replace(/[\\/]/g, '-');
  const ext = kind === 'note' ? '.md' : '';
  // Mirror the server-side resolution loop: try base, then "base 2", "base 3", …
  let i = 1;
  let leaf = base;
  while (i < 1000) {
    const candidate = `${parentPath}/${leaf}${ext}`;
    try {
      if (kind === 'note') {
        markSelfSaved(candidate);
        const { writeSecureNote } = await import('./crypto/secure-io');
        await writeSecureNote(candidate, '', { create: true });
      } else {
        const folderRes = checkAuth(await fetch('/api/vault/items', {
          method: 'POST',
          headers: baseHeaders(),
          body: JSON.stringify({ kind, parent_path: parentPath, name: leaf }),
        }));
        if (!folderRes.ok) {
          const data = await folderRes.json().catch(() => ({}));
          throw new Error(data.message || `Failed to create ${kind}`);
        }
        const { path } = await folderRes.json();
        return { path };
      }
      return { path: candidate };
    } catch (err) {
      // Server returns BadRequest "destination already exists" on collision.
      const msg = (err as Error).message || '';
      if (!msg.includes('already exists')) throw err;
      i++;
      leaf = `${base} ${i}`;
    }
  }
  throw new Error(`Failed to create ${kind}: too many name collisions`);
}

export async function fetchComments(path: string): Promise<CommentThread[]> {
  const res = await fetch(`/api/comments?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch comments');
  return res.json();
}

export async function addComment(path: string, blockId: string, text: string, quotedText?: string, positionHint?: { from: number; to: number }): Promise<void> {
  const res = checkAuth(await fetch('/api/comments', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, blockId, text, quotedText, positionHint }),
  }));
  if (!res.ok) throw new Error('Failed to add comment');
}

export async function replyToComment(path: string, blockId: string, threadId: string, text: string): Promise<void> {
  const res = checkAuth(await fetch('/api/comments/reply', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, blockId, threadId, text }),
  }));
  if (!res.ok) throw new Error('Failed to reply to comment');
}

export async function resolveComment(path: string, blockId: string, threadId: string, resolved: boolean): Promise<void> {
  const res = checkAuth(await fetch('/api/comments/resolve', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, blockId, threadId, resolved }),
  }));
  if (!res.ok) throw new Error('Failed to resolve comment');
}

export async function deleteComment(path: string, blockId: string, threadId: string, commentId: string): Promise<void> {
  const params = new URLSearchParams({ path, blockId, threadId, commentId });
  const res = checkAuth(await fetch(`/api/comments?${params}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to delete comment');
}

// Users

export interface UserInfo {
  email: string;
  displayName: string | null;
}

let usersCache: UserInfo[] | null = null;

export async function fetchUsers(): Promise<UserInfo[]> {
  if (usersCache) return usersCache;
  const res = await fetch('/api/users', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch users');
  usersCache = await res.json();
  return usersCache!;
}

// API Key helpers

export type ApiKeyScope = 'ro' | 'rc' | 'rw' | 'admin';

export interface ApiKeyInfo {
  id: number;
  name: string;
  scope: ApiKeyScope;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string;
}

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  const res = await fetch('/api/auth/api-keys', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to list API keys');
  return res.json();
}

export async function createApiKey(name: string, scope: ApiKeyScope = 'rw'): Promise<ApiKeyCreated> {
  const res = await fetch('/api/auth/api-keys', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ name, scope }),
  });
  if (!res.ok) throw new Error('Failed to create API key');
  return res.json();
}

export async function revokeApiKey(id: number): Promise<void> {
  const res = await fetch(`/api/auth/api-keys/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to revoke API key');
}

export async function fetchWhoami(): Promise<{ scope: string; permissions: string[]; isAdmin: boolean }> {
  const res = await fetch('/api/auth/api-keys/whoami', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch whoami');
  return res.json();
}

// Access log

export type AccessLogAction = 'view' | 'edit' | 'comment' | 'share-link-resolved' | 'fetched';

export interface AccessLogRow {
  id: number;
  viewer_email: string;
  action: AccessLogAction;
  ts: number;
  ip_hash: string | null;
}

export class AccessLogForbiddenError extends Error {
  constructor() { super('Access log forbidden'); }
}

export async function fetchAccessLog(path: string, opts?: { since?: number; limit?: number }): Promise<AccessLogRow[]> {
  const params = new URLSearchParams();
  if (opts?.since !== undefined) params.set('since', String(opts.since));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/notes/${encodeURIComponent(path)}/access-log${qs}`, {
    headers: authHeaders(),
  });
  if (res.status === 403) throw new AccessLogForbiddenError();
  if (!res.ok) throw new Error('Failed to fetch access log');
  const data = await res.json();
  return data.rows ?? [];
}

export async function eraseMyAccessLog(): Promise<{ deleted: number }> {
  const res = checkAuth(await fetch('/api/users/me/access-log', {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to erase access log');
  return res.json();
}

// OAuth Connections (consent + grants management)

export type OAuthScopeString = 'notes.read' | 'notes.comment' | 'notes.write';

export interface OAuthAuthorizeRequest {
  request_id: string;
  client: {
    client_id: string;
    name: string;
    client_uri: string | null;
    verified: boolean;
  };
  redirect_uri: string;
  redirect_domain: string;
  requested_scope: OAuthScopeString[];
  user: { email: string };
  existing_grant: { created_at: string } | null;
}

export interface OAuthGrantInfo {
  id: number;
  client_id: string;
  client_name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
}

export class OAuthRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function getAuthorizeRequest(requestId: string): Promise<OAuthAuthorizeRequest> {
  const res = await fetch(`/api/oauth/authorize/${encodeURIComponent(requestId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new OAuthRequestError(res.status, data.message || `Failed to load authorization request (${res.status})`);
  }
  return res.json();
}

export async function approveAuthorization(
  requestId: string,
  grantedScope?: OAuthScopeString[],
): Promise<{ redirect_to: string }> {
  const res = await fetch(`/api/oauth/authorize/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(grantedScope ? { granted_scope: grantedScope } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new OAuthRequestError(res.status, data.message || 'Failed to approve authorization');
  }
  return res.json();
}

export async function denyAuthorization(requestId: string): Promise<{ redirect_to: string }> {
  const res = await fetch(`/api/oauth/authorize/${encodeURIComponent(requestId)}/deny`, {
    method: 'POST',
    headers: baseHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new OAuthRequestError(res.status, data.message || 'Failed to deny authorization');
  }
  return res.json();
}

export async function listOAuthGrants(): Promise<OAuthGrantInfo[]> {
  const res = await fetch('/api/oauth/grants', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to list OAuth grants');
  return res.json();
}

export async function revokeOAuthGrant(id: number): Promise<void> {
  const res = await fetch(`/api/oauth/grants/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to revoke OAuth grant');
}

// Share Links

export interface ShareLinkInfo {
  code: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_resolved_at: number | null;
  /** Canonical email of the user who minted this link. Null for legacy
   * auto-minted rows (pre-explicit-mint contract). */
  created_by_email: string | null;
  /** When true, anonymous viewers can post comments via the guest endpoint.
   * Off by default; flipped via PATCH /api/share-links/:code. */
  allow_guest_comments: boolean;
}

/** Mint a public share-link. Specify `ttlMs: null` for "never expires";
 * leave undefined to take the server's default (30d for personal, never for
 * shared-vault). */
export async function mintShareLink(input: {
  path: string;
  ttlMs?: number | null;
  allowGuestComments?: boolean;
}): Promise<{ code: string }> {
  const body: {
    path: string;
    ttl_ms?: number | null;
    allow_guest_comments?: boolean;
  } = { path: input.path };
  if (input.ttlMs !== undefined) body.ttl_ms = input.ttlMs;
  if (input.allowGuestComments !== undefined) {
    body.allow_guest_comments = input.allowGuestComments;
  }
  const res = checkAuth(await fetch('/api/share-links', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error('Failed to create share link');
  return res.json();
}

/** Toggle allow_guest_comments on an existing share-link. */
export async function updateShareLink(
  code: string,
  input: { allowGuestComments?: boolean },
): Promise<{ ok: true }> {
  const body: { allow_guest_comments?: boolean } = {};
  if (input.allowGuestComments !== undefined) {
    body.allow_guest_comments = input.allowGuestComments;
  }
  const res = checkAuth(await fetch(`/api/share-links/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error('Failed to update share link');
  return res.json();
}

/** Look up the share-link metadata for a path. Returns null when no row
 * exists. Owner or admin only. */
export async function findShareLinkByPath(path: string): Promise<ShareLinkInfo | null> {
  const res = checkAuth(await fetch(`/api/share-links/by-path?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  }));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch share link');
  const body = await res.json();
  return body ?? null;
}

/** Revoke a share-link. The link's `revoked_at` is stamped server-side;
 * subsequent resolves return 410. */
export async function revokeShareLink(code: string): Promise<void> {
  const res = checkAuth(await fetch(`/api/share-links/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to revoke share link');
}

export class ShareLinkGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareLinkGoneError';
  }
}

export async function resolveShareLink(code: string): Promise<{
  path: string;
  /** Stable doc handle for the resolved path. Lazy-minted server-side; the
   * frontend uses it to normalize the address bar to /doc/<id> after the
   * share-link viewer hands off to the in-app reader. */
  handleId?: string;
  sharedByEmail?: string | null;
  allowGuestComments?: boolean;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  requiresPin?: boolean;
}> {
  const res = checkAuth(await fetch(`/api/share-links/resolve/${encodeURIComponent(code)}`, {
    headers: authHeaders(),
    credentials: 'same-origin',
  }));
  if (res.status === 404) throw new Error('Code not found');
  if (res.status === 410) {
    throw new ShareLinkGoneError(
      'This share link is no longer active — it may have been revoked or expired.',
    );
  }
  if (!res.ok) throw new Error('Failed to resolve share link');
  return res.json();
}

/** Anonymous-mode resolve: no Authorization header, returns the same shape as
 * the authenticated path. The backend's OptionalAuthGuard tolerates the
 * missing header. Used by the guest viewer to bootstrap. */
export async function resolveShareLinkPublic(code: string): Promise<{
  path: string;
  handleId?: string;
  sharedByEmail?: string | null;
  allowGuestComments?: boolean;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  requiresPin?: boolean;
}> {
  const res = await fetch(`/api/share-links/resolve/${encodeURIComponent(code)}`, {
    credentials: 'same-origin',
  });
  if (res.status === 404) throw new Error('Code not found');
  if (res.status === 410) {
    throw new ShareLinkGoneError(
      'This share link is no longer active — it may have been revoked or expired.',
    );
  }
  if (!res.ok) throw new Error('Failed to resolve share link');
  return res.json();
}

/** Anonymous-mode content fetch. Pass the accessToken issued by
 * `resolveShareLinkPublic`. Returns the rewritten markdown (assets pointing
 * at the scoped /asset endpoint). */
export async function fetchShareLinkContent(
  code: string,
  accessToken: string,
): Promise<{ path: string; content: string }> {
  const res = await fetch(`/api/share-links/${encodeURIComponent(code)}/content`, {
    headers: { Authorization: `ShareLink ${accessToken}` },
    credentials: 'same-origin',
  });
  if (res.status === 404) throw new Error('File not found');
  if (res.status === 410) {
    throw new ShareLinkGoneError(
      'This share link is no longer active — it may have been revoked or expired.',
    );
  }
  if (res.status === 423) {
    throw new Error('PIN required');
  }
  if (!res.ok) throw new Error('Failed to fetch share-link content');
  return res.json();
}

/** Anonymous PIN unlock for a share-link. On success the server sets a path-
 * scoped cookie AND returns the unlock token in the body — the SPA only needs
 * the cookie for subsequent requests. */
export async function verifyShareLinkPin(
  code: string,
  pin: string,
): Promise<{ ok: true; expiresIn?: number; unlockToken?: string }> {
  const res = await fetch(`/api/share-links/${encodeURIComponent(code)}/pin/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ pin }),
  });
  if (res.status === 404) throw new Error('Code not found');
  if (res.status === 410) {
    throw new ShareLinkGoneError('This share link is no longer active');
  }
  if (res.status === 423) {
    throw new Error('Locked out — try again later');
  }
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body?.error === 'wrong-pin') {
      const remaining = body.remainingAttempts;
      throw new Error(
        typeof remaining === 'number'
          ? `Wrong PIN — ${remaining} attempts remaining`
          : 'Wrong PIN',
      );
    }
    throw new Error('Bad request');
  }
  if (!res.ok) throw new Error('Failed to verify PIN');
  return res.json();
}

/** Post a guest comment to a share-link that has allow_guest_comments=true. */
export async function postGuestComment(
  code: string,
  accessToken: string,
  body: {
    blockId: string;
    threadId?: string;
    authorEmail: string;
    authorName: string;
    text: string;
    quotedText?: string;
    positionHint?: { from: number; to: number };
  },
): Promise<{ comment: import('@kalepin/shared').Comment; thread?: import('@kalepin/shared').CommentThread }> {
  const res = await fetch(`/api/share-links/${encodeURIComponent(code)}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `ShareLink ${accessToken}`,
    },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (res.status === 403) throw new Error('Guest comments are not enabled for this link');
  if (res.status === 429) throw new Error('Too many comments — please wait a moment');
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.message || errBody?.error || 'Failed to post comment');
  }
  return res.json();
}

// Headings

export interface HeadingEntry { level: number; text: string }

export async function fetchHeadings(path: string): Promise<HeadingEntry[]> {
  const res = await fetch(`/api/files/headings?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// Search

export interface SearchResult {
  path: string; snippet: string; score: number; heading?: string; type?: 'note' | 'comment'; threadId?: string; commentAuthor?: string;
  /** Set on results of a `tag:`-only query, which are ordered by recency instead of score. */
  modifiedAt?: string;
}

export async function searchNotes(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

// Updates / Changes

export interface FileChangeSummary {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  changes: number;
  lastChangedAt: string;
  user: string | null;
  diffs: (string | null)[];
  /** True when this row stored hashes/sizes only — render "(content hidden)" instead of a diff. */
  metadataOnly?: boolean;
}

export interface FolderGroup {
  folder: string;
  files: FileChangeSummary[];
}

export interface UpdatesResponse {
  period: { since: string | null; until: string };
  stats: { created: number; modified: number; deleted: number };
  starred: FolderGroup[];
  other: FolderGroup[];
}

export async function getUpdates(since?: string): Promise<UpdatesResponse> {
  const url = since
    ? `/api/updates?since=${encodeURIComponent(since)}`
    : '/api/updates';
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch updates');
  return res.json();
}

export async function markUpdatesSeen(): Promise<void> {
  await fetch('/api/updates/mark-seen', {
    method: 'POST',
    headers: authHeaders(),
  });
}

export interface RecentlyEditedItem {
  path: string;
  name: string;
  editorId: number | null;
  editorEmail: string | null;
  editorDisplayName: string | null;
  modifiedAt: string;
}

export async function getRecentlyEdited(limit?: number): Promise<RecentlyEditedItem[]> {
  const url = limit ? `/api/updates/recently-edited?limit=${limit}` : '/api/updates/recently-edited';
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch recently edited');
  return res.json();
}

// Stars

export interface StarredItem {
  id: number;
  userId: number;
  type: 'file' | 'folder';
  path: string;
  createdAt: string;
}

export async function getStars(): Promise<StarredItem[]> {
  const res = await fetch('/api/stars', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch stars');
  return res.json();
}

export async function addStar(type: 'file' | 'folder', path: string): Promise<StarredItem> {
  const res = await fetch('/api/stars', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ type, path }),
  });
  if (!res.ok) throw new Error('Failed to add star');
  return res.json();
}

export async function removeStar(id: number): Promise<void> {
  const res = await fetch(`/api/stars/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to remove star');
}

// Links / Backlinks

export interface BacklinkEntry {
  sourcePath: string;
  lineNumber: number;
  context: string | null;
  linkType: 'wikilink' | 'markdown';
}

export interface OutgoingLinkEntry {
  targetPath: string | null;
  rawTarget: string;
  lineNumber: number;
  linkType: 'wikilink' | 'markdown';
}

export interface UnlinkedMentionEntry {
  sourcePath: string;
  lineNumber: number;
  context: string;
}

export async function fetchBacklinks(path: string): Promise<BacklinkEntry[]> {
  const res = await fetch(`/api/links/backlinks?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch backlinks');
  return res.json();
}

export async function fetchOutgoingLinks(path: string): Promise<OutgoingLinkEntry[]> {
  const res = await fetch(`/api/links/outgoing?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch outgoing links');
  return res.json();
}

export async function fetchUnlinkedMentions(path: string): Promise<UnlinkedMentionEntry[]> {
  const res = await fetch(`/api/links/unlinked-mentions?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch unlinked mentions');
  return res.json();
}

export async function convertMention(sourcePath: string, lineNumber: number, title: string): Promise<void> {
  const res = await fetch('/api/links/convert-mention', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ sourcePath, lineNumber, title }),
  });
  if (!res.ok) throw new Error('Failed to convert mention');
}

// Graph

export interface GraphNode {
  path: string;
  title: string;
  inCount: number;
  outCount: number;
  lastModified: string | null;
  isBroken?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function fetchGraph(path?: string, depth?: number): Promise<GraphData> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (depth !== undefined) params.set('depth', String(depth));
  const qs = params.toString();
  const url = `/api/links/graph${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch graph data');
  return res.json();
}

// Tours

export interface CompletedTour {
  tourId: string;
  version: number;
}

export async function getCompletedTours(): Promise<CompletedTour[]> {
  const res = await fetch('/api/users/me/tours', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch completed tours');
  return res.json();
}

export async function updateCompletedTour(tourId: string, version: number): Promise<void> {
  await fetch('/api/users/me/tours', {
    method: 'PUT',
    headers: baseHeaders(),
    body: JSON.stringify({ tourId, version }),
  });
}

// Version History

export interface HistoryEntry {
  id: number;
  action: 'created' | 'modified' | 'deleted';
  userId: number | null;
  userEmail: string | null;
  createdAt: string;
}

export interface VersionContent {
  content: string;
  partial: boolean;
}

export async function fetchHistory(path: string): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/files/history?path=${encodeURIComponent(path)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

export async function fetchVersion(path: string, changeId: number): Promise<VersionContent> {
  const res = await fetch(`/api/files/version?path=${encodeURIComponent(path)}&changeId=${changeId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch version');
  return res.json();
}

export async function restoreVersion(path: string, changeId: number): Promise<void> {
  markSelfSaved(path);
  const res = await fetch('/api/files/restore', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ path, changeId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to restore version');
  }
}

// Vault export

export async function downloadVaultZip(): Promise<void> {
  const res = checkAuth(await fetch('/api/files/download-zip', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to download vault');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `Kalepin_vault_${stamp}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// Backup & Restore

export async function downloadBackup(): Promise<void> {
  const res = await fetch('/api/admin/backup/download', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to download backup');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get('Content-Disposition');
  const filenameMatch = disposition?.match(/filename=(.+)/);
  const filename = filenameMatch ? filenameMatch[1] : 'kalepin-backup.tar.gz';
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Encryption — public status (any authenticated user)

export interface EncryptionPublicStatus {
  zones: { personal?: boolean; shared?: boolean };
}

export async function getEncryptionPublicStatus(): Promise<EncryptionPublicStatus> {
  const res = checkAuth(
    await fetch('/api/encryption/status', { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error('Failed to load encryption status');
  return res.json();
}

// Secure files (E2E `_secure/`) — envelope-bytes I/O. The actual encrypt /
// decrypt work happens in `crypto/secure-io.ts`; the helpers there call
// directly into the same endpoints, so re-exporting them here would just be
// noise. We keep the type for the readSecureBytes shape only.

export interface SecureReadResponse { path: string; envelope: string }

// Secure vault (E2E `_secure/`) — wrapped-KEK custody and lifecycle.

export interface VaultMetaResponse {
  passphrase_wrapped_kek: string | null;
  passphrase_salt: string | null;
  recovery_wrapped_kek: string | null;
  recovery_salt: string | null;
  vault_setup_at: number | null;
  vault_tombstone_at: number | null;
}

export async function getVaultMeta(): Promise<VaultMetaResponse> {
  const res = checkAuth(await fetch('/api/users/me/vault-meta', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to fetch vault meta');
  return res.json();
}

export async function putVaultMeta(body: {
  passphrase_wrapped_kek: string;
  passphrase_salt: string;
  recovery_wrapped_kek?: string | null;
  recovery_salt?: string | null;
}): Promise<{ ok: true; vault_setup_at: number }> {
  const res = checkAuth(
    await fetch('/api/users/me/vault-meta', {
      method: 'PUT',
      headers: baseHeaders(),
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to update vault meta');
  }
  return res.json();
}

export async function resetSecureVault(confirmEmail: string): Promise<{ tombstone_path: string; expires_at: number; files_count: number }> {
  const res = checkAuth(
    await fetch('/api/users/me/secure-vault/reset', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ confirm_email: confirmEmail }),
    }),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Vault reset failed');
  }
  return res.json();
}

// Encryption (admin)

export type EncryptionZoneName = 'personal' | 'shared';
export type EncryptionMigrationState = 'idle' | 'encrypting' | 'decrypting';

export interface EncryptionZoneState {
  zone: EncryptionZoneName;
  enabled: boolean;
  kek_fingerprint: string | null;
  migration_state: EncryptionMigrationState;
  migration_progress: number;
  migration_total: number;
  migration_started_at?: number | null;
}

export interface EncryptionStateResponse {
  zones: EncryptionZoneState[];
}

export async function getEncryptionState(): Promise<EncryptionStateResponse> {
  const res = checkAuth(
    await fetch('/api/admin/encryption', { headers: authHeaders() }),
  );
  if (!res.ok) throw new Error('Failed to load encryption state');
  return res.json();
}

export async function encryptZone(zone: EncryptionZoneName): Promise<void> {
  const res = checkAuth(
    await fetch(`/api/admin/encryption/zones/${zone}/encrypt`, {
      method: 'POST',
      headers: authHeaders(),
    }),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to start encryption sweep');
  }
}

export async function decryptZone(zone: EncryptionZoneName): Promise<void> {
  const res = checkAuth(
    await fetch(`/api/admin/encryption/zones/${zone}/decrypt`, {
      method: 'POST',
      headers: authHeaders(),
    }),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to start decryption sweep');
  }
}

export async function restoreBackup(file: File): Promise<{ message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/admin/backup/restore', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to restore backup');
  }
  return res.json();
}

// Per-note PIN

export class PinLockedError extends Error {
  constructor(public readonly path: string) {
    super(`pin-locked:${path}`);
  }
}

export class PinWrongError extends Error {
  constructor(public readonly remainingAttempts: number) {
    super(`pin-wrong:remaining=${remainingAttempts}`);
  }
}

export class PinLockoutError extends Error {
  constructor(public readonly lockoutUntil: number | null) {
    super(`pin-lockout`);
  }
}

function pinPath(path: string): string {
  return `/api/notes/${encodeURIComponent(path)}/pin`;
}

export async function setNotePin(path: string, pin: string): Promise<void> {
  const res = checkAuth(await fetch(pinPath(path), {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ pin }),
  }));
  if (res.status === 204) return;
  const data = await res.json().catch(() => ({} as { message?: string }));
  throw new Error(data.message || `Failed to set PIN (${res.status})`);
}

export async function removeNotePin(path: string): Promise<void> {
  const res = checkAuth(await fetch(pinPath(path), {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (res.status === 204) return;
  throw new Error('Failed to remove PIN');
}

// Unlock tokens from successful PIN verifies, kept in memory only. The
// WebSocket was opened before the unlock cookie existed, so doc:open frames
// carry the token instead.
const pinUnlockTokens = new Map<string, string>();

export function getPinUnlockToken(path: string): string | undefined {
  return pinUnlockTokens.get(path);
}

/**
 * Verify a PIN. On success the server sets an HttpOnly cookie that subsequent
 * fetches automatically present. On failure, throws a typed error so callers
 * can render attempt counters and lockout timers.
 */
export async function verifyNotePin(path: string, pin: string): Promise<{ expiresIn?: number }> {
  const res = await fetch(`${pinPath(path)}/verify`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ pin }),
    credentials: 'same-origin',
  });
  if (res.status === 423) {
    const data = await res.json().catch(() => ({} as { lockoutUntil?: number }));
    throw new PinLockoutError(data.lockoutUntil ?? null);
  }
  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    if (data?.error === 'wrong-pin') {
      throw new PinWrongError(data.remainingAttempts ?? 0);
    }
    throw new Error(data?.message || 'Invalid PIN');
  }
  if (!res.ok) throw new Error(`Verify failed (${res.status})`);
  const data: { expiresIn?: number; token?: string } = await res.json();
  if (data.token) pinUnlockTokens.set(path, data.token);
  return { expiresIn: data.expiresIn };
}

// Document grants — per-file user-to-user permission grants

export type GrantPermission = 'read' | 'comment' | 'write';

export interface DocumentGrantInfo {
  id: number;
  grantor_email: string;
  grantee_email: string;
  path: string;
  permission: GrantPermission;
  expires_at: number | null;
  created_at: number;
}

export interface SharedWithMeGroup {
  grantor_email: string;
  items: Array<{
    id: number;
    path: string;
    permission: GrantPermission;
    expires_at: number | null;
    created_at: number;
  }>;
}

export async function mintGrant(input: {
  granteeEmail: string;
  path: string;
  permission: GrantPermission;
  expiresAt?: number | null;
}): Promise<{ id: number }> {
  const res = checkAuth(await fetch('/api/grants', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({
      grantee_email: input.granteeEmail,
      path: input.path,
      permission: input.permission,
      expires_at: input.expiresAt ?? null,
    }),
  }));
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || 'Failed to mint grant');
  }
  return res.json();
}

export async function revokeGrant(id: number): Promise<void> {
  const res = checkAuth(await fetch(`/api/grants/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to revoke grant');
}

export async function updateGrant(id: number, patch: { permission?: GrantPermission; expiresAt?: number | null }): Promise<DocumentGrantInfo> {
  const body: Record<string, unknown> = {};
  if (patch.permission !== undefined) body.permission = patch.permission;
  if (patch.expiresAt !== undefined) body.expires_at = patch.expiresAt;
  const res = checkAuth(await fetch(`/api/grants/${id}`, {
    method: 'PATCH',
    headers: baseHeaders(),
    body: JSON.stringify(body),
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update grant');
  }
  return res.json();
}

export interface AccessSummaryGrantee {
  email: string;
  view_count: number;
  last_view_at: number | null;
  last_edit_at: number | null;
}

export interface AccessSummary {
  grantees: AccessSummaryGrantee[];
  anonymous: { resolve_count: number; last_resolve_at: number | null } | null;
}

/**
 * Per-path aggregate of access-log activity for the share dialog. Returns
 * `null` when the backend doesn't expose the endpoint (older deploys without
 * `add-access-metadata` shipped) so the dialog can hide the meta line.
 */
export async function getAccessSummary(path: string): Promise<AccessSummary | null> {
  const res = checkAuth(await fetch(
    `/api/notes/${encodeURIComponent(path)}/access-summary`,
    { headers: authHeaders() },
  ));
  if (res.status === 404 || res.status === 501) return null;
  if (!res.ok) throw new Error('Failed to load access summary');
  return res.json();
}

export async function listGrantsForPath(path: string): Promise<DocumentGrantInfo[]> {
  const res = checkAuth(await fetch(`/api/grants?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to list grants for path');
  const data = await res.json();
  return data.grants as DocumentGrantInfo[];
}

export async function listGrants(as: 'grantor' | 'grantee'): Promise<DocumentGrantInfo[]> {
  const res = checkAuth(await fetch(`/api/grants?as=${as}`, {
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to list grants');
  const data = await res.json();
  return data.grants as DocumentGrantInfo[];
}

export async function listSharedWithMe(): Promise<SharedWithMeGroup[]> {
  const res = checkAuth(await fetch('/api/files/shared-with-me', {
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to list shared-with-me');
  const data = await res.json();
  return data.groups as SharedWithMeGroup[];
}

export interface PinnedNote { path: string; pinSetAt: number | null }

export async function listMyPinnedNotes(): Promise<PinnedNote[]> {
  const res = checkAuth(await fetch('/api/notes/pin/list', {
    method: 'POST',
    headers: baseHeaders(),
    body: '{}',
  }));
  if (!res.ok) throw new Error('Failed to list pinned notes');
  const data = await res.json();
  return (data.items ?? []) as PinnedNote[];
}

// Image attachment helpers

const imageBlobCache = new Map<string, string>();

export async function uploadImage(file: File, docPath: string): Promise<{ name: string; relativePath: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('docPath', docPath);
  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to upload image');
  return res.json();
}

/**
 * Build the attachment URL. For shared notes the legacy `?name=X` shape is
 * preserved bit-for-bit. For personal notes (`_users/{me}/...`) we append
 * `&doc={encoded docPath}` so the backend can resolve the personal namespace.
 */
export function attachmentUrl(name: string, docPath?: string): string {
  const base = `/api/files/attachment?name=${encodeURIComponent(name)}`;
  if (docPath && docPath.startsWith('_users/')) {
    return `${base}&doc=${encodeURIComponent(docPath)}`;
  }
  return base;
}

export async function fetchImageBlob(name: string, docPath?: string): Promise<string> {
  // Cache key includes the doc namespace so a shared image and a personal image
  // with colliding names are resolved independently.
  const cacheKey = docPath && docPath.startsWith('_users/') ? `${docPath}::${name}` : name;
  const cached = imageBlobCache.get(cacheKey);
  if (cached) return cached;
  const res = await fetch(attachmentUrl(name, docPath), {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch image');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  imageBlobCache.set(cacheKey, url);
  return url;
}

// Templates & daily notes

export type TemplateScope = 'shared' | 'personal';

export interface TemplateInfo {
  /** Path relative to the templates folder, without `.md`. */
  name: string;
  path: string;
  scope: TemplateScope;
}

export interface TemplateList {
  /** Configured templates folder name (`Templates` by default). */
  folder: string;
  templates: TemplateInfo[];
}

export interface CreatedNoteResult {
  path: string;
  id: string | null;
  created: boolean;
}

async function templateRequestError(res: Response, fallback: string): Promise<Error> {
  if (res.status === 423) return new Error('This template is PIN-protected. Open it and unlock it first.');
  const body = await res.json().catch(() => null);
  return new Error(typeof body?.message === 'string' ? body.message : fallback);
}

export async function listTemplates(): Promise<TemplateList> {
  const res = checkAuth(await fetch('/api/templates', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to load templates');
  return res.json();
}

/** Same endpoint as `createVaultItem`, with the template rendered server-side. */
export async function createNoteFromTemplate(
  parentPath: string,
  template: string,
  name: string | undefined,
  timezone: string | undefined,
): Promise<{ path: string }> {
  const res = checkAuth(await fetch('/api/vault/items', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ kind: 'note', parent_path: parentPath, name, template, timezone }),
  }));
  if (!res.ok) throw await templateRequestError(res, 'Failed to create note from template');
  const out = (await res.json()) as { path: string };
  markSelfSaved(out.path);
  return out;
}

/** Today's (or any day's) daily note, created on first request. */
export async function openDailyNote(date: string, timezone: string | undefined): Promise<CreatedNoteResult> {
  const res = checkAuth(await fetch('/api/daily-notes', {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ date, timezone }),
  }));
  if (!res.ok) throw await templateRequestError(res, "Failed to open today's note");
  const out = (await res.json()) as CreatedNoteResult;
  if (out.created) markSelfSaved(out.path);
  return out;
}

/** Create the shared `Templates/Meeting notes.md` sample unless it exists. */
export async function createSampleTemplate(): Promise<CreatedNoteResult> {
  const res = checkAuth(await fetch('/api/templates/sample', {
    method: 'POST',
    headers: baseHeaders(),
  }));
  if (!res.ok) throw await templateRequestError(res, 'Failed to create the sample template');
  const out = (await res.json()) as CreatedNoteResult;
  if (out.created) markSelfSaved(out.path);
  return out;
}

// Related notes

export interface RelatedNoteReason {
  /** Best-matching section of the related note ('' before any heading). */
  heading: string;
  /** Best-matching section of the open note. */
  sourceHeading: string;
  excerpt: string;
}

export interface RelatedNote {
  path: string;
  title: string;
  score: number;
  /** True when either note already links to the other. */
  linked: boolean;
  /** Null when the related note is PIN-locked. */
  reason: RelatedNoteReason | null;
}

export interface RelatedNotesResponse {
  /** False when the server's semantic index (embedding model) isn't available. */
  available: boolean;
  items: RelatedNote[];
}

export async function fetchRelatedNotes(path: string, limit?: number): Promise<RelatedNotesResponse> {
  const params = new URLSearchParams({ path });
  if (limit !== undefined) params.set('limit', String(limit));
  const res = checkAuth(await fetch(`/api/search/related?${params}`, {
    headers: authHeaders(),
    credentials: 'same-origin',
  }));
  if (!res.ok) throw new Error('Failed to fetch related notes');
  return res.json();
}

// Tags

export interface TagCount {
  /** Display form; tags match case-insensitively. */
  tag: string;
  /** Visible notes carrying the tag or a nested child tag. */
  count: number;
}

export interface TaggedNote {
  path: string;
  title: string;
  modifiedAt: string | null;
}

export async function fetchTags(): Promise<TagCount[]> {
  const res = checkAuth(await fetch('/api/tags', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to fetch tags');
  return res.json();
}

export async function fetchNotesForTag(tag: string): Promise<TaggedNote[]> {
  const res = checkAuth(await fetch(`/api/tags/notes?tag=${encodeURIComponent(tag)}`, { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to fetch tagged notes');
  return res.json();
}

// Notification inbox

export type InboxNotificationType = 'comment_mention' | 'doc_mention' | 'thread_reply' | 'share';

export interface InboxNotification {
  id: number;
  type: InboxNotificationType;
  actorEmail: string;
  actorName: string | null;
  /** Current path of the note (follows renames). */
  path: string;
  threadId: string | null;
  commentId: string | null;
  /** Doc mentions: heading slug to scroll to. */
  heading: string | null;
  snippet: string | null;
  createdAt: number;
  readAt: number | null;
  /** False when the note was deleted. */
  available: boolean;
}

export interface InboxPage {
  items: InboxNotification[];
  nextBefore: number | null;
}

export type EmailNotificationPreference = 'all' | 'mentions' | 'none';

export async function listNotifications(opts: { limit?: number; before?: number } = {}): Promise<InboxPage> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.before) qs.set('before', String(opts.before));
  const query = qs.toString();
  const res = checkAuth(await fetch(`/api/notifications${query ? `?${query}` : ''}`, {
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to load notifications');
  return res.json();
}

export async function getUnreadNotificationCount(): Promise<number> {
  const res = checkAuth(await fetch('/api/notifications/unread-count', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to load unread count');
  const data = await res.json();
  return typeof data.count === 'number' ? data.count : 0;
}

export async function markNotificationRead(id: number): Promise<void> {
  const res = checkAuth(await fetch(`/api/notifications/${id}/read`, {
    method: 'POST',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to mark notification read');
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = checkAuth(await fetch('/api/notifications/read-all', {
    method: 'POST',
    headers: authHeaders(),
  }));
  if (!res.ok) throw new Error('Failed to mark notifications read');
}

export async function getEmailNotificationPreference(): Promise<EmailNotificationPreference> {
  const res = checkAuth(await fetch('/api/notifications/preferences', { headers: authHeaders() }));
  if (!res.ok) throw new Error('Failed to load email preference');
  const data = await res.json();
  return data.email as EmailNotificationPreference;
}

export async function setEmailNotificationPreference(email: EmailNotificationPreference): Promise<void> {
  const res = checkAuth(await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: baseHeaders(),
    body: JSON.stringify({ email }),
  }));
  if (!res.ok) throw new Error('Failed to save email preference');
}

// ── Trash ──

export interface TrashItem {
  id: string;
  /** Basename of the original path (`Plan.md`, `Drafts`). */
  name: string;
  originalPath: string;
  /** Parent folder of the original path; '' for the vault root. */
  originalFolder: string;
  kind: 'file' | 'folder';
  zone: 'shared' | 'personal';
  deletedByEmail: string;
  /** unix ms */
  deletedAt: number;
  /** Files inside the item (1 for a file). */
  itemCount: number;
  canPurge: boolean;
}

export interface TrashListing {
  /** Days before automatic purge; 0 = never. */
  retentionDays: number;
  items: TrashItem[];
}

async function trashError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(typeof body?.message === 'string' ? body.message : fallback);
}

/** Delete a note or folder. `trashItemId` is null when the server deleted it
 *  permanently (end-to-end encrypted paths skip the trash). */
export async function moveToTrash(
  path: string,
  kind: 'file' | 'directory',
): Promise<{ trashItemId: string | null }> {
  const endpoint = kind === 'directory' ? 'directory' : 'delete';
  const res = checkAuth(await fetch(`/api/files/${endpoint}?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw await trashError(res, kind === 'directory' ? 'Failed to delete folder' : 'Failed to delete file');
  const body = await res.json().catch(() => ({}));
  return { trashItemId: typeof body?.trashItemId === 'string' ? body.trashItemId : null };
}

export async function listTrash(): Promise<TrashListing> {
  const res = checkAuth(await fetch('/api/trash', { headers: authHeaders() }));
  if (!res.ok) throw await trashError(res, 'Failed to load the trash');
  return res.json();
}

/** Restore an item; resolves to the path it was restored at (it gets a
 *  " (restored)" suffix when the original path is taken). */
export async function restoreTrashItem(id: string): Promise<{ id: string; path: string; kind: 'file' | 'folder' }> {
  const res = checkAuth(await fetch(`/api/trash/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  }));
  if (!res.ok) throw await trashError(res, 'Failed to restore');
  return res.json();
}

export async function purgeTrashItem(id: string): Promise<void> {
  const res = checkAuth(await fetch(`/api/trash/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));
  if (!res.ok) throw await trashError(res, 'Failed to delete permanently');
}

/** Purge every item the caller may purge; resolves to how many were purged. */
export async function emptyTrash(): Promise<number> {
  const res = checkAuth(await fetch('/api/trash', { method: 'DELETE', headers: authHeaders() }));
  if (!res.ok) throw await trashError(res, 'Failed to empty the trash');
  const body = await res.json();
  return typeof body?.purged === 'number' ? body.purged : 0;
}
