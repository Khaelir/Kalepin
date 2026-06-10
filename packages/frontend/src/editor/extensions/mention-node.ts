import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MentionNodeView } from './mention-node-view';

export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      email: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
        getAttrs(el) {
          const dom = el as HTMLElement;
          return {
            email: dom.getAttribute('data-email') || '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mention',
        'data-email': HTMLAttributes.email,
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PMNode) {
          const email = node.attrs.email || '';
          const pseudo = email.split('@')[0] || email;
          state.write(`@[${pseudo}](${email})`);
        },
        parse: {
          // After markdown-it parsing, @[pseudo](email) becomes:
          //   TextNode("@") + <a href="email">pseudo</a>
          // Convert these back into <span data-type="mention"> for ProseMirror.
          updateDOM(element: HTMLElement) {
            const links = Array.from(element.querySelectorAll('a'));
            for (const link of links) {
              if (link.closest('code, pre')) continue;
              const prev = link.previousSibling;
              if (!prev || prev.nodeType !== 3) continue; // 3 = TEXT_NODE
              const text = prev.textContent || '';
              if (!text.endsWith('@')) continue;

              const email = link.getAttribute('href') || '';
              if (!email.includes('@')) continue;

              const span = document.createElement('span');
              span.setAttribute('data-type', 'mention');
              span.setAttribute('data-email', email);

              prev.textContent = text.slice(0, -1);
              if (prev.textContent === '') prev.remove();
              link.replaceWith(span);
            }
          },
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
});
