import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import LinkBase from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import { MermaidBlock } from './extensions/mermaid-block';
import { Markdown } from 'tiptap-markdown';
import { Extension, getHTMLFromFragment } from '@tiptap/core';
import { WikilinkNode } from './extensions/wikilink-node';
import { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { OTClient } from './ot-client';
import { diffMarkdownToOps, applyOpsToMarkdown } from './ot-bridge';
import { createSlashMenuPlugin, SlashMenuState, SlashCommand, slashCommands, SLASH_COMMAND_GROUPS, setActiveDocPath } from './slash-commands';
import { createWikilinkMenuPlugin, WikilinkMenuState, wikilinkMenuPluginKey } from './wikilink-autocomplete';
import { WikilinkAutocomplete } from './WikilinkAutocomplete';
import { createMentionMenuPlugin, MentionMenuState, selectMentionUser } from './mention-autocomplete';
import { MentionAutocompleteMenu } from './MentionAutocompleteMenu';
import { MentionNode } from './extensions/mention-node';
import { WikilinkEditPopover } from './WikilinkEditPopover';
import { ImageWithAttachments } from './image-extension';
import { createImagePasteExtension } from './image-paste-handler';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';
import { TableControls } from './TableControls';
import { FloatingInput } from '../components/FloatingInput';
import { WSClient } from '../ws/ws-client';
import { getPinUnlockToken } from '../api';
import { CollaborativeCursors, updateRemotePresence, removeRemotePresence } from './extensions/collaborative-cursors';
import { CommentHighlights, updateCommentHighlights, setCommentHighlightOnClick } from './extensions/comment-highlights';
import { FloatingMinimap } from './FloatingMinimap';
import { SelectionBubble } from './SelectionBubble';
import { TableOfContents } from './extensions/toc-extension';
import { getColorForUser } from '../utils/user-colors';
import { useSaveStatus, SaveStatus } from './useSaveStatus';
import { DrawioEditorController } from './drawio-editor-controller';
import { DocHeader } from './DocHeader';
import { flattenFiles } from './extensions/wikilink-utils';
import { wikilinkTargetFor } from '../components/related-notes';

// The built-in Link extension registers a clickHandler plugin that calls
// window.open(link.href, link.target) during the mouseup event. Even with
// openOnClick:false the plugin is still registered and can interfere.
// More critically, link.href is the fully-resolved URL and link.target is ""
// (empty string, which ?? doesn't catch), so window.open(url, "") always
// opens a new tab. We strip that plugin and handle link clicks ourselves
// via a handleDOMEvents.click handler in LinkClickExtension below.
const Link = LinkBase.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).filter(
      (plugin) => (plugin as any).key !== 'handleClickLink$',
    );
  },
});

type EditorMode = 'rendered' | 'raw';

