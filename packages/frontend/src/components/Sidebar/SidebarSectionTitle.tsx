import React from 'react';

interface Props {
  children: React.ReactNode;
  count?: number;
  onAdd?: () => void;
  addTitle?: string;
}

export function SidebarSectionTitle({ children, count, onAdd, addTitle }: Props) {
  return (
    <div className="kp-side-section-title">
      <span className="kp-ssct-label">{children}</span>
      {typeof count === 'number' && <span className="kp-ssct-count">{count}</span>}
      {onAdd && (
        <button className="kp-ssct-add" onClick={onAdd} title={addTitle ?? 'Add'} type="button">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      )}
    </div>
  );
}
