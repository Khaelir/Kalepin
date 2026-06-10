import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { FileEntry } from '@kalepin/shared';
import { fetchHeadings, HeadingEntry } from '../api';

export interface WikilinkSuggestion {
  /** Display label (basename without .md) */
  label: string;
  /** Full path for insertion */
  path: string;
  /** Directory hint for disambiguation */
  dir: string;
}

export interface HeadingSuggestion {
  text: string;
  level: number;
}

export interface WikilinkMenuState {
  active: boolean;
  phase: 'note' | 'heading';
  query: string;
  /** Note name typed before # (only in heading phase) */
  noteName: string;
  position: { top: number; left: number };
  selectedIndex: number;
  suggestions: WikilinkSuggestion[];
  headings: HeadingSuggestion[];
}

export const wikilinkMenuPluginKey = new PluginKey('wikilinkMenu');

/** Flatten a FileEntry tree into a list of .md file paths */
export function flattenFiles(entries: FileEntry[], prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory' && entry.children) {
      result.push(...flattenFiles(entry.children, fullPath));
    } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
      result.push(fullPath);
    }
  }
  return result;
}

function basename(p: string): string {
  return p.replace(/\.md$/, '').split('/').pop() || p;
}

function dirHint(p: string): string {
  const parts = p.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

export function filterNotes(paths: string[], query: string): WikilinkSuggestion[] {
  const q = query.toLowerCase();
  const matches = paths
    .filter((p) => basename(p).toLowerCase().includes(q))
    .map((p) => ({ label: basename(p), path: p, dir: dirHint(p) }));
  // Sort: exact prefix match first, then by label length (shorter = more relevant)
  matches.sort((a, b) => {
    const aPrefix = a.label.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.label.toLowerCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.label.length - b.label.length;
  });
  return matches.slice(0, 20);
}

export function filterHeadings(headings: HeadingSuggestion[], query: string): HeadingSuggestion[] {
  if (!query) return headings;
  const q = query.toLowerCase();
  return headings.filter((h) => h.text.toLowerCase().includes(q));
}

// Cache headings during a single autocomplete session
let headingsCache: Map<string, HeadingSuggestion[]> = new Map();
let headingsFetchTimeout: ReturnType<typeof setTimeout> | null = null;

function clearHeadingsCache() {
  headingsCache.clear();
  if (headingsFetchTimeout) {
    clearTimeout(headingsFetchTimeout);
    headingsFetchTimeout = null;
  }
}

export function createWikilinkMenuPlugin(
  onStateChange: (state: WikilinkMenuState | null) => void,
  getFiles: () => FileEntry[],
  getActiveFile: () => string,
) {
  let editable = true;
  let cachedPaths: string[] | null = null;

  function getPaths(): string[] {
    if (!cachedPaths) cachedPaths = flattenFiles(getFiles());
    return cachedPaths;
  }

  return new Plugin({
    key: wikilinkMenuPluginKey,
    state: {
      init() {
        return null;
      },
      apply(tr, _prev, _oldState, newState) {
        const prev = _prev as WikilinkMenuState | null;
        const meta = tr.getMeta(wikilinkMenuPluginKey);
        if (meta !== undefined) return meta;

        if (!editable) return null;
        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { $from } = newState.selection;

        // Don't activate inside code blocks or inline code
        if ($from.parent.type.spec.code || $from.parent.type.name === 'codeBlock') {
          return null;
        }

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

        // Match [[ followed by non-] non-| characters (the query)
        // The query may contain # for heading phase
        const wikilinkMatch = textBefore.match(/\[\[([^\]|]*?)$/);

        if (!wikilinkMatch) return null;

        const fullQuery = wikilinkMatch[1];
        const hashIdx = fullQuery.indexOf('#');

        if (hashIdx >= 0) {
          // Heading phase
          const noteName = fullQuery.substring(0, hashIdx);
          const headingQuery = fullQuery.substring(hashIdx + 1);

          // Resolve note to get headings
          let headings: HeadingSuggestion[] = [];
          if (!noteName) {
            // Same-page: extract headings from current document
            headings = [];
            newState.doc.descendants((node) => {
              if (node.type.name === 'heading') {
                headings.push({ text: node.textContent, level: node.attrs.level });
              }
            });
          } else {
            // Look up from cache — actual fetch is triggered in the view update
            const paths = getPaths();
            const q = noteName.toLowerCase();
            const resolved = paths.find(
              (p) => basename(p).toLowerCase() === q,
            );
            if (resolved && headingsCache.has(resolved)) {
              headings = headingsCache.get(resolved)!;
            }
          }

          const filtered = filterHeadings(headings, headingQuery);

          return {
            active: true,
            phase: 'heading' as const,
            query: headingQuery,
            noteName,
            position: prev?.position ?? { top: 0, left: 0 },
            selectedIndex: prev?.active && prev.phase === 'heading'
              ? Math.min(prev.selectedIndex, Math.max(filtered.length - 1, 0))
              : 0,
            suggestions: [],
            headings: filtered,
          };
        } else {
          // Note phase
          // Invalidate path cache on each activation so new files show up
          cachedPaths = null;
          const suggestions = filterNotes(getPaths(), fullQuery);

          return {
            active: true,
            phase: 'note' as const,
            query: fullQuery,
            noteName: '',
            position: prev?.position ?? { top: 0, left: 0 },
            selectedIndex: prev?.active && prev.phase === 'note'
              ? Math.min(prev.selectedIndex, Math.max(suggestions.length - 1, 0))
              : 0,
            suggestions,
            headings: [],
          };
        }
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = wikilinkMenuPluginKey.getState(view.state) as WikilinkMenuState | null;
        if (!state?.active) return false;

        const items = state.phase === 'note' ? state.suggestions : state.headings;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const newIndex = Math.min(state.selectedIndex + 1, items.length - 1);
          view.dispatch(view.state.tr.setMeta(wikilinkMenuPluginKey, { ...state, selectedIndex: newIndex }));
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const newIndex = Math.max(state.selectedIndex - 1, 0);
          view.dispatch(view.state.tr.setMeta(wikilinkMenuPluginKey, { ...state, selectedIndex: newIndex }));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          if (items.length === 0) return false;
          event.preventDefault();

          const { $from } = view.state.selection;
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
          const wikilinkMatch = textBefore.match(/\[\[([^\]|]*?)$/);
          if (!wikilinkMatch) return false;

          const matchStart = $from.pos - wikilinkMatch[0].length;
          const matchEnd = $from.pos;

          let target: string;
          if (state.phase === 'note') {
            const note = state.suggestions[state.selectedIndex];
            if (!note) return false;
            // Disambiguate when multiple notes share same basename
            const hasDuplicates = state.suggestions.filter(
              (s) => s.label === note.label,
            ).length > 1;
            target = hasDuplicates && note.dir ? `${note.dir}/${note.label}` : note.label;
          } else {
            const heading = state.headings[state.selectedIndex];
            if (!heading) return false;
            const prefix = state.noteName || '';
            target = `${prefix}#${heading.text}`;
          }

          const wikilinkType = view.state.schema.nodes.wikilink;
          if (wikilinkType) {
            const wikilinkNode = wikilinkType.create({ target, alias: null });
            const tr = view.state.tr
              .delete(matchStart, matchEnd)
              .insert(matchStart, wikilinkNode);
            tr.setMeta(wikilinkMenuPluginKey, null);
            view.dispatch(tr);
          } else {
            // Fallback: insert as text if node type not registered
            const tr = view.state.tr
              .delete(matchStart, matchEnd)
              .insertText(`[[${target}]]`, matchStart);
            tr.setMeta(wikilinkMenuPluginKey, null);
            view.dispatch(tr);
          }
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(wikilinkMenuPluginKey, null));
          return true;
        }

        return false;
      },
    },
    view(v) {
      editable = v.editable;
      return {
        update(view) {
          editable = view.editable;
          const state = wikilinkMenuPluginKey.getState(view.state) as WikilinkMenuState | null;
          if (state?.active) {
            const coords = view.coordsAtPos(view.state.selection.from);

            // Trigger heading fetch if needed (debounced)
            if (state.phase === 'heading' && state.noteName) {
              const paths = flattenFiles(getFiles());
              const q = state.noteName.toLowerCase();
              const resolved = paths.find(
                (p) => basename(p).toLowerCase() === q,
              );
              if (resolved && !headingsCache.has(resolved)) {
                if (headingsFetchTimeout) clearTimeout(headingsFetchTimeout);
                headingsFetchTimeout = setTimeout(async () => {
                  const entries = await fetchHeadings(resolved);
                  headingsCache.set(resolved, entries.map((e) => ({ text: e.text, level: e.level })));
                  // Re-trigger state update
                  view.dispatch(view.state.tr.setMeta(wikilinkMenuPluginKey, undefined));
                }, 100);
              }
            }

            onStateChange({
              ...state,
              position: { top: coords.bottom + 6, left: coords.left },
            });
          } else {
            if (state === null) clearHeadingsCache();
            onStateChange(state);
          }
        },
      };
    },
  });
}
