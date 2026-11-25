import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { FileEntry } from '@kalepin/shared';
import { WikilinkNodeView } from './wikilink-node-view';

export interface WikilinkNodeOptions {
  getFiles: () => FileEntry[];
  getActiveFile: () => string;
  onNavigate: (path: string, heading?: string) => void;
}

const WIKILINK_IN_SOURCE = /\[\[[^\]\n]*\]\]/g;
const tablePatched = new WeakSet<object>();

/**
 * Make markdown-it's table rule read `[[target|alias]]` as part of one cell.
 * Inside tables the table serializer writes `[[target\|alias]]`, as GFM and
 * Obsidian expect, but notes saved by earlier versions (or written by hand)
 * hold the bare pipe, which split the cell and lost the row's last cell on
 * the next save.
 *
 * The table rule runs on a copy of the source in which bare pipes inside
 * `[[...]]` are replaced by NUL (escaped ones are left to the rule, which
 * already unescapes them). The copy has the same length, so line offsets stay
 * valid, and markdown-it has already turned any real NUL into U+FFFD. The
 * cells the rule produces get their pipes back before inline parsing.
 */
function allowWikilinkPipesInTables(md: any) {
  if (tablePatched.has(md)) return;
  // markdown-it has no public way to read a rule back, hence __rules__.
  const rule = md.block.ruler.__rules__.find((r: { name: string }) => r.name === 'table');
  if (!rule) return;
  tablePatched.add(md);
  const table = rule.fn;
  // One block state per parse; the rule runs for every line, so mask once.
  const maskedSources = new WeakMap<object, string | null>();
  const tableWithWikilinks = (state: any, startLine: number, endLine: number, silent: boolean) => {
    let masked = maskedSources.get(state);
    if (masked === undefined) {
      const src: string = state.src;
      const replaced = src.replace(WIKILINK_IN_SOURCE, (link) =>
        link.replace(/\\?\|/g, (pipe) => (pipe === '|' ? '\0' : pipe)),
      );
      masked = replaced === src ? null : replaced;
      maskedSources.set(state, masked);
    }
    if (masked === null) return table(state, startLine, endLine, silent);
    const src = state.src;
    const firstToken = state.tokens.length;
    state.src = masked;
    try {
      return table(state, startLine, endLine, silent);
    } finally {
      state.src = src;
      for (let i = firstToken; i < state.tokens.length; i++) {
        const token = state.tokens[i];
        if (token.type === 'inline') token.content = token.content.replace(/\0/g, '|');
      }
    }
  };
  md.block.ruler.at('table', tableWithWikilinks, { alt: rule.alt });
}

export const WikilinkNode = Node.create<WikilinkNodeOptions>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addOptions() {
    return {
      getFiles: () => [],
      getActiveFile: () => '',
      onNavigate: () => {},
    };
  },

  addAttributes() {
    return {
      target: { default: '' },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wikilink"]',
        getAttrs(el) {
          const dom = el as HTMLElement;
          return {
            target: dom.getAttribute('data-target') || '',
            alias: dom.getAttribute('data-alias') || null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'wikilink',
        'data-target': HTMLAttributes.target,
        'data-alias': HTMLAttributes.alias,
      }),
    ];
  },

  addStorage() {
    return {
      // Runtime callbacks — set in onCreate from options
      getFiles: (() => []) as () => FileEntry[],
      getActiveFile: (() => '') as () => string,
      onNavigate: ((_path: string, _heading?: string) => {}) as (path: string, heading?: string) => void,
      onOpenEditPopover: null as ((node: PMNode, getPos: () => number | undefined, anchorRect: DOMRect) => void) | null,
      // tiptap-markdown serializer
      markdown: {
        serialize(state: any, node: PMNode) {
          const target = node.attrs.target || '';
          const alias = node.attrs.alias;
          if (alias) {
            state.write(`[[${target}|${alias}]]`);
          } else {
            state.write(`[[${target}]]`);
          }
        },
        parse: {
          setup(markdownit: any) {
            allowWikilinkPipesInTables(markdownit);
          },
          // Hook into tiptap-markdown's DOM post-processing to convert
          // [[...]] text in the parsed HTML into <span data-type="wikilink"> elements.
          updateDOM(element: HTMLElement) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
              acceptNode(node) {
                if ((node as Text).parentElement?.closest('code, pre')) {
                  return NodeFilter.FILTER_REJECT;
                }
                return node.textContent?.includes('[[') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
              },
            });
            const textNodes: Text[] = [];
            while (walker.nextNode()) {
              textNodes.push(walker.currentNode as Text);
            }
            for (const textNode of textNodes) {
              const text = textNode.textContent || '';
              const regex = /\[\[([^\]]+?)\]\]/g;
              const parts: (string | HTMLSpanElement)[] = [];
              let lastIdx = 0;
              let match: RegExpExecArray | null;
              while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIdx) {
                  parts.push(text.slice(lastIdx, match.index));
                }
                const inner = match[1];
                const pipeIdx = inner.indexOf('|');
                const target = pipeIdx >= 0 ? inner.substring(0, pipeIdx).trim() : inner.trim();
                const alias = pipeIdx >= 0 ? inner.substring(pipeIdx + 1).trim() : null;
                const span = document.createElement('span');
                span.setAttribute('data-type', 'wikilink');
                span.setAttribute('data-target', target);
                if (alias) span.setAttribute('data-alias', alias);
                parts.push(span);
                lastIdx = match.index + match[0].length;
              }
              if (parts.length === 0) continue;
              if (lastIdx < text.length) {
                parts.push(text.slice(lastIdx));
              }
              const parent = textNode.parentNode;
              if (!parent) continue;
              for (const part of parts) {
                if (typeof part === 'string') {
                  parent.insertBefore(document.createTextNode(part), textNode);
                } else {
                  parent.insertBefore(part, textNode);
                }
              }
              parent.removeChild(textNode);
            }
          },
        },
      },
    };
  },

  onCreate() {
    this.storage.getFiles = this.options.getFiles;
    this.storage.getActiveFile = this.options.getActiveFile;
    this.storage.onNavigate = this.options.onNavigate;
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection)) return false;
        const node = selection.node;
        if (node.type.name !== 'wikilink') return false;

        // Open edit popover for the selected wikilink node
        const pos = selection.from;
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return false;
        const rect = dom.getBoundingClientRect();
        this.storage.onOpenEditPopover?.(node, () => pos, rect);
        return true;
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikilinkNodeView);
  },
});
