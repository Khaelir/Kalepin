import React, { useState } from 'react';
import type { UpdatesResponse, FileChangeSummary, FolderGroup } from '../api';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function actionIcon(action: string): string {
  switch (action) {
    case 'created': return '+';
    case 'modified': return '\u270E'; // ✎
    case 'deleted': return '\u00D7'; // ×
    default: return '?';
  }
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="changes-diff">
      {diff.split('\n').map((line, i) => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del';
        else if (line.startsWith('@@')) cls = 'diff-hunk';
        return <div key={i} className={cls}>{line}</div>;
      })}
    </pre>
  );
}

function FileEntry({
  file,
  defaultExpanded,
  onNavigate,
}: {
  file: FileChangeSummary;
  defaultExpanded: boolean;
  onNavigate: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDiffs = file.diffs.some((d) => d != null);

  return (
    <div className="changes-file">
      <div className="changes-file-header">
        <span className={`changes-action changes-action-${file.action}`}>
          {actionIcon(file.action)}
        </span>
        <button
          className="changes-file-name"
          onClick={() => onNavigate(file.path)}
          title={file.path}
        >
          {fileName(file.path)}
        </button>
        <span className="changes-file-meta">
          {file.user && <span className="changes-user">{file.user.split('@')[0]}</span>}
          <span className="changes-time">{relativeTime(file.lastChangedAt)}</span>
        </span>
      </div>
      {file.metadataOnly ? (
        <div className="changes-file-note">(content hidden)</div>
      ) : file.action === 'deleted' ? (
        <div className="changes-file-note">(deleted)</div>
      ) : file.action === 'created' && !hasDiffs ? (
        <div className="changes-file-note">(new file)</div>
      ) : hasDiffs ? (
        <>
          <button
            className="changes-toggle-diff"
            data-path={file.path}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '\u25BE Hide diff' : '\u25B8 Show diff'}
          </button>
          {expanded && file.diffs.filter(Boolean).map((d, i) => (
            <DiffBlock key={i} diff={d!} />
          ))}
        </>
      ) : null}
    </div>
  );
}

function FolderSection({
  groups,
  defaultExpanded,
  onNavigate,
}: {
  groups: FolderGroup[];
  defaultExpanded: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <>
      {groups.map((group) =>
        group.files.map((file) => (
          <FileEntry
            key={file.path}
            file={file}
            defaultExpanded={defaultExpanded}
            onNavigate={onNavigate}
          />
        ))
      )}
    </>
  );
}

interface ChangesPanelProps {
  updates: UpdatesResponse;
  onNavigate: (path: string) => void;
  onMarkSeen: () => void;
  onClose: () => void;
}

export function ChangesPanel({ updates, onNavigate, onMarkSeen, onClose }: ChangesPanelProps) {
  const sinceDate = updates.period.since;
  const totalFiles =
    updates.stats.created + updates.stats.modified + updates.stats.deleted;

  return (
    <main className="changes-pane">
      <div className="changes-pane-header">
        <button className="changes-pane-back" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back
        </button>
        <h2>What's changed</h2>
        <button className="changes-mark-seen" onClick={onMarkSeen}>
          Mark all as seen
        </button>
      </div>

      <div className="changes-pane-sub">
        {sinceDate && (
          <span className="changes-since">
            Since {relativeTime(sinceDate)} ago
          </span>
        )}
        <span className="changes-summary">
          {totalFiles} file{totalFiles !== 1 ? 's' : ''}
          {updates.stats.created > 0 && ` \u00B7 ${updates.stats.created} created`}
          {updates.stats.modified > 0 && ` \u00B7 ${updates.stats.modified} modified`}
          {updates.stats.deleted > 0 && ` \u00B7 ${updates.stats.deleted} deleted`}
        </span>
      </div>

      <div className="changes-pane-body">
        {updates.starred.length > 0 && (
          <div className="changes-section">
            <div className="changes-section-title">{'\u2605'} Starred</div>
            <FolderSection
              groups={updates.starred}
              defaultExpanded={true}
              onNavigate={onNavigate}
            />
          </div>
        )}

        {updates.other.length > 0 && (
          <div className="changes-section">
            {updates.starred.length > 0 && (
              <div className="changes-section-title">Other changes</div>
            )}
            <FolderSection
              groups={updates.other}
              defaultExpanded={false}
              onNavigate={onNavigate}
            />
          </div>
        )}

        {totalFiles === 0 && (
          <div className="changes-empty">No changes since your last visit</div>
        )}
      </div>
    </main>
  );
}
