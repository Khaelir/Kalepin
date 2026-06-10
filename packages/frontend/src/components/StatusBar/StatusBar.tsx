import React from 'react';
import type { SaveStatus } from '../../editor/useSaveStatus';

interface Props {
  saveStatus: SaveStatus;
  revision: number;
  collaboratorCount: number;
  wordCount: number;
}

type Tone = 'success' | 'warning' | 'error';

function toneForStatus(status: SaveStatus): Tone {
  switch (status) {
    case 'SYNCED':
      return 'success';
    case 'DIRTY':
    case 'FLUSH_PENDING':
      return 'warning';
    case 'ERROR':
    case 'DISCONNECTED':
      return 'error';
  }
}

function primaryLabel(status: SaveStatus, revision: number): string {
  switch (status) {
    case 'SYNCED':
      return `Synced · rev ${revision}`;
    case 'DIRTY':
      return `Editing · rev ${revision}`;
    case 'FLUSH_PENDING':
      return `Saving · rev ${revision}`;
    case 'ERROR':
      return 'Sync error';
    case 'DISCONNECTED':
      return 'Disconnected';
  }
}

function saveLabel(status: SaveStatus): string {
  switch (status) {
    case 'SYNCED':
      return 'Saved';
    case 'DIRTY':
      return 'Unsaved changes';
    case 'FLUSH_PENDING':
      return 'Flushing…';
    case 'ERROR':
      return 'Save failed';
    case 'DISCONNECTED':
      return 'Reconnecting…';
  }
}

function CloudIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12.5h7a3 3 0 0 0 .5-5.95A4 4 0 0 0 4.2 7.5 2.5 2.5 0 0 0 4.5 12.5Z" />
    </svg>
  );
}

export function StatusBar({ saveStatus, revision, collaboratorCount, wordCount }: Props) {
  const tone = toneForStatus(saveStatus);
  return (
    <footer className="kp-statusbar workspace-statusbar" role="status" aria-live="polite">
      <span className="kp-statusbar-group">
        <span className={`kp-status-dot kp-status-dot--${tone}`} />
        {primaryLabel(saveStatus, revision)}
      </span>
      <span className="kp-statusbar-sep">·</span>
      <span className="kp-statusbar-group">
        <CloudIcon />
        {saveLabel(saveStatus)}
      </span>
      <span className="kp-statusbar-sep">·</span>
      <span>
        {collaboratorCount} {collaboratorCount === 1 ? 'collaborator' : 'collaborators'} connected
      </span>
      <span className="kp-statusbar-spacer" />
      <span>Markdown · UTF-8 · LF</span>
      <span className="kp-statusbar-sep">·</span>
      <span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
    </footer>
  );
}
