import { describe, it, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { CommentsService } from './comments.service';

describe('CommentsService - async embeddings', () => {
  let service: CommentsService;
  let sidecarMock: any;
  let searchServiceMock: any;
  let notificationServiceMock: any;
  let mentionTrackingMock: any;
  let starsServiceMock: any;

  beforeEach(() => {
    sidecarMock = {
      read: mock.fn(async () => ({ comments: {} })),
      write: mock.fn(async () => {}),
    };
    searchServiceMock = {
      indexNoteComments: mock.fn(async () => {}),
      indexCommentEmbeddings: mock.fn(async () => {}),
    };
    notificationServiceMock = { resolveUserId: mock.fn(async () => null) };
    mentionTrackingMock = {
      shouldSend: mock.fn(async () => false),
      recordSent: mock.fn(async () => {}),
      collectThreadParticipants: mock.fn(() => new Set()),
    };
    starsServiceMock = { autoStarForUser: mock.fn(async () => {}) };

    const dailyStatsMock = {
      trackCommentAdded: mock.fn(() => {}),
      trackCommentResolved: mock.fn(() => {}),
    };

    service = new CommentsService(
      sidecarMock,
      searchServiceMock,
      dailyStatsMock as any,
      notificationServiceMock,
      mentionTrackingMock,
      starsServiceMock,
    );
  });

  it('addComment returns before embedding completes', async () => {
    let embeddingResolved = false;
    searchServiceMock.indexCommentEmbeddings = mock.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            embeddingResolved = true;
            resolve();
          }, 100),
        ),
    );

    const result = await service.addComment('test.md', 'block1', 'alice@test.com', 'hello');
    assert.ok(result.thread);
    assert.ok(result.comment);
    assert.equal(embeddingResolved, false, 'embedding should not have completed yet');
    assert.equal(searchServiceMock.indexNoteComments.mock.calls.length, 1, 'FTS indexing should be synchronous');
  });

  it('addComment does not throw when embedding fails', async () => {
    searchServiceMock.indexCommentEmbeddings = mock.fn(async () => {
      throw new Error('ONNX model not ready');
    });

    const result = await service.addComment('test.md', 'block1', 'alice@test.com', 'hello');
    assert.ok(result.thread);
    assert.ok(result.comment);
  });

  it('replyToThread returns before embedding completes', async () => {
    // Set up a thread to reply to
    const existingThread = {
      id: 'thread-1',
      blockId: 'block1',
      comments: [{ id: 'c1', author: 'bob@test.com', text: 'initial', createdAt: new Date().toISOString() }],
      resolved: false,
    };
    sidecarMock.read = mock.fn(async () => ({
      comments: { block1: { threads: [existingThread] } },
    }));

    let embeddingResolved = false;
    searchServiceMock.indexCommentEmbeddings = mock.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            embeddingResolved = true;
            resolve();
          }, 100),
        ),
    );

    const result = await service.replyToThread('test.md', 'block1', 'thread-1', 'alice@test.com', 'reply');
    assert.ok(result);
    assert.equal(embeddingResolved, false, 'embedding should not have completed yet');
    assert.equal(searchServiceMock.indexNoteComments.mock.calls.length, 1, 'FTS indexing should be synchronous');
  });

  it('replyToThread does not throw when embedding fails', async () => {
    const existingThread = {
      id: 'thread-1',
      blockId: 'block1',
      comments: [{ id: 'c1', author: 'bob@test.com', text: 'initial', createdAt: new Date().toISOString() }],
      resolved: false,
    };
    sidecarMock.read = mock.fn(async () => ({
      comments: { block1: { threads: [existingThread] } },
    }));
    searchServiceMock.indexCommentEmbeddings = mock.fn(async () => {
      throw new Error('ONNX model not ready');
    });

    const result = await service.replyToThread('test.md', 'block1', 'thread-1', 'alice@test.com', 'reply');
    assert.ok(result);
  });

  it('addGuestComment marks the comment as unverified and skips mention notifications', async () => {
    // Mention text — must NOT trigger notifications even though it parses to a
    // valid email pattern. The whole point of guest mode is that anyone can
    // type anything; treating @alice@example.com as an addressable mention
    // would let guests trigger arbitrary outbound emails.
    const result = await service.addGuestComment(
      'test.md',
      'block1',
      'troll@example.com',
      'Display Name',
      'hi @alice@example.com',
    );
    assert.equal(result.comment.author, 'troll@example.com');
    assert.equal(result.comment.authorName, 'Display Name');
    assert.equal(result.comment.authorVerified, false);
    // Mention-tracking must NOT be invoked: any guest comment containing an
    // @-mention would otherwise blast outbound notifications. This assertion
    // is the single most important security check in the file.
    assert.equal(notificationServiceMock.resolveUserId.mock.calls.length, 0);
    assert.equal(mentionTrackingMock.recordSent.mock.calls.length, 0);
  });

  it('replyToGuestThread reply also marks unverified and skips notifications', async () => {
    const existingThread = {
      id: 'thread-1',
      blockId: 'block1',
      comments: [{ id: 'c1', author: 'bob@test.com', text: 'initial', createdAt: new Date().toISOString() }],
      resolved: false,
    };
    sidecarMock.read = mock.fn(async () => ({
      comments: { block1: { threads: [existingThread] } },
    }));
    const reply = await service.replyToGuestThread(
      'test.md',
      'block1',
      'thread-1',
      'guest@example.com',
      'Display Name',
      'reply text',
    );
    assert.equal(reply.author, 'guest@example.com');
    assert.equal(reply.authorName, 'Display Name');
    assert.equal(reply.authorVerified, false);
  });
});
