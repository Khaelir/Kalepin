import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface RemoteUserPresence {
  userId: string;
  email: string;
  color: string;
  cursor: number | null;
  selection: { from: number; to: number } | null;
}

const collaborativeCursorsPluginKey = new PluginKey('collaborativeCursors');

/**
 * Update remote user presence data, triggering a decoration re-render.
 */
function setRemotePresence(
  view: ReturnType<typeof import('@tiptap/pm/view').EditorView.prototype.state.apply> extends never ? never : any,
  users: Map<string, RemoteUserPresence>,
) {
  const tr = view.state.tr.setMeta(collaborativeCursorsPluginKey, { users });
  view.dispatch(tr);
}

export const CollaborativeCursors = Extension.create({
  name: 'collaborativeCursors',

  addStorage() {
    return {
      users: new Map<string, RemoteUserPresence>(),
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: collaborativeCursorsPluginKey,

        state: {
          init() {
            return DecorationSet.empty;
          },

          apply(tr, oldDecorations) {
            const meta = tr.getMeta(collaborativeCursorsPluginKey);
            if (!meta) {
              // Map existing decorations through document changes
              return tr.docChanged ? oldDecorations.map(tr.mapping, tr.doc) : oldDecorations;
            }

            const users = meta.users as Map<string, RemoteUserPresence>;
            const decorations: Decoration[] = [];
            const docSize = tr.doc.content.size;

            for (const user of users.values()) {
              const clamp = (pos: number) => Math.max(0, Math.min(pos, docSize));

              // Selection highlight (inline decoration)
              if (user.selection && user.selection.from !== user.selection.to) {
                const from = clamp(user.selection.from);
                const to = clamp(user.selection.to);
                if (from < to) {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: 'collab-selection',
                      style: `background-color: ${user.color}33;`,
                    }),
                  );
                }
              }

              // Cursor caret (widget decoration)
              if (user.cursor != null) {
                const pos = clamp(user.cursor);
                const widget = document.createElement('span');
                widget.className = 'collab-cursor';
                widget.style.borderColor = user.color;

                const label = document.createElement('span');
                label.className = 'collab-cursor-label';
                label.style.backgroundColor = user.color;
                label.textContent = user.email;
                widget.appendChild(label);

                decorations.push(
                  Decoration.widget(pos, widget, {
                    side: -1,
                    key: `cursor-${user.userId}`,
                  }),
                );
              }
            }

            return DecorationSet.create(tr.doc, decorations);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

/**
 * Update a single remote user's presence data.
 */
export function updateRemotePresence(
  editor: any,
  presence: RemoteUserPresence,
) {
  const storage = editor.extensionManager.extensions.find(
    (ext: any) => ext.name === 'collaborativeCursors',
  )?.storage;
  if (!storage) return;

  storage.users.set(presence.userId, presence);

  const view = editor.view;
  if (view) {
    setRemotePresence(view, storage.users);
  }
}

/**
 * Remove a remote user's presence data.
 */
export function removeRemotePresence(editor: any, userId: string) {
  const storage = editor.extensionManager.extensions.find(
    (ext: any) => ext.name === 'collaborativeCursors',
  )?.storage;
  if (!storage) return;

  storage.users.delete(userId);

  const view = editor.view;
  if (view) {
    setRemotePresence(view, storage.users);
  }
}
