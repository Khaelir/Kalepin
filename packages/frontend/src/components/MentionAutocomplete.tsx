import React, { useState, useEffect, useRef } from 'react';
import { fetchUsers, type UserInfo } from '../api';

interface MentionAutocompleteProps {
  /** The text typed after '@' so far */
  filter: string;
  /** Position relative to viewport */
  position: { top: number; left: number };
  onSelect: (user: UserInfo) => void;
  onDismiss: () => void;
}

export function MentionAutocomplete({ filter, position, onSelect, onDismiss }: MentionAutocompleteProps) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const filtered = users.filter((u) => {
    const q = filter.toLowerCase();
    return (
      (u.displayName?.toLowerCase().includes(q) ?? false) ||
      u.email.toLowerCase().includes(q)
    );
  });

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlighted(0);
  }, [filter]);

  // Dismiss if no matches
  useEffect(() => {
    if (users.length > 0 && filtered.length === 0) {
      onDismiss();
    }
  }, [filtered.length, users.length, onDismiss]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        onSelect(filtered[highlighted]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [filtered, highlighted, onSelect, onDismiss]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss]);

  if (filtered.length === 0) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: position.top,
    left: position.left,
    zIndex: 310,
  };

  return (
    <div ref={containerRef} className="mention-autocomplete" style={style}>
      {filtered.map((user, i) => (
        <div
          key={user.email}
          className={`mention-autocomplete-item${i === highlighted ? ' highlighted' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(user); }}
          onMouseEnter={() => setHighlighted(i)}
        >
          <span className="mention-autocomplete-name">
            {user.displayName || user.email.split('@')[0]}
          </span>
          <span className="mention-autocomplete-email">{user.email}</span>
        </div>
      ))}
    </div>
  );
}
