import React, { useRef, useEffect } from 'react';
import type { WikilinkMenuState } from './wikilink-autocomplete';

interface Props {
  state: WikilinkMenuState;
  onSelect: (index: number) => void;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <strong>{text.slice(idx, idx + query.length)}</strong>
      {text.slice(idx + query.length)}
    </>
  );
}

export function WikilinkAutocomplete({ state, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!ref.current) return;
    const selected = ref.current.querySelector('.wikilink-menu-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  const isEmpty =
    (state.phase === 'note' && state.suggestions.length === 0) ||
    (state.phase === 'heading' && state.headings.length === 0);

  return (
    <div
      ref={ref}
      className="slash-menu wikilink-menu"
      style={{
        position: 'fixed',
        top: state.position.top,
        left: state.position.left,
      }}
    >
      {isEmpty ? (
        <div className="wikilink-menu-empty">No matches</div>
      ) : state.phase === 'note' ? (
        state.suggestions.map((s, i) => (
          <button
            key={s.path}
            className={`slash-menu-item wikilink-menu-item ${i === state.selectedIndex ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
          >
            <span className="slash-menu-icon">📄</span>
            <span className="slash-menu-text">
              <span className="slash-menu-label">
                <HighlightMatch text={s.label} query={state.query} />
              </span>
              {s.dir && <span className="slash-menu-desc">{s.dir}</span>}
            </span>
          </button>
        ))
      ) : (
        state.headings.map((h, i) => (
          <button
            key={`${h.text}-${i}`}
            className={`slash-menu-item wikilink-menu-item ${i === state.selectedIndex ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
          >
            <span className="slash-menu-icon wikilink-heading-level">H{h.level}</span>
            <span className="slash-menu-text">
              <span className="slash-menu-label">
                <HighlightMatch text={h.text} query={state.query} />
              </span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
