import React, { useEffect, useRef, useState } from 'react';
import { ChangesBadge } from '../ChangesBadge';
import { HelpDropdown } from '../HelpDropdown';
import { NotificationBell } from '../NotificationBell';
import type { UpdatesResponse, CompletedTour, InboxNotification } from '../../api';

export interface InboxProps {
  /** Bumped when the server says the inbox changed. */
  refreshKey: number;
  onOpen: (item: InboxNotification) => void;
}

interface Props {
  // Changes badge
  updates: UpdatesResponse | null;
  changesActive: boolean;
  onOpenChanges: () => void;
  // Search
  onOpenSearch: () => void;
  // Share (copy current doc URL)
  canShare: boolean;
  onShare: () => void;
  // Notification inbox
  inbox: InboxProps;
  // Help tours
  completedTours: CompletedTour[];
  onStartTour: (tourId: string) => void;
  // Overflow menu
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  tweaksActive: boolean;
  onOpenTweaks: () => void;
  settingsActive: boolean;
  onOpenSettings: () => void;
  onDownloadVault: () => void;
}

export function ActionCluster({
  updates,
  changesActive,
  onOpenChanges,
  onOpenSearch,
  canShare,
  onShare,
  inbox,
  completedTours,
  onStartTour,
  theme,
  onToggleTheme,
  tweaksActive,
  onOpenTweaks,
  settingsActive,
  onOpenSettings,
  onDownloadVault,
}: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [overflowOpen]);

  return (
    <div className="kp-action-cluster">
      <ChangesBadge updates={updates} active={changesActive} onClick={onOpenChanges} />

      <button
        type="button"
        className="kp-topbar-search"
        onClick={onOpenSearch}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span>Search vault…</span>
        <kbd className="kp-kbd">⇧⇧</kbd>
      </button>

      <button
        type="button"
        className="kp-iconbtn kp-share-btn"
        onClick={onShare}
        disabled={!canShare}
        title={canShare ? 'Copy share link' : 'Open a file to share'}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="4" cy="8" r="1.8" />
          <circle cx="12" cy="3.5" r="1.8" />
          <circle cx="12" cy="12.5" r="1.8" />
          <path d="M5.5 7l5-2.5M5.5 9l5 2.5" />
        </svg>
      </button>

      <NotificationBell refreshKey={inbox.refreshKey} onOpen={inbox.onOpen} />

      <HelpDropdown completedTours={completedTours} onStartTour={onStartTour} />

      <div ref={overflowRef} className="kp-overflow" style={{ position: 'relative' }}>
        <button
          type="button"
          className={`kp-iconbtn${overflowOpen ? ' is-active' : ''}`}
          onClick={() => setOverflowOpen((v) => !v)}
          title="More"
          aria-haspopup="menu"
          aria-expanded={overflowOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.2" />
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="13" cy="8" r="1.2" />
          </svg>
        </button>
        {overflowOpen && (
          <div className="kp-overflow-menu" role="menu">
            <button className="kp-overflow-item" type="button" role="menuitem" onClick={() => { setOverflowOpen(false); onToggleTheme(); }}>
              <span>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
            </button>
            <button className={`kp-overflow-item${tweaksActive ? ' is-active' : ''}`} type="button" role="menuitem" onClick={() => { setOverflowOpen(false); onOpenTweaks(); }}>
              <span>Tweaks panel</span>
            </button>
            <div className="kp-overflow-sep" />
            <button className={`kp-overflow-item${settingsActive ? ' is-active' : ''}`} type="button" role="menuitem" onClick={() => { setOverflowOpen(false); onOpenSettings(); }}>
              <span>Settings</span>
            </button>
            <button className="kp-overflow-item" type="button" role="menuitem" onClick={() => { setOverflowOpen(false); onDownloadVault(); }}>
              <span>Download vault (ZIP)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
