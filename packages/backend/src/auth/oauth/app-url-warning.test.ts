import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createAppUrlWarningMiddleware } from './app-url-warning';

function makeReq(headers: Record<string, string>): any {
  return { headers };
}

describe('createAppUrlWarningMiddleware', () => {
  it('warns when X-Forwarded-Proto disagrees with APP_URL', () => {
    const warns: string[] = [];
    const mw = createAppUrlWarningMiddleware({
      appUrl: 'https://kalepin.example',
      logger: { warn: (m: string) => warns.push(m) },
    });
    let nextCalled = false;
    mw(
      makeReq({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'kalepin.example' }),
      {} as any,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, true);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /APP_URL=https:\/\/kalepin\.example/);
    assert.match(warns[0], /X-Forwarded-Proto=http/);
  });

  it('warns when X-Forwarded-Host disagrees', () => {
    const warns: string[] = [];
    const mw = createAppUrlWarningMiddleware({
      appUrl: 'https://kalepin.example',
      logger: { warn: (m: string) => warns.push(m) },
    });
    mw(
      makeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'wrong.example' }),
      {} as any,
      () => {},
    );
    assert.equal(warns.length, 1);
    assert.match(warns[0], /X-Forwarded-Host=wrong\.example/);
  });

  it('stays silent when proxy headers match', () => {
    const warns: string[] = [];
    const mw = createAppUrlWarningMiddleware({
      appUrl: 'https://kalepin.example',
      logger: { warn: (m: string) => warns.push(m) },
    });
    mw(
      makeReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'kalepin.example' }),
      {} as any,
      () => {},
    );
    assert.equal(warns.length, 0);
  });

  it('throttles warnings to once per minute', () => {
    const warns: string[] = [];
    let now = 1_000_000;
    const mw = createAppUrlWarningMiddleware({
      appUrl: 'https://kalepin.example',
      logger: { warn: (m: string) => warns.push(m) },
      now: () => now,
    });
    const req = makeReq({ 'x-forwarded-proto': 'http' });
    mw(req, {} as any, () => {});
    assert.equal(warns.length, 1);
    now += 30_000;
    mw(req, {} as any, () => {});
    assert.equal(warns.length, 1, 'second call within 60s must be throttled');
    now += 31_000;
    mw(req, {} as any, () => {});
    assert.equal(warns.length, 2, 'third call after 60s+ must warn again');
  });

  it('skips warning when no proxy headers are present', () => {
    const warns: string[] = [];
    const mw = createAppUrlWarningMiddleware({
      appUrl: 'https://kalepin.example',
      logger: { warn: (m: string) => warns.push(m) },
    });
    mw(makeReq({}), {} as any, () => {});
    assert.equal(warns.length, 0);
  });
});
