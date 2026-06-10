import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { ShareLinksController } from './share-links.controller';
import { isVisibleTo } from '../auth/visibility';

interface StubServiceCall {
  method: string;
  args: unknown[];
}

class StubService {
  calls: StubServiceCall[] = [];
  // Behavior knobs flipped per-test
  resolveResult:
    | { kind: 'ok'; path: string }
    | { kind: 'gone'; reason: 'revoked' | 'expired' }
    | { kind: 'not_found' } = { kind: 'not_found' };
  pathForGone: string | null = null;
  infoForGone: {
    path: string;
    createdByEmail: string | null;
    allow_guest_comments?: boolean;
  } | null = null;
  guestCommentingAllowedResult = false;
  findByPathResult: {
    code: string;
    expires_at: number | null;
    revoked_at: number | null;
    created_at: number;
    last_resolved_at: number | null;
    created_by_email: string | null;
    allow_guest_comments: boolean;
  } | null = null;

  async mintExplicit(input: {
    path: string;
    ttlMs?: number | null;
    createdByEmail: string | null;
  }): Promise<{ code: string }> {
    this.calls.push({ method: 'mintExplicit', args: [input] });
    return { code: 'STUBCODE' };
  }
  async resolve(code: string) {
    this.calls.push({ method: 'resolve', args: [code] });
    return this.resolveResult;
  }
  async revoke(code: string) {
    this.calls.push({ method: 'revoke', args: [code] });
  }
  async findByPath(path: string) {
    this.calls.push({ method: 'findByPath', args: [path] });
    return this.findByPathResult;
  }
  async pathForCodeIncludingGone(code: string) {
    this.calls.push({ method: 'pathForCodeIncludingGone', args: [code] });
    return this.pathForGone;
  }
  async infoForCodeIncludingGone(code: string) {
    this.calls.push({ method: 'infoForCodeIncludingGone', args: [code] });
    if (!this.infoForGone) return null;
    return {
      path: this.infoForGone.path,
      createdByEmail: this.infoForGone.createdByEmail,
      allow_guest_comments: !!this.infoForGone.allow_guest_comments,
      handleId: null,
    };
  }
  async guestCommentingAllowed(code: string) {
    this.calls.push({ method: 'guestCommentingAllowed', args: [code] });
    return this.guestCommentingAllowedResult;
  }
  async setAllowGuestComments(code: string, value: boolean) {
    this.calls.push({ method: 'setAllowGuestComments', args: [code, value] });
  }
}

function makeReq(email: string): any {
  return { user: { email } };
}

// Mirrors GrantAwareVisibility's behaviour for the path classes the tests use.
// Owner of a personal path = `_users/<email>/...` matches; everyone else 404.
// Shared-vault paths (no _users/ prefix) are visible to all authenticated users
// (no grant lookup in this stub — tests covering grant behaviour live in the
// grant-aware-visibility test file).
const visibilityStub = {
  assertReadableBy: async (path: string, email: string) => {
    if (!isVisibleTo(path, email)) throw new NotFoundException();
  },
  assertWritableBy: async (path: string, email: string) => {
    if (!isVisibleTo(path, email)) throw new NotFoundException();
  },
} as any;

const pinStub = { hasPin: async () => false } as any;

const accessLogStub = { record: async () => null } as any;

const tokenStub = {
  mintAccessToken: () => ({ token: 'STUB.TOKEN', expiresAt: Date.now() + 60000 }),
  mintAssetToken: () => ({ token: 'STUB.ASSET', expiresAt: Date.now() + 60000 }),
  verifyAccessToken: () => ({ code: 'STUBCODE', path: 'Notes/team.md' }),
  verifyAssetToken: () => ({ code: 'STUBCODE', assetPath: 'img/x.png' }),
} as any;

const storageStub = {
  exists: async () => true,
  read: async () => 'stub content',
  write: async () => {},
  delete: async () => {},
  move: async () => {},
  list: async () => [],
  watch: () => {},
} as any;

const attachmentsStub = {
  serveForShareLink: async () => ({
    buffer: Buffer.from('img-bytes'),
    contentType: 'image/png',
  }),
} as any;

const commentsStub = {
  addGuestComment: async (..._args: any[]) => ({
    thread: { id: 'T1', blockId: 'B1', comments: [], resolved: false },
    comment: { id: 'C1', author: 'guest@x.com', text: 'hi', createdAt: '' },
  }),
  replyToGuestThread: async (..._args: any[]) => ({
    id: 'C2', author: 'guest@x.com', text: 'reply', createdAt: '',
  }),
} as any;

