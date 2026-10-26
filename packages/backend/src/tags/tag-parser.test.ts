import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  normalizeTag,
  normalizeTagKey,
  parseFrontmatterTags,
  parseInlineTags,
  parseTags,
  splitFrontmatter,
} from './tag-parser';

const keys = (content: string) => parseTags(content).map((t) => t.tag);
const inline = (body: string) => parseInlineTags(body).map((t) => t.tag);
const fm = (yaml: string) => keys(`---\n${yaml}\n---\nbody\n`);

describe('normalizeTag', () => {
  it('strips the leading # and lowercases the key, keeping display casing', () => {
    assert.deepEqual(normalizeTag('#Project'), { tag: 'project', display: 'Project' });
  });

  it('drops empty slash segments', () => {
    assert.deepEqual(normalizeTag('a//b/'), { tag: 'a/b', display: 'a/b' });
    assert.equal(normalizeTag('/'), null);
  });

  it('rejects numbers-only and punctuation-only candidates', () => {
    assert.equal(normalizeTag('1984'), null);
    assert.equal(normalizeTag('2024/05'), null);
    assert.equal(normalizeTag('-'), null);
    assert.equal(normalizeTag('__'), null);
    assert.ok(normalizeTag('y1984'));
    assert.ok(normalizeTag('2024-q1'));
    assert.ok(normalizeTag('2024-05'));
  });

  it('rejects characters outside the tag alphabet', () => {
    assert.equal(normalizeTag('a b'), null);
    assert.equal(normalizeTag('a.b'), null);
    assert.equal(normalizeTag('a,b'), null);
    assert.equal(normalizeTag(''), null);
    assert.equal(normalizeTag('#'), null);
  });

  it('accepts Unicode letters and combining marks', () => {
    assert.equal(normalizeTag('Café')?.tag, 'café');
    assert.equal(normalizeTag('日本語')?.tag, '日本語');
    assert.equal(normalizeTag('проект')?.tag, 'проект');
    // Decomposed "é" (e + U+0301) normalises to the composed form.
    assert.equal(normalizeTag('café')?.tag, 'café');
  });
});

describe('normalizeTagKey', () => {
  it('normalises without validating', () => {
    assert.equal(normalizeTagKey('#Project/Kalepin/'), 'project/kalepin');
    assert.equal(normalizeTagKey('a,b'), 'a,b');
    assert.equal(normalizeTagKey('#'), '');
  });
});

describe('splitFrontmatter', () => {
  it('splits a closed frontmatter block', () => {
    const r = splitFrontmatter('---\ntags: a\n---\n# Title\n');
    assert.deepEqual(r.frontmatter, ['tags: a']);
    assert.equal(r.body, '# Title\n');
  });

  it('accepts ... as the closing fence and CRLF line endings', () => {
    const r = splitFrontmatter('---\r\ntags: a\r\n...\r\nbody');
    assert.deepEqual(r.frontmatter, ['tags: a']);
    assert.equal(r.body, 'body');
  });

  it('treats an unclosed block as body', () => {
    const r = splitFrontmatter('---\ntags: x\nmore');
    assert.equal(r.frontmatter, null);
    assert.equal(r.body, '---\ntags: x\nmore');
  });

  it('requires the fence on the first line', () => {
    assert.equal(splitFrontmatter('\n---\ntags: a\n---\n').frontmatter, null);
    assert.equal(splitFrontmatter('text\n---\ntags: a\n---').frontmatter, null);
  });

  it('ignores a leading BOM', () => {
    assert.deepEqual(splitFrontmatter('﻿---\ntags: a\n---\n').frontmatter, ['tags: a']);
  });
});

