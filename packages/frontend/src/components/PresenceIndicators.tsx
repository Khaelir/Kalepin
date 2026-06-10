import React from 'react';
export { getColorForUser } from '../utils/user-colors';

interface PresenceUser {
  userId: string;
  email: string;
  color: string;
}

interface PresenceIndicatorsProps {
  users: PresenceUser[];
  onUserClick?: (userId: string) => void;
}

export function PresenceIndicators({ users, onUserClick }: PresenceIndicatorsProps) {
  return (
    <div className="presence-indicators">
      {users.map((user) => (
        <div
          key={user.userId}
          className="presence-avatar"
          style={{ backgroundColor: user.color, cursor: onUserClick ? 'pointer' : undefined }}
          onClick={() => onUserClick?.(user.userId)}
        >
          {user.email[0].toUpperCase()}
          <span className="presence-tooltip">{user.email}</span>
        </div>
      ))}
    </div>
  );
}
