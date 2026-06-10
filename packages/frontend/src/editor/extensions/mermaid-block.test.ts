import { describe, it, expect } from 'vitest';
import { Schema, type Node } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  DEFAULT_MERMAID_SOURCE,
  createMermaidAutofillPlugin,
  MERMAID_FILL_META,
} from './mermaid-block';

// Minimal PM schema mirroring the shape TipTap creates for paragraphs and
// CodeBlock-with-language. We avoid pulling in the full TipTap stack so this
// test stays fast and free of DOM/React dependencies.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: null } },
    },
    text: { group: 'inline' },
  },
});

function makeState(initialDoc?: Node): EditorState {
  return EditorState.create({
    doc: initialDoc ?? schema.node('doc', null, [schema.node('paragraph')]),
    schema,
    plugins: [createMermaidAutofillPlugin()],
  });
}

function findFirstMermaid(doc: Node): { node: Node; pos: number } | null {
  let found: { node: Node; pos: number } | null = null;
  doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === 'codeBlock' && n.attrs.language === 'mermaid') {
      found = { node: n, pos };
      return false;
    }
    return true;
  });
  return found;
}

describe('mermaid auto-fill plugin', () => {
  it('fills a newly inserted empty mermaid code block with the default template', () => {
    const state = makeState();

    // Replace the initial paragraph with an empty mermaid code block.
    const emptyMermaid = schema.node('codeBlock', { language: 'mermaid' });
    const tr = state.tr.replaceWith(0, state.doc.content.size, emptyMermaid);
    const next = state.apply(tr);

    const found = findFirstMermaid(next.doc);
    expect(found).not.toBeNull();
    expect(found!.node.textContent).toBe(DEFAULT_MERMAID_SOURCE);
    // Real newline preserved (not collapsed by HTML parsing).
    expect(found!.node.textContent).toContain('\n');
    // Literal `-->` preserved (not entity-encoded).
    expect(found!.node.textContent).toContain('-->');
    expect(found!.node.textContent).not.toContain('&gt;');
  });

  it('places the selection at the end of the inserted template', () => {
    const state = makeState();
    const emptyMermaid = schema.node('codeBlock', { language: 'mermaid' });
    const next = state.apply(state.tr.replaceWith(0, state.doc.content.size, emptyMermaid));

    const found = findFirstMermaid(next.doc)!;
    // Cursor should sit at the end of the inserted text (pos = inside-node + length).
    const expectedHead = found.pos + 1 + DEFAULT_MERMAID_SOURCE.length;
    expect(next.selection.head).toBe(expectedHead);
  });

  it('does NOT refill when the user deletes all content from an existing mermaid block', () => {
    // Start with a non-empty mermaid block.
    const filled = schema.node(
      'codeBlock',
      { language: 'mermaid' },
      schema.text('flowchart TD\n  A --> B'),
    );
    const initialDoc = schema.node('doc', null, [filled]);
    const state = makeState(initialDoc);

    // Delete every character inside the block.
    const start = 1; // inside the codeBlock
    const end = start + filled.content.size;
    const tr = state.tr.delete(start, end);
    const next = state.apply(tr);

    const found = findFirstMermaid(next.doc);
    expect(found).not.toBeNull();
    // The block is now empty AND must remain empty — the plugin's "newly created"
    // guard must skip this position because it existed in oldState.
    expect(found!.node.textContent).toBe('');
  });

  it('does not loop: the plugin ignores its own follow-up transaction', () => {
    const state = makeState();
    const emptyMermaid = schema.node('codeBlock', { language: 'mermaid' });
    const afterFill = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, emptyMermaid),
    );

    // The fill happened. Now apply a no-op transaction tagged with our meta —
    // the plugin must not try to fill again, and the doc must be unchanged.
    const tr = afterFill.tr.setMeta(MERMAID_FILL_META, true);
    const next = afterFill.apply(tr);

    expect(next.doc.eq(afterFill.doc)).toBe(true);
  });

  it('leaves non-mermaid code blocks untouched', () => {
    const state = makeState();
    const tsBlock = schema.node('codeBlock', { language: 'typescript' });
    const next = state.apply(state.tr.replaceWith(0, state.doc.content.size, tsBlock));

    let mermaidCount = 0;
    let tsCount = 0;
    next.doc.descendants((n) => {
      if (n.type.name !== 'codeBlock') return;
      if (n.attrs.language === 'mermaid') mermaidCount++;
      else if (n.attrs.language === 'typescript') tsCount++;
    });
    expect(mermaidCount).toBe(0);
    expect(tsCount).toBe(1);
    // Unaffected block stays empty.
    expect(next.doc.textContent).toBe('');
  });

  it('preserves an inserted mermaid block whose body is already populated', () => {
    const state = makeState();
    const populated = schema.node(
      'codeBlock',
      { language: 'mermaid' },
      schema.text('sequenceDiagram\n  A->>B: hi'),
    );
    const next = state.apply(state.tr.replaceWith(0, state.doc.content.size, populated));

    const found = findFirstMermaid(next.doc)!;
    expect(found.node.textContent).toBe('sequenceDiagram\n  A->>B: hi');
  });

  // Hush the unused-import warning for TextSelection across older TS configs;
  // it is used implicitly by EditorState when the plugin sets a selection.
  void TextSelection;
});
