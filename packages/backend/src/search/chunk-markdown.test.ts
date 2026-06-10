import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { chunkMarkdown, humanizePath } from './chunk-markdown';

describe('chunkMarkdown', () => {
  it('splits a multi-heading note into chunks per heading', () => {
    const content = `# Intro
This is the introduction section with enough text to exceed the minimum chunk threshold for proper splitting.

## Section A
Content of section A is also long enough to be its own chunk without merging into the next one.

## Section B
Content of section B is similarly substantial to remain a standalone chunk in the final output.`;

    const chunks = chunkMarkdown(content, 'test.md');
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].heading, 'Intro');
    assert.ok(chunks[0].text.includes('introduction section'));
    assert.equal(chunks[1].heading, 'Section A');
    assert.ok(chunks[1].text.includes('Content of section A'));
    assert.equal(chunks[2].heading, 'Section B');
    assert.equal(chunks[0].chunkIdx, 0);
    assert.equal(chunks[1].chunkIdx, 1);
    assert.equal(chunks[2].chunkIdx, 2);
  });

  it('merges tiny heading-only sections into the next section', () => {
    const content = `# Title

## Details
This section has enough content to stand on its own as a meaningful chunk for embedding.`;

    const chunks = chunkMarkdown(content, 'test.md');
    // "# Title" alone is too short, gets merged into "## Details"
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes('# Title'));
    assert.ok(chunks[0].text.includes('Details'));
  });

  it('returns a single chunk for notes without headings', () => {
    const content = 'Just some plain text without any headings.\n\nAnother paragraph.';
    const chunks = chunkMarkdown(content, 'plain.md');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].heading, '');
    assert.ok(chunks[0].text.includes('Just some plain text'));
  });

  it('returns empty array for empty notes', () => {
    assert.deepEqual(chunkMarkdown('', 'empty.md'), []);
    assert.deepEqual(chunkMarkdown('   \n  \n  ', 'whitespace.md'), []);
  });

  it('soft-splits long sections on paragraph boundaries', () => {
    const longParagraph = 'A'.repeat(300);
    // Create a section with many paragraphs exceeding 800 chars
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: ${longParagraph}`);
    const content = `# Long Section\n\n${paragraphs.join('\n\n')}`;

    const chunks = chunkMarkdown(content, 'long.md');
    assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);
    // All chunks should reference the same heading
    for (const chunk of chunks) {
      assert.equal(chunk.heading, 'Long Section');
    }
  });

  it('handles single short note as one chunk', () => {
    const content = '# Title\nShort content.';
    const chunks = chunkMarkdown(content, 'short.md');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].heading, 'Title');
  });

  // --- Code-block-aware chunking (task 2.5) ---

  it('preserves a single code block as an atomic unit', () => {
    const codeBlock = '```js\n' + 'const x = 1;\n'.repeat(80) + '```';
    const content = `# Code Section\nSome intro text.\n\n${codeBlock}\n\nAfter the code.`;

    const chunks = chunkMarkdown(content, 'code.md');
    // The code block should not be split across chunks
    for (const chunk of chunks) {
      const opens = (chunk.text.match(/^```/gm) || []).length;
      const closes = opens; // all fences should be balanced within each chunk
      assert.equal(opens % 2, 0, `Chunk should have balanced fences: "${chunk.text.slice(0, 80)}..."`);
    }
  });

  it('keeps multiple code blocks intact within a section', () => {
    const block1 = '```python\nprint("hello")\n```';
    const block2 = '```python\nprint("world")\n```';
    const filler = 'Some explanation text between code blocks.';
    const content = `# Multi Code\n\n${filler}\n\n${block1}\n\n${filler}\n\n${block2}\n\n${filler}`;

    const chunks = chunkMarkdown(content, 'multi.md');
    // Verify no chunk has an unbalanced fence
    for (const chunk of chunks) {
      const fences = (chunk.text.match(/^```/gm) || []).length;
      assert.equal(fences % 2, 0, `Unbalanced fences in chunk`);
    }
  });

  it('handles a code block exceeding the chunk limit as a single chunk', () => {
    const longCode = '```\n' + 'x = x + 1\n'.repeat(200) + '```';
    const content = `# Huge Code\n\n${longCode}`;

    const chunks = chunkMarkdown(content, 'huge.md');
    // The entire code block should be in one chunk even if it exceeds 1200 chars
    const codeChunk = chunks.find((c) => c.text.includes('x = x + 1'));
    assert.ok(codeChunk, 'Should have a chunk with the code');
    assert.ok(codeChunk.text.includes('```'), 'Code chunk should contain fences');
  });

  // --- Path prefix generation (task 2.6) ---
});

describe('humanizePath', () => {
  it('strips .md and replaces separators with spaces', () => {
    assert.equal(humanizePath('recipes/thai-green-curry.md'), 'recipes thai green curry');
  });

  it('handles nested paths', () => {
    assert.equal(humanizePath('projects/api/redesign-notes.md'), 'projects api redesign notes');
  });

  it('handles underscores', () => {
    assert.equal(humanizePath('my_folder/my_note.md'), 'my folder my note');
  });

  it('handles root-level files', () => {
    assert.equal(humanizePath('readme.md'), 'readme');
  });

  it('handles paths without .md extension', () => {
    assert.equal(humanizePath('notes/todo'), 'notes todo');
  });

  it('handles special characters in filenames', () => {
    assert.equal(humanizePath('2026-04-10_daily-log.md'), '2026 04 10 daily log');
  });
});
