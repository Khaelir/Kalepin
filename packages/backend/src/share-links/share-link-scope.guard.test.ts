import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { ShareLinkScopeGuard } from './share-link-scope.guard';

function makeContext(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('ShareLinkScopeGuard', () => {
  it('passes and attaches shareLinkContext when token verifies', () => {
    const guard = new ShareLinkScopeGuard({
      verifyAccessToken: () => ({ code: 'CODE001', path: 'Notes/foo.md' }),
    } as any);
    const req: any = {
      headers: { authorization: 'ShareLink abc.def' },
      params: { code: 'CODE001' },
    };
    assert.equal(guard.canActivate(makeContext(req)), true);
    assert.deepEqual(req.shareLinkContext, { code: 'CODE001', path: 'Notes/foo.md' });
  });

  it('401s when the Authorization header is missing', () => {
    const guard = new ShareLinkScopeGuard({ verifyAccessToken: () => null } as any);
    const req: any = { headers: {}, params: { code: 'CODE001' } };
    assert.throws(
      () => guard.canActivate(makeContext(req)),
      UnauthorizedException,
    );
    assert.equal(req.shareLinkContext, undefined);
  });

  it('401s when the scheme is not "ShareLink"', () => {
    const guard = new ShareLinkScopeGuard({ verifyAccessToken: () => null } as any);
    const req: any = {
      headers: { authorization: 'Bearer abc.def' },
      params: { code: 'CODE001' },
    };
    assert.throws(
      () => guard.canActivate(makeContext(req)),
      UnauthorizedException,
    );
  });

  it('401s when the token cannot be verified', () => {
    const guard = new ShareLinkScopeGuard({ verifyAccessToken: () => null } as any);
    const req: any = {
      headers: { authorization: 'ShareLink bad.token' },
      params: { code: 'CODE001' },
    };
    assert.throws(
      () => guard.canActivate(makeContext(req)),
      UnauthorizedException,
    );
  });

  it('401s when token code does not match URL :code (cross-link replay)', () => {
    const guard = new ShareLinkScopeGuard({
      verifyAccessToken: () => ({ code: 'CODE002', path: 'Notes/foo.md' }),
    } as any);
    const req: any = {
      headers: { authorization: 'ShareLink abc.def' },
      params: { code: 'CODE001' }, // different from token's code
    };
    assert.throws(
      () => guard.canActivate(makeContext(req)),
      UnauthorizedException,
    );
  });

  it('never sets req.user (no impersonation)', () => {
    const guard = new ShareLinkScopeGuard({
      verifyAccessToken: () => ({ code: 'CODE001', path: 'Notes/foo.md' }),
    } as any);
    const req: any = {
      headers: { authorization: 'ShareLink abc.def' },
      params: { code: 'CODE001' },
    };
    guard.canActivate(makeContext(req));
    assert.equal(req.user, undefined);
  });
});
