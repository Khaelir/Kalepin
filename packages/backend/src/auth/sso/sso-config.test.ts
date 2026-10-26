import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseSsoConfig, isInsecureLocalAuthority, ssoEnabledMessage } from './sso-config';

const TENANT = '1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901';
const CLIENT = '9f8e7d6c-5b4a-3928-1706-f5e4d3c2b1a0';

const FILES: Record<string, string> = {
  '/run/secrets/ms': '  file-secret\n',
  '/run/secrets/empty': '\n',
};
function readFile(path: string): string {
  if (path in FILES) return FILES[path];
  throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
}

function parse(env: Record<string, string | undefined>) {
  return parseSsoConfig({ APP_URL: 'https://kalepin.example.com', ...env }, readFile);
}

const COMPLETE = {
  SSO_MICROSOFT_TENANT_ID: TENANT,
  SSO_MICROSOFT_CLIENT_ID: CLIENT,
  SSO_MICROSOFT_CLIENT_SECRET_FILE: '/run/secrets/ms',
};

describe('parseSsoConfig', () => {
  it('leaves the provider off without a warning when nothing is set', () => {
    assert.deepEqual(parse({}), { warnings: [] });
  });

  it('treats blank values as unset', () => {
    assert.deepEqual(parse({ SSO_MICROSOFT_TENANT_ID: '', SSO_MICROSOFT_CLIENT_ID: '  ' }), { warnings: [] });
  });

  it('enables the provider with a complete configuration', () => {
    const config = parse(COMPLETE);
    assert.deepEqual(config.warnings, []);
    assert.deepEqual(config.microsoft, {
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: 'file-secret',
      authorityHost: 'https://login.microsoftonline.com',
      redirectUri: 'https://kalepin.example.com/api/auth/sso/microsoft/callback',
    });
    assert.equal(ssoEnabledMessage(config.microsoft!), `SSO: Microsoft sign-in enabled for tenant ${TENANT}`);
  });

  it('accepts the secret from the environment', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_SECRET_FILE: undefined, SSO_MICROSOFT_CLIENT_SECRET: ' env-secret ' });
    assert.deepEqual(config.warnings, []);
    assert.equal(config.microsoft?.clientSecret, 'env-secret');
  });

  it('lower-cases the tenant GUID', () => {
    assert.equal(parse({ ...COMPLETE, SSO_MICROSOFT_TENANT_ID: TENANT.toUpperCase() }).microsoft?.tenantId, TENANT);
  });

  it('trims trailing slashes from APP_URL', () => {
    const config = parse({ ...COMPLETE, APP_URL: 'https://kalepin.example.com//' });
    assert.equal(config.microsoft?.redirectUri, 'https://kalepin.example.com/api/auth/sso/microsoft/callback');
  });

  it('names the missing variable on a partial configuration', () => {
    const config = parse({ SSO_MICROSOFT_TENANT_ID: TENANT, SSO_MICROSOFT_CLIENT_ID: CLIENT });
    assert.equal(config.microsoft, undefined);
    assert.deepEqual(config.warnings, [
      'SSO_MICROSOFT: missing SSO_MICROSOFT_CLIENT_SECRET (or SSO_MICROSOFT_CLIENT_SECRET_FILE)',
    ]);
  });

  it('names every missing variable', () => {
    const config = parse({ SSO_MICROSOFT_CLIENT_SECRET: 's' });
    assert.equal(config.microsoft, undefined);
    assert.deepEqual(config.warnings, ['SSO_MICROSOFT: missing SSO_MICROSOFT_TENANT_ID, SSO_MICROSOFT_CLIENT_ID']);
  });

  it('refuses multi-tenant and other non-GUID tenant values', () => {
    for (const tenant of ['common', 'organizations', 'consumers', 'contoso.onmicrosoft.com', `${TENANT}x`]) {
      const config = parse({ ...COMPLETE, SSO_MICROSOFT_TENANT_ID: tenant });
      assert.equal(config.microsoft, undefined, tenant);
      assert.deepEqual(
        config.warnings,
        [
          "SSO_MICROSOFT: SSO_MICROSOFT_TENANT_ID must be your tenant's GUID; " +
            'multi-tenant values (common, organizations, consumers) are not supported',
        ],
        tenant,
      );
    }
  });

  it('refuses a non-GUID client ID', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_ID: 'kalepin' });
    assert.equal(config.microsoft, undefined);
    assert.deepEqual(config.warnings, ['SSO_MICROSOFT: SSO_MICROSOFT_CLIENT_ID must be the application (client) ID, a GUID']);
  });

  it('names the secret file when it cannot be read', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_SECRET_FILE: '/run/secrets/missing' });
    assert.equal(config.microsoft, undefined);
    assert.deepEqual(config.warnings, ['SSO_MICROSOFT: cannot read SSO_MICROSOFT_CLIENT_SECRET_FILE (/run/secrets/missing): ENOENT']);
  });

  it('refuses an empty secret file', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_SECRET_FILE: '/run/secrets/empty' });
    assert.equal(config.microsoft, undefined);
    assert.deepEqual(config.warnings, ['SSO_MICROSOFT: SSO_MICROSOFT_CLIENT_SECRET_FILE (/run/secrets/empty) is empty']);
  });

  it('does not fall back to the env secret when the file is unreadable', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_SECRET_FILE: '/run/secrets/missing', SSO_MICROSOFT_CLIENT_SECRET: 'env-secret' });
    assert.equal(config.microsoft, undefined);
  });

  it('prefers the file and warns when both secret sources are set', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_CLIENT_SECRET: 'env-secret' });
    assert.equal(config.microsoft?.clientSecret, 'file-secret');
    assert.deepEqual(config.warnings, [
      'SSO_MICROSOFT: both SSO_MICROSOFT_CLIENT_SECRET_FILE and SSO_MICROSOFT_CLIENT_SECRET are set; the file takes precedence',
    ]);
  });

  it('accepts an https national-cloud authority and trims its trailing slash', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_AUTHORITY_HOST: 'https://login.microsoftonline.us/' });
    assert.deepEqual(config.warnings, []);
    assert.equal(config.microsoft?.authorityHost, 'https://login.microsoftonline.us');
  });

  it('accepts plain http only for localhost and 127.0.0.1', () => {
    for (const host of ['http://localhost:4010', 'http://127.0.0.1:4010']) {
      const config = parse({ ...COMPLETE, SSO_MICROSOFT_AUTHORITY_HOST: host });
      assert.equal(config.microsoft?.authorityHost, host, host);
      assert.equal(isInsecureLocalAuthority(host), true, host);
    }
    assert.equal(isInsecureLocalAuthority('https://login.microsoftonline.com'), false);
  });

  it('refuses an insecure or malformed authority host', () => {
    for (const host of ['http://login.microsoftonline.com', 'http://10.0.0.1', 'ftp://localhost', 'not a url', 'https://x.example/?a=1']) {
      const config = parse({ ...COMPLETE, SSO_MICROSOFT_AUTHORITY_HOST: host });
      assert.equal(config.microsoft, undefined, host);
      assert.deepEqual(
        config.warnings,
        ['SSO_MICROSOFT: SSO_MICROSOFT_AUTHORITY_HOST must be an https:// URL (http:// is accepted only for localhost and 127.0.0.1)'],
        host,
      );
    }
  });

  it('reports every problem at once', () => {
    const config = parse({ SSO_MICROSOFT_TENANT_ID: 'common', SSO_MICROSOFT_CLIENT_ID: 'x' });
    assert.equal(config.warnings.length, 3);
  });

  it('never puts the secret in a warning', () => {
    const config = parse({ ...COMPLETE, SSO_MICROSOFT_TENANT_ID: 'common', SSO_MICROSOFT_CLIENT_SECRET: 'env-secret' });
    for (const warning of config.warnings) {
      assert.ok(!warning.includes('env-secret') && !warning.includes('file-secret'), warning);
    }
  });
});
