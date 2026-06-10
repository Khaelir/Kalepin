import { Plugin, PluginKey } from '@tiptap/pm/state';
import { uploadImage } from '../api';
import { openNewDrawioDiagram } from './drawio-editor-controller';
import { DEFAULT_MERMAID_SOURCE } from './extensions/mermaid-block';

export interface SlashCommand {
  name: string;
  label: string;
  icon: string;
  description: string;
  group?: string;
  keywords?: string[];
  needsInput?: { label: string; placeholder: string };
  children?: SlashCommand[];
  action: (editor: any, input?: string) => void;
}

export const SLASH_COMMAND_GROUPS = [
  { key: 'basic', label: 'Basic' },
  { key: 'insert', label: 'Insert' },
  { key: 'diagrams', label: 'Diagrams' },
] as const;

/** Set by the Editor component so slash commands can access the active file path. */
let _activeDocPath = '';
export function setActiveDocPath(path: string) {
  _activeDocPath = path;
}
export function getActiveDocPath(): string {
  return _activeDocPath;
}

export const slashCommands: SlashCommand[] = [
  // -- Basic --
  {
    name: 'heading',
    label: 'Heading',
    icon: 'H',
    description: 'Section heading',
    group: 'basic',
    keywords: ['h1', 'h2', 'h3', 'h4', 'title', 'section'],
    action: () => {}, // handled via children
    children: [
      {
        name: 'heading1',
        label: 'Heading 1',
        icon: 'H1',
        description: 'Top-level heading',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        name: 'heading2',
        label: 'Heading 2',
        icon: 'H2',
        description: 'Section heading',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        name: 'heading3',
        label: 'Heading 3',
        icon: 'H3',
        description: 'Subsection heading',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        name: 'heading4',
        label: 'Heading 4',
        icon: 'H4',
        description: 'Deep heading',
        action: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
      },
    ],
  },
  {
    name: 'task',
    label: 'Task',
    icon: '☑',
    description: 'Task list item',
    group: 'basic',
    keywords: ['todo', 'checkbox', 'list', 'checklist'],
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    name: 'divider',
    label: 'Divider',
    icon: '—',
    description: 'Horizontal rule',
    group: 'basic',
    keywords: ['hr', 'separator', 'line', 'break'],
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    name: 'callout',
    label: 'Callout',
    icon: '❝',
    description: 'Callout / blockquote',
    group: 'basic',
    keywords: ['quote', 'note', 'aside', 'blockquote', 'info'],
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  // -- Insert --
  {
    name: 'table',
    label: 'Table',
    icon: '⊞',
    description: 'Insert a table',
    group: 'insert',
    keywords: ['grid', 'spreadsheet', 'rows', 'columns'],
    action: (editor) => {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  {
    name: 'code',
    label: 'Code Block',
    icon: '{ }',
    description: 'Code with syntax highlighting',
    group: 'insert',
    keywords: ['snippet', 'syntax', 'programming', 'pre'],
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    name: 'link',
    label: 'Link',
    icon: '⛓',
    description: 'Insert a link',
    group: 'insert',
    keywords: ['url', 'href', 'anchor', 'hyperlink'],
    needsInput: { label: 'URL', placeholder: 'https://...' },
    action: (editor, url) => {
      if (url) {
        editor.chain().focus().setLink({ href: url }).run();
      }
    },
  },
  {
    name: 'image',
    label: 'Image',
    icon: '🖼',
    description: 'Insert an image',
    group: 'insert',
    keywords: ['picture', 'photo', 'upload', 'img'],
    action: (editor) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const { relativePath } = await uploadImage(file, _activeDocPath);
          editor.chain().focus().setImage({ src: relativePath, alt: 'image' }).run();
        } catch (err) {
          console.error('Image upload failed:', err);
        }
      };
      input.click();
    },
  },
  // -- Diagrams --
  {
    name: 'mermaid',
    label: 'Mermaid Diagram',
    icon: '◇',
    description: 'Insert a diagram',
    group: 'diagrams',
    keywords: ['flowchart', 'graph', 'sequence', 'chart'],
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: DEFAULT_MERMAID_SOURCE }],
        })
        .run();
    },
  },
  {
    name: 'toc',
    label: 'Table of Contents',
    icon: '☰',
    description: 'Insert a table of contents',
    group: 'diagrams',
    keywords: ['outline', 'navigation', 'contents', 'index'],
    action: (editor) => {
      editor.chain().focus().insertContent({ type: 'tableOfContents' }).run();
    },
  },
  {
    name: 'drawio',
    label: 'draw.io Diagram',
    icon: '◈',
    description: 'Create a draw.io diagram',
    group: 'diagrams',
    keywords: ['diagram', 'whiteboard', 'sketch', 'drawing'],
    action: (editor) => {
      openNewDrawioDiagram(editor, _activeDocPath);
    },
  },
];

export interface SlashMenuState {
  active: boolean;
  query: string;
  position: { top: number; left: number };
  filteredCommands: SlashCommand[];
  selectedIndex: number;
  /** When set, we're showing the children of a parent command */
  submenu?: {
    parent: SlashCommand;
    items: SlashCommand[];
    selectedIndex: number;
  };
}

export const slashMenuPluginKey = new PluginKey('slashMenu');

