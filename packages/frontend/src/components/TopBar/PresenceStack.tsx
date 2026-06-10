import React from 'react';

interface PresenceUser {
  userId: string;
  email: string;
  color: string;
}

interface Props {
  users: PresenceUser[];
  onUserClick?: (userId: string) => void;
  max?: number;
}

export function PresenceStack({ users, onUserClick, max = 4 }: Props) {
  if (users.length === 0) return null;
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <div className="kp-presence-stack" aria-label={`${users.length} collaborators`}>
      {visible.map((u) => (
        <button
          key={u.userId}
          type="button"
          className="kp-presence-avatar"
          style={{ background: u.color, boxShadow: `0 0 0 2px ${u.color}` }}
          onClick={() => onUserClick?.(u.userId)}
          title={u.email}
        >
          {u.email[0]?.toUpperCase() ?? '?'}
        </button>
      ))}
      {overflow > 0 && (
        <span className="kp-presence-overflow" title={`${overflow} more`}>+{overflow}</span>
      )}
    </div>
  );
}
