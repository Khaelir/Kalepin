import React from 'react';
import { parseFrontmatter } from '../../utils/frontmatter';
import { TagPill } from '../TagPill';

const STATUS_STYLES: Record<string, 'draft' | 'approved' | 'warning'> = {
  draft: 'draft',
  'in-review': 'warning',
  review: 'warning',
  approved: 'approved',
  done: 'approved',
};

interface Props {
  content: string | null | undefined;
  onTagClick?: (tag: string) => void;
}

export function InlineTags({ content, onTagClick }: Props) {
  const { tags, status } = parseFrontmatter(content);
  if (tags.length === 0 && !status) return null;
  return (
    <div className="kp-inline-tags">
      {tags.map((tag) => (
        <TagPill key={tag} tag={tag} onClick={onTagClick} />
      ))}
      {status && (
        <span className={`kp-tag kp-status-pill kp-status-${STATUS_STYLES[status] ?? 'draft'}`}>
          {status}
        </span>
      )}
    </div>
  );
}
