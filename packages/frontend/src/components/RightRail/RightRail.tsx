import React, { type ReactNode } from 'react';

export type RailTab = 'comments' | 'backlinks' | 'history' | 'activity';

interface TabConfig {
  key: RailTab;
  label: string;
  icon: ReactNode;
  count?: number;
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h10v7H6l-3 3V4Z" />
    </svg>
  );
}
function HubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="13" cy="3" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="13" cy="13" r="1.5" />
      <path d="M6.5 6.5 4 4M9.5 6.5 12 4M6.5 9.5 4 12M9.5 9.5 12 12" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3a5 5 0 1 0 4.5 2.8" />
      <path d="M12 2v3h-3" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h3l2-4 2 8 2-5 1 1h2" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3L5 8l5 5" />
    </svg>
  );
}

interface RightRailProps {
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
  commentCount: number;
  backlinkCount: number;
  showActivity?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: ReactNode;
}

export function RightRail({ tab, onTabChange, commentCount, backlinkCount, showActivity = false, collapsed = false, onToggleCollapse, children }: RightRailProps) {
  const tabs: TabConfig[] = [
    { key: 'comments', label: 'Comments', icon: <ChatIcon />, count: commentCount || undefined },
    { key: 'backlinks', label: 'Backlinks', icon: <HubIcon />, count: backlinkCount || undefined },
    { key: 'history', label: 'History', icon: <HistoryIcon /> },
    ...(showActivity ? [{ key: 'activity' as RailTab, label: 'Activity', icon: <ActivityIcon /> }] : []),
  ];

  if (collapsed) {
    return (
      <aside className="kp-rail is-collapsed">
        <button
          type="button"
          className="kp-rail-toggle kp-rail-toggle--expand"
          onClick={onToggleCollapse}
          aria-label="Expand panel"
          title="Expand panel"
          data-testid="rail-expand"
        >
          <ChevronLeftIcon />
        </button>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.label}
            data-testid={`rail-tab-${t.key}`}
            className="kp-rail-tab kp-rail-tab--collapsed"
            onClick={() => {
              onTabChange(t.key);
              onToggleCollapse?.();
            }}
          >
            <span className="kp-rail-tab-icon">{t.icon}</span>
            {t.count != null && <span className="kp-rail-tab-count kp-rail-tab-count--dot" aria-label={`${t.count}`}>{t.count}</span>}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="kp-rail">
      <div className="kp-rail-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            title={t.label}
            data-testid={`rail-tab-${t.key}`}
            className={`kp-rail-tab${t.key === tab ? ' is-active' : ''}`}
            onClick={() => onTabChange(t.key)}
          >
            <span className="kp-rail-tab-icon">{t.icon}</span>
            <span className="kp-rail-tab-label">{t.label}</span>
            {t.count != null && <span className="kp-rail-tab-count">{t.count}</span>}
          </button>
        ))}
        <span className="kp-rail-tabs-spacer" />
        {onToggleCollapse && (
          <button
            type="button"
            className="kp-rail-toggle kp-rail-toggle--collapse"
            onClick={onToggleCollapse}
            aria-label="Collapse panel"
            title="Collapse panel"
            data-testid="rail-collapse"
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>
      <div className="kp-rail-scroll">{children}</div>
    </aside>
  );
}
