// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { TableWithMarkdown } from './table-markdown';
import { WikilinkNode } from './extensions/wikilink-node';
import { MentionNode } from './extensions/mention-node';
import { ImageWithAttachments } from './image-extension';

// Image node views fetch attachments from the API; keep them pending so the
// tests never touch the network.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  fetchImageBlob: () => new Promise<string>(() => {}),
}));

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

/** An editor with the extensions that take part in table markdown, as in Editor.tsx. */
function createEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      Link.configure({ openOnClick: false }),
      TableWithMarkdown,
      TableRow,
      TableCell,
      TableHeader,
      Markdown,
      WikilinkNode,
      ImageWithAttachments,
      MentionNode,
    ],
    content: markdown,
  });
  editors.push(editor);
  return editor;
}

function getMarkdown(editor: Editor): string {
  return (editor.storage as any).markdown.getMarkdown();
}

/** A two-column table with an `a | b` header and the given body rows. */
function table(...rows: string[]): string {
  return ['| a | b |', '| --- | --- |', ...rows].join('\n') + '\n';
}

describe('table markdown round-trip', () => {
  it.each([
    ['plain cells', table('| 1 | 2 |'), table('| 1 | 2 |')],
    ['empty cells', table('|  | y |'), table('|  | y |')],
    ['a wikilink-only cell', table('| [[Roadmap]] | x |'), table('| [[Roadmap]] | x |')],
    ['a wikilink-only header cell', '| [[Roadmap]] | b |\n| --- | --- |\n| 1 | 2 |\n', '| [[Roadmap]] | b |\n| --- | --- |\n| 1 | 2 |\n'],
    ['a mention-only cell', table('| @[bob](bob@x.com) | x |'), table('| @[bob](bob@x.com) | x |')],
  ])('keeps %s', (_name, input, expected) => {
    const editor = createEditor(input);
    const output = getMarkdown(editor);
    expect(output).toBe(expected);
    // Reloading what was saved gives back the same document.
    expect(createEditor(output).getJSON()).toEqual(editor.getJSON());
  });
});