const docHandlesStub = {
  findOrCreateForPath: async () => 'AAAAAAAAAAAAAAAA',
  forPath: async () => null,
  resolve: async () => ({ path: 'Notes/team.md', tombstoned: false }),
} as any;

function makeCtrl(svc: StubService) {
  return new ShareLinksController(
    svc as any,
    pinStub,
    visibilityStub,
    accessLogStub,
    tokenStub,
    storageStub,
    attachmentsStub,
    commentsStub,
    docHandlesStub,
  );
}

describe('ShareLinksController.create — visibility gating', () => {
  it('rejects foreign personal path with 404 and never calls the service', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.create({ path: '_users/alice@example.com/secret.md' }, bob),
      { name: 'NotFoundException' },
    );
    assert.equal(stub.calls.length, 0, 'service must NOT be called when assertReadableBy fails');
  });

  it('allows owner to mint on their own personal path', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.create(
      { path: '_users/alice@example.com/diary.md' },
      alice,
    );
    assert.equal(result.code, 'STUBCODE');
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].method, 'mintExplicit');
  });

  it('allows any authenticated user to mint on a shared path', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    const result = await ctrl.create({ path: 'Notes/team-update.md' }, bob);
    assert.equal(result.code, 'STUBCODE');
  });

  it('LIKE-injection variant: johnxdoe cannot mint for john_doe\'s personal path', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const bob = makeReq('johnxdoe@x.com');
    await assert.rejects(
      () => ctrl.create({ path: '_users/john_doe@x.com/secret.md' }, bob),
      { name: 'NotFoundException' },
    );
    assert.equal(stub.calls.length, 0);
  });
});

describe('ShareLinksController.create — TTL defaults', () => {
  it('passes default 30-day ttl for personal paths', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await ctrl.create({ path: '_users/alice@example.com/diary.md' }, alice);
    const arg = stub.calls[0].args[0] as { ttlMs: number | null };
    assert.equal(arg.ttlMs, 30 * 24 * 60 * 60 * 1000);
  });

  it('passes null ttl for shared-vault paths', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await ctrl.create({ path: 'Notes/team.md' }, alice);
    const arg = stub.calls[0].args[0] as { ttlMs: number | null };
    assert.equal(arg.ttlMs, null);
  });

  it('honours explicit ttl_ms in the body', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await ctrl.create(
      { path: '_users/alice@example.com/diary.md', ttl_ms: 7 * 86400 * 1000 },
      alice,
    );
    const arg = stub.calls[0].args[0] as { ttlMs: number | null };
    assert.equal(arg.ttlMs, 7 * 86400 * 1000);
  });

  it('honours explicit ttl_ms = null (never)', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await ctrl.create(
      { path: '_users/alice@example.com/diary.md', ttl_ms: null },
      alice,
    );
    const arg = stub.calls[0].args[0] as { ttlMs: number | null };
    assert.equal(arg.ttlMs, null);
  });
});

describe('ShareLinksController.revoke — creator-only gate', () => {
  it('creator of the link can revoke', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: 'Notes/team.md',
      createdByEmail: 'alice@example.com',
    };
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.revoke('CODE000001', alice);
    assert.deepEqual(result, { ok: true });
    assert.ok(stub.calls.find((c) => c.method === 'revoke'));
  });

  it('non-creator with read access is forbidden', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: 'Notes/team.md',
      createdByEmail: 'alice@example.com',
    };
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.revoke('CODE000001', bob),
      ForbiddenException,
    );
    assert.equal(stub.calls.find((c) => c.method === 'revoke'), undefined);
  });

  it('admin (per ADMIN_EMAILS) can revoke a link they did not create', async () => {
    process.env.ADMIN_EMAILS = 'root@example.com';
    try {
      const stub = new StubService();
      stub.infoForGone = {
        path: '_users/alice@example.com/diary.md',
        createdByEmail: 'alice@example.com',
      };
      const ctrl = makeCtrl(stub);
      const root = makeReq('root@example.com');
      const result = await ctrl.revoke('CODE000001', root);
      assert.deepEqual(result, { ok: true });
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it('legacy auto-minted row (createdByEmail=null): owner can revoke', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: '_users/alice@example.com/diary.md',
      createdByEmail: null,
    };
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.revoke('CODE000001', alice);
    assert.deepEqual(result, { ok: true });
  });

  it('legacy auto-minted row (createdByEmail=null): non-owner non-admin is forbidden', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: '_users/alice@example.com/diary.md',
      createdByEmail: null,
    };
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.revoke('CODE000001', bob),
      ForbiddenException,
    );
  });

  it('case-insensitive creator match', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: 'Notes/team.md',
      createdByEmail: 'Alice@Example.COM',
    };
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.revoke('CODE000001', alice);
    assert.deepEqual(result, { ok: true });
  });

  it('returns 404 when the code does not exist', async () => {
    const stub = new StubService();
    stub.infoForGone = null;
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await assert.rejects(
      () => ctrl.revoke('CODE000001', alice),
      NotFoundException,
    );
  });
});

