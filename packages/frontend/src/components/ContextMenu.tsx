import React, { useLayoutEffect, useRef } from 'react';

export type ContextMenuItem =
  | { label: string; action: () => void; disabled?: boolean; danger?: boolean }
  | { type: 'separator' }
  | { type: 'header'; label: string };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp menu position to stay within viewport
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
  }, [x, y]);

  return (
    <>
      <div className="context-menu-overlay" onClick={onClose} />
      <div ref={menuRef} className="context-menu" style={{ top: y, left: x }}>
        {items.map((item, i) => {
          if ('type' in item && item.type === 'separator') {
            return <div key={`sep-${i}`} className="context-menu-separator" />;
          }
          if ('type' in item && item.type === 'header') {
            return (
              <div key={`hdr-${i}`} className="context-menu-header" title={item.label}>
                {item.label}
              </div>
            );
          }
          if ('action' in item) {
            const cls = [
              'context-menu-item',
              item.disabled ? 'disabled' : '',
              item.danger ? 'danger' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={`it-${i}-${item.label}`}
                className={cls}
                onClick={() => {
                  if (item.disabled) return;
                  item.action();
                  onClose();
                }}
              >
                {item.label}
              </button>
            );
          }
          return null;
        })}
      </div>
    </>
  );
}
