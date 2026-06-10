import { Plugin, PluginKey } from '@tiptap/pm/state';
import { fetchUsers, type UserInfo } from '../api';

export interface MentionMenuState {
  active: boolean;
  query: string;
  position: { top: number; left: number };
  selectedIndex: number;
  users: UserInfo[];
}

export const mentionMenuPluginKey = new PluginKey('mentionMenu');

let usersCache: UserInfo[] | null = null;

async function getUsers(): Promise<UserInfo[]> {
  if (usersCache) return usersCache;
  usersCache = await fetchUsers();
  return usersCache;
}

function filterUsers(users: UserInfo[], query: string): UserInfo[] {
  const q = query.toLowerCase();
  return users.filter((u) =>
    (u.displayName?.toLowerCase().includes(q) ?? false) ||
    u.email.toLowerCase().includes(q),
  ).slice(0, 10);
}

export function createMentionMenuPlugin(
  onStateChange: (state: MentionMenuState | null) => void,
) {
  let editable = true;
  let loadedUsers: UserInfo[] = [];

  return new Plugin({
    key: mentionMenuPluginKey,
    state: {
      init() {
        return null;
      },
      apply(tr, _prev, _oldState, newState) {
        const prev = _prev as MentionMenuState | null;
        const meta = tr.getMeta(mentionMenuPluginKey);
        if (meta !== undefined) return meta;

        if (!editable) return null;
        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { $from } = newState.selection;

        // Don't activate inside code blocks or inline code
        if ($from.parent.type.spec.code || $from.parent.type.name === 'codeBlock') {
          return null;
        }

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

        // Match @ preceded by space, start of line, or start of text — followed by non-space chars
        const mentionMatch = textBefore.match(/(?:^|[\s(])@([^\s@]*)$/);
        if (!mentionMatch) return null;

        const query = mentionMatch[1];
        const filtered = filterUsers(loadedUsers, query);

        if (filtered.length === 0 && query.length > 0) return null;

        return {
          active: true,
          query,
          position: prev?.position ?? { top: 0, left: 0 },
          selectedIndex: prev?.active
            ? Math.min(prev.selectedIndex, Math.max(filtered.length - 1, 0))
            : 0,
          users: filtered,
        };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = mentionMenuPluginKey.getState(view.state) as MentionMenuState | null;
        if (!state?.active) return false;

        const users = filterUsers(loadedUsers, state.query);
        if (users.length === 0) return false;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const next = Math.min(state.selectedIndex + 1, users.length - 1);
          view.dispatch(view.state.tr.setMeta(mentionMenuPluginKey, { ...state, selectedIndex: next }));
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const next = Math.max(state.selectedIndex - 1, 0);
          view.dispatch(view.state.tr.setMeta(mentionMenuPluginKey, { ...state, selectedIndex: next }));
          return true;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const user = users[state.selectedIndex];
          if (user) insertMention(view, state, user);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(mentionMenuPluginKey, null));
          return true;
        }
        return false;
      },
    },
    view(editorView) {
      let viewRef = editorView;

      // Fetch users; if the menu is already active when they arrive, notify React directly
      getUsers().then((u) => {
        loadedUsers = u;
        const state = mentionMenuPluginKey.getState(viewRef.state) as MentionMenuState | null;
        if (state?.active && u.length > 0) {
          const filtered = filterUsers(u, state.query);
          const { $from } = viewRef.state.selection;
          const coords = viewRef.coordsAtPos($from.pos);
          onStateChange({
            ...state,
            users: filtered,
            position: { top: coords.bottom + 4, left: coords.left },
          });
        }
      }).catch(() => {});

      return {
        update(view) {
          viewRef = view;
          editable = view.editable;
          const state = mentionMenuPluginKey.getState(view.state) as MentionMenuState | null;
          if (state?.active) {
            // Always re-filter with current loadedUsers (may have loaded after apply() ran)
            const users = filterUsers(loadedUsers, state.query);
            const { $from } = view.state.selection;
            const coords = view.coordsAtPos($from.pos);
            onStateChange({
              ...state,
              users,
              position: { top: coords.bottom + 4, left: coords.left },
            });
          } else {
            onStateChange(null);
          }
        },
      };
    },
  });
}

function insertMention(
  view: any,
  state: MentionMenuState,
  user: UserInfo,
): void {
  const { $from } = view.state.selection;
  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
  const match = textBefore.match(/(?:^|[\s(])@([^\s@]*)$/);
  if (!match) return;

  // Calculate the start position of the @query
  const matchStart = $from.pos - match[1].length - 1; // -1 for the @
  const mentionNode = view.state.schema.nodes.mention.create({ email: user.email });

  const tr = view.state.tr
    .delete(matchStart, $from.pos)
    .insert(matchStart, mentionNode);

  // Add a space after the mention
  tr.insertText(' ', matchStart + 1);

  tr.setMeta(mentionMenuPluginKey, null);
  view.dispatch(tr);
  view.focus();
}

export function selectMentionUser(view: any, user: UserInfo): void {
  const state = mentionMenuPluginKey.getState(view.state) as MentionMenuState | null;
  if (!state?.active) return;
  insertMention(view, state, user);
}
