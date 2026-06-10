import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TocNodeView } from './toc-node-view';

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc' })];
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, _node: PMNode) {
          state.write('<div data-type="toc"></div>\n\n');
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TocNodeView);
  },
});
