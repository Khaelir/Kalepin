import React, { useState, useEffect, useRef } from 'react';
import type { CommentThread } from '@kalepin/shared';
import { CommentReplyEditor } from './CommentReplyEditor';
import { getColorForUser } from '../utils/user-colors';

interface CommentsPanelProps {
  threads: CommentThread[];
  currentUser: string;
  highlightThreadId?: string | null;
  onAddComment: (blockId: string, text: string) => void;
  onReply: (blockId: string, threadId: string, text: string) => void;
  onResolve: (blockId: string, threadId: string, resolved: boolean) => void;
  onDelete: (blockId: string, threadId: string, commentId: string) => void;
  onNavigate: (thread: CommentThread) => void;
  /** True when the active doc lives under `_users/{me}/` — mentions don't notify. */
  personalNote?: boolean;
  /** True when the active doc is end-to-end encrypted (`_secure/`). */
  e2eEncrypted?: boolean;
}

const PERSONAL_MENTION_NOTICE =
  "Mentions inside your personal folder don't notify — only you can see this note.";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Show just the local part (before @) unless another email shares it. */
function buildDisplayNames(threads: CommentThread[]): Map<string, string> {
  const allEmails = new Set<string>();
  for (const t of threads) {
    for (const c of t.comments) allEmails.add(c.author);
  }
  const localCounts = new Map<string, number>();
  for (const email of allEmails) {
    const local = email.split('@')[0];
    localCounts.set(local, (localCounts.get(local) || 0) + 1);
  }
  const map = new Map<string, string>();
  for (const email of allEmails) {
    const local = email.split('@')[0];
    map.set(email, localCounts.get(local)! > 1 ? email : local);
  }
  return map;
}

function renderCommentText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const email = match[2];
    const color = getColorForUser(email);
    parts.push(
      <span key={match.index} className="mention" style={{ backgroundColor: `${color}26`, color }}>@{match[1]}</span>,
    );
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

export function CommentsPanel({
  threads,
  currentUser,
  highlightThreadId,
  onAddComment,
  onReply,
  onResolve,
  onDelete,
  onNavigate,
  personalNote,
  e2eEncrypted,
}: CommentsPanelProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  if (e2eEncrypted) {
    return (
      <div className="comments-e2e-banner" role="note">
        <strong>Comments are disabled in end-to-end encrypted folders.</strong>
        <div style={{ marginTop: 4 }}>
          The server cannot read or store comments on files in your Encrypted Folder.
        </div>
      </div>
    );
  }

  const activeThreads = threads.filter((t) => !t.resolved);
  const resolvedThreads = threads.filter((t) => t.resolved);
  const displayNames = buildDisplayNames(threads);

  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightThreadId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightThreadId]);

  const renderThread = (thread: CommentThread) => (
    <div
      key={thread.id}
      ref={thread.id === highlightThreadId ? highlightRef : undefined}
      className={`comment-thread ${thread.resolved ? 'resolved' : ''}${thread.id === highlightThreadId ? ' highlight' : ''}`}
      onClick={() => onNavigate(thread)}
      style={{ cursor: 'pointer' }}
      title="Click to highlight text in editor"
    >
      {thread.quotedText && (
        <div className="comment-quoted-text">
          &ldquo;{thread.quotedText.length > 120 ? thread.quotedText.slice(0, 120) + '…' : thread.quotedText}&rdquo;
        </div>
      )}
      <div className="thread-header">
        <button
          className="thread-resolve-btn"
          onClick={(e) => { e.stopPropagation(); onResolve(thread.blockId, thread.id, !thread.resolved); }}
        >
          {thread.resolved ? 'Reopen' : 'Resolve'}
        </button>
      </div>
      {thread.comments.map((comment, index) => (
        <div key={comment.id} className={`comment ${index > 0 ? 'comment-reply' : ''}`}>
          <div className="comment-meta">
            <span className="comment-author" title={comment.author}>{displayNames.get(comment.author) || comment.author}</span>
            <span className="comment-time">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
            {comment.author === currentUser && (
              <button
                className="comment-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(thread.blockId, thread.id, comment.id); }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="comment-text">{renderCommentText(comment.text)}</div>
        </div>
      ))}
      {replyingTo === thread.id ? (
        <div className="reply-form" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
          <CommentReplyEditor
            onSubmit={(text) => {
              onReply(thread.blockId, thread.id, text);
              setReplyingTo(null);
            }}
            onCancel={() => setReplyingTo(null)}
            placeholder="Write a reply..."
            notice={personalNote ? PERSONAL_MENTION_NOTICE : undefined}
          />
        </div>
      ) : (
        <button className="reply-btn" onClick={(e) => { e.stopPropagation(); setReplyingTo(thread.id); }}>
          Reply
        </button>
      )}
    </div>
  );

  return (
    <div className="comments-panel">
      {activeThreads.length === 0 && resolvedThreads.length === 0 && (
        <p className="no-comments">No comments yet</p>
      )}
      {activeThreads.map(renderThread)}
      {resolvedThreads.length > 0 && (
        <details className="resolved-section">
          <summary>Resolved ({resolvedThreads.length})</summary>
          {resolvedThreads.map(renderThread)}
        </details>
      )}
    </div>
  );
}
