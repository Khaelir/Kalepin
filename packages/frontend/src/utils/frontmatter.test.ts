import { describe, it, expect } from 'vitest';
import { normalizeTag, parseFrontmatter, tagSearchQuery } from './frontmatter';

const tags = (yaml: string) => parseFrontmatter(`---\n${yaml}\n---\n# Body #inline\n`).tags;

describe('parseFrontmatter — tags', () => {
  it('reads a block list (which the old parser missed)', () => {
    expect(tags('tags:\n  - project\n  - idea')).toEqual(['project', 'idea']);
    expect(tags('tags:\n- a\n- b\ntitle: x')).toEqual(['a', 'b']);
  });

  it('reads flow lists, including multi-line ones', () => {
    expect(tags(`tags: [alpha, "beta", '#gamma']`)).toEqual(['alpha', 'beta', 'gamma']);
    expect(tags('tags: [one,\n  two]')).toEqual(['one', 'two']);
  });

  it('reads scalar, comma- and space-separated values', () => {
    expect(tags('tags: meeting')).toEqual(['meeting']);
    expect(tags('tags: one, two three')).toEqual(['one', 'two', 'three']);
  });

  it('accepts the singular key and strips a leading #', () => {
    expect(tags('tag: #meeting')).toEqual(['meeting']);
  });

  it('drops YAML comments and invalid values', () => {
    expect(tags('tags: work # quarterly')).toEqual(['work']);
    expect(tags('tags: [1984, ok, a.b]')).toEqual(['ok']);
    expect(tags('tags: null')).toEqual([]);
  });

  it('keeps nested tags and the casing as written, deduplicated case-insensitively', () => {
    expect(tags('tags: [Project/Kalepin, project/kalepin, Idea]')).toEqual(['Project/Kalepin', 'Idea']);
  });

  it('ignores inline body tags and indented keys', () => {
    expect(tags('meta:\n  tags: [nested]')).toEqual([]);
  });

  it('needs a closed frontmatter block on the first line', () => {
    expect(parseFrontmatter('---\ntags: [x]\n').tags).toEqual([]);
    expect(parseFrontmatter('# T\n---\ntags: [x]\n---\n').tags).toEqual([]);
    expect(parseFrontmatter('').tags).toEqual([]);
    expect(parseFrontmatter(null).tags).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(parseFrontmatter('---\r\ntags: [a]\r\n---\r\n').tags).toEqual(['a']);
  });
});

describe('parseFrontmatter — status', () => {
  it('reads and lowercases the status', () => {
    expect(parseFrontmatter('---\nstatus: "In-Review"\n---\n').status).toBe('in-review');
  });

  it('is null when absent', () => {
    expect(parseFrontmatter('---\ntags: [a]\n---\n').status).toBeNull();
  });
});

describe('normalizeTag', () => {
  it('mirrors the server rules', () => {
    expect(normalizeTag('#Café')).toBe('Café');
    expect(normalizeTag('a//b/')).toBe('a/b');
    expect(normalizeTag('1984')).toBeNull();
    expect(normalizeTag('-')).toBeNull();
    expect(normalizeTag('a b')).toBeNull();
  });
});

describe('tagSearchQuery', () => {
  it('builds the search modal query', () => {
    expect(tagSearchQuery('project/kalepin')).toBe('tag:project/kalepin');
  });
});
