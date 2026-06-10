import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MentionAutocomplete } from './MentionAutocomplete';
import type { UserInfo } from '../api';

interface FloatingInputProps {
  label: string;
  placeholder?: string;
  position: { top: number; left: number };
  onSubmit: (value: string) => void;
  onCancel: () => void;
  /** Inline notice shown above the input (e.g. mention-suppression warning for personal docs). */
  notice?: React.ReactNode;
}

function getMentionState(value: string, cursorPos: number): { active: boolean; filter: string; atIndex: number } {
  // Walk backward from cursor to find '@' preceded by space or at start
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === ' ' || ch === '\n') break;
    if (ch === '@' && (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n')) {
      return { active: true, filter: value.slice(i + 1, cursorPos), atIndex: i };
    }
  }
  return { active: false, filter: '', atIndex: -1 };
}

export function FloatingInput({ label, placeholder, position, onSubmit, onCancel, notice }: FloatingInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mentionState, setMentionState] = useState<{ active: boolean; filter: string; atIndex: number }>({ active: false, filter: '', atIndex: -1 });

  useEffect(() => {
    // Focus after a tick so the editor doesn't steal it back
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Clamp position so the input doesn't overflow the viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(position.top, window.innerHeight - 80),
    left: Math.min(position.left, window.innerWidth - 280),
    zIndex: 300,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let MentionAutocomplete handle keys when active
    if (mentionState.active) return;

    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    const cursor = e.target.selectionStart ?? newValue.length;
    setMentionState(getMentionState(newValue, cursor));
  };

  const handleSelect = useCallback((user: UserInfo) => {
    const name = user.displayName || user.email.split('@')[0];
    const mention = `@[${name}](${user.email}) `;
    const before = value.slice(0, mentionState.atIndex);
    const after = value.slice((inputRef.current?.selectionStart ?? value.length));
    const newValue = before + mention + after;
    setValue(newValue);
    setMentionState({ active: false, filter: '', atIndex: -1 });
    requestAnimationFrame(() => {
      const pos = before.length + mention.length;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  }, [value, mentionState.atIndex]);

  const handleDismiss = useCallback(() => {
    setMentionState({ active: false, filter: '', atIndex: -1 });
    inputRef.current?.focus();
  }, []);

  // Dropdown positioned below the floating input
  const dropdownPos = {
    top: Math.min(position.top, window.innerHeight - 80) + 60,
    left: Math.min(position.left, window.innerWidth - 280),
  };

  return (
    <>
      <div className="floating-input-overlay" onClick={onCancel} />
      <div ref={containerRef} className="floating-input" style={style}>
        {notice && <div className="floating-input-notice">{notice}</div>}
        <span className="floating-input-label">{label}</span>
        <input
          ref={inputRef}
          type="text"
          className="floating-input-field"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <div className="floating-input-hint">Enter to confirm · Esc to cancel</div>
      </div>
      {mentionState.active && (
        <MentionAutocomplete
          filter={mentionState.filter}
          position={dropdownPos}
          onSelect={handleSelect}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}
