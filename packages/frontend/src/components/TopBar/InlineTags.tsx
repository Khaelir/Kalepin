import React from 'react';

interface Parsed {
  tags: string[];
  status: string | null;
}

const STATUS_STYLES: Record<string, 'draft' | 'approved' | 'warning'> = {
  draft: 'draft',
  'in-review': 'warning',
  review: 'warning',
  approved: 'approved',
  done: 'approved',
};

function parseFrontmatter(content: string | null | undefined): Parsed {
  if (!content || !content.startsWith('---')) return { tags: [], status: null };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { tags: [], status: null };
  const block = content.slice(3, end);
  const tags = new Set<string>();
  let status: string | null = null;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'tags' || key === 'tag') {
      if (value.startsWith('[')) {
        value
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
          .forEach((t) => tags.add(t));
      } else if (value) {
        tags.add(value.replace(/^['"]|['"]$/g, ''));
      }
    } else if (key === 'status' && value) {
      status = value.replace(/^['"]|['"]$/g, '').toLowerCase();
    }
  }
  return { tags: [...tags], status };
}

interface Props {
  content: string | null | undefined;
}

export function InlineTags({ content }: Props) {
  const { tags, status } = parseFrontmatter(content);
  if (tags.length === 0 && !status) return null;
  return (
    <div className="kp-inline-tags">
      {tags.map((tag) => (
        <span key={tag} className="kp-tag">
          <span className="kp-tag-hash">#</span>
          {tag}
        </span>
      ))}
      {status && (
        <span className={`kp-tag kp-status-pill kp-status-${STATUS_STYLES[status] ?? 'draft'}`}>
          {status}
        </span>
      )}
    </div>
  );
}
