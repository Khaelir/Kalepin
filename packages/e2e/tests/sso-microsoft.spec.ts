// Microsoft sign-in (openspec change add-microsoft-sso) against the mock
// Entra issuer started by global-setup.ts. The backend is configured with
// SSO_MICROSOFT_* pointing at it (playwright.config.ts).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { BACKEND_PORT, DB_PATH, FRONTEND_PORT, SSO_CALLBACK_URL } from '../playwright.config';
import { MOCK_OIDC_TENANT, lastMockAuthorize, lastMockTokens, setMockIdentity } from '../mock-oidc-issuer';

const FRONTEND = `http://localhost:${FRONTEND_PORT}`;
const BACKEND = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';
const FOREIGN_TENANT = '99999999-0000-4000-8000-000000000000';

let counter = 0;
function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${++counter}`;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function query<T>(sql: string, ...params: unknown[]): T | undefined {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

/** An existing magic-link-style user with a personal note, created through the API. */
async function seedUser(email: string, personalNote: string): Promise<number> {
  const token = jwt.sign({ sub: 1, email }, JWT_SECRET, { expiresIn: '1h' });
  const tree = await fetch(`${BACKEND}/api/files/tree`, { headers: bearer(token) });
  if (!tree.ok) throw new Error(`bootstrap failed: ${tree.status}`);
  const res = await fetch(`${BACKEND}/api/files/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ path: `_users/${email}/${personalNote}`, content: '# SSO diary\n\nPrivate.\n' }),
  });
  if (!res.ok) throw new Error(`create note failed: ${res.status} ${await res.text()}`);
  return query<{ id: number }>('SELECT id FROM users WHERE email = ?', email)!.id;
}

async function clickMicrosoft(page: Page) {
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
}

async function sessionToken(page: Page): Promise<{ sub: number; email: string }> {
  const token = await page.evaluate(() => localStorage.getItem('kalepin_token'));
  expect(token).toBeTruthy();
  return jwt.verify(token!, JWT_SECRET) as { sub: number; email: string };
}

async function expectLoginError(page: Page, message: string) {
  await expect(page.locator('.login-sso-error')).toHaveText(message);
  expect(new URL(page.url()).searchParams.has('sso_error')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('kalepin_token'))).toBeNull();
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function setupConsentRequest(req: APIRequestContext): Promise<string> {
  const redirectUri = 'https://example.com/cb';
  const reg = await req.post(`${BACKEND}/oauth/register`, {
    data: {
      client_name: 'SSO consent client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  const client = await reg.json();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: 'notes.read',
    code_challenge: s256(randomBytes(32).toString('base64url')),
    code_challenge_method: 'S256',
    state: 'state-sso',
  });
  const resp = await req.get(`${BACKEND}/oauth/authorize?${params}`, { maxRedirects: 0 });
  const url = new URL(resp.headers()['location']);
  return new URLSearchParams(url.hash.split('?').slice(1).join('?')).get('request_id')!;
}

async function expectConsentScreen(page: Page, requestId: string) {
  await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('SSO consent client')).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#/oauth/consent?request_id=${requestId}`);
  expect(new URL(page.url()).search).toBe('');
}

