import React, { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  text: string;
  type: 'info' | 'error' | 'success';
  /** Optional action button — fires on click then dismisses the toast. */
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ messages, onDismiss }: ToastProps) {
  return (
    <div className="toast-container">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ message, onDismiss }: { message: ToastMessage; onDismiss: (id: string) => void }) {
  // Toasts with an action stay visible 12s — long enough for the user to react.
  const ttl = message.actionLabel ? 12000 : 5000;
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), ttl);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss, ttl]);

  return (
    <div className={`toast toast-${message.type}`}>
      <span>{message.text}</span>
      {message.actionLabel && message.onAction && (
        <button
          className="toast-action"
          onClick={() => {
            message.onAction!();
            onDismiss(message.id);
          }}
        >
          {message.actionLabel}
        </button>
      )}
      <button className="toast-close" onClick={() => onDismiss(message.id)}>×</button>
    </div>
  );
}
