import React, { useState, useEffect, useCallback, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import type { FileEntry, CommentThread } from '@kalepin/shared';
import { checkTokenFromUrl, requestMagicLink, getToken, clearToken } from './auth';
import { WSClient } from './ws/ws-client';
import { KalepinEditor, EditorHandle } from './editor/Editor';
import { SecureEditor } from './components/SecureEditor';
import { MoveToSecureDialog } from './components/MoveToSecureDialog';
import { MoveFromSecureDialog } from './components/MoveFromSecureDialog';
import { PassphraseSetupDialog } from './components/PassphraseSetupDialog';
import { PassphrasePromptDialog } from './components/PassphrasePromptDialog';
import { loadCachedMasterKek } from './crypto/key-store';
import { isE2EEncrypted, prettifyPath } from './crypto/path-predicates';
import { SECURE_FOLDER_ENABLED } from './feature-flags';
import { consumeSelfSaved } from './self-saved-paths';
import { decideActiveDocEcho } from './active-doc-echo-gate';
import { NudgeRegistry } from './nudge-pending';
import { FileTree, isPersonalRootSegment, PERSONAL_PREFIX, partitionTree } from './components/FileTree';
import { CommentsPanel } from './components/CommentsPanel';
import { ContextMenu } from './components/ContextMenu';
import { PinDialog } from './components/PinDialog';
import { InputModal } from './components/InputModal';
import { ShareDialog } from './components/ShareDialog';
import {
  buildShareLinkUrl,
  buildDocUrlByPath,
  buildDocUrlByHandle,
  parseDocUrl,
} from './urls';
import { ConfirmModal } from './components/ConfirmModal';
import { LoginPage } from './components/LoginPage';
import { GuestDocView } from './components/GuestDocView';
import { OAuthConsentPage } from './components/OAuthConsentPage';
import { getColorForUser } from './components/PresenceIndicators';
import { ToastContainer, ToastMessage } from './components/Toast';
import { SettingsPage } from './components/SettingsPage';
import { SearchModal } from './components/SearchModal';
import { ChangesPanel } from './components/ChangesPanel';
import { BacklinksPanel } from './components/BacklinksPanel';
import { VersionHistoryPanel } from './components/VersionHistoryPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { GraphView } from './components/GraphView';
import type { HistoryEntry } from './api';
import { CoachMark } from './components/CoachMark';
import { TopBar } from './components/TopBar/TopBar';
import { StatusBar } from './components/StatusBar/StatusBar';
import { RightRail, type RailTab } from './components/RightRail/RightRail';
import { TweaksPanel } from './components/TweaksPanel/TweaksPanel';
import { VaultHeader } from './components/Sidebar/VaultHeader';
import { CreatePopover, type CreateKind } from './components/Sidebar/CreatePopover';
import { StarredSection } from './components/Sidebar/StarredSection';
import { RecentSection } from './components/Sidebar/RecentSection';
import { SidebarSectionTitle } from './components/Sidebar/SidebarSectionTitle';
import { Icon } from './components/Icon';
import { recordVisit } from './utils/recent-files';
import type { SaveStatus } from './editor/useSaveStatus';
import * as api from './api';
import type { UpdatesResponse, StarredItem, CompletedTour } from './api';
import { useTour } from './tours/useTour';
import { TUTORIAL_CONTENT } from './tours/essentials';

/** Runtime preferences persisted across sessions. Shape is owned by Phase 2+ of the redesign. */
type TweakAccent = 'orange' | 'blue' | 'green' | 'purple' | 'rose';
type TweakDensity = 'compact' | 'comfortable' | 'spacious';
type TweakEditorFont = 'serif' | 'sans';
type Tweak = {
  theme: 'light' | 'dark';
  accent: TweakAccent;
  density: TweakDensity;
  editorFont: TweakEditorFont;
  sidebar: boolean;
  rail: boolean;
  minimap: boolean;
};

const DEFAULT_TWEAK: Tweak = {
  theme: 'light',
  accent: 'blue',
  density: 'comfortable',
  editorFont: 'serif',
  sidebar: true,
  rail: true,
  minimap: true,
};
const TWEAKS_STORAGE_KEY = 'kalepin-tweaks';
const TWEAKS_VERSION = 1;

function loadInitialTweak(): Tweak {
  try {
    const raw = localStorage.getItem(TWEAKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Tweak> & { version?: number };
      if (parsed && parsed.version === TWEAKS_VERSION) {
        return { ...DEFAULT_TWEAK, ...parsed };
      }
    }
  } catch {
    /* fall through to migration / defaults */
  }
  const legacy = localStorage.getItem('kalepin-theme');
  let theme: 'light' | 'dark';
  if (legacy === 'light' || legacy === 'dark') {
    theme = legacy;
    localStorage.removeItem('kalepin-theme');
  } else {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return { ...DEFAULT_TWEAK, theme };
}

/** Error boundary that catches tiptap view-not-mounted race conditions (Safari). */
class EditorErrorBoundary extends Component<
  { fileKey: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[EditorErrorBoundary] caught:', error.message);
  }
  componentDidUpdate(prev: { fileKey: string }) {
    // Reset when switching files so the editor retries
    if (prev.fileKey !== this.props.fileKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
          <p>Editor failed to load.</p>
          <button onClick={() => this.setState({ hasError: false })}
            style={{ padding: '6px 16px', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Backwards-compatible: returns file path for legacy URLs, null for new format. */
function filePathFromUrl(): string | null {
  const parsed = parseDocUrl();
  return parsed?.filePath ?? null;
}

function headingFromUrl(): string | null {
  const hash = window.location.hash;
  return hash ? decodeURIComponent(hash.slice(1)) : null;
}

function threadIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('thread');
}

// OAuth consent route uses hash-based routing so the SPA handles the redirect
// without needing a server-side rewrite. The OAuth controller emits URLs of
// the form `<APP_URL>/#/oauth/consent?request_id=<id>`.
function parseConsentRoute(): { requestId: string } | null {
  const raw = window.location.hash;
  if (!raw.startsWith('#/oauth/consent')) return null;
  const queryStart = raw.indexOf('?');
  if (queryStart < 0) return null;
  const params = new URLSearchParams(raw.slice(queryStart + 1));
  const requestId = params.get('request_id');
  return requestId ? { requestId } : null;
}

interface PresenceUser {
  userId: string;
  email: string;
  color: string;
}

interface DocState {
  content: string;
  revision: number;
  /** Resolved access level for the viewer. Absent on REST-fallback opens (treated as writable). */
  permission?: 'owner' | 'write' | 'comment';
}

export function App() {
  const [token, setTokenState] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [docState, setDocState] = useState<DocState | null>(null);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<'workspace' | 'settings' | 'changes' | 'graph'>('workspace');
  const [tweak, setTweak] = useState<Tweak>(loadInitialTweak);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>('comments');
  // null = follow auto-collapse heuristic; true/false = user override (resets when activeFile changes)
  const [railCollapseOverride, setRailCollapseOverride] = useState<boolean | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<HistoryEntry | null>(null);
  const [versionPreview, setVersionPreview] = useState<string | null>(null);
  const [versionPartial, setVersionPartial] = useState(false);
  const [backlinkCount, setBacklinkCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('SYNCED');
  const [docRevision, setDocRevision] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [docAuthor, setDocAuthor] = useState<string | null>(null);
  const [docUpdatedAt, setDocUpdatedAt] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [pinPrompt, setPinPrompt] = useState<
    | { path: string; mode: 'set'; changing?: boolean }
    | { path: string; mode: 'verify'; resumeOpen?: boolean }
    | null
  >(null);
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(new Set());
  const [moveSecureDialog, setMoveSecureDialog] = useState<
    | { kind: 'to'; src: string }
    | { kind: 'from'; src: string }
    | null
  >(null);
  const [secureDialog, setSecureDialog] = useState<{ kind: 'setup' | 'unlock' } | null>(null);
  const [vaultMeta, setVaultMeta] = useState<{ vault_setup_at: number | null; vault_tombstone_at: number | null } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [modal, setModal] = useState<{ title: string; placeholder?: string; defaultValue?: string; readOnly?: boolean; onConfirm: (v: string) => void } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [createPicker, setCreatePicker] = useState<{ kind: CreateKind; anchor: HTMLElement } | null>(null);
  const [shareDialog, setShareDialog] = useState<{ path: string; isFolder: boolean; targetPaths?: string[] } | null>(null);
  // Set when the user navigates to a /d/<code>/... URL whose code resolves to
  // 410 Gone. Drives a top-level "this link is no longer active" page.
  const [goneShareLink, setGoneShareLink] = useState<{ code: string } | null>(null);
  // Set when /api/files/read?handle=<id> returns 410 + { tombstoned: true }.
  // Distinct from goneShareLink — this card says "the note no longer exists",
  // a different signal from "the link no longer resolves".
  const [tombstonedHandle, setTombstonedHandle] = useState<{ handleId: string } | null>(null);
  const [renameRequestKey, setRenameRequestKey] = useState(0);
  const wsRef = useRef<WSClient | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const activeFileRef = useRef<string | null>(null);
  // Last time an OT 'op' or 'ack' frame landed on the active doc, in ms epoch.
  // The `file:changed` echo for the same path within the 2s window is the OT
  // flush coming back through chokidar; suppress the user-visible toast.
  const lastOTRevisionAtRef = useRef<number>(0);
  // Pending "share with X too?" intents keyed by note path. Populated by
  // `recordPendingShareNudge` at create-time and drained by
  // `triggerPendingShareNudge` on the first save (OT ack) or rename-away-from
  // -Untitled — whichever fires first.
  const nudgeRegistryRef = useRef<NudgeRegistry>(new NudgeRegistry());
  // Indirection so the WS effect (declared before `triggerPendingShareNudge`)
  // can reach the latest function value without subscribing to its identity.
  const triggerPendingShareNudgeRef = useRef<(path: string) => void>(() => {});
  // Ref so the keydown effect (declared near the top) can reach the mint+copy
  // callback (declared further down) without a circular declaration.
  const mintAndCopyPublicLinkRef = useRef<(() => void) | null>(null);
  const currentUserRef = useRef('');
  const pendingHeadingRef = useRef<string | null>(null);
  const pendingThreadIdRef = useRef<string | null>(null);
  const [highlightThreadId, setHighlightThreadId] = useState<string | null>(null);
  const isPopstateRef = useRef(false);
  const [updates, setUpdates] = useState<UpdatesResponse | null>(null);
  const [stars, setStars] = useState<StarredItem[]>([]);
  const [completedTours, setCompletedTours] = useState<CompletedTour[]>([]);
  const [sharedEncrypted, setSharedEncrypted] = useState(false);
  const tutorialFileRef = useRef<string | null>(null);
  const tutorialKeyRef = useRef(0); // Incremented each tour to force editor remount
  const savedUpdatesRef = useRef<UpdatesResponse | null>(null);

  const theme = tweak.theme;
  const setTheme = useCallback((next: 'light' | 'dark') => {
    setTweak((t) => ({ ...t, theme: next }));
  }, []);

  // Apply tweak to <html> dataset + persist
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = tweak.theme;
    root.dataset.accent = tweak.accent;
    root.dataset.density = tweak.density;
    root.dataset.editorFont = tweak.editorFont;
    root.classList.remove('light-mode');
    localStorage.setItem(
      TWEAKS_STORAGE_KEY,
      JSON.stringify({ ...tweak, version: TWEAKS_VERSION }),
    );
  }, [tweak]);

  const addToast = useCallback((
    text: string,
    type: ToastMessage['type'] = 'info',
    options?: { actionLabel?: string; onAction?: () => void },
  ) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, text, type, actionLabel: options?.actionLabel, onAction: options?.onAction }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const { activeTour, startTour, nextStep, skipTour, completeTour, notifyAction } = useTour(completedTours, setCompletedTours);

  // Keep activeFileRef in sync with activeFile state (for use in long-lived callbacks)
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  // Drop any rail collapse override when the user switches notes — the new note
  // gets its own auto-collapse decision based on its comments/backlinks.
  useEffect(() => { setRailCollapseOverride(null); }, [activeFile]);

  // Tour step side-effects refs (callbacks defined after loadFileTree)
  const savedCommentsRef = useRef<CommentThread[] | null>(null);
  const prevTourStepRef = useRef<string | null>(null);

  useEffect(() => {
    const curr = activeTour?.tour.steps[activeTour.stepIndex]?.id ?? null;
    const prev = prevTourStepRef.current;
    if (curr === prev) return;
    prevTourStepRef.current = curr;

    const now = new Date().toISOString();
    const CHANGES_STEPS = ['changes-click', 'changes-diff-click', 'changes-diff-view'];
    const mockUpdates: UpdatesResponse = {
      period: { since: new Date(Date.now() - 86400000).toISOString(), until: now },
      stats: { created: 1, modified: 1, deleted: 1 },
      starred: [],
      other: [{
        folder: '',
        files: [
          { path: 'meeting-notes.md', action: 'created', changes: 1, lastChangedAt: now, user: 'alex@example.com', diffs: [null] },
          { path: 'roadmap.md', action: 'modified', changes: 3, lastChangedAt: now, user: 'team@example.com', diffs: ['@@ -1,3 +1,4 @@\n Roadmap\n+- Add interactive tutorial\n - Improve search'] },
          { path: 'old-draft.md', action: 'deleted', changes: 1, lastChangedAt: now, user: null, diffs: [null] },
        ],
      }],
    };

    const fakeComments: CommentThread[] = [
      {
        id: 'tour-thread-1',
        blockId: 'tour-block-1',
        quotedText: 'Your team can edit notes in real-time.',
        comments: [
          { id: 'tc1', author: 'alex@example.com', text: 'Love how smooth the collaboration is!', createdAt: now },
          { id: 'tc2', author: 'sam@example.com', text: 'Works great with our team workflow.', createdAt: now },
        ],
        resolved: false,
      },
      {
        id: 'tour-thread-2',
        blockId: 'tour-block-2',
        quotedText: 'Comments and changes keep everyone on the same page.',
        comments: [
          { id: 'tc3', author: 'jordan@example.com', text: 'Can we add a section about notifications?', createdAt: now },
        ],
        resolved: false,
      },
    ];

    // --- Leaving previous step ---
    if (prev === 'comments' && savedCommentsRef.current !== null) {
      setComments(savedCommentsRef.current);
      savedCommentsRef.current = null;
    }
    const wasChanges = CHANGES_STEPS.includes(prev ?? '');
    const isChanges = CHANGES_STEPS.includes(curr ?? '');
    if (wasChanges && !isChanges) {
      setUpdates(savedUpdatesRef.current);
      savedUpdatesRef.current = null;
      setView('workspace');
    }

    // --- Entering current step ---
    if (curr === 'comments') {
      savedCommentsRef.current = comments;
      setComments(fakeComments);
      setRailTab('comments');
    }
    if (curr === 'changes-click' && !wasChanges) {
      savedUpdatesRef.current = updates;
      setUpdates(mockUpdates);
    }
    if (curr === 'changes-diff-click' || curr === 'changes-diff-view') {
      setView('changes');
    }
  }, [activeTour?.stepIndex, !!activeTour]);

  // Listen for diff toggle clicks during the tour
  useEffect(() => {
    const stepId = activeTour?.tour.steps[activeTour.stepIndex]?.id;
    if (stepId !== 'changes-diff-click') return;
    const handler = (e: MouseEvent) => {
      const btn = (e.target as Element).closest('.changes-toggle-diff[data-path="roadmap.md"]');
      if (btn) notifyAction('diff-expanded');
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [activeTour?.stepIndex, notifyAction]);

  // Auth check
  useEffect(() => {
    const t = checkTokenFromUrl();
    setTokenState(t);
  }, []);

  // Admin flag — drives visibility of the access-log "Activity" rail tab on
  // shared-vault paths and on foreign personal paths.
  useEffect(() => {
    if (!token) return;
    api.fetchWhoami().then((info) => setIsAdmin(!!info.isAdmin)).catch(() => { /* non-fatal */ });
  }, [token]);

  // Connect WebSocket when authenticated
  useEffect(() => {
    if (!token) return;

    // Decode JWT to get user info
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      currentUserRef.current = payload.email || '';
    } catch { /* ignore */ }

    const ws = new WSClient(token);
    wsRef.current = ws;
    ws.connect();

    ws.on('file:changed', (msg: any) => {
      // The watcher fans out to every session of the owning user — including
      // this tab. Suppress the toast (and the read fallback) when the change
      // originated here so the user doesn't see ghost notifications on save.
      if (consumeSelfSaved(msg.path)) return;
      const decision = decideActiveDocEcho({
        isActive: msg.path === activeFileRef.current,
        lastOTRevisionAt: lastOTRevisionAtRef.current,
        now: Date.now(),
      });
      if (decision.showToast) {
        addToast(`File changed externally: ${prettifyPath(msg.path)}`, 'info');
      }
      if (decision.refreshContent) {
        // E2E paths can't be read through /api/files/read — the SecureEditor
        // owns its own decrypt loop and will refresh on next open.
        if (isE2EEncrypted(msg.path)) return;
        api.readFileContent(msg.path).then((content) => {
          setDocState((prev) => prev ? { ...prev, content } : null);
        }).catch(() => { /* transient — leave the editor as-is */ });
      }
    });

    // Track OT revision arrival for the active doc. Both 'ack' (our op
    // confirmed) and 'op' (collaborator op) bump the timestamp so the file:
    // changed handler can tell an OT-driven flush from a true external edit.
    const bumpOTRevision = () => { lastOTRevisionAtRef.current = Date.now(); };
    // 'ack' confirms an op the user produced — i.e. they typed at least one
    // character. That's the "first non-empty save" signal that drains a
    // pending share-nudge. Collaborator 'op' frames don't qualify.
    ws.on('ack', (msg: any) => {
      bumpOTRevision();
      if (msg?.docId) triggerPendingShareNudgeRef.current(msg.docId);
    });
    ws.on('op', bumpOTRevision);

    ws.on('doc:reload', (msg: any) => {
      if (msg.path === activeFileRef.current) {
        openFile(msg.path);
      }
    });

    // The open doc was renamed or moved (by this tab or anyone else).
    ws.on('doc:moved', (msg: any) => {
      followActiveDocAfterMove(msg.from, msg.to);
    });

    ws.on('file:tree-update', () => {
      loadFileTree();
    });

    ws.on('presence:join', (msg: any) => {
      setPresenceUsers((prev) => {
        if (prev.find((u) => u.userId === msg.userId)) return prev;
        return [...prev, { userId: msg.userId, email: msg.email, color: getColorForUser(msg.email) }];
      });
    });

    ws.on('presence:leave', (msg: any) => {
      setPresenceUsers((prev) => prev.filter((u) => u.userId !== msg.userId));
    });

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [token]);

  // Load file tree
  const loadFileTree = useCallback(async () => {
    try {
      const tree = await api.fetchFileTree();
      setFiles(tree);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (token) loadFileTree();
  }, [token, loadFileTree]);

  // Track vault state for the Encrypted Folder placeholder in the sidebar.
  const reloadVaultMeta = useCallback(async () => {
    try {
      const wire = await api.getVaultMeta();
      setVaultMeta({
        vault_setup_at: wire.vault_setup_at,
        vault_tombstone_at: wire.vault_tombstone_at,
      });
    } catch { /* not authed yet, or transient — try again on next refresh */ }
  }, []);
  useEffect(() => {
    if (token) void reloadVaultMeta();
  }, [token, reloadVaultMeta]);

  const handleSecureFolderActivate = useCallback(async () => {
    // Defensive: with §2 done the sidebar tile is gone when the flag is off,
    // so this handler should be unreachable. Guard anyway in case a stale
    // call site survives.
    if (!SECURE_FOLDER_ENABLED) return;
    // Always re-read meta on click — the cached `vaultMeta` state may be stale
    // (background refresh hasn't landed yet, or another browser tab just
    // completed setup). Without this the dialog mis-routes to "Set up" for a
    // user whose vault already exists on the server.
    let meta = vaultMeta;
    try {
      const wire = await api.getVaultMeta();
      meta = { vault_setup_at: wire.vault_setup_at, vault_tombstone_at: wire.vault_tombstone_at };
      setVaultMeta(meta);
    } catch { /* keep whatever cached state we had */ }

    if (!meta || !meta.vault_setup_at) {
      setSecureDialog({ kind: 'setup' });
      return;
    }
    // Vault set up but master-KEK not cached — prompt for passphrase. The
    // unlock caches the key and refreshes the tree so the now-existing folder
    // expands cleanly the next time the user clicks.
    const cached = await loadCachedMasterKek();
    if (!cached) {
      setSecureDialog({ kind: 'unlock' });
      return;
    }
    // Already unlocked — let the default expand-folder behaviour run.
  }, [vaultMeta]);

  // Load the set of paths for which the user has set a PIN. Used by the
  // context menu to render Change/Remove vs. Set.
  useEffect(() => {
    if (!token) return;
    api.listMyPinnedNotes()
      .then((items) => setPinnedPaths(new Set(items.map((i) => i.path))))
      .catch(() => { /* fall back to optimistic UX */ });
  }, [token]);

  // Tour cleanup: remove mocked doc, restore faked state
  const tourCleanup = useCallback(() => {
    if (tutorialFileRef.current) {
      // Remove fake file from tree, clear editor
      const fakePath = tutorialFileRef.current;
      setFiles((prev) => prev.filter((f) => f.path !== fakePath));
      setActiveFile(null);
      setDocState(null);
      tutorialFileRef.current = null;
    }
    if (savedCommentsRef.current !== null) {
      setComments(savedCommentsRef.current);
      savedCommentsRef.current = null;
    }
    if (savedUpdatesRef.current !== null) {
      setUpdates(savedUpdatesRef.current);
      savedUpdatesRef.current = null;
      setView('workspace');
    }
    prevTourStepRef.current = null;
  }, []);

  const handleSkipTour = useCallback(() => {
    skipTour();
    tourCleanup();
  }, [skipTour, tourCleanup]);

  const handleCompleteTour = useCallback(() => {
    completeTour();
    tourCleanup();
  }, [completeTour, tourCleanup]);

  // Load updates, stars, and tours on auth
  const updatesLoadedRef = useRef(false);
  useEffect(() => {
    if (!token || updatesLoadedRef.current) return;
    updatesLoadedRef.current = true;

    Promise.all([api.getUpdates(), api.getStars(), api.getCompletedTours()])
      .then(([updatesData, starsData, toursData]) => {
        setUpdates(updatesData);
        setStars(starsData);
        setCompletedTours(toursData);

        // Best-effort: surface a sidebar lock cue when the shared zone is encrypted.
        // Failures are silent — encryption status is purely informational.
        api.getEncryptionPublicStatus()
          .then((s) => setSharedEncrypted(!!s.zones.shared))
          .catch(() => {});

        // Fire toasts for starred file changes
        const starredFiles = updatesData.starred.flatMap((g) => g.files);
        if (starredFiles.length > 0) {
          if (starredFiles.length <= 3) {
            for (const file of starredFiles) {
              const name = file.path.split('/').pop() || file.path;
              const user = file.user ? ` by ${file.user.split('@')[0]}` : '';
              addToast(`\u2605 ${name} was ${file.action}${user}`, 'info');
            }
          } else {
            addToast(`\u2605 ${starredFiles.length} starred files changed`, 'info');
          }
        }

      })
      .catch(() => { /* ignore */ });
  }, [token, addToast]);

  const handleMarkSeen = useCallback(async () => {
    await api.markUpdatesSeen();
    setUpdates(null);
    setView('workspace');
  }, []);

  /** Smart default folder for new-note shortcuts: parent of activeFile, or vault root. */
  const smartDefaultFolder = activeFile
    ? activeFile.split('/').slice(0, -1).join('/')
    : '';

  /** Create a note or folder at the given parent path; opens the new note in rename mode.
   *  openFile is referenced lazily; the binding is set later in this render so the closure
   *  captures the right value by the time the user invokes the callback. */
  const createItemRef = useRef<(kind: CreateKind, parentPath: string) => Promise<void>>(async () => {});
  const createItem = useCallback((kind: CreateKind, parentPath: string) => {
    return createItemRef.current(kind, parentPath);
  }, []);

  const handleNewFile = useCallback(() => {
    const isTourCreate = activeTour?.tour.id === 'essentials'
      && activeTour.tour.steps[activeTour.stepIndex]?.id === 'create-note';
    if (isTourCreate) {
      const username = currentUserRef.current?.split('@')[0] || 'user';
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const name = `Tutorial - ${username} - ${date}`;
      tutorialFileRef.current = name;
      setModal({
        title: 'New File',
        placeholder: 'File name',
        defaultValue: name,
        readOnly: true,
        onConfirm: () => {
          setModal(null);
          tutorialKeyRef.current++;
          setFiles((prev) => [...prev, { name, path: name, type: 'file' as const }]);
          setActiveFile(name);
          setDocState({ content: TUTORIAL_CONTENT, revision: 0 });
          window.history.pushState({ file: name }, '', buildDocUrlByPath(name));
          setTimeout(() => notifyAction('file-created'), 150);
        },
      });
      notifyAction('file-modal-opened');
      return;
    }
    createItem('note', smartDefaultFolder);
  }, [activeTour, notifyAction, createItem, smartDefaultFolder]);

  const handleToggleStar = useCallback(async (type: 'file' | 'folder', path: string) => {
    const existing = stars.find((s) => s.type === type && s.path === path);
    if (existing) {
      // Optimistic remove
      setStars((prev) => prev.filter((s) => s.id !== existing.id));
      try {
        await api.removeStar(existing.id);
      } catch {
        // Rollback
        setStars((prev) => [...prev, existing]);
      }
    } else {
      // Optimistic add
      const temp: StarredItem = { id: -Date.now(), userId: 0, type, path, createdAt: new Date().toISOString() };
      setStars((prev) => [...prev, temp]);
      try {
        const saved = await api.addStar(type, path);
        setStars((prev) => prev.map((s) => (s.id === temp.id ? saved : s)));
      } catch {
        setStars((prev) => prev.filter((s) => s.id !== temp.id));
      }
    }
  }, [stars, addToast]);

  // Open document. The URL bar always normalizes to `/doc/<handle-id>` once
  // the read response delivers the handle. Until then we push the legacy
  // `/doc/<path>` form so back/forward stays consistent.
  const openFile = useCallback(async (path: string, heading?: string, opts?: { replaceHistory?: boolean }) => {
    console.debug(`[App.openFile] Switching to file: "${path}", previous activeFile: "${activeFile}"`);
    setDocState(null); // Clear stale content so Editor unmounts until new content arrives
    setActiveFile(path);
    // Update the ref now rather than after render, so a rename followed both
    // via the HTTP response and the `doc:moved` frame opens the doc only once.
    activeFileRef.current = path;
    recordVisit(path);
    setPresenceUsers([]);
    setVersionPreview(null);
    setSelectedVersion(null);
    pendingHeadingRef.current = heading ?? headingFromUrl();

    // Initial push uses the legacy path form. We `replaceState` to /doc/<id>
    // as soon as the read returns the handle, so the user never sees the
    // path-form URL for more than one frame.
    const initialUrl = buildDocUrlByPath(path, heading);
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
    } else if (opts?.replaceHistory) {
      // Same doc under a new path (rename): don't leave a back entry pointing
      // at the old path.
      window.history.replaceState({ file: path }, '', initialUrl);
    } else {
      window.history.pushState({ file: path }, '', initialUrl);
    }

    const normalizeToHandle = (handleId: string) => {
      const url = buildDocUrlByHandle(handleId, heading) + window.location.search;
      const final = (heading || window.location.hash) && !url.includes('#')
        ? url + window.location.hash
        : url;
      window.history.replaceState({ file: path, handleId }, '', final);
    };

    // OT/REST fetches only apply to non-E2E paths. For `_secure/` paths the
    // SecureEditor handles its own fetch via /api/files/secure/read; we mark
    // docState as ready so the conditional render swaps to SecureEditor.
    if (isE2EEncrypted(path)) {
      setDocState({ content: '', revision: 0 });
      // Comments / backlinks / history skipped — the server returns 403/empty
      // for E2E paths and the SecureEditor banner already says comments are
      // disabled.
      return;
    }

    let resolved = false;

    const restFallback = async () => {
      try {
        const result = await api.readFile({ path });
        setDocState({ content: result.content, revision: 0 });
        if (result.handle?.id) normalizeToHandle(result.handle.id);
      } catch (err) {
        if (err instanceof api.PinLockedError) {
          setPinPrompt({ path, mode: 'verify', resumeOpen: true });
        }
      }
    };

    // Try WebSocket first for OT session
    if (wsRef.current) {
      await wsRef.current.ready;
      console.debug(`[App.openFile] Sending doc:open via WS for "${path}"`);
      wsRef.current.send({ type: 'doc:open', docId: path });

      const cleanup: Array<() => void> = [];
      const finish = () => { resolved = true; for (const off of cleanup) off(); };

      cleanup.push(wsRef.current.on('doc:opened', (msg: any) => {
        if (msg.docId === path && !resolved) {
          finish();
          console.debug(`[App.openFile] Received doc:opened for "${path}", revision=${msg.revision}, content length=${msg.content?.length}`);
          setDocState({ content: msg.content, revision: msg.revision, permission: msg.permission });
          if (msg.handle?.id) normalizeToHandle(msg.handle.id);
        }
      }));

      // OT gateway emits typed error frames for not_found / forbidden / e2e-no-collab
      // (e.g. read-only grantees, foreign-personal docIds, share-link views by an
      // authenticated user). Fall back to REST immediately instead of waiting the
      // safety-net timeout — which is the dominant cause of perceived slowness on
      // shared/public-vault file opens.
      cleanup.push(wsRef.current.on('error', (msg: any) => {
        if (msg?.docId === path && !resolved) {
          finish();
          console.debug(`[App.openFile] WS error code=${msg.code} for "${path}", falling back to REST`);
          void restFallback();
        }
      }));

      // Safety net: covers cases where the gateway drops the frame entirely
      // (e.g. unexpected disconnect mid-flight). 700ms is well above a healthy
      // round-trip but short enough to not feel laggy.
      setTimeout(() => {
        if (!resolved) {
          finish();
          console.warn(`[App.openFile] WS timeout for "${path}", falling back to REST API`);
          void restFallback();
        }
      }, 700);
    } else {
      // No WebSocket — use REST API directly
      await restFallback();
    }

    // Comments aren't on the editor's critical path; fetch in the background
    // and reset first so a stale list from the previous file doesn't show
    // through during the request.
    setComments([]);
    api.fetchComments(path)
      .then(setComments)
      .catch(() => { /* ignore — same as before */ });

    // Fetch backlink count for badge
    api.fetchBacklinks(path)
      .then((bl) => setBacklinkCount(bl.length))
      .catch(() => setBacklinkCount(0));

    // Fetch last-edited metadata for the doc header
    setDocAuthor(null);
    setDocUpdatedAt(null);
    api.fetchHistory(path)
      .then((entries) => {
        const latest = entries[0];
        if (latest) {
          setDocAuthor(latest.userEmail);
          setDocUpdatedAt(latest.createdAt);
        }
      })
      .catch(() => { /* ignore — header just omits those fields */ });
  }, []);

  // After `src` was renamed/moved to `dest`, re-open the active doc at its new
  // path if it was the moved file or lives under the moved folder. The server
  // re-keys the live session to the new path; only re-opening attaches the
  // editor to it — switching `activeFile` alone left edits going nowhere.
  const followActiveDocAfterMove = useCallback((src: string, dest: string) => {
    const current = activeFileRef.current;
    if (!current) return;
    let next: string | null = null;
    if (current === src) next = dest;
    else if (current.startsWith(src + '/')) next = dest + current.slice(src.length);
    if (next) void openFile(next, undefined, { replaceHistory: true });
  }, [openFile]);

  // Bind the create-item ref now that openFile is declared.
  createItemRef.current = async (kind: CreateKind, parentPath: string) => {
    try {
      const { path } = await api.createVaultItem(kind, parentPath);
      await loadFileTree();
      if (kind === 'note') {
        await openFile(path);
        setRenameRequestKey((k) => k + 1);
        // Record (don't yet show) the share-nudge: it'll fire on the first
        // OT save or the rename-away-from-Untitled, whichever comes first.
        await recordPendingShareNudge(parentPath, path);
      }
    } catch (err) {
      addToast((err as Error).message || `Failed to create ${kind}`, 'error');
    }
  };

  // Compute the "share with X?" intent for a freshly-created private note and
  // park it on the path. The nudge is rendered later by
  // `triggerPendingShareNudge` once the user shows commitment to the file
  // (typing → save, or renaming away from Untitled).
  const recordPendingShareNudge = useCallback(async (parentPath: string, newPath: string) => {
    // Accept the personal root itself ("_users/<me>") *and* any sub-folder
    // under it. Right-clicking the root row passes `parentPath` without a
    // trailing slash, so `startsWith(root + "/")` alone misses the case where
    // the new note sits directly in the personal root — which is the exact
    // configuration that should still suggest siblings shared with the same
    // grantee.
    const ownRoot = `${PERSONAL_PREFIX}${currentUserRef.current}`;
    if (!parentPath || (parentPath !== ownRoot && !parentPath.startsWith(`${ownRoot}/`))) return;
    try {
      const myGrants = await api.listGrants('grantor');
      const folderGrants = myGrants.filter((g) => g.path.startsWith(parentPath + '/'));
      if (folderGrants.length === 0) return;
      // Dominant (grantee, permission) by count of sibling grants.
      const counts = new Map<string, { count: number; permission: api.GrantPermission }>();
      for (const g of folderGrants) {
        const key = `${g.grantee_email}::${g.permission}`;
        const cur = counts.get(key);
        counts.set(key, { count: (cur?.count ?? 0) + 1, permission: g.permission });
      }
      let bestKey = '';
      let best = 0;
      for (const [k, v] of counts) {
        if (v.count > best) { best = v.count; bestKey = k; }
      }
      if (!bestKey) return;
      const [grantee, permission] = bestKey.split('::') as [string, api.GrantPermission];
      nudgeRegistryRef.current.record(newPath, { grantee, permission });
    } catch {
      // Silent — best-effort prompt
    }
  }, []);

  const triggerPendingShareNudge = useCallback((path: string) => {
    const entry = nudgeRegistryRef.current.take(path);
    if (!entry) return;
    const { grantee, permission } = entry;
    addToast(
      `${path.split('/').pop()} is private. Share with ${grantee} too?`,
      'info',
      {
        actionLabel: `Share ${permission}`,
        onAction: async () => {
          try {
            await api.mintGrant({ granteeEmail: grantee, path, permission });
            addToast(`Shared with ${grantee}`, 'info');
            loadFileTree();
          } catch (err) {
            addToast((err as Error).message || 'Failed to share', 'error');
          }
        },
      },
    );
  }, [addToast, loadFileTree]);
  useEffect(() => { triggerPendingShareNudgeRef.current = triggerPendingShareNudge; }, [triggerPendingShareNudge]);

  // Open file from URL on initial load (after auth)
  const initialOpenDone = useRef(false);
  useEffect(() => {
    if (!token || initialOpenDone.current) return;
    const parsed = parseDocUrl();
    if (!parsed) return;

    initialOpenDone.current = true;
    pendingHeadingRef.current = headingFromUrl();
    const threadId = threadIdFromUrl();
    if (threadId) {
      pendingThreadIdRef.current = threadId;
      setRailTab('comments');
    }
    isPopstateRef.current = true;

    if (parsed.handleId) {
      // /doc/<id> — read by handle, then open. openFile() will normalize
      // the address bar to /doc/<id> on its own (no-op here since we're
      // already there), but we need the path to drive the OT session.
      api.readFile({ handleId: parsed.handleId }).then((result) => {
        openFile(result.path);
      }).catch((err) => {
        if (err instanceof api.DocTombstonedError) {
          setTombstonedHandle({ handleId: parsed.handleId! });
          return;
        }
        // 404 or transport error: leave the user on the workspace home.
      });
    } else if (parsed.code) {
      // /s/<code> (or legacy /d/<code>) — resolve code to file path.
      // The cosmetic suffix (if any) was dropped by the parser; we never
      // recover from a gone code by opening a guessed path.
      api.resolveShareLink(parsed.code).then(({ path, requiresPin }) => {
        if (requiresPin) {
          setActiveFile(path);
          setPinPrompt({ path, mode: 'verify', resumeOpen: true });
          return;
        }
        openFile(path);
      }).catch((err) => {
        if (err instanceof api.ShareLinkGoneError) {
          setGoneShareLink({ code: parsed.code! });
        }
      });
    } else if (parsed.filePath) {
      // Legacy /doc/<file/path> URL — open file, openFile() normalizes the
      // URL to /doc/<id> as soon as the read returns the handle.
      openFile(parsed.filePath);
    }
  }, [token, openFile]);

  // Scroll to heading after document loads
  useEffect(() => {
    if (!docState || !pendingHeadingRef.current) return;
    const heading = pendingHeadingRef.current;
    pendingHeadingRef.current = null;
    // Double-rAF: first frame lets TipTap render, second frame scrolls
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(heading);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }, [docState]);

  // Navigate to comment thread after doc + comments load
  useEffect(() => {
    const threadId = pendingThreadIdRef.current;
    if (!threadId || !docState) return;

    const thread = comments.find((t) => t.id === threadId);
    if (!thread) return;

    pendingThreadIdRef.current = null;
    setHighlightThreadId(threadId);

    // Navigate editor to the quoted text
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!editorRef.current) return;
        if (thread.quotedText || thread.positionHint) {
          editorRef.current.navigateToComment(thread.quotedText, thread.positionHint);
        } else {
          const match = thread.blockId.match(/^selection-(\d+)-(\d+)$/);
          if (match) {
            editorRef.current.navigateToComment(undefined, { from: Number(match[1]), to: Number(match[2]) });
          }
        }
      });
    });

    // Clear highlight after a few seconds
    const timer = setTimeout(() => setHighlightThreadId(null), 3000);
    return () => clearTimeout(timer);
  }, [comments, docState]);

  // Browser back/forward navigation
  useEffect(() => {
    const handlePopstate = () => {
      const parsed = parseDocUrl();
      if (!parsed) {
        setActiveFile(null);
        setDocState(null);
        return;
      }

      isPopstateRef.current = true;

      if (parsed.handleId) {
        api.readFile({ handleId: parsed.handleId }).then((result) => {
          setGoneShareLink(null);
          setTombstonedHandle(null);
          openFile(result.path);
        }).catch((err) => {
          if (err instanceof api.DocTombstonedError) {
            setTombstonedHandle({ handleId: parsed.handleId! });
            return;
          }
          setActiveFile(null);
          setDocState(null);
        });
      } else if (parsed.code) {
        // /s/<code> (or legacy /d/<code>) — resolve code. Any cosmetic
        // suffix on a pre-deploy URL is silently ignored by the parser.
        api.resolveShareLink(parsed.code).then(({ path }) => {
          setGoneShareLink(null);
          setTombstonedHandle(null);
          openFile(path);
        }).catch((err) => {
          if (err instanceof api.ShareLinkGoneError) {
            setGoneShareLink({ code: parsed.code! });
            return;
          }
          setActiveFile(null);
          setDocState(null);
        });
      } else if (parsed.filePath) {
        setGoneShareLink(null);
        setTombstonedHandle(null);
        openFile(parsed.filePath);
      }
    };
    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [openFile]);

  // Quick-menu shortcuts: Cmd/Ctrl+K and double-Shift both toggle the search modal.
  // ⌘N creates at smart default; ⌘⇧N opens the create picker for the user to choose.
  useEffect(() => {
    let lastShiftTime = 0;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
        lastShiftTime = 0;
        return;
      }
      // Cmd-Shift-C: mint (if needed) + copy public link. Power-user shortcut
      // equivalent to the share dialog's copy button. Skipped while an input
      // or contenteditable surface owns the keyboard so it doesn't shadow
      // ordinary copy commands.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
        const target = e.target as HTMLElement | null;
        const inEditable = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName));
        if (inEditable) return;
        if (!activeFileRef.current) return;
        e.preventDefault();
        mintAndCopyPublicLinkRef.current?.();
        lastShiftTime = 0;
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'n') {
        // Don't intercept while a modal/contenteditable owns the keyboard
        const target = e.target as HTMLElement | null;
        const inEditable = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName));
        if (inEditable) return;
        e.preventDefault();
        if (e.shiftKey) {
          // Open picker anchored to the document (no specific anchor element).
          const fakeAnchor = document.querySelector('.kp-newbtn-split__chevron') as HTMLElement | null;
          if (fakeAnchor) setCreatePicker({ kind: 'note', anchor: fakeAnchor });
        } else {
          handleNewFile();
        }
        lastShiftTime = 0;
        return;
      }
      if (e.key === 'Shift' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        if (now - lastShiftTime < 400) {
          e.preventDefault();
          setSearchOpen((open) => !open);
          lastShiftTime = 0;
        } else {
          lastShiftTime = now;
        }
      } else {
        lastShiftTime = 0;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewFile]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const contextMenuItems = (() => {
    if (!contextMenu) return [] as import('./components/ContextMenu').ContextMenuItem[];
    const entry = contextMenu.entry;
    const isFolder = entry?.type === 'directory';
    const dir = isFolder ? entry!.path : '';
    const isPersonalRoot = !!entry && isPersonalRootSegment(entry.path);

    const renameAction = () => {
      if (!entry) return;
      setModal({
        title: 'Rename',
        placeholder: 'New name',
        defaultValue: entry.name,
        onConfirm: async (newName) => {
          if (newName !== entry.name) {
            const parent = entry.path.split('/').slice(0, -1).join('/');
            const dest = parent ? `${parent}/${newName}` : newName;
            try {
              await api.moveFile(entry.path, dest);
            } catch (err) {
              // Keep the modal open so the name can be corrected.
              addToast((err as Error).message || 'Rename failed', 'error');
              return;
            }
            followActiveDocAfterMove(entry.path, dest);
            loadFileTree();
          }
          setModal(null);
        },
      });
    };

    const deleteAction = () => {
      if (!entry) return;
      const deleteFn = entry.type === 'directory' ? api.deleteDirectory : api.deleteFile;
      deleteFn(entry.path).then(loadFileTree);
    };

    const copyPathAction = () => {
      if (!entry) return;
      navigator.clipboard?.writeText(entry.path).then(
        () => addToast('Path copied to clipboard', 'info'),
        () => addToast('Could not copy path', 'error'),
      );
    };

    const ownPersonalPrefix = `${PERSONAL_PREFIX}${currentUserRef.current}/`;
    const isOwnedPersonal = entry?.path.startsWith(ownPersonalPrefix) ?? false;
    const collectMarkdownDescendants = (e: FileEntry): string[] => {
      const out: string[] = [];
      const walk = (n: FileEntry) => {
        if (n.type === 'file' && n.path.endsWith('.md')) out.push(n.path);
        if (n.children) for (const c of n.children) walk(c);
      };
      walk(e);
      return out;
    };

    if (isFolder) {
      if (isPersonalRoot) {
        // Personal root: only you can see this folder. Hide rename/delete/move-to-trash.
        return [
          { type: 'header' as const, label: 'Personal' },
          { label: 'New note here', action: () => createItem('note', dir) },
          { label: 'New folder here', action: () => createItem('folder', dir) },
          { type: 'separator' as const },
          { label: 'Copy path', action: copyPathAction },
        ];
      }
      const folderItems: import('./components/ContextMenu').ContextMenuItem[] = [
        { type: 'header' as const, label: entry!.name },
        { label: 'New note here', action: () => createItem('note', dir) },
        { label: 'New folder here', action: () => createItem('folder', dir) },
        { type: 'separator' as const },
        { label: 'Rename…', action: renameAction },
        { label: 'Copy path', action: copyPathAction },
      ];
      if (isOwnedPersonal && entry) {
        const targets = collectMarkdownDescendants(entry);
        if (targets.length > 0) {
          folderItems.push({
            label: `Share folder… (${targets.length} ${targets.length === 1 ? 'file' : 'files'})`,
            action: () => setShareDialog({ path: entry.path, isFolder: true, targetPaths: targets }),
          });
        }
      }
      folderItems.push({ label: 'Delete folder…', action: deleteAction, danger: true });
      return folderItems;
    }

    // Files / empty-tree fallback
    const items: import('./components/ContextMenu').ContextMenuItem[] = [
      { label: 'New note', action: () => createItem('note', '') },
      { label: 'New folder', action: () => createItem('folder', '') },
    ];
    if (entry) {
      const isMd = entry.type === 'file' && entry.path.endsWith('.md');
      // Stage-2 carve-out mirror: hide Set/Change/Remove PIN actions for paths
      // under `_secure/`. The server rejects them anyway with 400, but the menu
      // should not advertise an action that always fails.
      const isE2EPath = entry.path.includes('/_secure/') || entry.path.endsWith('/_secure');
      if (isMd && !isE2EPath) {
        const hasPin = pinnedPaths.has(entry.path);
        items.push(
          { type: 'separator' as const },
          {
            label: hasPin ? 'Change PIN…' : 'Set PIN…',
            action: () => setPinPrompt({ path: entry.path, mode: 'set', changing: hasPin }),
          },
        );
        if (hasPin) {
          items.push({
            label: 'Remove PIN',
            action: async () => {
              try {
                await api.removeNotePin(entry.path);
                setPinnedPaths((prev) => {
                  const next = new Set(prev);
                  next.delete(entry.path);
                  return next;
                });
                addToast('PIN removed', 'info');
              } catch (err) {
                addToast((err as Error).message || 'Failed to remove PIN', 'error');
              }
            },
          });
        }
      }
      const isE2EPathForShare = entry.path.includes('/_secure/') || entry.path.endsWith('/_secure');
      if (entry.type === 'file' && entry.path.endsWith('.md') && isOwnedPersonal && !isE2EPathForShare) {
        items.push(
          { type: 'separator' as const },
          { label: 'Share file…', action: () => setShareDialog({ path: entry.path, isFolder: false }) },
        );
      }
      // Move-into-/-out-of-`_secure/` actions only on personal-owned single
      // files (not directories — moving a folder needs a multi-file flow that
      // we haven't shipped yet). Gated by SECURE_FOLDER_ENABLED — when off,
      // neither entry appears.
      if (SECURE_FOLDER_ENABLED && entry.type === 'file' && entry.path.endsWith('.md') && isOwnedPersonal) {
        if (isE2EPathForShare) {
          items.push(
            { type: 'separator' as const },
            { label: 'Move out of Encrypted Folder…', action: () => setMoveSecureDialog({ kind: 'from', src: entry.path }) },
          );
        } else {
          items.push(
            { type: 'separator' as const },
            { label: 'Move to Encrypted Folder…', action: () => setMoveSecureDialog({ kind: 'to', src: entry.path }) },
          );
        }
      }
      items.push(
        { type: 'separator' as const },
        { label: 'Rename…', action: renameAction },
        { label: 'Copy path', action: copyPathAction },
        { label: 'Delete', action: deleteAction, danger: true },
      );
    }
    return items;
  })();

  // Cmd-Shift-C power-user shortcut: mint (if needed) + copy. Equivalent to
  // the public-link panel's "Generate" + "Copy" sequence. Bypasses the dialog
  // for users who already know what they're doing.
  const mintAndCopyPublicLink: () => Promise<void> = useCallback(async () => {
    if (!activeFile) return;
    try {
      const existing = await api.findShareLinkByPath(activeFile);
      const isActive =
        !!existing &&
        existing.revoked_at === null &&
        (existing.expires_at === null || existing.expires_at > Date.now());
      let code: string;
      if (existing && isActive) {
        code = existing.code;
      } else {
        const minted = await api.mintShareLink({ path: activeFile });
        code = minted.code;
      }
      // The address bar stays on `/doc/<handle-id>` regardless — minting a
      // public link is no longer a navigation action. The clipboard receives
      // the path-free recipient URL only.
      const url = buildShareLinkUrl(activeFile, code);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        addToast('Public link copied to clipboard', 'info');
      } else {
        addToast(url, 'info');
      }
    } catch (err) {
      addToast((err as Error).message || 'Could not copy public link', 'error');
    }
  }, [activeFile, addToast]);

  useEffect(() => {
    mintAndCopyPublicLinkRef.current = mintAndCopyPublicLink;
  }, [mintAndCopyPublicLink]);

  // Toolbar Share button: opens the dialog (single source of truth for public
  // and per-recipient sharing). The dialog explains the public-link contract
  // before the user hits "Generate", removing the need for a separate confirm.
  const handleShare = useCallback(() => {
    if (!activeFile) return;
    setShareDialog({ path: activeFile, isFolder: false });
  }, [activeFile]);

  // Reset version-history state whenever the user leaves the History tab.
  useEffect(() => {
    if (railTab !== 'history') {
      setSelectedVersion(null);
      setVersionPreview(null);
      setVersionPartial(false);
    }
  }, [railTab]);

  // Rename the active doc by renaming its file. Keeps the .md extension and
  // the parent directory; caller supplies the new base title.
  const renameActiveDoc = useCallback(async (newTitle: string): Promise<boolean> => {
    const current = activeFileRef.current;
    if (!current) return false;
    const dir = current.split('/').slice(0, -1).join('/');
    const dest = (dir ? `${dir}/` : '') + newTitle.replace(/[\\/]/g, '-') + (current.endsWith('.md') ? '.md' : '');
    if (dest === current) return false;
    try {
      await api.moveFile(current, dest);
    } catch (err) {
      addToast((err as Error).message || 'Rename failed', 'error');
      return false;
    }
    // Move any pending share-nudge from the old path to the new one, then
    // trigger it: a rename away from "Untitled note" is the user's commitment
    // signal, and it takes precedence over the save-driven trigger.
    if (nudgeRegistryRef.current.rekey(current, dest)) {
      triggerPendingShareNudge(dest);
    }
    followActiveDocAfterMove(current, dest);
    loadFileTree();
    return true;
  }, [addToast, loadFileTree, triggerPendingShareNudge, followActiveDocAfterMove]);

  // OAuth consent route — short-circuits the workspace render so unauthenticated
  // users get the consent-aware login flow (which round-trips back to this URL
  // after magic-link auth).
  const consentRoute = parseConsentRoute();
  if (consentRoute) {
    return <OAuthConsentPage requestId={consentRoute.requestId} isAuthenticated={!!token} />;
  }

  // Not authenticated. Two branches:
  //  - URL is `/s/<code>...` (or legacy `/d/<code>...`): render the public
  //    guest viewer. The user can sign in from there if they want the full
  //    workspace.
  //  - Otherwise: classic login page.
  if (!token) {
    const parsed = parseDocUrl();
    if (parsed?.code) {
      return <GuestDocView code={parsed.code} />;
    }
    return <LoginPage onLogin={async (email) => {
      await requestMagicLink(email, window.location.pathname + window.location.search + window.location.hash);
    }} />;
  }

  // The /d/<code>/... URL the user followed is no longer active. We give the
  // owner a path back to their workspace; everyone else lands here too — the
  // server only tells us the link is gone, not whether the viewer is the owner.
  if (goneShareLink) {
    return (
      <div className="share-link-gone">
        <div className="share-link-gone-card">
          <h1 className="share-link-gone-title">This link is no longer active</h1>
          <p className="share-link-gone-message">
            The owner may have revoked it, or it may have expired. If you have
            access to the underlying note, open it from your workspace.
          </p>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            onClick={() => {
              setGoneShareLink(null);
              window.history.replaceState({}, '', '/');
            }}
          >
            Go to workspace
          </button>
        </div>
      </div>
    );
  }

  // The /doc/<id> URL pointed at a note that has since been deleted. Distinct
  // from share-link-gone (which is about the link's lifecycle, not the file's).
  if (tombstonedHandle) {
    console.warn(`[doc-tombstone] handle=${tombstonedHandle.handleId} resolved 410`);
    return (
      <div className="share-link-gone">
        <div className="share-link-gone-card">
          <h1 className="share-link-gone-title">This note no longer exists</h1>
          <p className="share-link-gone-message">
            The link you followed points to a note that has been deleted. If
            you think this was a mistake, ask the person who shared the link.
          </p>
          <button
            type="button"
            className="modal-btn modal-btn-confirm"
            onClick={() => {
              setTombstonedHandle(null);
              window.history.replaceState({}, '', '/');
            }}
          >
            Go to workspace
          </button>
        </div>
      </div>
    );
  }

  const railShown = tweak.rail && view === 'workspace' && activeFile;
  const statusShown = view === 'workspace' && !!activeFile && !!docState;
  const openCommentCount = comments.filter((t) => !t.resolved).length;
  // Auto-collapse the rail when the current note has nothing to show there.
  // History is always available, but it's a power-user surface — don't keep
  // the panel expanded just for it. User toggles override the heuristic until
  // they switch files.
  const railAutoCollapsed = openCommentCount === 0 && backlinkCount === 0;
  const railCollapsed = railShown ? (railCollapseOverride ?? railAutoCollapsed) : false;
  const workspaceClass = [
    'workspace',
    tweak.sidebar ? '' : 'no-sidebar',
    !railShown ? 'no-rail' : '',
    railCollapsed ? 'rail-collapsed' : '',
    statusShown ? '' : 'no-status',
  ].filter(Boolean).join(' ');

  return (
    <div className={workspaceClass}>
      <TopBar
        activeFile={activeFile}
        docContent={docState?.content}
        presenceUsers={presenceUsers}
        onUserClick={(userId) => editorRef.current?.scrollToUser(userId)}
        updates={updates}
        changesActive={view === 'changes'}
        onOpenChanges={() => {
          setView(view === 'changes' ? 'workspace' : 'changes');
          notifyAction('changes-opened');
        }}
        onOpenSearch={() => setSearchOpen(true)}
        canShare={!!activeFile}
        onShare={handleShare}
        completedTours={completedTours}
        onStartTour={(id) => { setView('workspace'); startTour(id); }}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        tweaksActive={tweaksOpen}
        onOpenTweaks={() => setTweaksOpen((v) => !v)}
        settingsActive={view === 'settings'}
        onOpenSettings={() => setView(view === 'settings' ? 'workspace' : 'settings')}
        onDownloadVault={() => api.downloadVaultZip().catch(() => addToast('Failed to download vault', 'error'))}
      />

      {/* Sidebar */}
      <aside className={`sidebar ${tweak.sidebar ? '' : 'collapsed'}`}>
        <VaultHeader
          defaultFolder={smartDefaultFolder}
          onCreateAtDefault={handleNewFile}
          onOpenNotePicker={(anchor) => setCreatePicker({ kind: 'note', anchor })}
          onOpenFolderPicker={(anchor) => setCreatePicker({ kind: 'folder', anchor })}
        />
        {tweak.sidebar && (
          <>
            <div className="sidebar-search">
              <input
                type="text"
                placeholder="Filter files…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="sidebar-sections">
              <StarredSection stars={stars} activePath={activeFile} onOpen={(p) => { setView('workspace'); openFile(p); }} />
              <RecentSection activePath={activeFile} onOpen={(p) => { setView('workspace'); openFile(p); }} />
            </div>
            {(() => {
              const handleRename = async (entry: FileEntry, newName: string) => {
                const dir = entry.path.split('/').slice(0, -1).join('/');
                const dest = dir ? `${dir}/${newName}` : newName;
                try {
                  await api.moveFile(entry.path, dest);
                } catch (err) {
                  addToast((err as Error).message || 'Rename failed', 'error');
                  return;
                }
                followActiveDocAfterMove(entry.path, dest);
                loadFileTree();
              };
              const handleMove = async (src: string, dest: string) => {
                try {
                  await api.moveFile(src, dest);
                } catch (err) {
                  addToast((err as Error).message || 'Move failed', 'error');
                  return;
                }
                followActiveDocAfterMove(src, dest);
                await loadFileTree();
              };
              const commonProps = {
                files,
                activeFile,
                onFileSelect: (path: string) => { setView('workspace'); openFile(path); },
                onMove: handleMove,
                onRename: handleRename,
                onContextMenu: handleContextMenu,
                searchQuery,
                stars,
                onToggleStar: handleToggleStar,
                onCreateInFolder: (kind: 'note' | 'folder', folder: string) => createItem(kind, folder),
                currentUserEmail: currentUserRef.current,
                onToast: addToast,
                onSecureFolderActivate: handleSecureFolderActivate,
              };
              const partitioned = partitionTree(files);
              const hasPersonal = !!partitioned.personalRoot;
              const hasSharedWithMe = !!partitioned.sharedWithMeRoot;
              return (
                <>
                  {hasPersonal && (
                    <>
                      <div className="sidebar-sections">
                        <SidebarSectionTitle>Personal</SidebarSectionTitle>
                      </div>
                      <FileTree {...commonProps} section="personal" />
                    </>
                  )}
                  {hasSharedWithMe && (
                    <>
                      <div className="sidebar-sections">
                        <SidebarSectionTitle>Shared with me</SidebarSectionTitle>
                      </div>
                      <FileTree {...commonProps} section="shared-with-me" />
                    </>
                  )}
                  <div className="sidebar-sections">
                    <SidebarSectionTitle>
                      Vault
                      {sharedEncrypted && (
                        <Icon
                          name="lock"
                          size={12}
                          className="vault-lock-icon"
                          title="Shared vault is encrypted at rest"
                        />
                      )}
                    </SidebarSectionTitle>
                  </div>
                  <FileTree {...commonProps} section="shared" />
                </>
              );
            })()}
          </>
        )}
      </aside>

      {view === 'settings' ? (
        <SettingsPage
          onBack={() => setView('workspace')}
          completedTours={completedTours}
          onStartTour={(id) => { setView('workspace'); startTour(id); }}
        />
      ) : view === 'graph' ? (
        <GraphView
          onBack={() => setView('workspace')}
          onNavigate={(path) => {
            setView('workspace');
            openFile(path);
          }}
          initialCenter={activeFile || undefined}
        />
      ) : view === 'changes' ? (
        updates ? (
          <ChangesPanel
            updates={updates}
            onNavigate={(path) => {
              setView('workspace');
              openFile(path);
            }}
            onMarkSeen={handleMarkSeen}
            onClose={() => setView('workspace')}
          />
        ) : (
          <main className="changes-pane">
            <div className="changes-pane-header">
              <button className="changes-pane-back" onClick={() => setView('workspace')}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 3L5 8l5 5" />
                </svg>
                Back
              </button>
              <h2>What's changed</h2>
              <span />
            </div>
            <div className="changes-empty">No changes since your last visit</div>
          </main>
        )
      ) : (
        <>
          {/* Main editor area */}
          <main className="editor-area">
            {versionPreview !== null && activeFile && (
              <div className={`version-preview-banner${versionPartial ? ' version-preview-banner--partial' : ''}`}>
                {versionPartial
                  ? 'Could not fully reconstruct this version — some changes were lost'
                  : `Viewing historical version${selectedVersion ? ` — ${new Date(selectedVersion.createdAt).toLocaleString()}` : ''}`
                }
                <button className="version-preview-back" onClick={() => { setVersionPreview(null); setSelectedVersion(null); setVersionPartial(false); }}>
                  Back to current
                </button>
              </div>
            )}
            {activeFile && isE2EEncrypted(activeFile) ? (
              SECURE_FOLDER_ENABLED ? (
                <SecureEditor path={activeFile} />
              ) : (
                // Defensive: stray deep-link / devtool path under `_secure/`
                // when the UI is gated. Avoid mounting the editor (which would
                // advertise the hidden feature) — show a neutral placeholder.
                <div className="secure-editor-unavailable" style={{ padding: 24, color: 'var(--text-muted, #888)' }}>
                  This content is not available.
                </div>
              )
            ) : activeFile && docState && wsRef.current ? (
              <EditorErrorBoundary fileKey={`${activeFile}-${tutorialKeyRef.current}`}>
                <KalepinEditor
                  ref={editorRef}
                  key={`${activeFile}-${tutorialKeyRef.current}`}
                  wsClient={wsRef.current}
                  docId={activeFile}
                  initialContent={docState.content}
                  initialRevision={docState.revision}
                  permission={docState.permission}
                  activeFile={activeFile}
                  previewContent={versionPreview}
                  comments={comments}
                  currentUser={currentUserRef.current}
                  onAddComment={(blockId, text, quotedText, positionHint) => {
                    api.addComment(activeFile!, blockId, text, quotedText, positionHint).then(() =>
                      api.fetchComments(activeFile!).then(setComments),
                    );
                  }}
                  onOpenComments={() => { setRailTab('comments'); }}
                  onSelectThread={(threadId) => {
                    setRailTab('comments');
                    setHighlightThreadId(threadId);
                    setTimeout(() => setHighlightThreadId(null), 3000);
                    // Navigate editor to the comment's quoted text
                    const thread = comments.find((t) => t.id === threadId);
                    if (thread && editorRef.current) {
                      if (thread.quotedText || thread.positionHint) {
                        editorRef.current.navigateToComment(thread.quotedText, thread.positionHint);
                      } else {
                        const match = thread.blockId.match(/^selection-(\d+)-(\d+)$/);
                        if (match) {
                          editorRef.current.navigateToComment(undefined, { from: Number(match[1]), to: Number(match[2]) });
                        }
                      }
                    }
                  }}
                  onNotifyAction={notifyAction}
                  onNavigate={openFile}
                  files={files}
                  onSaveStatusChange={setSaveStatus}
                  onRevisionChange={setDocRevision}
                  onWordCountChange={setWordCount}
                  authorEmail={docAuthor}
                  updatedAt={docUpdatedAt}
                  wordCount={wordCount}
                  backlinkCount={backlinkCount}
                  presenceUsers={presenceUsers}
                  onRename={renameActiveDoc}
                  onRenameError={(msg) => addToast(msg, 'error')}
                  focusThreadId={highlightThreadId}
                  minimapEnabled={tweak.minimap}
                  renameRequestKey={renameRequestKey}
                />
              </EditorErrorBoundary>
            ) : (
              <div className="editor-placeholder">
                <p>Select a file or create a new one to get started</p>
              </div>
            )}
          </main>

          {/* Right rail — single tabbed panel for all per-doc context */}
          {activeFile && (
            <RightRail
              tab={railTab}
              onTabChange={setRailTab}
              commentCount={openCommentCount}
              backlinkCount={backlinkCount}
              showActivity={
                // Owner-or-admin gate. Personal paths owned by the current
                // user qualify; admins see the tab on every path.
                isAdmin ||
                (!!currentUserRef.current &&
                  activeFile.startsWith(`${PERSONAL_PREFIX}${currentUserRef.current}/`))
              }
              collapsed={railCollapsed}
              onToggleCollapse={() => setRailCollapseOverride(!railCollapsed)}
            >
              <div className="kp-rail-panel" hidden={railTab !== 'comments'}>
                <CommentsPanel
                  threads={comments}
                  currentUser={currentUserRef.current}
                  highlightThreadId={highlightThreadId}
                  personalNote={!!activeFile && activeFile.startsWith(PERSONAL_PREFIX)}
                  e2eEncrypted={!!activeFile && isE2EEncrypted(activeFile)}
                  onAddComment={(blockId, text) => {
                    api.addComment(activeFile!, blockId, text).then(() =>
                      api.fetchComments(activeFile!).then(setComments),
                    );
                  }}
                  onReply={(blockId, threadId, text) => {
                    api.replyToComment(activeFile!, blockId, threadId, text).then(() =>
                      api.fetchComments(activeFile!).then(setComments),
                    );
                  }}
                  onResolve={(blockId, threadId, resolved) => {
                    api.resolveComment(activeFile!, blockId, threadId, resolved).then(() =>
                      api.fetchComments(activeFile!).then(setComments),
                    );
                  }}
                  onDelete={(blockId, threadId, commentId) => {
                    api.deleteComment(activeFile!, blockId, threadId, commentId).then(() =>
                      api.fetchComments(activeFile!).then(setComments),
                    );
                  }}
                  onNavigate={(thread) => {
                    if (!editorRef.current) return;
                    if (thread.quotedText || thread.positionHint) {
                      editorRef.current.navigateToComment(thread.quotedText, thread.positionHint);
                    } else {
                      const match = thread.blockId.match(/^selection-(\d+)-(\d+)$/);
                      if (match) {
                        editorRef.current.navigateToComment(undefined, { from: Number(match[1]), to: Number(match[2]) });
                      }
                    }
                  }}
                />
              </div>
              {railTab === 'backlinks' && (
                <BacklinksPanel
                  activeFile={activeFile}
                  onNavigate={(path) => openFile(path)}
                  onPopOutGraph={() => setView('graph')}
                />
              )}
              {railTab === 'activity' && (
                <ActivityPanel activeFile={activeFile} />
              )}
              {railTab === 'history' && (
                <VersionHistoryPanel
                  activeFile={activeFile}
                  selectedVersion={selectedVersion}
                  onSelectVersion={setSelectedVersion}
                  onRestore={(entry) => {
                    api.restoreVersion(activeFile, entry.id)
                      .then(() => {
                        addToast('Version restored', 'info');
                        setVersionPreview(null);
                        setSelectedVersion(null);
                        setVersionPartial(false);
                        openFile(activeFile);
                      })
                      .catch((err) => addToast(err.message, 'error'));
                  }}
                  onViewVersion={(content, entry, partial) => {
                    if (!content && !partial && selectedVersion?.id === entry.id) {
                      setVersionPreview(null);
                      setVersionPartial(false);
                    } else {
                      setVersionPreview(content || '');
                      setVersionPartial(partial);
                    }
                  }}
                />
              )}
            </RightRail>
          )}
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Modal */}
      {modal && (
        <InputModal
          title={modal.title}
          placeholder={modal.placeholder}
          defaultValue={modal.defaultValue}
          readOnly={modal.readOnly}
          onConfirm={modal.onConfirm}
          onCancel={() => setModal(null)}
        />
      )}

      {/* PIN dialog (set / verify) */}
      {pinPrompt && (
        <PinDialog
          {...(pinPrompt.mode === 'set'
            ? { mode: 'set' as const, path: pinPrompt.path, changing: pinPrompt.changing }
            : { mode: 'verify' as const, path: pinPrompt.path })}
          onClose={() => setPinPrompt(null)}
          onSuccess={() => {
            const closing = pinPrompt;
            setPinPrompt(null);
            if (closing.mode === 'set') {
              setPinnedPaths((prev) => new Set(prev).add(closing.path));
              addToast('PIN saved', 'info');
            } else if (closing.mode === 'verify' && (closing as { resumeOpen?: boolean }).resumeOpen) {
              openFile(closing.path);
            }
          }}
        />
      )}

      {/* Encrypted Folder setup / unlock — fired by the sidebar placeholder.
          Outer flag guard prevents mounting via stale state on a flag-off build. */}
      {SECURE_FOLDER_ENABLED && secureDialog?.kind === 'setup' && (
        <PassphraseSetupDialog
          onCancel={() => setSecureDialog(null)}
          onComplete={() => {
            setSecureDialog(null);
            void reloadVaultMeta();
            void loadFileTree();
            addToast('Encrypted Folder ready.', 'info');
          }}
        />
      )}
      {SECURE_FOLDER_ENABLED && secureDialog?.kind === 'unlock' && (
        <PassphrasePromptDialog
          onCancel={() => setSecureDialog(null)}
          onUnlock={() => {
            setSecureDialog(null);
            void loadFileTree();
          }}
        />
      )}

      {/* Move-to-_secure / move-out dialogs */}
      {moveSecureDialog?.kind === 'to' && (
        <MoveToSecureDialog
          src={moveSecureDialog.src}
          defaultDest={(() => {
            const filename = moveSecureDialog.src.split('/').pop() || '';
            return `_users/${currentUserRef.current}/_secure/${filename}`;
          })()}
          myEmail={currentUserRef.current}
          onCancel={() => setMoveSecureDialog(null)}
          onDone={() => {
            const dest = `_users/${currentUserRef.current}/_secure/${moveSecureDialog.src.split('/').pop()}`;
            setMoveSecureDialog(null);
            addToast('Moved to Encrypted Folder. Server can no longer read this file.', 'info');
            void loadFileTree();
            if (activeFile === moveSecureDialog.src) openFile(dest);
          }}
        />
      )}
      {moveSecureDialog?.kind === 'from' && (
        <MoveFromSecureDialog
          src={moveSecureDialog.src}
          defaultDest={(() => {
            const filename = moveSecureDialog.src.split('/').pop() || '';
            return `_users/${currentUserRef.current}/${filename}`;
          })()}
          myEmail={currentUserRef.current}
          onCancel={() => setMoveSecureDialog(null)}
          onDone={() => {
            const dest = `_users/${currentUserRef.current}/${moveSecureDialog.src.split('/').pop()}`;
            setMoveSecureDialog(null);
            addToast('Moved out of Encrypted Folder. The file is now server-readable again.', 'info');
            void loadFileTree();
            if (activeFile === moveSecureDialog.src) openFile(dest);
          }}
        />
      )}

      {/* Share dialog (per-file user-to-user grants + public link panel) */}
      {shareDialog && (
        <ShareDialog
          path={shareDialog.path}
          targetPaths={shareDialog.targetPaths}
          isFolder={shareDialog.isFolder}
          currentUserEmail={currentUserRef.current}
          isAdmin={isAdmin}
          hasPin={pinnedPaths.has(shareDialog.path)}
          onManagePin={() => {
            // Reuse the same PinDialog flow the file-tree context menu uses.
            // Setting a PIN on the path also gates authenticated reads —
            // share-links are only one of several access surfaces for it.
            setPinPrompt({
              path: shareDialog.path,
              mode: 'set',
              changing: pinnedPaths.has(shareDialog.path),
            });
          }}
          onClose={() => setShareDialog(null)}
          onShared={(count) => {
            addToast(`Shared ${count} ${count === 1 ? 'file' : 'files'}`, 'info');
            loadFileTree();
          }}
          onCodeMinted={(_code) => {
            // The address bar stays on `/doc/<handle-id>` after minting — the
            // recipient URL `/s/<code>` is delivered via clipboard / native
            // share, not by rewriting the in-app URL bar.
          }}
        />
      )}

      {/* Confirm modal (e.g., share-link from a personal note) */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Search modal */}
      {searchOpen && (
        <SearchModal
          onSelect={(path, heading, threadId) => {
            if (threadId) {
              pendingThreadIdRef.current = threadId;
              setRailTab('comments');
            }
            openFile(path, heading);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Tour coach mark */}
      {activeTour && (
        <CoachMark
          step={activeTour.tour.steps[activeTour.stepIndex]}
          stepIndex={activeTour.stepIndex}
          totalSteps={activeTour.tour.steps.length}
          onNext={nextStep}
          onSkip={handleSkipTour}
          onDone={handleCompleteTour}
          isLast={activeTour.stepIndex === activeTour.tour.steps.length - 1}
        />
      )}

      {/* Tweaks panel */}
      {tweaksOpen && (
        <TweaksPanel
          state={tweak}
          setState={setTweak}
          onClose={() => setTweaksOpen(false)}
        />
      )}

      {/* Create folder/note picker popover */}
      {createPicker && (
        <CreatePopover
          kind={createPicker.kind}
          files={files}
          defaultFolder={smartDefaultFolder}
          currentUserEmail={currentUserRef.current}
          anchorRef={{ current: createPicker.anchor }}
          onConfirm={(folderPath) => {
            createItem(createPicker.kind, folderPath);
            setCreatePicker(null);
          }}
          onClose={() => setCreatePicker(null)}
        />
      )}

      {/* Toasts */}
      <ToastContainer messages={toasts} onDismiss={dismissToast} />

      {statusShown ? (
        <StatusBar
          saveStatus={saveStatus}
          revision={docRevision}
          collaboratorCount={presenceUsers.length + 1}
          wordCount={wordCount}
        />
      ) : (
        <footer className="workspace-statusbar" />
      )}
    </div>
  );
}
