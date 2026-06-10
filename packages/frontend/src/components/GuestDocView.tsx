import React, { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkBase from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';
import { MermaidBlock } from '../editor/extensions/mermaid-block';
import { MentionNode } from '../editor/extensions/mention-node';
import { GuestWikilinkNode } from './guest-wikilink';
import { GuestAnchoredCommentBubble } from './guest-anchored-comment';
import * as api from '../api';

interface Props {
  code: string;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'gone'; reason?: string }
  | { kind: 'pin-required'; sharedByEmail: string | null }
  | {
      kind: 'ready';
      path: string;
      content: string;
      sharedByEmail: string | null;
      allowGuestComments: boolean;
      accessToken: string;
    }
  | { kind: 'error'; message: string };

/**
 * Public-mode read-only viewer for shared notes. Renders without any of the
 * authenticated workspace shell (no file tree, no command palette, no
 * comments rail) — just the doc, an attribution header, and a sign-in CTA.
 *
 * No JWT/session is ever held: the only credential is the per-(code, path)
 * access token issued by `/api/share-links/resolve/:code`. Asset URLs in the
 * served markdown are pre-rewritten by the server to point at scoped
 * `/api/share-links/:code/asset` endpoints, so the browser fetches images
 * without any extra header plumbing.
 */
export function GuestDocView({ code }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  // Bootstrap: resolve the code → either ask for PIN or fetch content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await api.resolveShareLinkPublic(code);
        if (cancelled) return;
        if (info.requiresPin) {
          setStage({ kind: 'pin-required', sharedByEmail: info.sharedByEmail ?? null });
          return;
        }
        if (!info.accessToken) {
          setStage({ kind: 'error', message: 'Server did not issue an access token' });
          return;
        }
        const content = await api.fetchShareLinkContent(code, info.accessToken);
        if (cancelled) return;
        setStage({
          kind: 'ready',
          path: content.path,
          content: content.content,
          sharedByEmail: info.sharedByEmail ?? null,
          allowGuestComments: !!info.allowGuestComments,
          accessToken: info.accessToken,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof api.ShareLinkGoneError) {
          setStage({ kind: 'gone', reason: err.message });
        } else {
          setStage({ kind: 'error', message: (err as Error).message || 'Failed to load' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinValue || pinBusy) return;
    setPinBusy(true);
    setPinError(null);
    try {
      await api.verifyShareLinkPin(code, pinValue);
      // Re-resolve: now the cookie is set so the server returns the access
      // token instead of `requiresPin: true`.
      const info = await api.resolveShareLinkPublic(code);
      if (!info.accessToken) {
        setPinError('PIN accepted but no access token was issued. Please refresh.');
        setPinBusy(false);
        return;
      }
      const content = await api.fetchShareLinkContent(code, info.accessToken);
      setStage({
        kind: 'ready',
        path: content.path,
        content: content.content,
        sharedByEmail: info.sharedByEmail ?? null,
        allowGuestComments: !!info.allowGuestComments,
        accessToken: info.accessToken,
      });
    } catch (err) {
      setPinError((err as Error).message || 'Failed to verify PIN');
    } finally {
      setPinBusy(false);
    }
  }

  return (
    <div className="guest-doc-view">
      <header className="guest-doc-header">
        <div className="guest-doc-brand">
          <a href="/" className="guest-doc-brand-link">Kalepin</a>
        </div>
        <div className="guest-doc-attribution">
          {stage.kind === 'ready' || stage.kind === 'pin-required' ? (
            stage.sharedByEmail ? (
              <span>Shared by <strong>{stage.sharedByEmail}</strong></span>
            ) : (
              <span>Shared via public link</span>
            )
          ) : null}
        </div>
        <div className="guest-doc-actions">
          {stage.kind === 'ready' && stage.allowGuestComments && (
            <button
              type="button"
              className="guest-doc-jump-comments"
              onClick={() => {
                // The composer sits at the bottom of the article; for long
                // docs it's below the fold, so we surface a discoverable
                // affordance in the header that scrolls down to it.
                document
                  .querySelector('.guest-doc-comment-box')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              Add comment
            </button>
          )}
          <a
            href="/"
            className="guest-doc-signin"
            onClick={(e) => {
              // Preserve the deep link so post-login the user lands back here
              // with full session.
              e.preventDefault();
              const next = window.location.pathname + window.location.search + window.location.hash;
              window.location.href = `/?next=${encodeURIComponent(next)}`;
            }}
          >
            Sign in
          </a>
        </div>
      </header>

      <main className="guest-doc-main">
        {stage.kind === 'loading' && (
          <div className="guest-doc-loading">Loading…</div>
        )}
        {stage.kind === 'pin-required' && (
          <form className="guest-doc-pin" onSubmit={submitPin}>
            <h2>Enter the PIN</h2>
            <p>This note is protected by a PIN. Ask the person who shared it.</p>
            <input
              type="password"
              autoComplete="off"
              autoFocus
              value={pinValue}
              pattern="\S{8,}"
              onChange={(e) => setPinValue(e.target.value.replace(/\s+/g, ''))}
              placeholder="At least 8 characters, no spaces"
              disabled={pinBusy}
            />
            <button type="submit" disabled={pinBusy || pinValue.length < 8}>
              {pinBusy ? 'Checking…' : 'Unlock'}
            </button>
            {pinError && <div className="guest-doc-pin-error">{pinError}</div>}
          </form>
        )}
        {stage.kind === 'gone' && (
          <div className="guest-doc-gone">
            <h2>This link is no longer active</h2>
            <p>{stage.reason ?? 'It may have been revoked or expired.'}</p>
          </div>
        )}
        {stage.kind === 'error' && (
          <div className="guest-doc-error">
            <h2>Couldn't open this link</h2>
            <p>{stage.message}</p>
          </div>
        )}
        {stage.kind === 'ready' && (
          <GuestDocBody
            content={stage.content}
            code={code}
            path={stage.path}
            accessToken={stage.accessToken}
            allowGuestComments={stage.allowGuestComments}
          />
        )}
      </main>
    </div>
  );
}

interface BodyProps {
  content: string;
  code: string;
  path: string;
  accessToken: string;
  allowGuestComments: boolean;
}

function GuestDocBody({ content, code, path, accessToken, allowGuestComments }: BodyProps) {
  // useState (not useRef) so the bubble re-renders when the article DOM is
  // first attached — a useRef.current mutation wouldn't kick a re-render and
  // the bubble's selection watcher would stay gated on `null` forever.
  const [articleEl, setArticleEl] = useState<HTMLElement | null>(null);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          // MermaidBlock extends CodeBlockLowlight and provides the code_block
          // node — disable StarterKit's default to avoid a duplicate-node clash.
          codeBlock: false,
        }),
        LinkBase.configure({ openOnClick: true, autolink: true }),
        // Asset URLs in the served markdown are pre-rewritten by the server
        // to `/api/share-links/<code>/asset?...` (see asset-rewriter.ts), so
        // a plain Image extension renders them without any auth plumbing.
        Image,
        MermaidBlock.configure({ lowlight: createLowlight(common) }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({ nested: true }),
        // Wikilinks render as styled non-clickable chips. Mentions reuse the
        // authenticated NodeView verbatim — it's pure presentation.
        GuestWikilinkNode,
        MentionNode,
        Markdown.configure({ html: true, breaks: false, transformPastedText: false }),
      ],
      content,
      editable: false,
    },
    // Re-mount when content changes (e.g., after PIN unlock + content fetch).
    [content],
  );

  return (
    <article className="guest-doc-article" ref={setArticleEl}>
      <h1 className="guest-doc-title">{titleFromPath(path)}</h1>
      <EditorContent editor={editor} className="editor-content" />
      {allowGuestComments && (
        <>
          {/* Inline anchored composer: guests select text in the doc and a
              floating "Comment" bubble appears next to the selection. The
              bottom box below remains for general-purpose (unanchored)
              comments — still useful when nothing specific is being marked. */}
          <GuestAnchoredCommentBubble
            editor={editor}
            articleEl={articleEl}
            code={code}
            accessToken={accessToken}
            readIdentity={() => readSessionIdentity(code)}
            writeIdentity={(id) => writeSessionIdentity(code, id)}
          />
          <GuestCommentBox code={code} accessToken={accessToken} />
        </>
      )}
    </article>
  );
}

function titleFromPath(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.md$/, '');
}

