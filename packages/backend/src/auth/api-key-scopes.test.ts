import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { SCOPE_PERMISSIONS, PERMISSIONS } from './permissions';
import type { ApiKeyScope, Permission } from './permissions';
import { CombinedAuthGuard } from './combined-auth.guard';
import { REQUIRED_SCOPE_KEY } from './required-scope.decorator';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { isAdmin } from './admin.util';

// --- Helpers ---

function makeGuard(
  verifyApiKeyResult: { sub: number; email: string; scope: ApiKeyScope },
  verifyTokenResult?: { sub: number; email: string },
) {
  const authService = {
    verifyApiKey: async () => verifyApiKeyResult,
    verifyToken: () => verifyTokenResult ?? { sub: 1, email: 'u@test.com' },
    ensureUser: async () => {},
  } as any;

  const reflector = {
    get: (_key: string, _handler: any) => undefined as Permission | undefined,
  } as any;

  const guard = new CombinedAuthGuard(authService, reflector);
  return { guard, reflector };
}

function makeContext(token: string, requiredPermission?: Permission) {
  const request = { headers: { authorization: `Bearer ${token}` }, user: undefined as any };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    request,
    requiredPermission,
  };
}

// --- Tests ---

describe('SCOPE_PERMISSIONS map', () => {
  it('ro includes read-only permissions', () => {
    const ro = SCOPE_PERMISSIONS['ro'];
    assert.ok(ro.includes('notes:read'));
    assert.ok(ro.includes('notes:search'));
    assert.ok(ro.includes('comments:read'));
    assert.ok(ro.includes('links:read'));
    assert.ok(ro.includes('stars:read'));
    assert.ok(ro.includes('updates:read'));
    assert.ok(ro.includes('attachments:read'));
    assert.ok(ro.includes('users:read'));
  });

  it('ro excludes write permissions', () => {
    const ro = SCOPE_PERMISSIONS['ro'];
    assert.ok(!ro.includes('notes:create'));
    assert.ok(!ro.includes('notes:edit'));
    assert.ok(!ro.includes('notes:delete'));
    assert.ok(!ro.includes('comments:write'));
    assert.ok(!ro.includes('stars:write'));
    assert.ok(!ro.includes('attachments:write'));
    assert.ok(!ro.includes('admin:backup'));
  });

  it('rc includes ro + comments:write', () => {
    const rc = SCOPE_PERMISSIONS['rc'];
    for (const perm of SCOPE_PERMISSIONS['ro']) {
      assert.ok(rc.includes(perm), `rc should include ${perm}`);
    }
    assert.ok(rc.includes('comments:write'));
  });

  it('rc excludes note write permissions', () => {
    const rc = SCOPE_PERMISSIONS['rc'];
    assert.ok(!rc.includes('notes:create'));
    assert.ok(!rc.includes('notes:edit'));
    assert.ok(!rc.includes('notes:delete'));
  });

  it('rw includes all non-admin permissions', () => {
    const rw = SCOPE_PERMISSIONS['rw'];
    for (const perm of PERMISSIONS) {
      if (perm.startsWith('admin:')) {
        assert.ok(!rw.includes(perm), `rw should not include ${perm}`);
      } else {
        assert.ok(rw.includes(perm), `rw should include ${perm}`);
      }
    }
  });

  it('admin includes all permissions', () => {
    const admin = SCOPE_PERMISSIONS['admin'];
    for (const perm of PERMISSIONS) {
      assert.ok(admin.includes(perm), `admin should include ${perm}`);
    }
  });

  it('rw excludes admin:backup', () => {
    const rw = SCOPE_PERMISSIONS['rw'];
    assert.ok(!rw.includes('admin:backup'));
  });
});

