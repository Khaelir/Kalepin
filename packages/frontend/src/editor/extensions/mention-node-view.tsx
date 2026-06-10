import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { getColorForUser } from '../../utils/user-colors';

export function MentionNodeView({ node }: NodeViewProps) {
  const email: string = node.attrs.email || '';
  const pseudo = email.split('@')[0] || email;
  const color = getColorForUser(email);

  return (
    <NodeViewWrapper as="span" className="mention-badge" data-email={email}>
      <span
        className="mention-badge-text"
        style={{ backgroundColor: `${color}26`, color }}
      >
        @{pseudo}
      </span>
    </NodeViewWrapper>
  );
}
