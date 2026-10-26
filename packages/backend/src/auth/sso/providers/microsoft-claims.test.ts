import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { identityFromMicrosoftClaims } from './microsoft.provider';
import { SsoError } from '../identity-provider';

const TENANT = '1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901';
const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;

const BASE = {
  iss: ISS,
  tid: TENANT,
  oid: '00000000-0000-0000-0000-0000000000aa',
  email: 'alice@company.com',
  preferred_username: 'a.smith@company.com',
  name: 'Alice Smith',
};

function rejectsWith(code: string, claims: Record<string, unknown>) {
  assert.throws(
    () => identityFromMicrosoftClaims(claims, TENANT),
    (err: unknown) => err instanceof SsoError && err.code === code,
  );
}

describe('identityFromMicrosoftClaims', () => {
  it('maps the claims of a token from the configured tenant', () => {
    assert.deepEqual(identityFromMicrosoftClaims(BASE, TENANT), {
      issuer: ISS,
      subject: BASE.oid,
      emails: ['alice@company.com', 'a.smith@company.com'],
      displayName: 'Alice Smith',
    });
  });

  it('compares tid case-insensitively', () => {
    assert.equal(identityFromMicrosoftClaims({ ...BASE, tid: TENANT.toUpperCase() }, TENANT).subject, BASE.oid);
    assert.equal(identityFromMicrosoftClaims(BASE, TENANT.toUpperCase()).subject, BASE.oid);
  });

  it('rejects a token from another tenant', () => {
    rejectsWith('wrong_tenant', { ...BASE, tid: '99999999-0000-0000-0000-000000000000' });
  });

  it('rejects a token without tid', () => {
    const { tid: _tid, ...claims } = BASE;
    rejectsWith('wrong_tenant', claims);
    rejectsWith('wrong_tenant', { ...BASE, tid: 42 });
  });

  it('falls back to preferred_username when email is absent', () => {
    const { email: _email, ...claims } = BASE;
    assert.deepEqual(identityFromMicrosoftClaims(claims, TENANT).emails, ['a.smith@company.com']);
    assert.deepEqual(identityFromMicrosoftClaims({ ...BASE, email: '  ' }, TENANT).emails, ['a.smith@company.com']);
  });

  it('returns no candidates when neither email claim is present', () => {
    const { email: _email, preferred_username: _upn, ...claims } = BASE;
    assert.deepEqual(identityFromMicrosoftClaims(claims, TENANT).emails, []);
  });

  it('rejects a token without oid', () => {
    const { oid: _oid, ...claims } = BASE;
    rejectsWith('provider_error', claims);
  });

  it('omits a missing display name', () => {
    const { name: _name, ...claims } = BASE;
    assert.equal(identityFromMicrosoftClaims(claims, TENANT).displayName, undefined);
  });
});
