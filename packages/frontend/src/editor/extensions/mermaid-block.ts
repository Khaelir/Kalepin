import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MermaidNodeView } from './mermaid-node-view';
import { DrawioCodeBanner, isDrawioXml } from './drawio-code-banner';

export const DEFAULT_MERMAID_SOURCE = 'graph LR\n  A --> B';

export const MERMAID_FILL_META = 'mermaid-default-template-fill';
export const mermaidAutofillKey = new PluginKey('mermaidDefaultTemplateFill');

/**
 * Auto-fills newly-created empty mermaid code blocks with the default template
 * via a single ProseMirror plugin. Exported standalone so it can be unit-tested
 * without the React node view or the rest of the TipTap stack.
 */
export function createMermaidAutofillPlugin() {
  return new Plugin({
    key: mermaidAutofillKey,
    appendTransaction(transactions, oldState, newState) {
      if (transactions.some((tr) => tr.getMeta(MERMAID_FILL_META))) return null;
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const isMermaid = (n: any) =>
        n && n.type.name === 'codeBlock' && n.attrs.language === 'mermaid';

      // Collect positions of mermaid blocks that exist in oldState.
      const oldMermaidPositions = new Set<number>();
      oldState.doc.descendants((n, pos) => {
        if (isMermaid(n)) oldMermaidPositions.add(pos);
      });

      const fills: { pos: number; nodeSize: number }[] = [];
      newState.doc.descendants((n, pos) => {
        if (!isMermaid(n)) return;
        // Only fill when this position is genuinely new (no mermaid block
        // existed there in oldState) AND the node body is empty.
        if (oldMermaidPositions.has(pos)) return;
        if (n.textContent.trim().length > 0) return;
        fills.push({ pos, nodeSize: n.nodeSize });
      });

      if (fills.length === 0) return null;

      const tr = newState.tr;
      // Walk in reverse so earlier positions stay valid as we mutate.
      // The first fill in the original order (last fill in reverse iteration)
      // is the one closest to the user's cursor; place selection there.
      let firstFillEnd = -1;
      for (let i = fills.length - 1; i >= 0; i--) {
        const { pos } = fills[i];
        const insertPos = pos + 1; // inside the node, before its content
        tr.insertText(DEFAULT_MERMAID_SOURCE, insertPos);
        if (i === 0) {
          firstFillEnd = insertPos + DEFAULT_MERMAID_SOURCE.length;
        }
      }

      tr.setMeta(MERMAID_FILL_META, true);
      tr.setMeta('addToHistory', false);

      if (firstFillEnd > 0) {
        try {
          tr.setSelection(TextSelection.create(tr.doc, firstFillEnd));
        } catch {
          // Selection placement is a nicety; ignore failures.
        }
      }

      return tr;
    },
  });
}

/**
 * Extends CodeBlockLowlight to render mermaid and draw.io code blocks
 * with custom React NodeViews.
 * - Mermaid blocks (language=mermaid): rendered diagram with edit toggle
 * - draw.io XML blocks: informational banner guiding SVG export
 * - All other code blocks: default syntax-highlighted rendering
 */
export const MermaidBlock = CodeBlockLowlight.extend({
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    return [...parentPlugins, createMermaidAutofillPlugin()];
  },
  addNodeView() {
    const defaultNodeView = this.parent?.();

    return (props) => {
      const language = props.node.attrs.language;
      if (language === 'mermaid') {
        return ReactNodeViewRenderer(MermaidNodeView)(props);
      }
      // Detect raw draw.io XML pasted into code blocks (content-based)
      if (isDrawioXml(props.node.textContent)) {
        return ReactNodeViewRenderer(DrawioCodeBanner)(props);
      }
      // Fall through to default code block rendering
      if (typeof defaultNodeView === 'function') {
        return defaultNodeView(props);
      }
      return {} as any;
    };
  },
});