describe('ShareLinksController.create — write-permission gate', () => {
  it('write-only stub: read-only grantee is forbidden', async () => {
    // Override the default visibility stub: simulate Bob having read but not
    // write on a shared-vault path. assertReadableBy passes; assertWritableBy
    // throws ForbiddenException. With the new gate, mint must fail.
    const stub = new StubService();
    const ctrl = new ShareLinksController(
      stub as any,
      pinStub,
      {
        assertReadableBy: async () => {},
        assertWritableBy: async () => {
          throw new ForbiddenException('Write permission required');
        },
      } as any,
      accessLogStub,
      tokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.create({ path: 'Notes/team.md' }, bob),
      ForbiddenException,
    );
    assert.equal(stub.calls.length, 0, 'service must NOT be called when assertWritableBy fails');
  });
});

describe('ShareLinksController.byPath', () => {
  it('owner can read metadata for their own path, with createdByEmail', async () => {
    const stub = new StubService();
    stub.findByPathResult = {
      code: 'STUBCODE01',
      expires_at: null,
      revoked_at: null,
      created_at: 1_700_000_000_000,
      last_resolved_at: null,
      created_by_email: 'alice@example.com',
      allow_guest_comments: false,
    };
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.byPath('_users/alice@example.com/diary.md', alice);
    assert.equal(result.code, 'STUBCODE01');
    assert.equal(result.created_by_email, 'alice@example.com');
    assert.equal(stub.calls.find((c) => c.method === 'findByPath')?.method, 'findByPath');
  });

  it('returns 404 when no share-link row exists for the path', async () => {
    // Regression: NestJS's Express adapter sends an empty body for a null
    // return, which the frontend cannot parse as JSON. Surface "no row" as
    // 404 so the frontend's existing 404 → null mapping kicks in.
    const stub = new StubService();
    stub.findByPathResult = null;
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await assert.rejects(
      () => ctrl.byPath('_users/alice@example.com/diary.md', alice),
      NotFoundException,
    );
  });

  it('non-owner of personal path gets 404', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.byPath('_users/alice@example.com/diary.md', bob),
      NotFoundException,
    );
    assert.equal(stub.calls.length, 0);
  });
});

describe('ShareLinksController.resolve — gone semantics', () => {
  it('returns 410 when the code is revoked', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'gone', reason: 'revoked' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.resolve('CODE000001', { user: { email: 'alice@example.com' }, headers: {} } as any),
      GoneException,
    );
  });

  it('returns 410 when the code is expired', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'gone', reason: 'expired' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.resolve('CODE000001', { user: { email: 'alice@example.com' }, headers: {} } as any),
      GoneException,
    );
  });

  it('returns 404 for unknown codes', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'not_found' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.resolve('CODE000001', { user: { email: 'alice@example.com' }, headers: {} } as any),
      NotFoundException,
    );
  });

  it('returns path + sharedByEmail + accessToken on success (no PIN)', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    stub.infoForGone = { path: 'Notes/team.md', createdByEmail: 'alice@example.com' };
    const ctrl = makeCtrl(stub);
    const result = await ctrl.resolve(
      'CODE000001',
      { user: { email: 'alice@example.com' }, headers: {} } as any,
    );
    assert.equal(result.path, 'Notes/team.md');
    assert.equal(result.sharedByEmail, 'alice@example.com');
    assert.equal(result.accessToken, 'STUB.TOKEN');
    assert.ok(result.accessTokenExpiresAt);
  });

  it('returns requiresPin=true and omits accessToken when path is PIN-locked', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/locked.md' };
    stub.infoForGone = { path: 'Notes/locked.md', createdByEmail: 'alice@example.com' };
    const pinHasPinStub = { hasPin: async () => true, validateUnlockToken: () => null } as any;
    const ctrl = new ShareLinksController(
      stub as any,
      pinHasPinStub,
      visibilityStub,
      accessLogStub,
      tokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    const result = await ctrl.resolve(
      'CODE000001',
      { headers: {} } as any,
    );
    assert.equal(result.requiresPin, true);
    assert.equal(result.accessToken, undefined);
    assert.equal(result.sharedByEmail, 'alice@example.com');
  });
});