/** Apply a remote markdown update using a surgical PM transaction instead of setContent(). */
function applyRemoteMarkdown(
  editor: ReturnType<typeof useEditor>,
  shadowRef: React.MutableRefObject<string>,
  newMd: string,
  isRemoteRef: React.MutableRefObject<boolean>,
) {
  if (!editor) return;
  // Guard: editor.view may not exist yet if <EditorContent> hasn't mounted (Safari timing)
  try { editor.view.dom; } catch { return; }

  // Parse the new markdown into a PM doc
  // tiptap-markdown's parser.parse() returns HTML, so we need to convert it
  // to a PM Node via ProseMirror's DOMParser.
  const mdParser = (editor.storage as any).markdown?.parser;
  if (!mdParser) {
    isRemoteRef.current = true;
    editor.commands.setContent(newMd);
    isRemoteRef.current = false;
    shadowRef.current = newMd;
    return;
  }

  // tiptap-markdown's parser returns HTML. To get a PM doc that exactly matches
  // what setContent() would produce, we must use parseSlice() (not parse()),
  // because parse() enforces the doc's "block+" content spec and may add a
  // trailing empty paragraph that the editor's live doc doesn't have.
  const html = mdParser.parse(newMd);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  // Run mention updateDOM hook so @[pseudo](email) (now @<a>) becomes mention spans
  const mentionParse = (editor.storage as any).mention?.markdown?.parse;
  if (mentionParse?.updateDOM) mentionParse.updateDOM(wrapper);
  const newContent = PMDOMParser.fromSchema(editor.schema).parseSlice(wrapper).content;
  const newDoc = editor.state.doc.copy(newContent);
  const oldDoc = editor.state.doc;

  let start = oldDoc.content.findDiffStart(newDoc.content);
  if (start != null) {
    let { a: endA, b: endB } = oldDoc.content.findDiffEnd(newDoc.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    // Table-aware diff expansion: if the diff region touches a table,
    // expand bounds to the full table to avoid cross-cell slices
    const $start = oldDoc.resolve(start);
    for (let d = $start.depth; d > 0; d--) {
      if ($start.node(d).type.name === 'table') {
        const tableStart = $start.before(d);
        const tableEndOld = $start.after(d);
        start = tableStart;
        // Only expand endA to table boundary if diff doesn't extend beyond it
        if (endA <= tableEndOld) {
          endA = tableEndOld;
        }
        // Find corresponding table in new doc and expand endB
        const $new = newDoc.resolve(tableStart + 1);
        for (let nd = $new.depth; nd > 0; nd--) {
          if ($new.node(nd).type.name === 'table') {
            const tableEndNew = $new.after(nd);
            if (endB <= tableEndNew) {
              endB = tableEndNew;
            }
            break;
          }
        }
        break;
      }
    }

    const tr = editor.state.tr;
    tr.replace(start, endA, newDoc.slice(start, endB));
    tr.setMeta('addToHistory', false);
    isRemoteRef.current = true;
    editor.view.dispatch(tr);
    isRemoteRef.current = false;
  }

  shadowRef.current = newMd;
}

/** Generate a URL-friendly slug from heading text (standard markdown anchor rules). */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Heading extension that adds an id attribute and a clickable anchor link. */
const HeadingWithAnchor = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level;
    const text = node.textContent;
    const id = slugify(text);
    return [`h${level}`, { ...HTMLAttributes, id }, 0];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingAnchors'),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement;
              if (!target.classList.contains('heading-anchor')) return false;
              event.preventDefault();
              event.stopPropagation();
              const id = target.getAttribute('data-heading-id');
              const url = `${window.location.origin}${window.location.pathname}#${id}`;
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
              navigator.clipboard.writeText(url);

              const toast = document.createElement('span');
              toast.className = 'heading-copy-toast';
              toast.textContent = 'Link copied';
              toast.style.left = `${event.clientX}px`;
              toast.style.top = `${event.clientY - 8}px`;
              document.body.appendChild(toast);
              requestAnimationFrame(() => toast.classList.add('visible'));
              setTimeout(() => {
                toast.classList.remove('visible');
                toast.addEventListener('transitionend', () => toast.remove());
              }, 900);
              return true;
            },
          },
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') {
                const id = slugify(node.textContent);
                decorations.push(
                  Decoration.widget(pos + 1, () => {
                    const anchor = document.createElement('a');
                    anchor.className = 'heading-anchor';
                    anchor.setAttribute('data-heading-id', id);
                    anchor.textContent = '#';
                    anchor.contentEditable = 'false';
                    return anchor;
                  }, { side: -1 }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/**
 * Check if a table can be safely serialized as markdown.
 * Requires all cells to contain exactly one paragraph child (no headings,
 * blockquotes, code blocks, etc.) and no col/row spans.
 */
function isMarkdownSerializable(node: PMNode): boolean {
  let ok = true;
  node.forEach((row) => {
    row.forEach((cell) => {
      if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) {
        ok = false;
        return;
      }
      if (cell.childCount > 1 || (cell.childCount === 1 && cell.firstChild?.type.name !== 'paragraph')) {
        ok = false;
      }
    });
  });
  // Also require first row to be all tableHeader cells
  const firstRow = node.firstChild;
  if (firstRow) {
    firstRow.forEach((cell) => {
      if (cell.type.name !== 'tableHeader') ok = false;
    });
  }
  return ok;
}

/** Table extension with fixed markdown serialization for block content in cells. */
const TableWithMarkdown = Table.configure({ resizable: false }).extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Enter navigates to the cell below (same column).
      // If on the last row, a new row is added first.
      Enter: ({ editor }) => {
        if (!editor.isActive('table')) return false;

        const { state } = editor;
        const { $from } = state.selection;

        // Find table and cell depths
        let tableDepth = -1, cellDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'table') { tableDepth = d; break; }
          if (name === 'tableCell' || name === 'tableHeader') cellDepth = d;
        }
        if (tableDepth < 0 || cellDepth < 0) return false;

        const tableNode = $from.node(tableDepth);
        const tableStart = $from.start(tableDepth);
        const map = TableMap.get(tableNode);
        const cellOffset = $from.before(cellDepth) - tableStart;
        const { top: row, left: col } = map.findCell(cellOffset);

        if (row + 1 >= map.height) {
          // Last row: add a new row, then navigate into it
          editor.commands.addRowAfter();
          const newState = editor.state;
          const new$from = newState.selection.$from;
          let newTableDepth = -1;
          for (let d = new$from.depth; d > 0; d--) {
            if (new$from.node(d).type.name === 'table') { newTableDepth = d; break; }
          }
          if (newTableDepth < 0) return true;
          const newTable = new$from.node(newTableDepth);
          const newTableStart = new$from.start(newTableDepth);
          const newMap = TableMap.get(newTable);
          const targetOffset = newMap.positionAt(row + 1, col, newTable);
          const $target = newState.doc.resolve(newTableStart + targetOffset + 1);
          editor.view.dispatch(newState.tr.setSelection(TextSelection.near($target)).scrollIntoView());
          return true;
        }

        // Navigate to cell below (same column)
        const targetOffset = map.positionAt(row + 1, col, tableNode);
        const $target = state.doc.resolve(tableStart + targetOffset + 1);
        editor.view.dispatch(state.tr.setSelection(TextSelection.near($target)).scrollIntoView());
        return true;
      },
      // Shift+Enter inserts a hard break (line break) within the cell.
      'Shift-Enter': ({ editor }) => {
        if (!editor.isActive('table')) return false;
        return editor.commands.setHardBreak();
      },
    };
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(this: { editor: any }, state: any, node: PMNode, parent: any) {
          if (!isMarkdownSerializable(node)) {
            // Fall back to HTML to preserve block-level content in cells
            const schema = node.type.schema;
            const html = getHTMLFromFragment(Fragment.from(node), schema);
            state.write(html);
            state.closeBlock(node);
            return;
          }
          // Standard markdown table serialization
          state.inTable = true;
          node.forEach((row: PMNode, _p: number, i: number) => {
            state.write('| ');
            row.forEach((col: PMNode, _p2: number, j: number) => {
              if (j) state.write(' | ');
              const cellContent = col.firstChild;
              if (cellContent && cellContent.textContent.trim()) {
                state.renderInline(cellContent);
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!i) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => '---')
                .join(' | ');
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

interface FloatingInputState {
  label: string;
  placeholder: string;
  position: { top: number; left: number };
  onSubmit: (value: string) => void;
  notice?: React.ReactNode;
}

const PERSONAL_MENTION_NOTICE =
  "Mentions inside your personal folder don't notify — only you can see this note.";

export interface EditorHandle {
  navigateToComment: (quotedText?: string, positionHint?: { from: number; to: number }) => void;
  scrollToUser: (userId: string) => void;
  scrollToHeading: (id: string) => void;
  /** Append a paragraph linking to `targetPath`; false when the note isn't editable. */
  appendWikilink: (targetPath: string) => boolean;
}

/** Heading entry emitted via onHeadingsChange (consumed by the Outline panel). */
export interface DocHeading {
  /** DOM id — matches HeadingWithAnchor's slugify(text). First DOM match wins on duplicates. */
  slug: string;
  level: number;
  text: string;
  /** ProseMirror position — stable React key; also used by Phase 8 mini-map. */
  pos: number;
}

interface EditorProps {
  wsClient: WSClient;
  docId: string;
  initialContent: string;
  initialRevision: number;
  /** Viewer's access level. 'comment' renders the editor read-only; absent or 'owner'/'write' allows edits. */
  permission?: 'owner' | 'write' | 'comment';
  activeFile: string;
  previewContent?: string | null;
  comments?: import('@kalepin/shared').CommentThread[];
  onAddComment?: (blockId: string, text: string, quotedText: string, positionHint: { from: number; to: number }) => void;
  onOpenComments?: () => void;
  onSelectThread?: (threadId: string) => void;
  onNotifyAction?: (actionId: string) => void;
  onNavigate?: (path: string, heading?: string) => void;
  files?: import('@kalepin/shared').FileEntry[];
  currentUser?: string;
  onSaveStatusChange?: (status: SaveStatus) => void;
  onRevisionChange?: (revision: number) => void;
  onWordCountChange?: (count: number) => void;
  onHeadingsChange?: (headings: DocHeading[]) => void;
  /** DocHeader metadata — wired from App.tsx. */
  authorEmail?: string | null;
  updatedAt?: string | null;
  wordCount?: number;
  backlinkCount?: number;
  presenceUsers?: { userId: string; email: string; color: string }[];
  onRename?: (newName: string) => Promise<boolean> | boolean;
  onRenameError?: (msg: string) => void;
  /** Bumped by parent to force the title into rename mode (focus + select-all). */
  renameRequestKey?: number;
  /** Thread id to pulse in the prose (mirrors CommentsPanel highlight). */
  focusThreadId?: string | null;
  /** Show the floating mini-map rail + comment strip along the right edge. */
  minimapEnabled?: boolean;
  /** DocHeader tag pills open the search modal on `tag:<tag>`. */
  onTagClick?: (tag: string) => void;
}

export const KalepinEditor = forwardRef<EditorHandle, EditorProps>(function KalepinEditor({
  wsClient,
  docId,
  initialContent,
  initialRevision,
  permission,
  activeFile,
  previewContent,
  comments: commentThreads,
  onAddComment,
  onOpenComments,
  onSelectThread,
  onNotifyAction,
  onNavigate,
  files,
  currentUser,
  onSaveStatusChange,
  onRevisionChange,
  onWordCountChange,
  onHeadingsChange,
  authorEmail = null,
  updatedAt = null,
  wordCount = 0,
  backlinkCount = 0,
  presenceUsers = [],
  onRename,
  onRenameError,
  renameRequestKey,
  focusThreadId = null,
  minimapEnabled = true,
  onTagClick,
}, ref) {
  const otClientRef = useRef<OTClient | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [wikilinkMenu, setWikilinkMenu] = useState<WikilinkMenuState | null>(null);
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState | null>(null);
  const isRemoteRef = useRef(false);
  const [mode, setMode] = useState<EditorMode>('rendered');
  const [rawContent, setRawContent] = useState('');
  const remoteOpsQueueRef = useRef<any[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [floatingInput, setFloatingInput] = useState<FloatingInputState | null>(null);
  const [docHeadings, setDocHeadings] = useState<DocHeading[]>([]);
  const executeCommandRef = useRef<((cmd: SlashCommand) => void) | null>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [wikilinkEditPopover, setWikilinkEditPopover] = useState<{
    node: import('@tiptap/pm/model').Node;
    getPos: () => number | undefined;
    anchorRect: DOMRect;
  } | null>(null);

  // Shadow markdown — mirrors what the server has
  const shadowRef = useRef<string>(initialContent);

  // Save status state machine
  const { status: saveStatus, markDirty, markAcked, resetToSynced } = useSaveStatus(wsClient, docId);

  // Forward save status + revision + word count to the parent so the status bar
  // can render them without touching editor internals.
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);
  onSaveStatusChangeRef.current = onSaveStatusChange;
  const onRevisionChangeRef = useRef(onRevisionChange);
  onRevisionChangeRef.current = onRevisionChange;
  const onWordCountChangeRef = useRef(onWordCountChange);
  onWordCountChangeRef.current = onWordCountChange;
  const onHeadingsChangeRef = useRef(onHeadingsChange);
  onHeadingsChangeRef.current = onHeadingsChange;

  useEffect(() => {
    onSaveStatusChangeRef.current?.(saveStatus);
  }, [saveStatus]);

  useEffect(() => {
    onRevisionChangeRef.current?.(initialRevision);
    const offAck = wsClient.on('ack', (msg: any) => {
      if (msg.docId !== docId) return;
      onRevisionChangeRef.current?.(msg.rev);
    });
    const offOp = wsClient.on('op', (msg: any) => {
      if (msg.docId !== docId) return;
      onRevisionChangeRef.current?.(msg.rev);
    });
    const offOpened = wsClient.on('doc:opened', (msg: any) => {
      if (msg.docId !== docId) return;
      onRevisionChangeRef.current?.(msg.revision);
    });
    return () => { offAck(); offOp(); offOpened(); };
  }, [wsClient, docId, initialRevision]);

  // Ctrl+S: prevent default and force server-side flush
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        wsClient.send({ type: 'doc:flush', docId });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wsClient, docId]);

  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  setActiveDocPath(activeFile);

  const ImagePasteExtension = createImagePasteExtension(() => activeFileRef.current);

  const SlashMenuExtension = Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [createSlashMenuPlugin(
        setSlashMenu,
        (cmd) => executeCommandRef.current?.(cmd),
      )];
    },
  });

  const filesRef = useRef(files || []);
  filesRef.current = files || [];

  const WikilinkMenuExtension = Extension.create({
    name: 'wikilinkMenu',
    addProseMirrorPlugins() {
      return [createWikilinkMenuPlugin(
        setWikilinkMenu,
        () => filesRef.current,
        () => activeFileRef.current,
      )];
    },
  });

  const MentionMenuExtension = Extension.create({
    name: 'mentionMenu',
    addProseMirrorPlugins() {
      return [createMentionMenuPlugin(setMentionMenu)];
    },
  });

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  // Handle clicks on links: anchor links scroll in-place, internal links
  // navigate within the app, external links open in a new tab.
  // Uses handleDOMEvents.click (fires directly on the DOM event) rather than
  // handleClick (ProseMirror abstraction) so it works reliably regardless of
  // editability state and plugin ordering.
  const LinkClickExtension = Extension.create({
    name: 'linkClick',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('linkClick'),
        props: {
          handleDOMEvents: {
            click(view, event) {
              const target = event.target as HTMLElement;
              const link = target.closest('a');
              if (!link) return false;
              const href = link.getAttribute('href');
              if (!href) return false;

              // Anchor links: scroll to heading
              if (href.startsWith('#')) {
                event.preventDefault();
                const targetId = href.slice(1);
                const editorContainer = document.querySelector('.editor-container');
                const heading = editorContainer?.querySelector(`[id="${CSS.escape(targetId)}"]`);
                if (heading) {
                  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${targetId}`);
                }
                return true;
              }

              // External links: open in new tab
              if (/^https?:\/\//.test(href)) {
                // Check if it's an internal app link (same origin with /doc/, /s/ or legacy /d/ path)
                try {
                  const url = new URL(href, window.location.origin);
                  const isShareLink = url.pathname.startsWith('/s/') || url.pathname.startsWith('/d/');
                  if (url.origin === window.location.origin && (url.pathname.startsWith('/doc/') || isShareLink)) {
                    event.preventDefault();
                    if (url.pathname.startsWith('/doc/')) {
                      const segment = url.pathname.slice('/doc/'.length);
                      const firstSlash = segment.indexOf('/');
                      const isHandle =
                        firstSlash === -1 &&
                        /^[A-Z2-7]{16}$/.test(decodeURIComponent(segment));
                      if (isHandle) {
                        // Handle-form internal URL — push and let App's
                        // popstate handler resolve via /api/files/read?handle.
                        window.history.pushState(null, '', url.pathname + url.search + url.hash);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      } else {
                        // Legacy /doc/<path> — pass through onNavigate so the
                        // file tree resolves it (and openFile normalizes the
                        // URL bar to /doc/<id> on success).
                        const notePath = decodeURIComponent(segment);
                        const heading = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
                        onNavigateRef.current?.(notePath, heading);
                      }
                    } else {
                      // /s/<code> (or legacy /d/<code>) — let the popstate
                      // handler resolve the code via the share-link API. Any
                      // legacy `/cosmetic` suffix is silently ignored by the
                      // parser arm.
                      window.history.pushState(null, '', url.pathname + url.search + url.hash);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }
                    return true;
                  }
                } catch { /* malformed URL — fall through to open externally */ }
                event.preventDefault();
                window.open(href, '_blank', 'noopener');
                return true;
              }

              // Relative / internal link: navigate within the app
              event.preventDefault();
              const [path, hash] = href.split('#');
              const heading = hash ? decodeURIComponent(hash) : undefined;
              onNavigateRef.current?.(decodeURIComponent(path), heading);
              return true;
            },
          },
        },
      })];
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, link: false }),
      MermaidBlock.configure({ lowlight: createLowlight(common) }),
      HeadingWithAnchor.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Placeholder.configure({ placeholder: 'Start writing, or type / for commands...' }),
      Link.configure({ openOnClick: false, HTMLAttributes: { target: null, rel: null } }),
      TableWithMarkdown,
      TableRow,
      TableCell,
      TableHeader,
      Markdown,
      WikilinkNode.configure({
        getFiles: () => filesRef.current,
        getActiveFile: () => activeFileRef.current,
        onNavigate: (path: string, heading?: string) => onNavigateRef.current?.(path, heading),
      }),
      ImageWithAttachments,
      ImagePasteExtension,
      SlashMenuExtension,
      WikilinkMenuExtension,
      LinkClickExtension,
      TaskList,
      TaskItem.configure({ nested: true }),
      MentionNode,
      MentionMenuExtension,
      CollaborativeCursors,
      CommentHighlights,
      TableOfContents,
    ],
    content: initialContent,
    immediatelyRender: false,
    onCreate({ editor }) {
      // Initialize shadow to the original server content (not getMarkdown(),
      // which may normalize whitespace). The shadow must always match the
      // server's state so OT ops have correct positions.
      shadowRef.current = initialContent;
      console.debug(`[Editor] TipTap created for docId="${docId}", shadow length=${initialContent.length}`);
    },
    onTransaction({ transaction, editor }) {
      // Skip remote changes and non-doc changes
      if (isRemoteRef.current) return;
      if (!transaction.docChanged) return;

      const newMd = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
      const ops = diffMarkdownToOps(shadowRef.current, newMd);
      shadowRef.current = newMd;

      if (ops && otClientRef.current) {
        console.debug(`[Editor] Sending local op for docId="${docId}"`);
        otClientRef.current.sendOp(ops);
        markDirty();
      }
    },
  });

  // Wire the edit popover callback into wikilink storage
  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as any).wikilink;
    if (storage) {
      storage.onOpenEditPopover = (
        node: PMNode,
        getPos: () => number | undefined,
        anchorRect: DOMRect,
      ) => {
        setWikilinkEditPopover({ node, getPos, anchorRect });
      };
    }
  }, [editor]);

  // Debounced word count — fed to the status bar via onWordCountChange
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const text = editor.state.doc.textContent.trim();
      const count = text ? text.split(/\s+/).length : 0;
      onWordCountChangeRef.current?.(count);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, 300);
    };
    compute();
    editor.on('update', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  // Debounced heading walk — feeds the Outline panel. Skip if no subscriber.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      const entries: DocHeading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;
        const text = node.textContent;
        const slug = slugify(text) || `heading-${pos}`;
        entries.push({ slug, level: node.attrs.level, text, pos });
      });
      setDocHeadings(entries);
      onHeadingsChangeRef.current?.(entries);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(compute, 300);
    };
    compute();
    editor.on('update', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  // Sync comment threads to the highlight extension
  const onSelectThreadRef = useRef(onSelectThread);
  onSelectThreadRef.current = onSelectThread;

  useEffect(() => {
    if (!editor) return;
    updateCommentHighlights(editor, commentThreads ?? [], focusThreadId);
  }, [editor, commentThreads, focusThreadId]);

  useEffect(() => {
    if (!editor) return;
    setCommentHighlightOnClick((event) => {
      onSelectThreadRef.current?.(event.threadId);
    });
    return () => setCommentHighlightOnClick(null);
  }, [editor]);

  // Preview mode: swap editor content and toggle editable
  const liveContentRef = useRef<string | null>(null);
  const liveShadowRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    if (previewContent != null) {
      // Entering preview: save live content, swap in preview, make read-only
      if (liveContentRef.current === null) {
        liveContentRef.current = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
        liveShadowRef.current = shadowRef.current;
      }
      // Parse markdown → HTML → PM doc, then replace editor content via transaction
      const mdParser = (editor.storage as any).markdown?.parser;
      if (mdParser && previewContent) {
        const html = mdParser.parse(previewContent);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const newDoc = PMDOMParser.fromSchema(editor.schema).parse(wrapper);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, newDoc.content);
        isRemoteRef.current = true;
        editor.view.dispatch(tr);
        isRemoteRef.current = false;
      } else {
        isRemoteRef.current = true;
        editor.commands.setContent(previewContent || '<p></p>');
        isRemoteRef.current = false;
      }
      editor.setEditable(false);
    } else if (liveContentRef.current !== null) {
      // Leaving preview: restore live content, make editable (unless permission says otherwise)
      editor.setEditable(permission !== 'comment');
      const mdParser = (editor.storage as any).markdown?.parser;
      if (mdParser) {
        const html = mdParser.parse(liveContentRef.current);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const newDoc = PMDOMParser.fromSchema(editor.schema).parse(wrapper);
        const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, newDoc.content);
        isRemoteRef.current = true;
        editor.view.dispatch(tr);
        isRemoteRef.current = false;
      } else {
        isRemoteRef.current = true;
        editor.commands.setContent(liveContentRef.current);
        isRemoteRef.current = false;
      }
      shadowRef.current = liveShadowRef.current ?? liveContentRef.current;
      liveContentRef.current = null;
      liveShadowRef.current = null;
    }
  }, [editor, previewContent]);

  // Helper: select a range and scroll it into view
  const selectAndScroll = useCallback((from: number, to: number) => {
    if (!editor) return;
    const maxPos = editor.state.doc.content.size - 1;
    const clampedFrom = Math.min(from, maxPos);
    const clampedTo = Math.min(to, maxPos);
    editor.commands.setTextSelection({ from: clampedFrom, to: clampedTo });
    editor.commands.focus();
    const coords = editor.view.coordsAtPos(clampedFrom);
    const editorContainer = document.querySelector('.editor-container');
    if (editorContainer) {
      const rect = editorContainer.getBoundingClientRect();
      editorContainer.scrollTop += coords.top - rect.top - rect.height / 3;
    }
  }, [editor]);

  // Find all occurrences of a text string, returning their ProseMirror positions
  const findTextOccurrences = useCallback((searchText: string): { from: number; to: number }[] => {
    if (!editor) return [];
    const doc = editor.state.doc;
    const textChunks: { pos: number; text: string }[] = [];
    doc.descendants((node, pos) => {
      if (node.isText) {
        textChunks.push({ pos, text: node.text! });
      }
      return true;
    });

    // Build full text with position mapping
    let fullText = '';
    const posMap: { charOffset: number; pmPos: number }[] = [];
    for (const chunk of textChunks) {
      posMap.push({ charOffset: fullText.length, pmPos: chunk.pos });
      fullText += chunk.text;
    }

    // Find all occurrences
    const results: { from: number; to: number }[] = [];
    let startIdx = 0;
    while (true) {
      const index = fullText.indexOf(searchText, startIdx);
      if (index === -1) break;

      // Map char offset to PM position
      let pmFrom = 0;
      for (let i = posMap.length - 1; i >= 0; i--) {
        if (posMap[i].charOffset <= index) {
          pmFrom = posMap[i].pmPos + (index - posMap[i].charOffset);
          break;
        }
      }
      results.push({ from: pmFrom, to: pmFrom + searchText.length });
      startIdx = index + 1;
    }
    return results;
  }, [editor]);

  // Navigate to a comment by quoted text + position hint
  const navigateToComment = useCallback((quotedText?: string, positionHint?: { from: number; to: number }) => {
    if (!editor) return;

    if (quotedText) {
      const occurrences = findTextOccurrences(quotedText);
      if (occurrences.length === 0) {
        if (positionHint) selectAndScroll(positionHint.from, positionHint.to);
        return;
      }
      if (occurrences.length === 1 || !positionHint) {
        selectAndScroll(occurrences[0].from, occurrences[0].to);
        return;
      }
      let best = occurrences[0];
      let bestDist = Math.abs(best.from - positionHint.from);
      for (const occ of occurrences) {
        const dist = Math.abs(occ.from - positionHint.from);
        if (dist < bestDist) {
          best = occ;
          bestDist = dist;
        }
      }
      selectAndScroll(best.from, best.to);
    } else if (positionHint) {
      selectAndScroll(positionHint.from, positionHint.to);
    }
  }, [editor, findTextOccurrences, selectAndScroll]);

  // Expose navigation to parent
  useImperativeHandle(ref, () => ({
    navigateToComment,
    scrollToUser(userId: string) {
      if (!editor) return;
      const storage = editor.extensionManager.extensions.find(
        (ext: any) => ext.name === 'collaborativeCursors',
      )?.storage;
      if (!storage) return;
      const user = storage.users.get(userId);
      if (!user?.cursor) return;
      selectAndScroll(user.cursor, user.cursor);
    },
    scrollToHeading(id: string) {
      if (!containerRef.current) return;
      const el = containerRef.current.querySelector(`.tiptap [id="${CSS.escape(id)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    appendWikilink(targetPath: string) {
      if (!editor || !editor.isEditable) return false;
      const { wikilink, paragraph } = editor.schema.nodes;
      if (!wikilink || !paragraph) return false;
      const target = wikilinkTargetFor(targetPath, activeFileRef.current, flattenFiles(filesRef.current));
      const node = paragraph.create(null, wikilink.create({ target, alias: null }));
      // A plain transaction: the OT bridge picks it up like any local edit.
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, node));
      return true;
    },
  }), [editor, navigateToComment, selectAndScroll]);

  // Execute slash command — handles both Enter (from plugin) and click paths
  const executeCommand = useCallback((cmd: SlashCommand) => {
    if (!editor) return;

    if (cmd.needsInput) {
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      setFloatingInput({
        label: cmd.needsInput.label,
        placeholder: cmd.needsInput.placeholder,
        position: { top: coords.bottom + 6, left: coords.left },
        onSubmit: (value: string) => {
          cmd.action(editor, value);
          setFloatingInput(null);
          editor.commands.focus();
        },
      });
      return;
    }

    cmd.action(editor);
    if (cmd.name === 'table') {
      onNotifyAction?.('table-inserted');
    }
  }, [editor, onNotifyAction]);

  // Keep ref in sync so the plugin callback always has the latest
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  // Click handler for slash menu items
  const handleSlashCommand = useCallback((index: number) => {
    if (!slashMenu || !editor) return;

    // If we're in a submenu, execute the submenu child
    if (slashMenu.submenu) {
      const cmd = slashMenu.submenu.items[index];
      if (!cmd) return;

      // Delete the slash text
      const { $from } = editor.state.selection;
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
      const slashMatch = textBefore.match(/\/(\w*)$/);
      if (slashMatch) {
        const from = $from.pos - slashMatch[0].length;
        const to = $from.pos;
        const tr = editor.state.tr.delete(from, to);
        editor.view.dispatch(tr);
      }

      setSlashMenu(null);
      executeCommand(cmd);
      return;
    }

    const cmd = slashMenu.filteredCommands[index];
    if (!cmd) return;

    // If the command has children, open the submenu
    if (cmd.children?.length) {
      setSlashMenu({
        ...slashMenu,
        submenu: { parent: cmd, items: cmd.children, selectedIndex: 0 },
      });
      return;
    }

    // Delete the slash text
    const { $from } = editor.state.selection;
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    const slashMatch = textBefore.match(/\/(\w*)$/);
    if (slashMatch) {
      const from = $from.pos - slashMatch[0].length;
      const to = $from.pos;
      const tr = editor.state.tr.delete(from, to);
      editor.view.dispatch(tr);
    }

    setSlashMenu(null);
    executeCommand(cmd);
  }, [slashMenu, editor, executeCommand]);

  // Click handler for submenu back button
  const handleSubmenuBack = useCallback(() => {
    if (!slashMenu) return;
    setSlashMenu({ ...slashMenu, submenu: undefined });
  }, [slashMenu]);

  // Notify when slash menu opens (for tour)
  const slashMenuWasActive = useRef(false);
  useEffect(() => {
    if (slashMenu?.active && !slashMenuWasActive.current) {
      onNotifyAction?.('slash-menu-opened');
    }
    slashMenuWasActive.current = !!slashMenu?.active;
  }, [slashMenu?.active, onNotifyAction]);

  // Close slash menu on scroll
  useEffect(() => {
    if (!slashMenu?.active) return;
    const container = document.querySelector('.editor-container');
    if (!container) return;
    const handleScroll = () => setSlashMenu(null);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [slashMenu?.active]);

  // Close wikilink menu on scroll
  useEffect(() => {
    if (!wikilinkMenu?.active) return;
    const container = document.querySelector('.editor-container');
    if (!container) return;
    const handleScroll = () => setWikilinkMenu(null);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [wikilinkMenu?.active]);

  // Close mention menu on scroll
  useEffect(() => {
    if (!mentionMenu?.active) return;
    const container = document.querySelector('.editor-container');
    if (!container) return;
    const handleScroll = () => setMentionMenu(null);
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [mentionMenu?.active]);

  // Scroll selected slash menu item into view
  useEffect(() => {
    if (!slashMenu?.active || !slashMenuRef.current) return;
    const selected = slashMenuRef.current.querySelector('.slash-menu-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [slashMenu?.selectedIndex, slashMenu?.submenu?.selectedIndex, slashMenu?.active]);

  // Clamp slash menu position to stay within viewport
  useLayoutEffect(() => {
    if (!slashMenu?.active || !slashMenuRef.current) return;
    const el = slashMenuRef.current;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
  }, [slashMenu?.active, slashMenu?.position?.top, slashMenu?.position?.left, slashMenu?.submenu]);

  useEffect(() => {
    if (!editor) return;

    const otClient = new OTClient(
      wsClient,
      docId,
      initialRevision,
      (ops) => {
        if (mode === 'raw') {
          remoteOpsQueueRef.current.push(ops);
          return;
        }
        const newMd = applyOpsToMarkdown(shadowRef.current, ops);
        applyRemoteMarkdown(editor, shadowRef, newMd, isRemoteRef);
      },
      {
        initialShadow: initialContent,
        onError: () => {
          // Reset optimistic shadow to confirmed shadow
          const confirmed = otClient.getConfirmedShadow();
          if (confirmed) {
            shadowRef.current = confirmed;
            applyRemoteMarkdown(editor, shadowRef, confirmed, isRemoteRef);
          }
        },
      },
    );
    otClientRef.current = otClient;
    console.debug(`[Editor] OTClient created for docId="${docId}", revision=${initialRevision}`);

    // Track acks to update confirmed shadow and save status
    const offAck = wsClient.on('ack', (msg: any) => {
      if (msg.docId !== docId) return;
      // Update confirmed shadow to current shadow (which reflects acked state)
      otClient.setConfirmedShadow(shadowRef.current);
      markAcked();
    });

    return () => {
      console.debug(`[Editor] OTClient cleanup/destroy for docId="${docId}"`);
      otClient.destroy();
      offAck();
    };
  }, [editor, wsClient, docId, initialRevision]);

  // Document re-sync on reconnect
  useEffect(() => {
    if (!editor) return;

    const offConnected = wsClient.on('connected', (msg: any) => {
      if (!msg.wasReconnect) return;
      // Re-send doc:open to get fresh content + revision
      console.debug(`[Editor] Reconnected, re-syncing docId="${docId}"`);
      wsClient.send({ type: 'doc:open', docId, unlock: getPinUnlockToken(docId) });
    });

    const offDocOpened = wsClient.on('doc:opened', (msg: any) => {
      if (msg.docId !== docId) return;
      // Only handle re-sync (not initial open)
      if (!otClientRef.current) return;

      console.debug(`[Editor] Re-sync doc:opened for "${docId}", rev=${msg.revision}`);

      // Destroy old OTClient
      otClientRef.current.destroy();

      // Create new OTClient with fresh revision
      const otClient = new OTClient(
        wsClient,
        docId,
        msg.revision,
        (ops) => {
          if (mode === 'raw') {
            remoteOpsQueueRef.current.push(ops);
            return;
          }
          const newMd = applyOpsToMarkdown(shadowRef.current, ops);
          applyRemoteMarkdown(editor, shadowRef, newMd, isRemoteRef);
        },
        {
          initialShadow: msg.content,
          onError: () => {
            const confirmed = otClient.getConfirmedShadow();
            if (confirmed) {
              shadowRef.current = confirmed;
              applyRemoteMarkdown(editor, shadowRef, confirmed, isRemoteRef);
            }
          },
        },
      );
      otClientRef.current = otClient;

      // Replace editor content with server state
      shadowRef.current = msg.content;
      applyRemoteMarkdown(editor, shadowRef, msg.content, isRemoteRef);

      // Restore editable and reset save status (comment-only stays locked).
      // Read permission from the payload — the server re-sends it on every
      // doc:opened, so a re-sync sees the current value even if the prop is stale.
      const livePermission = msg.permission ?? permission;
      editor.setEditable(livePermission !== 'comment');
      resetToSynced();
    });

    return () => {
      offConnected();
      offDocOpened();
    };
  }, [editor, wsClient, docId]);

  // Broadcast local cursor/selection via presence messages (throttled to 50ms)
  useEffect(() => {
    if (!editor) return;

    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSent = 0;

    const sendPresence = () => {
      const { from, to, head } = editor.state.selection;
      const hasSelection = from !== to;
      wsClient.send({
        type: 'presence',
        docId,
        cursor: head,
        selection: hasSelection ? { from, to } : null,
      });
      lastSent = Date.now();
      throttleTimer = null;
    };

    const handleSelectionUpdate = () => {
      const now = Date.now();
      const elapsed = now - lastSent;
      if (elapsed >= 50) {
        sendPresence();
      } else if (!throttleTimer) {
        throttleTimer = setTimeout(sendPresence, 50 - elapsed);
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [editor, wsClient, docId]);

  // Listen for incoming presence and presence:leave messages
  useEffect(() => {
    if (!editor) return;

    const removePresenceHandler = wsClient.on('presence', (msg: any) => {
      if (!msg.userId || msg.docId !== docId) return;
      updateRemotePresence(editor, {
        userId: msg.userId,
        email: msg.email || msg.userId,
        color: getColorForUser(msg.email || msg.userId),
        cursor: msg.cursor ?? null,
        selection: msg.selection ?? null,
      });
    });

    const removeLeaveHandler = wsClient.on('presence:leave', (msg: any) => {
      if (!msg.userId) return;
      removeRemotePresence(editor, msg.userId);
    });

    return () => {
      removePresenceHandler();
      removeLeaveHandler();
    };
  }, [editor, wsClient, docId]);

  // Update the OT callback when mode changes so queuing works
  useEffect(() => {
    if (!otClientRef.current || !editor) return;
    otClientRef.current.setRemoteOpCallback((ops) => {
      if (mode === 'raw') {
        remoteOpsQueueRef.current.push(ops);
        return;
      }
      const newMd = applyOpsToMarkdown(shadowRef.current, ops);
      applyRemoteMarkdown(editor, shadowRef, newMd, isRemoteRef);
    });
  }, [mode, editor]);

  const switchToRaw = useCallback(() => {
    if (!editor) return;

    // Flush pending OT ops
    if (otClientRef.current) {
      otClientRef.current.flush();
    }

    // Use the shadow (which is markdown) for raw editing
    const md = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
    shadowRef.current = md;
    setRawContent(md);
    setMode('raw');
  }, [editor]);

  const switchToRendered = useCallback(() => {
    if (!editor) return;

    // Send any raw edits as OT ops
    const rawOps = diffMarkdownToOps(shadowRef.current, rawContent);
    if (rawOps && otClientRef.current) {
      otClientRef.current.sendOp(rawOps);
    }
    shadowRef.current = rawContent;

    // Apply queued remote ops to shadow
    const queued = remoteOpsQueueRef.current;
    remoteOpsQueueRef.current = [];
    for (const remoteOps of queued) {
      shadowRef.current = applyOpsToMarkdown(shadowRef.current, remoteOps);
    }

    // Update editor to final state
    isRemoteRef.current = true;
    editor.commands.setContent(shadowRef.current);
    isRemoteRef.current = false;

    setMode('rendered');
  }, [editor, rawContent]);

  // Lock editor on ERROR/DISCONNECTED, unlock on recovery to SYNCED.
  // Comment-only grantees are also locked — server rejects their ops, this
  // prevents the UI from accumulating ghost edits that will never apply.
  const isLocked = saveStatus === 'ERROR' || saveStatus === 'DISCONNECTED';
  const isReadOnlyByPermission = permission === 'comment';
  useEffect(() => {
    if (!editor || previewContent != null) return;
    editor.setEditable(!isLocked && !isReadOnlyByPermission);
  }, [editor, isLocked, isReadOnlyByPermission, previewContent]);

  // Copy editor content as markdown (for error banner button)
  const handleCopyContent = useCallback(() => {
    if (!editor) return;
    const md = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
    navigator.clipboard.writeText(md);
  }, [editor]);

  // beforeunload guard — warn when there are unconfirmed changes
  useEffect(() => {
    if (saveStatus === 'SYNCED') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  // Editor context menu handler (only in rendered mode)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (mode !== 'rendered') return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [mode]);

  const hasSelection = editor ? !editor.state.selection.empty : false;

  const contextMenuItems = (() => {
    const items: ContextMenuItem[] = [
      {
        label: 'Cut',
        action: () => {
          document.execCommand('cut');
        },
      },
      {
        label: 'Copy',
        action: () => {
          document.execCommand('copy');
        },
      },
      {
        label: 'Paste',
        action: () => {
          navigator.clipboard.readText().then((text) => {
            editor?.commands.insertContent(text);
          }).catch(() => {
            document.execCommand('paste');
          });
        },
      },
    ];

    if (hasSelection && onAddComment) {
      items.push({
        label: 'Add Comment',
        action: () => {
          if (!editor) return;
          const { from, to } = editor.state.selection;
          const selectedText = editor.state.doc.textBetween(from, to);
          const blockId = crypto.randomUUID();
          const coords = editor.view.coordsAtPos(from);
          const isPersonal = activeFile.startsWith('_users/');
          setFloatingInput({
            label: 'Comment',
            placeholder: 'Add a comment...',
            position: { top: coords.bottom + 6, left: coords.left },
            notice: isPersonal ? PERSONAL_MENTION_NOTICE : undefined,
            onSubmit: (commentText: string) => {
              onAddComment(blockId, commentText, selectedText, { from, to });
              onOpenComments?.();
              setFloatingInput(null);
            },
          });
        },
      });
    }

    if (editor?.isActive('table')) {
      const { $from } = editor.state.selection;
      const isHeaderRow = (() => {
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'tableHeader') return true;
          if (name === 'tableCell' || name === 'tableRow' || name === 'table') return false;
        }
        return false;
      })();
      const tableNode = (() => {
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'table') return $from.node(d);
        }
        return null;
      })();
      const rowCount = tableNode ? tableNode.childCount : 0;
      const isLastDataRow = rowCount <= 2;

      items.push({ type: 'separator' });
      items.push({ label: 'Insert row above', action: () => editor.chain().focus().addRowBefore().run(), disabled: isHeaderRow });
      items.push({ label: 'Insert row below', action: () => editor.chain().focus().addRowAfter().run() });
      items.push({ label: 'Insert column left', action: () => editor.chain().focus().addColumnBefore().run() });
      items.push({ label: 'Insert column right', action: () => editor.chain().focus().addColumnAfter().run() });
      items.push({ type: 'separator' });
      items.push({ label: 'Delete row', action: () => editor.chain().focus().deleteRow().run(), disabled: isHeaderRow || isLastDataRow });
      items.push({ label: 'Delete column', action: () => editor.chain().focus().deleteColumn().run() });
      items.push({ label: 'Delete table', action: () => editor.chain().focus().deleteTable().run() });
    }

    return items;
  })();

  return (
    <div ref={containerRef} className={`editor-container${isLocked ? ' editor-locked' : ''}`} onContextMenu={handleContextMenu}>
      {/* Comment-only banner — server rejects ops, this just sets the expectation. */}
      {isReadOnlyByPermission && (
        <div className="save-banner save-banner--info">
          <span className="save-banner-text">
            You have comment-only access to this note. Use the rail to leave comments.
          </span>
        </div>
      )}

      {/* Save status banner (ERROR / DISCONNECTED) */}
      {isLocked && (
        <div className={`save-banner save-banner--${saveStatus === 'DISCONNECTED' ? 'disconnected' : 'error'}`}>
          <span className="save-banner-text">
            {saveStatus === 'DISCONNECTED'
              ? 'Connection lost \u2014 your changes are not being saved. Reconnecting...'
              : 'Save failed \u2014 your changes may not be saved'}
          </span>
          <button className="save-banner-copy" onClick={handleCopyContent}>
            Copy content
          </button>
        </div>
      )}

      {/* Mode toggle + save status */}
      <div className="editor-mode-toggle">
        <button
          className={`mode-toggle-btn ${mode === 'rendered' ? 'active' : ''}`}
          onClick={() => mode === 'raw' ? switchToRendered() : undefined}
          title="Rendered view"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 3h12M2 6h8M2 9h10M2 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          className={`mode-toggle-btn ${mode === 'raw' ? 'active' : ''}`}
          onClick={() => mode === 'rendered' ? switchToRaw() : undefined}
          title="Raw Markdown"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="save-status-indicator" data-status={saveStatus}>
          {saveStatus === 'SYNCED' && <><SaveCheckIcon /> Saved</>}
          {(saveStatus === 'DIRTY' || saveStatus === 'FLUSH_PENDING') && 'Saving...'}
          {saveStatus === 'ERROR' && <><SaveErrorIcon /> Save failed</>}
          {saveStatus === 'DISCONNECTED' && <><SaveWarningIcon /> Connection lost</>}
        </div>
      </div>

      {/* Rendered mode */}
      {mode === 'rendered' && (
        <>
          <div className="kp-doc">
            {onRename && previewContent == null && (
              <DocHeader
                filePath={activeFile}
                authorEmail={authorEmail}
                updatedAt={updatedAt}
                wordCount={wordCount}
                backlinkCount={backlinkCount}
                content={editor ? (editor.storage as any).markdown?.getMarkdown?.() ?? initialContent : initialContent}
                presenceUsers={presenceUsers}
                onRename={onRename}
                onRenameError={onRenameError}
                renameRequestKey={renameRequestKey}
                onTagClick={onTagClick}
              />
            )}
            <EditorContent editor={editor} className="editor-content" />
          </div>
          {editor && minimapEnabled && previewContent == null && (
            <FloatingMinimap
              editor={editor}
              container={containerRef.current}
              headings={docHeadings}
              threads={commentThreads ?? []}
              onFocusThread={(threadId) => onSelectThreadRef.current?.(threadId)}
            />
          )}
          {editor && previewContent == null && onAddComment && (
            <SelectionBubble
              editor={editor}
              container={containerRef.current}
              onComment={({ from, to, quotedText, anchor }) => {
                const blockId = crypto.randomUUID();
                const isPersonal = activeFile.startsWith('_users/');
                setFloatingInput({
                  label: 'Comment',
                  placeholder: 'Add a comment...',
                  position: anchor,
                  notice: isPersonal ? PERSONAL_MENTION_NOTICE : undefined,
                  onSubmit: (commentText: string) => {
                    onAddComment(blockId, commentText, quotedText, { from, to });
                    onOpenComments?.();
                    setFloatingInput(null);
                  },
                });
              }}
            />
          )}
          {slashMenu?.active && (
            <div
              ref={slashMenuRef}
              className={`slash-menu ${slashMenu.submenu ? 'slash-menu--submenu' : ''}`}
              style={{
                position: 'fixed',
                top: slashMenu.position.top,
                left: slashMenu.position.left,
              }}
            >
              {slashMenu.submenu ? (
                <>
                  <button
                    className="slash-menu-back"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSubmenuBack();
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>{slashMenu.submenu.parent.label}</span>
                  </button>
                  <div className="slash-menu-divider" />
                  {slashMenu.submenu.items.map((cmd, i) => (
                    <button
                      key={cmd.name}
                      className={`slash-menu-item ${i === slashMenu.submenu!.selectedIndex ? 'selected' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSlashCommand(i);
                      }}
                    >
                      <span className={`slash-menu-icon slash-menu-icon--${cmd.name}`}>{cmd.icon}</span>
                      <span className="slash-menu-text">
                        <span className="slash-menu-label">{cmd.label}</span>
                        <span className="slash-menu-desc">{cmd.description}</span>
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <div className="slash-menu-hint">
                    <span className="slash-menu-hint-query">/ {slashMenu.query}</span>
                    <span className="slash-menu-hint-esc">Esc</span>
                  </div>
                  {slashMenu.filteredCommands.length === 0 ? (
                    <div className="slash-menu-empty">No matching commands</div>
                  ) : slashMenu.query ? (
                    slashMenu.filteredCommands.map((cmd, i) => (
                      <button
                        key={cmd.name}
                        className={`slash-menu-item ${i === slashMenu.selectedIndex ? 'selected' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSlashCommand(i);
                        }}
                      >
                        <span className="slash-menu-icon">{cmd.icon}</span>
                        <span className="slash-menu-text">
                          <span className="slash-menu-label">{cmd.label}</span>
                          <span className="slash-menu-desc">{cmd.description}</span>
                        </span>
                        {cmd.children && (
                          <svg className="slash-menu-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    ))
                  ) : (
                    SLASH_COMMAND_GROUPS.map((group) => {
                      const groupCmds = slashMenu.filteredCommands.filter((cmd) => cmd.group === group.key);
                      if (groupCmds.length === 0) return null;
                      return (
                        <div key={group.key}>
                          <div className="slash-menu-group-header">{group.label}</div>
                          {groupCmds.map((cmd) => {
                            const i = slashMenu.filteredCommands.indexOf(cmd);
                            return (
                              <button
                                key={cmd.name}
                                className={`slash-menu-item ${i === slashMenu.selectedIndex ? 'selected' : ''}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSlashCommand(i);
                                }}
                              >
                                <span className="slash-menu-icon">{cmd.icon}</span>
                                <span className="slash-menu-text">
                                  <span className="slash-menu-label">{cmd.label}</span>
                                  <span className="slash-menu-desc">{cmd.description}</span>
                                </span>
                                {cmd.children && (
                                  <svg className="slash-menu-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none">
                                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          )}
          {wikilinkMenu?.active && editor && (
            <WikilinkAutocomplete
              state={wikilinkMenu}
              onSelect={(index) => {
                const view = editor.view;
                const state = wikilinkMenuPluginKey.getState(view.state) as WikilinkMenuState | null;
                if (!state) return;

                const { $from } = view.state.selection;
                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                const wikilinkMatch = textBefore.match(/\[\[([^\]|]*?)$/);
                if (!wikilinkMatch) return;

                const matchStart = $from.pos - wikilinkMatch[0].length;
                const matchEnd = $from.pos;

                let target: string;
                if (state.phase === 'note') {
                  const note = state.suggestions[index];
                  if (!note) return;
                  const hasDuplicates = state.suggestions.filter(
                    (s) => s.label === note.label,
                  ).length > 1;
                  target = hasDuplicates && note.dir ? `${note.dir}/${note.label}` : note.label;
                } else {
                  const heading = state.headings[index];
                  if (!heading) return;
                  const prefix = state.noteName || '';
                  target = `${prefix}#${heading.text}`;
                }

                const wikilinkType = view.state.schema.nodes.wikilink;
                if (wikilinkType) {
                  const wikilinkNode = wikilinkType.create({ target, alias: null });
                  const tr = view.state.tr
                    .delete(matchStart, matchEnd)
                    .insert(matchStart, wikilinkNode);
                  tr.setMeta(wikilinkMenuPluginKey, null);
                  view.dispatch(tr);
                } else {
                  const tr = view.state.tr
                    .delete(matchStart, matchEnd)
                    .insertText(`[[${target}]]`, matchStart);
                  tr.setMeta(wikilinkMenuPluginKey, null);
                  view.dispatch(tr);
                }
                view.focus();
              }}
            />
          )}
          {mentionMenu?.active && editor && (
            <MentionAutocompleteMenu
              state={mentionMenu}
              onSelect={(index) => {
                const user = mentionMenu.users[index];
                if (user) selectMentionUser(editor.view, user);
              }}
            />
          )}
          {wikilinkEditPopover && editor && (
            <WikilinkEditPopover
              editor={editor}
              node={wikilinkEditPopover.node}
              getPos={wikilinkEditPopover.getPos}
              anchorRect={wikilinkEditPopover.anchorRect}
              onClose={() => setWikilinkEditPopover(null)}
            />
          )}
        </>
      )}

      {/* Raw Markdown mode */}
      {mode === 'raw' && (
        <div className="raw-markdown-view">
          <div className="raw-sync-indicator">
            Sync paused — edits will sync when switching back to rendered mode
          </div>
          <textarea
            className="raw-markdown-textarea"
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {/* Floating inline input (links, comments) */}
      {floatingInput && (
        <FloatingInput
          label={floatingInput.label}
          placeholder={floatingInput.placeholder}
          position={floatingInput.position}
          onSubmit={floatingInput.onSubmit}
          notice={floatingInput.notice}
          onCancel={() => {
            setFloatingInput(null);
            editor?.commands.focus();
          }}
        />
      )}

      {/* Table hover controls */}
      {mode === 'rendered' && editor && <TableControls editor={editor} />}

      {/* draw.io editor modal */}
      {editor && <DrawioEditorController editor={editor} activeDocPath={activeFile} />}

      {/* Editor context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});

function SaveCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: 'middle' }}>
      <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function SaveErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: 'middle' }}>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 4.5v4M8 10.5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function SaveWarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: 'middle' }}>
      <path d="M8 1.5L14.5 13H1.5L8 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8 6v3M8 11v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
