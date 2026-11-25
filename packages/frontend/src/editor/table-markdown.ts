import { Table } from '@tiptap/extension-table';
import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment, Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from 'prosemirror-tables';

/**
 * Check if a table can be safely serialized as markdown.
 * Requires all cells to contain exactly one paragraph child (no headings,
 * blockquotes, code blocks, etc.) and no col/row spans.
 */
function isMarkdownSerializable(node: PMNode): boolean {
  let ok = true;
  node.forEach((row) => {
    row.forEach((cell) => {
      if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) {
        ok = false;
        return;
      }
      if (cell.childCount > 1 || (cell.childCount === 1 && cell.firstChild?.type.name !== 'paragraph')) {
        ok = false;
      }
    });
  });
  // Also require first row to be all tableHeader cells
  const firstRow = node.firstChild;
  if (firstRow) {
    firstRow.forEach((cell) => {
      if (cell.type.name !== 'tableHeader') ok = false;
    });
  }
  return ok;
}

/** Table extension with fixed markdown serialization for block content in cells. */
export const TableWithMarkdown = Table.configure({ resizable: false }).extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Enter navigates to the cell below (same column).
      // If on the last row, a new row is added first.
      Enter: ({ editor }) => {
        if (!editor.isActive('table')) return false;

        const { state } = editor;
        const { $from } = state.selection;

        // Find table and cell depths
        let tableDepth = -1, cellDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'table') { tableDepth = d; break; }
          if (name === 'tableCell' || name === 'tableHeader') cellDepth = d;
        }
        if (tableDepth < 0 || cellDepth < 0) return false;

        const tableNode = $from.node(tableDepth);
        const tableStart = $from.start(tableDepth);
        const map = TableMap.get(tableNode);
        const cellOffset = $from.before(cellDepth) - tableStart;
        const { top: row, left: col } = map.findCell(cellOffset);

        if (row + 1 >= map.height) {
          // Last row: add a new row, then navigate into it
          editor.commands.addRowAfter();
          const newState = editor.state;
          const new$from = newState.selection.$from;
          let newTableDepth = -1;
          for (let d = new$from.depth; d > 0; d--) {
            if (new$from.node(d).type.name === 'table') { newTableDepth = d; break; }
          }
          if (newTableDepth < 0) return true;
          const newTable = new$from.node(newTableDepth);
          const newTableStart = new$from.start(newTableDepth);
          const newMap = TableMap.get(newTable);
          const targetOffset = newMap.positionAt(row + 1, col, newTable);
          const $target = newState.doc.resolve(newTableStart + targetOffset + 1);
          editor.view.dispatch(newState.tr.setSelection(TextSelection.near($target)).scrollIntoView());
          return true;
        }

        // Navigate to cell below (same column)
        const targetOffset = map.positionAt(row + 1, col, tableNode);
        const $target = state.doc.resolve(tableStart + targetOffset + 1);
        editor.view.dispatch(state.tr.setSelection(TextSelection.near($target)).scrollIntoView());
        return true;
      },
      // Shift+Enter inserts a hard break (line break) within the cell.
      'Shift-Enter': ({ editor }) => {
        if (!editor.isActive('table')) return false;
        return editor.commands.setHardBreak();
      },
    };
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(this: { editor: any }, state: any, node: PMNode, parent: any) {
          if (!isMarkdownSerializable(node)) {
            // Fall back to HTML to preserve block-level content in cells
            const schema = node.type.schema;
            const html = getHTMLFromFragment(Fragment.from(node), schema);
            state.write(html);
            state.closeBlock(node);
            return;
          }
          // Standard markdown table serialization
          state.inTable = true;
          node.forEach((row: PMNode, _p: number, i: number) => {
            state.write('| ');
            row.forEach((col: PMNode, _p2: number, j: number) => {
              if (j) state.write(' | ');
              const cellContent = col.firstChild;
              if (cellContent && cellContent.textContent.trim()) {
                state.renderInline(cellContent);
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!i) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => '---')
                .join(' | ');
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