interface CommentBoxProps {
  code: string;
  accessToken: string;
}

/**
 * Inline guest-comment composer. Shown only when the link's
 * `allow_guest_comments` flag is true. The owner sees these as unverified in
 * the authenticated dialog.
 */
function GuestCommentBox({ code, accessToken }: CommentBoxProps) {
  // Persist name/email for the duration of the visit so the guest doesn't
  // retype across multiple comments.
  const initialIdentity = useMemo(
    () => readSessionIdentity(code),
    [code],
  );
  const [name, setName] = useState(initialIdentity.name);
  const [email, setEmail] = useState(initialIdentity.email);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Anchor to a synthetic block id so the server has something to attach
      // the thread to. The owner's editor renders these threads as floating
      // comments rather than inline highlights.
      await api.postGuestComment(code, accessToken, {
        blockId: 'guest-comment',
        authorEmail: email.trim(),
        authorName: name.trim(),
        text: text.trim(),
      });
      writeSessionIdentity(code, { name: name.trim(), email: email.trim() });
      setText('');
      setPosted(true);
    } catch (err) {
      setError((err as Error).message || 'Failed to post comment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guest-doc-comment-box" onSubmit={submit}>
      <h3>Leave a comment</h3>
      <p className="guest-doc-comment-hint">
        Comments from public viewers are marked as unverified.
      </p>
      <div className="guest-doc-comment-row">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          type="email"
          placeholder="Your email"
          value={email}
          maxLength={320}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </div>
      <textarea
        placeholder="Add a comment…"
        value={text}
        maxLength={10000}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="guest-doc-comment-actions">
        <button type="submit" disabled={busy || !name.trim() || !email.trim() || !text.trim()}>
          {busy ? 'Posting…' : 'Post comment'}
        </button>
        {posted && <span className="guest-doc-comment-status">Posted!</span>}
      </div>
      {error && <div className="guest-doc-comment-error">{error}</div>}
    </form>
  );
}

interface GuestIdentity {
  name: string;
  email: string;
}

function readSessionIdentity(code: string): GuestIdentity {
  try {
    const raw = sessionStorage.getItem(`kalepin-guest-${code}`);
    if (!raw) return { name: '', email: '' };
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
    };
  } catch {
    return { name: '', email: '' };
  }
}

function writeSessionIdentity(code: string, identity: GuestIdentity) {
  try {
    sessionStorage.setItem(`kalepin-guest-${code}`, JSON.stringify(identity));
  } catch {
    // sessionStorage may be unavailable (private browsing, quota); silently skip.
  }
}