describe('ShareLinksController.updateLink — PATCH gating', () => {
  it('creator can flip allow_guest_comments', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: 'Notes/team.md',
      createdByEmail: 'alice@example.com',
    };
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    const result = await ctrl.updateLink('CODE001', { allow_guest_comments: true }, alice);
    assert.deepEqual(result, { ok: true });
    const setCall = stub.calls.find((c) => c.method === 'setAllowGuestComments');
    assert.ok(setCall);
    assert.deepEqual(setCall.args, ['CODE001', true]);
  });

  it('non-creator non-admin is forbidden', async () => {
    const stub = new StubService();
    stub.infoForGone = {
      path: 'Notes/team.md',
      createdByEmail: 'alice@example.com',
    };
    const ctrl = makeCtrl(stub);
    const bob = makeReq('bob@example.com');
    await assert.rejects(
      () => ctrl.updateLink('CODE001', { allow_guest_comments: true }, bob),
      ForbiddenException,
    );
  });

  it('admin can flip the flag on a link they did not create', async () => {
    process.env.ADMIN_EMAILS = 'root@example.com';
    try {
      const stub = new StubService();
      stub.infoForGone = {
        path: '_users/alice@example.com/diary.md',
        createdByEmail: 'alice@example.com',
      };
      const ctrl = makeCtrl(stub);
      const root = makeReq('root@example.com');
      const result = await ctrl.updateLink('CODE001', { allow_guest_comments: false }, root);
      assert.deepEqual(result, { ok: true });
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it('404s when the code does not exist', async () => {
    const stub = new StubService();
    stub.infoForGone = null;
    const ctrl = makeCtrl(stub);
    const alice = makeReq('alice@example.com');
    await assert.rejects(
      () => ctrl.updateLink('CODE001', { allow_guest_comments: true }, alice),
      NotFoundException,
    );
  });
});

describe('ShareLinksController.postGuestComment — guest comment endpoint', () => {
  function makeCtxReq(path: string) {
    return {
      shareLinkContext: { code: 'CODE001', path },
      headers: {},
    } as any;
  }

  it('appends a comment when the link allows guest comments and validation passes', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = true;
    const ctrl = makeCtrl(stub);
    const result = await ctrl.postGuestComment(
      'CODE001',
      {
        blockId: 'B1',
        authorEmail: 'guest@example.com',
        authorName: 'A Guest',
        text: 'Hello!',
      },
      makeCtxReq('Notes/team.md'),
    );
    assert.ok((result as any).comment);
  });

  it('refuses with 403 when allow_guest_comments is false', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = false;
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.postGuestComment(
          'CODE001',
          {
            blockId: 'B1',
            authorEmail: 'guest@example.com',
            authorName: 'A Guest',
            text: 'Hi',
          },
          makeCtxReq('Notes/team.md'),
        ),
      ForbiddenException,
    );
  });

  it('refuses with 403 when shareLinkContext is missing', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = true;
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.postGuestComment(
          'CODE001',
          {
            blockId: 'B1',
            authorEmail: 'guest@example.com',
            authorName: 'A Guest',
            text: 'Hi',
          },
          { headers: {} } as any,
        ),
      ForbiddenException,
    );
  });

  it('400s on missing required fields', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = true;
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.postGuestComment(
          'CODE001',
          { blockId: 'B1', authorEmail: 'guest@x.com', authorName: 'g', text: '' },
          makeCtxReq('Notes/team.md'),
        ),
      BadRequestException,
    );
  });

  it('400s on syntactically invalid email', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = true;
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () =>
        ctrl.postGuestComment(
          'CODE001',
          { blockId: 'B1', authorEmail: 'not-an-email', authorName: 'g', text: 'hi' },
          makeCtxReq('Notes/team.md'),
        ),
      BadRequestException,
    );
  });

  it('400s when text exceeds 10KB', async () => {
    const stub = new StubService();
    stub.guestCommentingAllowedResult = true;
    const ctrl = makeCtrl(stub);
    const huge = 'x'.repeat(10_001);
    await assert.rejects(
      () =>
        ctrl.postGuestComment(
          'CODE001',
          { blockId: 'B1', authorEmail: 'g@x.com', authorName: 'g', text: huge },
          makeCtxReq('Notes/team.md'),
        ),
      BadRequestException,
    );
  });
});

