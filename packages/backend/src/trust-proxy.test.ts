import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DEFAULT_TRUST_PROXY, resolveTrustProxy } from './trust-proxy';

/** `req.ip` as Express computes it for a request from `remoteAddress`. */
function clientIp(trustProxy: string | undefined, remoteAddress: string, xff?: string): string {
  const app = new ExpressAdapter().getInstance();
  app.set('trust proxy', resolveTrustProxy(trustProxy));
  const req = Object.create(app.request);
  req.headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
  req.socket = { remoteAddress };
  return req.ip;
}

describe('resolveTrustProxy', () => {
  it('defaults to loopback and private networks', () => {
    assert.equal(resolveTrustProxy(undefined), DEFAULT_TRUST_PROXY);
    assert.equal(resolveTrustProxy('  '), DEFAULT_TRUST_PROXY);
  });

  it('accepts booleans, hop counts and address lists', () => {
    assert.equal(resolveTrustProxy('true'), true);
    assert.equal(resolveTrustProxy('FALSE'), false);
    assert.equal(resolveTrustProxy('2'), 2);
    assert.equal(resolveTrustProxy('10.0.0.0/8, 192.0.2.10'), '10.0.0.0/8, 192.0.2.10');
  });
});

describe('req.ip under the default TRUST_PROXY', () => {
  it('ignores X-Forwarded-For from a client that reaches the port directly', () => {
    assert.equal(clientIp(undefined, '198.51.100.7', '203.0.113.4'), '198.51.100.7');
    assert.equal(clientIp(undefined, '198.51.100.7', '203.0.113.5'), '198.51.100.7');
  });

  it('takes the client address from a proxy on the Docker network', () => {
    assert.equal(clientIp(undefined, '172.18.0.5', '203.0.113.9'), '203.0.113.9');
    assert.equal(clientIp(undefined, '::ffff:172.18.0.5', '203.0.113.9'), '203.0.113.9');
  });

  it('skips the values a client prepended before the proxy appended its address', () => {
    assert.equal(clientIp(undefined, '172.18.0.5', '1.2.3.4, 203.0.113.9'), '203.0.113.9');
  });
});

describe('req.ip under other TRUST_PROXY values', () => {
  it('a hop count trusts that many proxies', () => {
    assert.equal(clientIp('1', '198.51.100.1', '1.2.3.4, 203.0.113.9'), '203.0.113.9');
  });

  it('false never reads X-Forwarded-For', () => {
    assert.equal(clientIp('false', '172.18.0.5', '203.0.113.9'), '172.18.0.5');
  });
});
