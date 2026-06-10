import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'http';
import { McpService } from './mcp.service';

type LogCall = {
  toolName: string;
  userId: number;
  apiKeyId: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  opts?: { errorMessage?: string };
};

function makeStatsServiceStub() {
  const calls: LogCall[] = [];
  return {
    calls,
    logToolCall: async (
      toolName: string,
      userId: number,
      apiKeyId: number | null,
      durationMs: number,
      success: boolean,
      error?: string,
      opts?: { resultCount?: number; errorMessage?: string },
    ) => {
      calls.push({ toolName, userId, apiKeyId, durationMs, success, error, opts });
    },
  };
}

function makeFakeRes() {
  let statusCode = 0;
  let body = '';
  const headers: Record<string, string> = {};
  const res: any = {
    writeHead: (code: number, h?: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, h || {});
    },
    end: (chunk?: string) => {
      if (chunk) body += chunk;
    },
  };
  return {
    res: res as ServerResponse,
    get statusCode() { return statusCode; },
    get body() { return body; },
    get headers() { return headers; },
  };
}

function makeFakeReq(sessionId: string) {
  return {
    headers: { 'mcp-session-id': sessionId },
  } as unknown as IncomingMessage;
}

function makeMcpServiceWithStub() {
  const stats = makeStatsServiceStub();
  // Constructor order: files, search, comments, changeTracking, stats, ot, attachments, encryptionPredicates, pinService, backup?
  const service = new McpService(
    null as any,
    null as any,
    null as any,
    null as any,
    stats as any,
    null as any,
    null as any,
    {
      isEncryptedAtRest: () => false,
      isE2EEncrypted: () => false,
      shouldIndexPlaintext: () => true,
      canCollab: () => true,
      commentBodiesEncrypted: () => false,
      shareLinkMintable: () => true,
    } as any,
    {
      hasPin: async () => false,
      validateUnlockToken: () => null,
    } as any,
    {
      visibilityFor: async () => ({ kind: 'owner' }),
      assertReadableBy: async () => {},
      assertWritableBy: async () => {},
      assertCommentableBy: async () => {},
      visibleGrantSet: async () => new Set<string>(),
    } as any,
  );
  return { service, stats };
}

describe('mcp.service session-user binding', () => {
  const cleanups: (() => void)[] = [];
  function makeServiceTracked() {
    const made = makeMcpServiceWithStub();
    cleanups.push(() => made.service.onModuleDestroy());
    return made;
  }
  after(() => { for (const fn of cleanups) fn(); });

  it('rejects cross-user session reuse with 403 and does not invoke the session transport', async () => {
    const { service, stats } = makeServiceTracked();

    let transportCalled = false;
    const fakeSession: any = {
      transport: {
        handleRequest: async () => {
          transportCalled = true;
        },
      },
      server: {} as any,
      userId: 1, // session belongs to user A
      userEmail: 'a@example.com',
      lastActivity: Date.now() - 1000,
    };
    (service as any).sessions.set('sid-A', fakeSession);

    const req = makeFakeReq('sid-A');
    const captured = makeFakeRes();

    // user B presents user A's session
    await service.handleRequest(req, captured.res, {}, { sub: 2, email: 'b@example.com' });

    assert.equal(captured.statusCode, 403);
    assert.deepEqual(JSON.parse(captured.body), { error: 'session_user_mismatch' });
    assert.equal(transportCalled, false, 'session transport must not be invoked on mismatch');
    // session must not be touched
    assert.equal(fakeSession.lastActivity < Date.now() - 100, true, 'lastActivity must not be bumped');

    // and the rejection is logged
    assert.equal(stats.calls.length, 1);
    assert.equal(stats.calls[0].toolName, 'mcp.session_mismatch');
    assert.equal(stats.calls[0].userId, 2);
    assert.equal(stats.calls[0].success, false);
    assert.equal(stats.calls[0].error, 'session_user_mismatch');
  });

  it('allows same-user session reuse (regression check)', async () => {
    const { service } = makeServiceTracked();

    let transportCalled = false;
    const fakeSession: any = {
      transport: {
        handleRequest: async () => {
          transportCalled = true;
        },
      },
      server: {} as any,
      userId: 7,
      userEmail: 'same@example.com',
      lastActivity: 0,
    };
    (service as any).sessions.set('sid-X', fakeSession);

    const req = makeFakeReq('sid-X');
    const captured = makeFakeRes();

    await service.handleRequest(req, captured.res, {}, { sub: 7, email: 'same@example.com' });

    assert.equal(transportCalled, true, 'same-user reuse must invoke the session transport');
    assert.equal(captured.statusCode, 0, 'no error response should be written');
    assert.ok(fakeSession.lastActivity > 0, 'lastActivity should be bumped');
  });

  it('rejects cross-user DELETE on existing session with 403', async () => {
    const { service } = makeServiceTracked();

    let closed = false;
    const fakeSession: any = {
      transport: { close: async () => { closed = true; } },
      server: {} as any,
      userId: 1,
      userEmail: 'a@example.com',
      lastActivity: Date.now(),
    };
    (service as any).sessions.set('sid-D', fakeSession);

    const req = makeFakeReq('sid-D');
    const captured = makeFakeRes();

    await service.handleDeleteSession(req, captured.res, { sub: 99, email: 'attacker@example.com' });

    assert.equal(captured.statusCode, 403);
    assert.deepEqual(JSON.parse(captured.body), { error: 'session_user_mismatch' });
    assert.equal(closed, false, 'session transport must not be closed by a mismatched user');
    assert.ok((service as any).sessions.has('sid-D'), 'session must remain intact');
  });
});
