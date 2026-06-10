import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { MentionNode } from '../editor/extensions/mention-node';
import { createMentionMenuPlugin, selectMentionUser, type MentionMenuState } from '../editor/mention-autocomplete';
import { MentionAutocompleteMenu } from '../editor/MentionAutocompleteMenu';
import type { Node as PMNode } from '@tiptap/pm/model';

interface CommentReplyEditorProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  /** Inline notice shown above the editor (e.g. mention-suppression warning for personal docs). */
  notice?: React.ReactNode;
}

function serialize(doc: PMNode): string {
  const parts: string[] = [];
  doc.content.forEach((block, _offset, index) => {
    if (index > 0) parts.push('\n');
    block.content.forEach((node) => {
      if (node.type.name === 'mention') {
        const email = node.attrs.email || '';
        const name = email.split('@')[0] || email;
        parts.push(`@[${name}](${email})`);
      } else if (node.isText) {
        parts.push(node.text || '');
      }
    });
  });
  return parts.join('');
}

export function CommentReplyEditor({ onSubmit, onCancel, placeholder = 'Write a reply...', notice }: CommentReplyEditorProps) {
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState | null>(null);

  const MentionMenuExtension = Extension.create({
    name: 'mentionMenu',
    addProseMirrorPlugins() {
      return [createMentionMenuPlugin(setMentionMenu)];
    },
  });

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      MentionNode,
      MentionMenuExtension,
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: 'comment-reply-editor',
      },
    },
  });

  useEffect(() => {
    if (editor) {
      requestAnimationFrame(() => {
        editor.commands.focus();
      });
    }
  }, [editor]);

  const handleSubmit = () => {
    if (!editor) return;
    const text = serialize(editor.state.doc);
    if (!text.trim()) return;
    onSubmit(text);
  };

  return (
    <div className="comment-reply-editor-wrapper">
      {notice && <div className="comment-mention-notice">{notice}</div>}
      <EditorContent editor={editor} />
      {mentionMenu?.active && editor && (
        <MentionAutocompleteMenu
          state={mentionMenu}
          onSelect={(index) => {
            const user = mentionMenu.users[index];
            if (user) selectMentionUser(editor.view, user);
          }}
        />
      )}
      <div className="reply-actions">
        <button onClick={handleSubmit}>Reply</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
