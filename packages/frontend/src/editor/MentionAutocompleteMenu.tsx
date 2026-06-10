import React, { useRef, useEffect } from 'react';
import type { MentionMenuState } from './mention-autocomplete';
import { getColorForUser } from '../utils/user-colors';

interface Props {
  state: MentionMenuState;
  onSelect: (index: number) => void;
}

export function MentionAutocompleteMenu({ state, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const selected = ref.current.querySelector('.mention-menu-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  if (!state.active || state.users.length === 0) return null;

  return (
    <div
      ref={ref}
      className="mention-autocomplete"
      style={{
        position: 'fixed',
        top: state.position.top,
        left: state.position.left,
        zIndex: 310,
      }}
    >
      {state.users.map((user, i) => {
        const color = getColorForUser(user.email);
        return (
          <div
            key={user.email}
            className={`mention-menu-item${i === state.selectedIndex ? ' selected' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(i); }}
            onMouseEnter={() => {/* hover is visual only, selection happens via keyboard or click */}}
          >
            <span className="mention-menu-dot" style={{ backgroundColor: color }} />
            <span className="mention-menu-info">
              <span className="mention-autocomplete-name">
                {user.displayName || user.email.split('@')[0]}
              </span>
              <span className="mention-autocomplete-email">{user.email}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
