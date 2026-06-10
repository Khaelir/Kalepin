export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}

export interface FileChangeEvent {
  event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
}

export interface CommentThread {
  id: string;
  blockId: string;
  quotedText?: string;
  positionHint?: { from: number; to: number };
  comments: Comment[];
  resolved: boolean;
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  /** Display name for guest commenters; absent for authenticated comments
   * (where `author` is already a real email and the UI shows it directly). */
  authorName?: string;
  /** True when `author` is an authenticated email; false when the commenter
   * typed their own email via a guest-comment-enabled share link. Always
   * include in new writes; legacy comments without this field render as
   * verified for back-compat. */
  authorVerified?: boolean;
}

export interface SidecarData {
  comments: Record<string, { threads: CommentThread[] }>;
}

export interface UserPresence {
  userId: string;
  email: string;
  color: string;
  cursor: number | null;
  selection: { from: number; to: number } | null;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  heading?: string;
  type?: 'note' | 'comment';
  threadId?: string;
  commentAuthor?: string;
}