test.describe('Sign in with Microsoft', () => {
  test('the login page offers Microsoft above the magic-link form', async ({ page }) => {
    await page.goto(FRONTEND);
    const button = page.getByRole('button', { name: 'Sign in with Microsoft' });
    await expect(button).toBeVisible();
    await expect(page.locator('.login-divider')).toHaveText('or');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    const buttonBox = (await button.boundingBox())!;
    const inputBox = (await page.locator('input[type="email"]').boundingBox())!;
    expect(buttonBox.y).toBeLessThan(inputBox.y);
  });

  for (const [label, response] of [
    ['no provider is enabled', { status: 200, body: JSON.stringify({ providers: [] }) }],
    ['the providers request fails', { status: 500, body: 'boom' }],
  ] as const) {
    test(`the login page shows only the magic-link form when ${label}`, async ({ page }) => {
      await page.route('**/api/auth/providers', (route) => route.fulfill({ contentType: 'application/json', ...response }));
      const providers = page.waitForResponse('**/api/auth/providers');
      await page.goto(FRONTEND);
      await providers;
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('.login-card button')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Send Magic Link' })).toBeVisible();
      await expect(page.locator('.login-providers, .login-divider, .login-sso-error')).toHaveCount(0);
    });
  }

  test('an existing user lands in their own account and personal folder', async ({ page }) => {
    const email = `${unique('sso-existing')}@example.com`;
    const userId = await seedUser(email, 'SsoDiary.md');
    const oid = unique('oid');
    await setMockIdentity({ email, preferred_username: email, oid, name: 'Existing Sso' });

    await page.goto(`${FRONTEND}/`);
    await clickMicrosoft(page);

    const personalTree = page.locator('.file-tree[data-section="personal"]');
    await expect(personalTree.locator('.file-tree-node', { hasText: 'SsoDiary.md' })).toBeVisible({ timeout: 15_000 });
    expect(await sessionToken(page)).toMatchObject({ sub: userId, email });
    expect(new URL(page.url()).search).toBe('');
    expect(query<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE email = ?', email)!.n).toBe(1);

    const authorize = await lastMockAuthorize();
    expect(authorize).toMatchObject({
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      code_challenge_method: 'S256',
      redirect_uri: SSO_CALLBACK_URL,
    });
    expect(authorize.scope).not.toContain('offline_access');

    const identity = query<{ userId: number; provider: string; emailAtLink: string }>(
      'SELECT userId, provider, emailAtLink FROM user_identities WHERE subject = ?',
      oid,
    );
    expect(identity).toEqual({ userId, provider: 'microsoft', emailAtLink: email });

    // Microsoft's tokens are used once and dropped: nothing in the database.
    const tokens = await lastMockTokens();
    expect(tokens.id_token).toBeTruthy();
    for (const file of [DB_PATH, `${DB_PATH}-wal`]) {
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file).toString('latin1');
      expect(bytes.includes(tokens.id_token!)).toBe(false);
      expect(bytes.includes(tokens.access_token!)).toBe(false);
    }
  });

  test('a new user is created with the provider display name', async ({ page }) => {
    const email = `${unique('sso-new')}@example.com`;
    await setMockIdentity({ email, oid: unique('oid'), name: 'Brand New' });

    await page.goto(FRONTEND);
    await clickMicrosoft(page);

    await expect(page.locator('.file-tree').first()).toBeVisible({ timeout: 15_000 });
    expect((await sessionToken(page)).email).toBe(email);
    expect(query<{ displayName: string }>('SELECT displayName FROM users WHERE email = ?', email)).toEqual({
      displayName: 'Brand New',
    });
  });

  test('a callback replayed after sign-in is refused as expired', async ({ page, context }) => {
    await setMockIdentity({ email: `${unique('sso-replay')}@example.com`, oid: unique('oid') });
    await page.goto(FRONTEND);
    const callback = page.waitForRequest((r) => r.url().startsWith(SSO_CALLBACK_URL));
    await clickMicrosoft(page);
    const callbackUrl = (await callback).url();
    await expect(page.locator('.file-tree').first()).toBeVisible({ timeout: 15_000 });

    // Replay from a fresh page: the signed-in workspace reacts to losing its
    // token with its own navigation, which would abort a goto on that page.
    expect((await context.cookies()).some((c) => c.name === 'kp_sso')).toBe(false);
    await page.evaluate(() => localStorage.clear());
    await page.close();
    const replay = await context.newPage();
    await replay.goto(callbackUrl);
    await expectLoginError(replay, 'Sign-in expired, please try again');
  });

  test('an identity without a usable email is refused', async ({ page }) => {
    // The e2e backend runs with DOMAIN_ALLOWLIST=*, so the only way to end up
    // with no allowlisted address is to have no email-shaped claim at all.
    // The allowlist filtering itself is covered by the backend unit tests.
    await setMockIdentity({ preferred_username: 'ALICE\\corp', oid: unique('oid') });
    await page.goto(FRONTEND);
    await clickMicrosoft(page);
    await expectLoginError(page, 'Email domain not allowed');
  });

  test('a token from another tenant is refused', async ({ page }) => {
    await setMockIdentity({ email: `${unique('sso-foreign')}@example.com`, oid: unique('oid'), tid: FOREIGN_TENANT });
    await page.goto(FRONTEND);
    await clickMicrosoft(page);
    await expectLoginError(page, 'Account from another organisation');
  });

  test('cancelling at Microsoft shows a message', async ({ page }) => {
    await setMockIdentity({ error: 'access_denied' });
    await page.goto(FRONTEND);
    await clickMicrosoft(page);
    await expectLoginError(page, 'Sign-in was cancelled');
  });
});

test.describe('OAuth consent round-trips', () => {
  test('consent → Microsoft → back on the same consent request, signed in', async ({ page, request }) => {
    const requestId = await setupConsentRequest(request);
    await setMockIdentity({ email: `${unique('sso-consent')}@example.com`, oid: unique('oid'), tid: MOCK_OIDC_TENANT });

    await page.goto(`${FRONTEND}/#/oauth/consent?request_id=${requestId}`);
    await clickMicrosoft(page);
    await expectConsentScreen(page, requestId);
  });

  test('consent → Microsoft error → back on the consent request with the message', async ({ page, request }) => {
    const requestId = await setupConsentRequest(request);
    await setMockIdentity({ email: `${unique('sso-consent-err')}@example.com`, oid: unique('oid'), tid: FOREIGN_TENANT });

    await page.goto(`${FRONTEND}/#/oauth/consent?request_id=${requestId}`);
    await clickMicrosoft(page);
    await expectLoginError(page, 'Account from another organisation');
    expect(new URL(page.url()).hash).toBe(`#/oauth/consent?request_id=${requestId}`);
  });

  test('consent → magic link → back on the same consent request, signed in', async ({ page, request }) => {
    const requestId = await setupConsentRequest(request);
    const email = `${unique('magic-consent')}@example.com`;

    await page.goto(`${FRONTEND}/#/oauth/consent?request_id=${requestId}`);
    await page.locator('input[type="email"]').fill(email);
    await page.getByRole('button', { name: 'Send Magic Link' }).click();
    await expect(page.getByText('Magic link sent')).toBeVisible();

    const row = query<{ token: string }>('SELECT token FROM magic_link_tokens WHERE email = ? ORDER BY id DESC LIMIT 1', email);
    expect(row).toBeTruthy();
    await page.goto(`${FRONTEND}/api/auth/verify?token=${row!.token}`);
    await expectConsentScreen(page, requestId);
    expect((await sessionToken(page)).email).toBe(email);
  });
});
