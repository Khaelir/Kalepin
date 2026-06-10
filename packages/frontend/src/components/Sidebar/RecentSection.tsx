import React, { useEffect, useState } from 'react';
import { SidebarSectionTitle } from './SidebarSectionTitle';
import { Icon } from '../Icon';
import { getRecentFiles, subscribeRecent, formatRelativeTime, type RecentFile } from '../../utils/recent-files';
import { useCollapsedSection } from './useCollapsedSection';

interface Props {
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Limit displayed entries (default 6) */
  limit?: number;
}

function displayName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

export function RecentSection({ activePath, onOpen, limit = 6 }: Props) {
  const [recents, setRecents] = useState<RecentFile[]>(() => getRecentFiles());
  const [tick, setTick] = useState(0);
  const [collapsed, toggle] = useCollapsedSection('recent', true);

  useEffect(() => {
    const unsubscribe = subscribeRecent(() => setRecents(getRecentFiles()));
    // Relative-time tick every 60s so "2m" becomes "3m" without page refresh
    const interval = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  if (recents.length === 0) return null;
  const visible = recents.slice(0, limit);

  return (
    <div className="kp-side-section">
      <div onClick={toggle} style={{ cursor: 'pointer' }}>
        <SidebarSectionTitle count={recents.length}>
          <span className={`kp-section-caret${collapsed ? '' : ' is-open'}`}>▸</span> Recently opened
        </SidebarSectionTitle>
      </div>
      {!collapsed && (
        <div className="kp-side-section-body" data-tick={tick}>
          {visible.map((r) => {
            const isActive = r.path === activePath;
            return (
              <button
                key={r.path}
                className={`kp-node${isActive ? ' is-active' : ''}`}
                type="button"
                onClick={() => onOpen(r.path)}
                title={r.path}
              >
                <Icon name="description" size={16} className="kp-node-icon" />
                <span className="kp-node-label">{displayName(r.path)}</span>
                <span className="kp-node-meta">{formatRelativeTime(r.visitedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