describe('frontmatter tags', () => {
  it('reads a block list', () => {
    assert.deepEqual(fm('tags:\n  - project\n  - idea'), ['project', 'idea']);
  });

  it('reads a block list at the key indentation', () => {
    assert.deepEqual(fm('tags:\n- a\n- b\ntitle: x'), ['a', 'b']);
  });

  it('skips blank and comment lines inside a block list and stops at the next key', () => {
    assert.deepEqual(fm('tags:\n  - a\n\n  # note\n  - b\naliases:\n  - c'), ['a', 'b']);
  });

  it('reads a flow list with quotes and hashes', () => {
    assert.deepEqual(fm(`tags: [alpha, "beta", '#gamma']`), ['alpha', 'beta', 'gamma']);
  });

  it('reads a flow list spread over several lines', () => {
    assert.deepEqual(fm('tags: [one,\n  two,\n  three]\ntitle: t'), ['one', 'two', 'three']);
  });

  it('reads a single scalar', () => {
    assert.deepEqual(fm('tags: meeting'), ['meeting']);
  });

  it('reads comma- and space-separated scalars', () => {
    assert.deepEqual(fm('tags: one, two three'), ['one', 'two', 'three']);
    assert.deepEqual(fm('tags: "a, b"'), ['a', 'b']);
  });

  it('accepts the singular key and any key casing', () => {
    assert.deepEqual(fm('tag: meeting'), ['meeting']);
    assert.deepEqual(fm('Tags: [x]'), ['x']);
  });

  it('merges tags and tag keys', () => {
    assert.deepEqual(fm('tags: [a]\ntag: b'), ['a', 'b']);
  });

  it('strips a leading # written Obsidian-style', () => {
    assert.deepEqual(fm('tags: #foo'), ['foo']);
    assert.deepEqual(fm('tags:\n  - #foo\n  - "#bar"'), ['foo', 'bar']);
  });

  it('drops YAML comments', () => {
    assert.deepEqual(fm('tags: work # quarterly'), ['work']);
    assert.deepEqual(fm('tags: [a, b] # trailing'), ['a', 'b']);
    assert.deepEqual(fm('tags:\n  - a # why\n  - b'), ['a', 'b']);
  });

  it('splits list items containing spaces and drops invalid pieces', () => {
    assert.deepEqual(fm('tags:\n  - my tag\n  - 1984\n  - ok.no'), ['my', 'tag']);
  });

  it('keeps nested tags', () => {
    assert.deepEqual(fm('tags: [project/kalepin]'), ['project/kalepin']);
  });

  it('ignores indented keys, null values and block scalars', () => {
    assert.deepEqual(fm('meta:\n  tags: [nested]'), []);
    assert.deepEqual(fm('tags: null'), []);
    assert.deepEqual(fm('tags: ~'), []);
    assert.deepEqual(fm('tags: |\n  a'), []);
    assert.deepEqual(fm('tags:'), []);
    assert.deepEqual(fm('tags: []'), []);
  });

  it('ignores other keys', () => {
    assert.deepEqual(fm('title: #notatag\naliases: [x]\nstatus: draft'), []);
  });

  it('deduplicates case-insensitively, keeping the first display form', () => {
    assert.deepEqual(parseFrontmatterTags(['tags: [Idea, idea, IDEA]']), [{ tag: 'idea', display: 'Idea' }]);
  });

  it('does not read frontmatter-looking text further down the note', () => {
    assert.deepEqual(keys('# Title\n\n---\ntags: [x]\n---\n'), []);
  });

  it('does not read tags from an unclosed frontmatter block', () => {
    assert.deepEqual(keys('---\ntags: [x]\nno closing fence'), []);
  });
});

