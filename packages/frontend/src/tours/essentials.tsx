import type { TourDefinition } from './types';

export const TUTORIAL_CONTENT = `# Getting Started

Welcome to your collaborative markdown workspace.

## Write Together

Your team can edit notes in real-time. Use slash commands to insert tables, code blocks, and more.

## Stay in Sync

Comments and changes keep everyone on the same page.
`;

export function createEssentialsTour(): TourDefinition {
  return {
    id: 'essentials',
    version: 1,
    name: 'Getting Started',
    description: 'Learn the basics of Kalepin',
    steps: [
      {
        id: 'welcome',
        type: 'passive',
        target: null,
        title: 'Welcome to Kalepin',
        body: 'Your collaborative markdown workspace. Let\u2019s get you started.',
      },
      {
        id: 'create-note',
        type: 'active',
        target: '.new-file-btn',
        title: 'Create a note',
        body: 'Click here to create your first note.',
        position: 'right',
        waitFor: 'file-modal-opened',
      },
      {
        id: 'name-it',
        type: 'active',
        target: '.modal-card',
        title: 'Name it',
        body: 'This is your tutorial note. Click Create to continue.',
        position: 'bottom',
        waitFor: 'file-created',
      },
      {
        id: 'try-slash',
        type: 'active',
        target: '.tiptap',
        title: 'Try a slash command',
        body: 'Type / to see what you can insert.',
        position: 'top',
        waitFor: 'slash-menu-opened',
        onEnter: () => {
          // Focus the editor and place cursor at the end
          setTimeout(() => {
            const el = document.querySelector('.tiptap') as HTMLElement | null;
            if (!el) return;
            el.focus();
            // Move cursor to the very end of the document
            const sel = window.getSelection();
            if (sel) {
              sel.selectAllChildren(el);
              sel.collapseToEnd();
            }
            // Scroll to bottom
            const container = document.querySelector('.editor-container');
            if (container) container.scrollTop = container.scrollHeight;
          }, 200);
        },
      },
      {
        id: 'insert-table',
        type: 'active',
        target: '.slash-menu',
        title: 'Insert a table',
        body: 'Select Table from the menu.',
        position: 'right',
        waitFor: 'table-inserted',
      },
      {
        id: 'slash-explained',
        type: 'passive',
        target: '.editor-content',
        title: 'Slash commands',
        body: 'Tables, tasks, code blocks, callouts \u2014 all from /.',
        position: 'top',
      },
      {
        id: 'search',
        type: 'passive',
        target: '.kp-topbar-search',
        title: 'Find anything',
        body: '\u2318K to search across all your notes.',
        position: 'bottom',
      },
      {
        id: 'comments',
        type: 'passive',
        target: '.kp-rail',
        title: 'Start a discussion',
        body: 'Select text and add a comment. Your team sees it in real-time.',
        position: 'left',
        noDim: true,
        onEnter: () => {
          // Scroll editor to top so the quoted text is visible
          const container = document.querySelector('.editor-container');
          if (container) container.scrollTop = 0;
        },
      },
      {
        id: 'changes-click',
        type: 'active',
        target: '.changes-badge-btn',
        title: 'See what changed',
        body: 'Click here to see recent edits from your team.',
        position: 'bottom',
        waitFor: 'changes-opened',
      },
      {
        id: 'changes-diff-click',
        type: 'active',
        target: '.changes-toggle-diff[data-path="roadmap.md"]',
        title: 'Inspect a change',
        body: 'Click "Show diff" to see what was modified.',
        position: 'bottom',
        waitFor: 'diff-expanded',
        noDim: true,
      },
      {
        id: 'changes-diff-view',
        type: 'passive',
        target: '.changes-diff',
        title: 'Line-by-line diffs',
        body: 'Green lines are additions, red lines are deletions. You always know exactly what changed.',
        position: 'bottom',
        noDim: true,
      },
      {
        id: 'done',
        type: 'passive',
        target: null,
        title: 'You\u2019re all set!',
        body: 'Hit ? anytime to revisit or discover new features.',
      },
    ],
  };
}
