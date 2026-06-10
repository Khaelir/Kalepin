import type { OTMessage, OTAck } from './ot';

export interface PresenceMessage {
  type: 'presence';
  docId: string;
  userId: string;
  cursor: number | null;
  selection: { from: number; to: number } | null;
}

export interface CommentNewMessage {
  type: 'comment:new';
  docId: string;
  comment: CommentPayload;
}

export interface CommentUpdateMessage {
  type: 'comment:update';
  docId: string;
  comment: CommentPayload;
}

export interface CommentDeleteMessage {
  type: 'comment:delete';
  docId: string;
  commentId: string;
}

export interface FileChangedMessage {
  type: 'file:changed';
  path: string;
}

export interface FileTreeUpdateMessage {
  type: 'file:tree-update';
  event: 'add' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
}

export interface FlushedMessage {
  type: 'flushed';
  docId: string;
}

export interface FlushErrorMessage {
  type: 'flush:error';
  docId: string;
  error?: string;
}

export interface CommentPayload {
  id: string;
  threadId: string;
  blockId: string;
  author: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
}

export type WSMessage =
  | OTMessage
  | OTAck
  | PresenceMessage
  | CommentNewMessage
  | CommentUpdateMessage
  | CommentDeleteMessage
  | FileChangedMessage
  | FileTreeUpdateMessage
  | FlushedMessage
  | FlushErrorMessage;
