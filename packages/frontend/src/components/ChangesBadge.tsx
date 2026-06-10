import React from 'react';
import type { UpdatesResponse } from '../api';

interface ChangesBadgeProps {
  updates: UpdatesResponse | null;
  onClick: () => void;
  active?: boolean;
}

export function ChangesBadge({ updates, onClick, active }: ChangesBadgeProps) {
  const totalFiles = updates
    ? updates.stats.created + updates.stats.modified + updates.stats.deleted
    : 0;

  const hasStarred = updates?.starred.some((g) => g.files.length > 0) ?? false;

  return (
    <button
      className={`sidebar-settings-btn changes-badge-btn${active ? ' active' : ''}${hasStarred ? ' changes-badge-starred' : ''}`}
      onClick={onClick}
      title={
        totalFiles > 0
          ? `What's changed \u2014 ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`
          : "What's changed"
      }
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0z" />
        <path d="M8 4v4l2.5 1.5" />
      </svg>
      {totalFiles > 0 && (
        <span className="changes-badge-count">{totalFiles > 99 ? '99+' : totalFiles}</span>
      )}
    </button>
  );
}