describe('ShareLinksController.asset — scoped per-asset endpoint', () => {
  function makeRes() {
    const headers: Record<string, string> = {};
    let sent: Buffer | undefined;
    const res = {
      set: (k: string | Record<string, string>, v?: string) => {
        if (typeof k === 'object') Object.assign(headers, k);
        else if (v !== undefined) headers[k] = v;
        return res;
      },
      send: (b: Buffer) => { sent = b; return res; },
      get headers() { return headers; },
      get sent() { return sent; },
    } as any;
    return res;
  }

  it('streams the attachment when token verifies and link is active', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    const localTokenStub = {
      ...tokenStub,
      verifyAssetToken: () => ({ code: 'CODE001', assetPath: 'img.png' }),
    };
    const ctrl = new ShareLinksController(
      stub as any,
      pinStub,
      visibilityStub,
      accessLogStub,
      localTokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    const res = makeRes();
    await ctrl.asset('CODE001', 'img.png', 'tok.sig', { headers: {} } as any, res);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.ok(res.sent);
  });

  it('refuses when the asset token code does not match URL :code', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    const localTokenStub = {
      ...tokenStub,
      verifyAssetToken: () => ({ code: 'OTHER', assetPath: 'img.png' }),
    };
    const ctrl = new ShareLinksController(
      stub as any,
      pinStub,
      visibilityStub,
      accessLogStub,
      localTokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    await assert.rejects(
      () => ctrl.asset('CODE001', 'img.png', 'tok.sig', { headers: {} } as any, makeRes()),
      ForbiddenException,
    );
  });

  it('refuses when the asset token name does not match the query name', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    const localTokenStub = {
      ...tokenStub,
      verifyAssetToken: () => ({ code: 'CODE001', assetPath: 'other.png' }),
    };
    const ctrl = new ShareLinksController(
      stub as any,
      pinStub,
      visibilityStub,
      accessLogStub,
      localTokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    await assert.rejects(
      () => ctrl.asset('CODE001', 'img.png', 'tok.sig', { headers: {} } as any, makeRes()),
      ForbiddenException,
    );
  });

  it('410s when the share-link has been revoked between resolve and asset fetch', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'gone', reason: 'revoked' };
    const localTokenStub = {
      ...tokenStub,
      verifyAssetToken: () => ({ code: 'CODE001', assetPath: 'img.png' }),
    };
    const ctrl = new ShareLinksController(
      stub as any,
      pinStub,
      visibilityStub,
      accessLogStub,
      localTokenStub,
      storageStub,
      attachmentsStub,
      commentsStub,
      docHandlesStub,
    );
    await assert.rejects(
      () => ctrl.asset('CODE001', 'img.png', 'tok.sig', { headers: {} } as any, makeRes()),
      GoneException,
    );
  });

  it('400s on missing query params', async () => {
    const stub = new StubService();
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () => ctrl.asset('CODE001', '', 'tok.sig', { headers: {} } as any, makeRes()),
      BadRequestException,
    );
    await assert.rejects(
      () => ctrl.asset('CODE001', 'img.png', '', { headers: {} } as any, makeRes()),
      BadRequestException,
    );
  });
});

describe('ShareLinksController.content — anonymous content endpoint', () => {
  function makeContentCtx(path: string) {
    return { shareLinkContext: { code: 'STUBCODE', path }, headers: {} } as any;
  }

  it('returns content when shareLinkContext path matches the live path', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    const ctrl = makeCtrl(stub);
    const result = await ctrl.content('STUBCODE', makeContentCtx('Notes/team.md'));
    assert.equal(result.path, 'Notes/team.md');
    assert.equal(result.content, 'stub content');
  });

  it('refuses with 403 when shareLinkContext is missing', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team.md' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () => ctrl.content('STUBCODE', { headers: {} } as any),
      ForbiddenException,
    );
  });

  it('refuses with 403 when token path does not match live path (post-rename drift)', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'ok', path: 'Notes/team-v2.md' }; // server says v2
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () => ctrl.content('STUBCODE', makeContentCtx('Notes/team.md')), // token says v1
      ForbiddenException,
    );
  });

  it('410s when the link has been revoked between resolve and content fetch', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'gone', reason: 'revoked' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () => ctrl.content('STUBCODE', makeContentCtx('Notes/team.md')),
      GoneException,
    );
  });

  it('404s when the link is unknown', async () => {
    const stub = new StubService();
    stub.resolveResult = { kind: 'not_found' };
    const ctrl = makeCtrl(stub);
    await assert.rejects(
      () => ctrl.content('STUBCODE', makeContentCtx('Notes/team.md')),
      NotFoundException,
    );
  });
});