function scoreCommand(cmd: SlashCommand, query: string): number {
  const lowerName = cmd.name.toLowerCase();
  const lowerLabel = cmd.label.toLowerCase();
  if (lowerName === query) return 100;
  if (lowerLabel.startsWith(query)) return 80;
  if (lowerName.includes(query) || lowerLabel.includes(query)) return 60;
  if (cmd.keywords) {
    for (const kw of cmd.keywords) {
      const lowerKw = kw.toLowerCase();
      if (lowerKw.startsWith(query)) return 40;
      if (lowerKw.includes(query)) return 20;
    }
  }
  return 0;
}

function scoreAndFilter(commands: SlashCommand[], query: string): SlashCommand[] {
  const scored = commands
    .map((cmd, i) => ({ cmd, score: scoreCommand(cmd, query), index: i }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((x) => x.cmd);
}

export function createSlashMenuPlugin(
  onStateChange: (state: SlashMenuState | null) => void,
  onExecuteCommand: (cmd: SlashCommand) => void,
) {
  let editable = true;
  return new Plugin({
    key: slashMenuPluginKey,
    state: {
      init() {
        return null;
      },
      apply(tr, _prev, _oldState, newState) {
        const prev = _prev as SlashMenuState | null;
        const meta = tr.getMeta(slashMenuPluginKey);
        if (meta !== undefined) return meta;

        // Don't activate in read-only mode (e.g. version preview)
        if (!editable) return null;

        if (!tr.docChanged && !tr.selectionSet) return prev;

        const { $from } = newState.selection;

        // Don't activate slash commands inside code blocks or inline code
        if ($from.parent.type.spec.code || $from.parent.type.name === 'codeBlock') {
          return null;
        }

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
        const slashMatch = textBefore.match(/\/(\w*)$/);

        if (slashMatch) {
          const query = slashMatch[1].toLowerCase();
          const filtered = query
            ? scoreAndFilter(slashCommands, query)
            : slashCommands;
          return {
            active: true,
            query,
            filteredCommands: filtered,
            selectedIndex: prev?.active
              ? Math.min(prev.selectedIndex, Math.max(filtered.length - 1, 0))
              : 0,
            position: prev?.position ?? { top: 0, left: 0 },
          };
        }

        return null;
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashMenuPluginKey.getState(view.state);
        if (!state?.active) return false;

        const inSubmenu = !!state.submenu;
        const items = inSubmenu ? state.submenu!.items : state.filteredCommands;
        const currentIndex = inSubmenu ? state.submenu!.selectedIndex : state.selectedIndex;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const newIndex = Math.min(currentIndex + 1, items.length - 1);
          if (inSubmenu) {
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
              ...state,
              submenu: { ...state.submenu!, selectedIndex: newIndex },
            }));
          } else {
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { ...state, selectedIndex: newIndex }));
          }
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const newIndex = Math.max(currentIndex - 1, 0);
          if (inSubmenu) {
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
              ...state,
              submenu: { ...state.submenu!, selectedIndex: newIndex },
            }));
          } else {
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { ...state, selectedIndex: newIndex }));
          }
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          if (inSubmenu) {
            // Execute the submenu child command
            const cmd = state.submenu!.items[state.submenu!.selectedIndex];
            if (cmd) {
              const { $from } = view.state.selection;
              const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
              const slashMatch = textBefore.match(/\/(\w*)$/);
              if (slashMatch) {
                const from = $from.pos - slashMatch[0].length;
                const to = $from.pos;
                view.dispatch(view.state.tr.delete(from, to).setMeta(slashMenuPluginKey, null));
              }
              setTimeout(() => onExecuteCommand(cmd), 0);
            }
          } else {
            const cmd = state.filteredCommands[state.selectedIndex];
            if (cmd) {
              if (cmd.children?.length) {
                // Open submenu
                view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
                  ...state,
                  submenu: { parent: cmd, items: cmd.children, selectedIndex: 0 },
                }));
              } else {
                // Delete slash text and execute
                const { $from } = view.state.selection;
                const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
                const slashMatch = textBefore.match(/\/(\w*)$/);
                if (slashMatch) {
                  const from = $from.pos - slashMatch[0].length;
                  const to = $from.pos;
                  view.dispatch(view.state.tr.delete(from, to).setMeta(slashMenuPluginKey, null));
                }
                setTimeout(() => onExecuteCommand(cmd), 0);
              }
            }
          }
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (inSubmenu) {
            // Go back to parent menu
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
              ...state,
              submenu: undefined,
            }));
          } else {
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, null));
          }
          return true;
        }
        // ArrowLeft also goes back from submenu
        if (event.key === 'ArrowLeft' && inSubmenu) {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
            ...state,
            submenu: undefined,
          }));
          return true;
        }
        // ArrowRight opens submenu on item with children
        if (event.key === 'ArrowRight' && !inSubmenu) {
          const cmd = state.filteredCommands[state.selectedIndex];
          if (cmd?.children?.length) {
            event.preventDefault();
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, {
              ...state,
              submenu: { parent: cmd, items: cmd.children, selectedIndex: 0 },
            }));
            return true;
          }
        }

        return false;
      },
    },
    view(v) {
      editable = v.editable;
      return {
        update(view) {
          editable = view.editable;
          const state = slashMenuPluginKey.getState(view.state);
          if (state?.active) {
            const coords = view.coordsAtPos(view.state.selection.from);
            onStateChange({
              ...state,
              position: { top: coords.bottom + 6, left: coords.left },
            });
          } else {
            onStateChange(state);
          }
        },
      };
    },
  });
}