describe('inline tags', () => {
  it('reads simple, nested and Unicode tags', () => {
    assert.deepEqual(inline('Planning #project/kalepin and #café #日本語'), ['project/kalepin', 'café', '日本語']);
  });

  it('reads tags at line start, in lists, quotes, tables and parentheses', () => {
    assert.deepEqual(
      inline('#start\n- item #list\n> quoted #quote\n| cell #cell |\n(see #paren)'),
      ['start', 'list', 'quote', 'cell', 'paren'],
    );
  });

  it('reads tags with underscores, dashes and digits', () => {
    assert.deepEqual(inline('#to_do #in-progress #y2024 #2024-q1'), ['to_do', 'in-progress', 'y2024', '2024-q1']);
  });

  it('stops at punctuation', () => {
    assert.deepEqual(inline('Done #tag. Next #other, then #last!'), ['tag', 'other', 'last']);
  });

  it('ignores numbers-only tags', () => {
    assert.deepEqual(inline('issue #1984 and #42'), []);
  });

  it('ignores headings', () => {
    assert.deepEqual(inline('# Title\n## Sub\n### Third ###\n#'), []);
  });

  it('reads tags inside heading text', () => {
    assert.deepEqual(inline('## Retro #meeting'), ['meeting']);
  });

  it('treats #Word without a space as a tag (not a heading)', () => {
    assert.deepEqual(inline('#Heading'), ['heading']);
  });

  it('ignores hashes glued to a word, #, &, / or backslash', () => {
    assert.deepEqual(inline('abc#tag C# x##y &#39; &#x27; path/#frag \\#escaped'), []);
  });

  it('ignores fenced code blocks (backticks and tildes)', () => {
    const body = 'before #in\n```js\nconst x = "#notatag";\n```\n~~~\n#alsonot\n~~~\nafter #out';
    assert.deepEqual(inline(body), ['in', 'out']);
  });

  it('only closes a fence with the same marker of at least the same length', () => {
    const body = '````\n```\n#inside\n````\n#outside';
    assert.deepEqual(inline(body), ['outside']);
    assert.deepEqual(inline('```\n~~~\n#inside\n```\n#outside'), ['outside']);
  });

  it('treats an unclosed fence as code until the end', () => {
    assert.deepEqual(inline('#before\n```\n#never'), ['before']);
  });

  it('ignores inline code spans, including multi-backtick spans', () => {
    assert.deepEqual(inline('use `#notatag` and ``a ` #nope`` but #yes'), ['yes']);
  });

  it('keeps tags after an unmatched backtick', () => {
    assert.deepEqual(inline('a ` b #yes'), ['yes']);
  });

  it('ignores URLs', () => {
    assert.deepEqual(
      inline('https://example.com/#frag http://x.y/a#b www.site.com/#c ftp://h/#d'),
      [],
    );
  });

  it('ignores markdown link destinations but reads link text', () => {
    assert.deepEqual(inline('[jump](#anchor) [#text](other.md)'), ['text']);
  });

  it('ignores wikilinks and embeds', () => {
    assert.deepEqual(inline('[[#Heading]] [[Note#Section]] ![[img#x]] [[a|alias #b]]'), []);
  });

  it('ignores HTML tags and comments', () => {
    assert.deepEqual(inline('<a href="#top">up</a> <!-- #hidden --> <span id="#x">#real</span>'), ['real']);
  });

  it('ignores reference definitions', () => {
    assert.deepEqual(inline('[ref]: #anchor\n#kept'), ['kept']);
  });

  it('deduplicates case-insensitively', () => {
    assert.deepEqual(parseInlineTags('#Idea then #idea and #IDEA'), [{ tag: 'idea', display: 'Idea' }]);
  });

  it('drops empty slash segments in nested tags', () => {
    assert.deepEqual(inline('#a//b/ end'), ['a/b']);
  });
});

describe('parseTags', () => {
  it('combines frontmatter and inline tags, frontmatter first, deduplicated', () => {
    const content = '---\ntags: [Roadmap, idea]\n---\n# Plan\n\nWe ship #roadmap items and #release/v1.\n';
    assert.deepEqual(parseTags(content), [
      { tag: 'roadmap', display: 'Roadmap' },
      { tag: 'idea', display: 'idea' },
      { tag: 'release/v1', display: 'release/v1' },
    ]);
  });

  it('does not read YAML as inline tags', () => {
    assert.deepEqual(keys('---\ntitle: x # comment #nope\n---\n'), []);
  });

  it('returns nothing for an empty note', () => {
    assert.deepEqual(parseTags(''), []);
  });
});
