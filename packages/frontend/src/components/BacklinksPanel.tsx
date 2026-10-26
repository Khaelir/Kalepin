import React, { useState, useEffect, useCallback } from 'react';
import * as api from '../api';
import type { BacklinkEntry, OutgoingLinkEntry, UnlinkedMentionEntry } from '../api';
import { GraphPanel } from './GraphPanel';
import { RelatedNotesSection } from './RelatedNotesSection';

interface BacklinksPanelProps {
  activeFile: string;
  onNavigate: (path: string) => void;
  onPopOutGraph?: () => void;
  /** Revision of the open note; lets the Related section refresh after edits. */
  revision?: number;
  /** Appends a wikilink to the open note; omitted when it is read-only. */
  onInsertLink?: (path: string) => boolean;
}

function noteTitle(filePath: string): string {
  const basename = filePath.split('/').pop() || filePath;
  return basename.replace(/\.md$/, '');
}

export function BacklinksPanel({ activeFile, onNavigate, onPopOutGraph, revision, onInsertLink }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingLinkEntry[]>([]);
  const [mentions, setMentions] = useState<UnlinkedMentionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<'list' | 'graph'>('list');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bl, ol, um] = await Promise.all([
        api.fetchBacklinks(activeFile),
        api.fetchOutgoingLinks(activeFile),
        api.fetchUnlinkedMentions(activeFile),
      ]);
      setBacklinks(bl);
      setOutgoing(ol);
      setMentions(um);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [activeFile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleConvertMention = async (mention: UnlinkedMentionEntry) => {
    const title = noteTitle(activeFile);
    try {
      await api.convertMention(mention.sourcePath, mention.lineNumber, title);
      // Refresh data — the mention should move to backlinks
      await loadData();
    } catch {
      // ignore
    }
  };

  const modeToggle = (
    <div className="backlinks-mode-toggle" data-testid="backlinks-mode-toggle">
      <button className={`backlinks-mode-btn${displayMode === 'list' ? ' active' : ''}`} onClick={() => setDisplayMode('list')}>List</button>
      <button className={`backlinks-mode-btn${displayMode === 'graph' ? ' active' : ''}`} onClick={() => setDisplayMode('graph')}>Graph</button>
    </div>
  );

  if (loading && displayMode === 'list') {
    return (
      <div className="backlinks-panel">
        {modeToggle}
        <p className="backlinks-loading">Loading...</p>
      </div>
    );
  }

  if (displayMode === 'graph') {
    return (
      <div className="backlinks-panel backlinks-panel--graph">
        {modeToggle}
        <GraphPanel
          activeFile={activeFile}
          onNavigate={onNavigate}
          onPopOut={onPopOutGraph}
        />
      </div>
    );
  }

  return (
    <div className="backlinks-panel">
      {modeToggle}
      {/* Backlinks section */}
      <details className="backlinks-section" open>
        <summary className="backlinks-section-header">
          Backlinks <span className="backlinks-count">{backlinks.length}</span>
        </summary>
        {backlinks.length === 0 ? (
          <p className="backlinks-empty">No backlinks found</p>
        ) : (
          <div className="backlinks-list">
            {backlinks.map((bl, i) => (
              <div
                key={`${bl.sourcePath}-${bl.lineNumber}-${i}`}
                className="backlink-entry"
                onClick={() => onNavigate(bl.sourcePath)}
              >
                <div className="backlink-title">{noteTitle(bl.sourcePath)}</div>
                {bl.context && (
                  <div className="backlink-context">{bl.context.trim()}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </details>

      {/* Outgoing Links section */}
      <details className="backlinks-section">
        <summary className="backlinks-section-header">
          Outgoing Links <span className="backlinks-count">{outgoing.length}</span>
        </summary>
        {outgoing.length === 0 ? (
          <p className="backlinks-empty">No outgoing links</p>
        ) : (
          <div className="backlinks-list">
            {outgoing.map((ol, i) => (
              <div
                key={`${ol.rawTarget}-${ol.lineNumber}-${i}`}
                className={`backlink-entry${ol.targetPath ? '' : ' backlink-dangling'}`}
                onClick={() => ol.targetPath && onNavigate(ol.targetPath)}
                style={{ cursor: ol.targetPath ? 'pointer' : 'default' }}
              >
                <div className="backlink-title">
                  {ol.targetPath ? noteTitle(ol.targetPath) : ol.rawTarget}
                </div>
                {!ol.targetPath && (
                  <div className="backlink-context backlink-unresolved">Not found</div>
                )}
              </div>
            ))}
          </div>
        )}
      </details>

      {/* Unlinked Mentions section */}
      <details className="backlinks-section">
        <summary className="backlinks-section-header">
          Unlinked Mentions <span className="backlinks-count">{mentions.length}</span>
        </summary>
        {mentions.length === 0 ? (
          <p className="backlinks-empty">No unlinked mentions</p>
        ) : (
          <div className="backlinks-list">
            {mentions.map((m, i) => (
              <div
                key={`${m.sourcePath}-${m.lineNumber}-${i}`}
                className="backlink-entry"
              >
                <div className="backlink-entry-header">
                  <div
                    className="backlink-title backlink-title-clickable"
                    onClick={() => onNavigate(m.sourcePath)}
                  >
                    {noteTitle(m.sourcePath)}
                  </div>
                  <button
                    className="backlink-link-btn"
                    onClick={() => handleConvertMention(m)}
                    title="Convert to wikilink"
                  >
                    Link
                  </button>
                </div>
                <div className="backlink-context">{m.context.trim()}</div>
              </div>
            ))}
          </div>
        )}
      </details>

      <RelatedNotesSection
        activeFile={activeFile}
        revision={revision}
        onNavigate={onNavigate}
        onInsertLink={onInsertLink}
      />
    </div>
  );
}