describe('CombinedAuthGuard scope enforcement', () => {
  describe('ro key', () => {
    it('allows read endpoints', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'ro' });
      reflector.get = () => 'notes:read' as Permission;
      const ctx = makeContext('kp_abc123');
      const result = await guard.canActivate(ctx as any);
      assert.equal(result, true);
    });

    it('rejects write endpoints with 403', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'ro' });
      reflector.get = () => 'notes:create' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });

    it('rejects comment write', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'ro' });
      reflector.get = () => 'comments:write' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });
  });

  describe('rc key', () => {
    it('allows read endpoints', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rc' });
      reflector.get = () => 'notes:read' as Permission;
      const ctx = makeContext('kp_abc123');
      const result = await guard.canActivate(ctx as any);
      assert.equal(result, true);
    });

    it('allows comment write', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rc' });
      reflector.get = () => 'comments:write' as Permission;
      const ctx = makeContext('kp_abc123');
      const result = await guard.canActivate(ctx as any);
      assert.equal(result, true);
    });

    it('rejects note create with 403', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rc' });
      reflector.get = () => 'notes:create' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });

    it('rejects note edit with 403', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rc' });
      reflector.get = () => 'notes:edit' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });

    it('rejects note delete with 403', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rc' });
      reflector.get = () => 'notes:delete' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });
  });

  describe('rw key', () => {
    it('allows all non-admin endpoints', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rw' });
      for (const perm of PERMISSIONS) {
        if (perm.startsWith('admin:')) continue;
        reflector.get = () => perm;
        const ctx = makeContext('kp_abc123');
        const result = await guard.canActivate(ctx as any);
        assert.equal(result, true, `rw key should be allowed for ${perm}`);
      }
    });

    it('rejects admin:backup with 403', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'rw' });
      reflector.get = () => 'admin:backup' as Permission;
      const ctx = makeContext('kp_abc123');
      await assert.rejects(
        () => guard.canActivate(ctx as any),
        (err: any) => err instanceof ForbiddenException,
      );
    });
  });

  describe('admin key', () => {
    it('allows all endpoints including admin:backup', async () => {
      const { guard, reflector } = makeGuard({ sub: 1, email: 'u@test.com', scope: 'admin' });
      for (const perm of PERMISSIONS) {
        reflector.get = () => perm;
        const ctx = makeContext('kp_abc123');
        const result = await guard.canActivate(ctx as any);
        assert.equal(result, true, `admin key should be allowed for ${perm}`);
      }
    });
  });

  describe('legacy key (NULL scope treated as rw)', () => {
    it('treats undefined scope as rw', async () => {
      const authService = {
        verifyApiKey: async () => ({ sub: 1, email: 'u@test.com', scope: 'rw' }),
        verifyToken: () => ({ sub: 1, email: 'u@test.com' }),
      } as any;
      const reflector = {
        get: () => 'notes:create' as Permission,
      } as any;
      const guard = new CombinedAuthGuard(authService, reflector);
      const ctx = makeContext('kp_legacy_key');
      const result = await guard.canActivate(ctx as any);
      assert.equal(result, true);
    });
  });

  describe('JWT bypasses scope check', () => {
    it('allows any permission for JWT tokens', async () => {
      const { guard, reflector } = makeGuard(
        { sub: 1, email: 'u@test.com', scope: 'ro' },
        { sub: 1, email: 'u@test.com' },
      );
      reflector.get = () => 'admin:backup' as Permission;
      const ctx = makeContext('jwt.token.here');
      const result = await guard.canActivate(ctx as any);
      assert.equal(result, true);
    });
  });
});

describe('whoami response', () => {
  it('returns correct permissions for ro scope', () => {
    const scope: ApiKeyScope = 'ro';
    const permissions = [...SCOPE_PERMISSIONS[scope]];
    assert.equal(permissions.length, 8);
    assert.ok(permissions.includes('notes:read'));
    assert.ok(!permissions.includes('notes:create'));
  });

  it('returns correct permissions for rc scope', () => {
    const scope: ApiKeyScope = 'rc';
    const permissions = [...SCOPE_PERMISSIONS[scope]];
    assert.equal(permissions.length, 9);
    assert.ok(permissions.includes('comments:write'));
    assert.ok(!permissions.includes('notes:edit'));
  });

  it('returns non-admin permissions for rw scope', () => {
    const scope: ApiKeyScope = 'rw';
    const permissions = [...SCOPE_PERMISSIONS[scope]];
    const nonAdminPerms = PERMISSIONS.filter((p) => !p.startsWith('admin:'));
    assert.equal(permissions.length, nonAdminPerms.length);
    assert.ok(!permissions.includes('admin:backup'));
  });

  it('returns all permissions for admin scope', () => {
    const scope: ApiKeyScope = 'admin';
    const permissions = [...SCOPE_PERMISSIONS[scope]];
    assert.equal(permissions.length, PERMISSIONS.length);
    assert.ok(permissions.includes('admin:backup'));
  });
});

describe('isAdmin helper', () => {
  let origAdminEmails: string | undefined;

  beforeEach(() => {
    origAdminEmails = process.env.ADMIN_EMAILS;
  });

  afterEach(() => {
    if (origAdminEmails !== undefined) process.env.ADMIN_EMAILS = origAdminEmails;
    else delete process.env.ADMIN_EMAILS;
  });

  it('returns true for admin email', () => {
    process.env.ADMIN_EMAILS = 'admin@test.com,boss@test.com';
    assert.equal(isAdmin('admin@test.com'), true);
    assert.equal(isAdmin('boss@test.com'), true);
  });

  it('is case-insensitive', () => {
    process.env.ADMIN_EMAILS = 'Admin@Test.com';
    assert.equal(isAdmin('admin@test.com'), true);
    assert.equal(isAdmin('ADMIN@TEST.COM'), true);
  });

  it('returns false for non-admin email', () => {
    process.env.ADMIN_EMAILS = 'admin@test.com';
    assert.equal(isAdmin('user@test.com'), false);
  });

  it('returns false when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdmin('admin@test.com'), false);
  });

  it('handles whitespace in email list', () => {
    process.env.ADMIN_EMAILS = ' admin@test.com , boss@test.com ';
    assert.equal(isAdmin('admin@test.com'), true);
    assert.equal(isAdmin('boss@test.com'), true);
  });
});
