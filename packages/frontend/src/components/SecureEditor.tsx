import React, { useEffect, useRef, useState } from 'react';
import { readSecureNote, writeSecureNote, VaultLockedError } from '../crypto/secure-io';
import { isRecoveryUnlockPending } from '../crypto/recovery-pending';
import { PassphrasePromptDialog } from './PassphrasePromptDialog';
import { SecureOnboardingModal, shouldShowSecureOnboarding } from './SecureOnboardingModal';
import { SECURE_FOLDER_ENABLED } from '../feature-flags';
import { Icon } from './Icon';
import { SecureDraft, type SaveState } from './secure-draft';

interface Props {
  path: string;
  onUnlockNeeded?: () => void;
}

/**
 * Minimal editor for E2E `_secure/` notes. Concurrent editing is intentionally
 * disabled (the OT gateway rejects `doc:open` for these paths anyway), so
 * this component skips the WebSocket entirely. Edits buffer locally and
 * upload as a single encrypted envelope on a debounced timer or explicit
 * Cmd+S / "Save" press.
 *
 * The richer Tiptap-based Editor stays the path for non-E2E notes; we don't
 * try to share that surface here because every collaborative affordance —
 * presence, comments, OT — would need a carve-out branch deep inside it.
 */
export function SecureEditor({ path }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => SECURE_FOLDER_ENABLED && shouldShowSecureOnboarding());
  // The open note's read and unsaved edits, bound to its path (see SecureDraft).
  const draftRef = useRef<SecureDraft | null>(null);

  const reload = (draft = draftRef.current) => {
    if (!draft) return;
    setLoadError(null);
    draft.load()
      .then((text) => {
        if (text === null) return; // the note was left, or re-read, meanwhile
        setContent(text);
        setSaveState('idle');
      })
      .catch((err) => {
        if (err instanceof VaultLockedError) {
          setNeedsUnlock(true);
          return;
        }
        setLoadError((err as Error).message || 'Failed to load note');
      });
  };

  useEffect(() => {
    setContent(null);
    setNeedsUnlock(false);
    setLoadError(null);
    setSaveState('idle');
    setSaveError(null);
    const draft = new SecureDraft({
      path,
      read: readSecureNote,
      write: writeSecureNote,
      onState: (state, err) => {
        setSaveState(state);
        if (state === 'saving') setSaveError(null);
        if (state !== 'error') return;
        if (err instanceof VaultLockedError) {
          setNeedsUnlock(true);
          setSaveError('Vault is locked. Unlock to save.');
          return;
        }
        setSaveError((err as Error).message || 'Save failed');
      },
    });
    draftRef.current = draft;
    reload(draft);
    return () => {
      if (draftRef.current === draft) draftRef.current = null;
      // Leaving the note: save its pending edits to its own path.
      void draft.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setContent(next);
    draftRef.current?.edit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+S → flush immediately.
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void draftRef.current?.flush();
    }
  };

  if (showOnboarding) {
    return <SecureOnboardingModal onDismiss={() => setShowOnboarding(false)} />;
  }
  if (needsUnlock) {
    return (
      <PassphrasePromptDialog
        path={path}
        onUnlock={() => {
          setNeedsUnlock(false);
          reload();
        }}
        onCancel={() => setNeedsUnlock(false)}
      />
    );
  }

  return (
    <div className="secure-editor" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {isRecoveryUnlockPending() && (
        <div className="secure-editor-error" role="alert">
          Your vault is unlocked via recovery phrase only — set a new passphrase in Settings → Security before continuing.
        </div>
      )}
      <div className="secure-editor-banner" role="note">
        <Icon name="encrypted" size={18} className="secure-editor-banner-icon" />
        <span>
          End-to-end encrypted. Concurrent editing is disabled in the Encrypted Folder.
          Changes save automatically; press <kbd>⌘S</kbd> to flush immediately.
        </span>
      </div>
      {loadError && (
        <div className="secure-editor-error">{loadError}</div>
      )}
      {saveError && (
        <div className="secure-editor-error">{saveError}</div>
      )}
      <textarea
        className="secure-editor-textarea"
        value={content ?? ''}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={content === null ? 'Decrypting…' : 'Start writing…'}
        spellCheck={false}
        disabled={content === null}
      />
      <div className="secure-editor-status" data-state={saveState}>
        {saveState === 'idle' && content !== null && 'Up to date'}
        {saveState === 'dirty' && 'Editing…'}
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'Saved'}
        {saveState === 'error' && 'Save failed'}
      </div>
    </div>
  );
}
