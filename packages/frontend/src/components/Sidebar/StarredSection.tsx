import React from 'react';
import type { StarredItem } from '../../api';
import { SidebarSectionTitle } from './SidebarSectionTitle';
import { Icon } from '../Icon';
import { useCollapsedSection } from './useCollapsedSection';

interface Props {
  stars: StarredItem[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

function displayName(path: string): string {
  const clean = path.endsWith('/') ? path.slice(0, -1) : path;
  const base = clean.split('/').pop() ?? clean;
  return base.replace(/\.md$/, '');
}

export function StarredSection({ stars, activePath, onOpen }: Props) {
  const [collapsed, toggle] = useCollapsedSection('starred', true);
  if (stars.length === 0) return null;

  return (
    <div className="kp-side-section">
      <div onClick={toggle} style={{ cursor: 'pointer' }}>
        <SidebarSectionTitle count={stars.length}>
          <span className={`kp-section-caret${collapsed ? '' : ' is-open'}`}>▸</span> Starred
        </SidebarSectionTitle>
      </div>
      {!collapsed && (
        <div className="kp-side-section-body">
          {stars.map((s) => {
            const path = s.type === 'folder' ? s.path.replace(/\/$/, '') : s.path;
            const isActive = path === activePath;
            const isFolder = s.type === 'folder';
            return (
              <button
                key={`${s.type}:${s.path}`}
                className={`kp-node${isActive ? ' is-active' : ''}`}
                type="button"
                onClick={() => !isFolder && onOpen(path)}
                disabled={isFolder}
                title={path}
              >
                <Icon
                  name={isFolder ? 'folder' : 'description'}
                  size={16}
                  fill={isFolder}
                  className="kp-node-icon"
                  style={isFolder ? { color: 'var(--luce-primary)' } : undefined}
                />
                <span className="kp-node-label">{displayName(path)}</span>
                <span className="kp-node-star" aria-hidden>★</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
