import { describe, it, expect } from 'vitest';
import { buildTagTree, type TagTreeNode } from './tag-tree';

const shape = (nodes: TagTreeNode[]): unknown =>
  nodes.map((n) => (n.children.length ? [`${n.name}:${n.count}`, shape(n.children)] : `${n.name}:${n.count}`));

describe('buildTagTree', () => {
  it('nests children under their parent', () => {
    const tree = buildTagTree([
      { tag: 'project', count: 3 },
      { tag: 'project/kalepin', count: 2 },
      { tag: 'project/kalepin/ui', count: 1 },
      { tag: 'idea', count: 1 },
    ]);
    expect(shape(tree)).toEqual(['idea:1', ['project:3', [['kalepin:2', ['ui:1']]]]]);
    expect(tree[1].children[0].tag).toBe('project/kalepin');
    expect(tree[1].children[0].key).toBe('project/kalepin');
  });

  it('does not depend on input order', () => {
    const tree = buildTagTree([
      { tag: 'a/b/c', count: 1 },
      { tag: 'a/b', count: 1 },
      { tag: 'a', count: 1 },
    ]);
    expect(shape(tree)).toEqual([['a:1', [['b:1', ['c:1']]]]]);
  });

  it('matches parents case-insensitively and keeps display casing', () => {
    const tree = buildTagTree([
      { tag: 'Project', count: 2 },
      { tag: 'project/Kalepin', count: 1 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Project');
    expect(tree[0].children[0].name).toBe('Kalepin');
  });

  it('sorts siblings by name, case-insensitively', () => {
    const tree = buildTagTree([
      { tag: 'beta', count: 1 },
      { tag: 'Alpha', count: 1 },
      { tag: 'gamma', count: 1 },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('attaches an orphan to the root under its full name', () => {
    expect(shape(buildTagTree([{ tag: 'x/y', count: 1 }]))).toEqual(['x/y:1']);
  });

  it('returns an empty tree for no tags', () => {
    expect(buildTagTree([])).toEqual([]);
  });
});
