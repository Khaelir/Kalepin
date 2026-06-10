import React, { useState, useEffect, useRef } from 'react';

interface InputModalProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  readOnly?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputModal({ title, placeholder, defaultValue = '', readOnly, onConfirm, onCancel }: InputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            value={value}
            onChange={(e) => { if (!readOnly) setValue(e.target.value); }}
            placeholder={placeholder}
            readOnly={readOnly}
            style={readOnly ? { opacity: 0.7, cursor: 'default' } : undefined}
          />
          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-btn modal-btn-confirm" disabled={!value.trim()}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
