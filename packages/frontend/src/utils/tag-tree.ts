export interface TagCountLike {
  tag: string;
  count: number;
}

export interface TagTreeNode {
  /** Lowercase full tag — stable identity (tags match case-insensitively). */
  key: string;
  /** Last path segment, as displayed. */
  name: string;
  /** Full tag as displayed, used for the `tag:` search. */
  tag: string;
  count: number;
  children: TagTreeNode[];
}

/**
 * Turn the flat `/api/tags` list into a tree: `project/kalepin` goes under
 * `project`. The server lists every ancestor, so a missing parent only
 * happens with hand-made input — the node then sits at the root under its full name.
 * Siblings are sorted by name, case-insensitively.
 */
export function buildTagTree(tags: TagCountLike[]): TagTreeNode[] {
  const byKey = new Map<string, TagTreeNode>();
  const roots: TagTreeNode[] = [];
  const depth = (t: string) => t.split('/').length;
  for (const t of [...tags].sort((a, b) => depth(a.tag) - depth(b.tag))) {
    const key = t.tag.toLowerCase();
    if (byKey.has(key)) continue;
    const parent = byKey.get(key.split('/').slice(0, -1).join('/'));
    // An orphan keeps its full name so its context is not lost at the root.
    const name = parent ? t.tag.split('/').pop()! : t.tag;
    const node: TagTreeNode = { key, name, tag: t.tag, count: t.count, children: [] };
    byKey.set(key, node);
    (parent ? parent.children : roots).push(node);
  }
  const sort = (nodes: TagTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}
