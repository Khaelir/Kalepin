import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseLinksFromMarkdown, resolveWikilink, resolveMarkdownLink } from './link-parser';

describe('parseLinksFromMarkdown', () => {
  it('extracts wikilinks', () => {
    const links = parseLinksFromMarkdown('See [[Meeting Notes]] for details');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'Meeting Notes');
    assert.equal(links[0].linkType, 'wikilink');
    assert.equal(links[0].lineNumber, 1);
  });

  it('extracts wikilinks with aliases (ignores alias)', () => {
    const links = parseLinksFromMarkdown("Check [[Meeting Notes|yesterday's meeting]]");
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'Meeting Notes');
  });

  it('extracts markdown links to local .md files', () => {
    const links = parseLinksFromMarkdown('[see here](../docs/architecture.md)');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, '../docs/architecture.md');
    assert.equal(links[0].linkType, 'markdown');
  });

  it('ignores external URLs in markdown links', () => {
    const links = parseLinksFromMarkdown('[Google](https://google.com)');
    assert.equal(links.length, 0);
  });

  it('ignores external URLs in wikilinks', () => {
    const links = parseLinksFromMarkdown('[[https://example.com]]');
    assert.equal(links.length, 0);
  });

  it('ignores image embeds with ![[...]]', () => {
    const links = parseLinksFromMarkdown('![[image.png]]');
    assert.equal(links.length, 0);
  });

  it('ignores markdown image embeds ![alt](...)', () => {
    const links = parseLinksFromMarkdown('![alt text](image.png)');
    assert.equal(links.length, 0);
  });

  it('ignores markdown links to non-.md files', () => {
    const links = parseLinksFromMarkdown('[photo](image.png)');
    assert.equal(links.length, 0);
  });

  it('extracts multiple links from multiple lines', () => {
    const content = `# Notes
See [[Project A]] and [[Project B]]
Also [ref](other.md)`;
    const links = parseLinksFromMarkdown(content);
    assert.equal(links.length, 3);
    assert.equal(links[0].lineNumber, 2);
    assert.equal(links[1].lineNumber, 2);
    assert.equal(links[2].lineNumber, 3);
  });

  it('handles wikilinks with paths', () => {
    const links = parseLinksFromMarkdown('[[work/meetings/standup]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'work/meetings/standup');
  });

  it('distinguishes embed from regular wikilink on same line', () => {
    const links = parseLinksFromMarkdown('![[embed.png]] and [[real link]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'real link');
  });

  it('strips heading fragment from wikilinks', () => {
    const links = parseLinksFromMarkdown('See [[Architecture#API Design]] for details');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'Architecture');
    assert.equal(links[0].linkType, 'wikilink');
  });

  it('strips heading fragment with alias', () => {
    const links = parseLinksFromMarkdown('[[Architecture#API Design|see API section]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'Architecture');
  });

  it('handles same-page heading link [[#Heading]]', () => {
    const links = parseLinksFromMarkdown('Jump to [[#Introduction]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, '');
    assert.equal(links[0].linkType, 'wikilink');
  });

  it('handles empty heading [[Page#]]', () => {
    const links = parseLinksFromMarkdown('See [[Architecture#]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'Architecture');
  });

  it('handles heading with path [[dir/Page#Heading]]', () => {
    const links = parseLinksFromMarkdown('See [[docs/Architecture#API Design]]');
    assert.equal(links.length, 1);
    assert.equal(links[0].rawTarget, 'docs/Architecture');
  });
});

describe('resolveWikilink', () => {
  const allPaths = [
    'docs/Architecture.md',
    'notes/Meeting Notes.md',
    'notes/project/Notes.md',
    'journal/Notes.md',
  ];

  it('resolves exact path match', () => {
    const result = resolveWikilink('docs/Architecture', 'index.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });

  it('resolves exact path with .md extension', () => {
    const result = resolveWikilink('docs/Architecture.md', 'index.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });

  it('resolves unique basename match', () => {
    const result = resolveWikilink('Architecture', 'notes/foo.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });

  it('resolves unique basename (Meeting Notes)', () => {
    const result = resolveWikilink('Meeting Notes', 'index.md', allPaths);
    assert.equal(result, 'notes/Meeting Notes.md');
  });

  it('prefers same-directory for ambiguous basenames', () => {
    // "Notes" matches both notes/project/Notes.md and journal/Notes.md
    const result = resolveWikilink('Notes', 'journal/daily.md', allPaths);
    assert.equal(result, 'journal/Notes.md');
  });

  it('returns null for unresolvable wikilink', () => {
    const result = resolveWikilink('Nonexistent', 'index.md', allPaths);
    assert.equal(result, null);
  });

  it('case-insensitive basename matching', () => {
    const result = resolveWikilink('architecture', 'index.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });

  it('strips heading fragment before resolution', () => {
    const result = resolveWikilink('Architecture#API Design', 'index.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });

  it('resolves same-page link [[#Heading]] to source file', () => {
    const result = resolveWikilink('#Introduction', 'notes/Meeting Notes.md', allPaths);
    assert.equal(result, 'notes/Meeting Notes.md');
  });

  it('resolves empty fragment [[Page#]] same as [[Page]]', () => {
    const result = resolveWikilink('Architecture#', 'index.md', allPaths);
    assert.equal(result, 'docs/Architecture.md');
  });
});

describe('resolveMarkdownLink', () => {
  it('resolves relative path from source', () => {
    const result = resolveMarkdownLink('../docs/architecture.md', 'notes/meeting.md');
    assert.equal(result, 'docs/architecture.md');
  });

  it('resolves same-directory path', () => {
    const result = resolveMarkdownLink('other.md', 'notes/meeting.md');
    assert.equal(result, 'notes/other.md');
  });

  it('resolves nested relative path', () => {
    const result = resolveMarkdownLink('sub/file.md', 'docs/index.md');
    assert.equal(result, 'docs/sub/file.md');
  });
});
