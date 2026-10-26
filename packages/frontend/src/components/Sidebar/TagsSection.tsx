import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchTags, type TagCount } from '../../api';
import { buildTagTree, type TagTreeNode } from '../../utils/tag-tree';
import { SidebarSectionTitle } from './SidebarSectionTitle';
import { useCollapsedSection } from './useCollapsedSection';

interface Props {
  /** Changes whenever notes may have changed; the section refetches (debounced). */
  refreshKey: string | number;
  onSelectTag: (tag: string) => void;
}

const REFRESH_DEBOUNCE_MS = 400;

export function TagsSection({ refreshKey, onSelectTag }: Props) {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [collapsed, toggle] = useCollapsedSection('tags', true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchTags()
        .then((next) => {
          if (!cancelled) setTags(next);
        })
        .catch(() => {
          /* transient — keep the last list */
        });
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshKey]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);

  const toggleNode = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (tree.length === 0) return null;

  return (
    <div className="kp-side-section kp-tags-section">
      <div onClick={toggle} style={{ cursor: 'pointer' }}>
        <SidebarSectionTitle count={tree.length}>
          <span className={`kp-section-caret${collapsed ? '' : ' is-open'}`}>▸</span> Tags
        </SidebarSectionTitle>
      </div>
      {!collapsed && (
        <div className="kp-side-section-body" role="tree" aria-label="Tags">
          {tree.map((node) => (
            <TagNode
              key={node.key}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggleNode}
              onSelect={onSelectTag}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NodeProps {
  node: TagTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (tag: string) => void;
}

function TagNode({ node, depth, expanded, onToggle, onSelect }: NodeProps) {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && expanded.has(node.key);
  return (
    <>
      <div
        className="kp-node kp-tag-node"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? open : undefined}
        data-tag={node.tag}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`kp-tag-node-caret${open ? ' is-open' : ''}`}
            onClick={() => onToggle(node.key)}
            aria-label={`${open ? 'Collapse' : 'Expand'} #${node.tag}`}
          >
            ▸
          </button>
        ) : (
          <span className="kp-tag-node-caret" aria-hidden />
        )}
        <button
          type="button"
          className="kp-tag-node-label"
          onClick={() => onSelect(node.tag)}
          title={`Show notes tagged #${node.tag}`}
        >
          <span className="kp-tag-hash">#</span>
          {node.name}
        </button>
        <span className="kp-node-meta">{node.count}</span>
      </div>
      {open &&
        node.children.map((child) => (
          <TagNode
            key={child.key}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}
