import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { BACKEND_PORT, FRONTEND_PORT } from '../playwright.config';

const BACKEND = `http://localhost:${BACKEND_PORT}`;
const FRONTEND = `http://localhost:${FRONTEND_PORT}`;
const JWT_SECRET = 'test-secret';

let userIdCounter = 2000;
function makeJwt(email: string): { token: string; sub: number } {
  const sub = ++userIdCounter;
  return { token: jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: '1h' }), sub };
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function setupConsentRequest(req: APIRequestContext, opts: { redirectUri?: string; scope?: string } = {}) {
  const redirectUri = opts.redirectUri ?? 'https://example.com/cb';
  const scope = opts.scope ?? 'notes.read notes.comment notes.write';
  const reg = await req.post(`${BACKEND}/oauth/register`, {
    data: {
      client_name: 'UI test client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  const client = await reg.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = s256(verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-abc',
  });
  const resp = await req.get(`${BACKEND}/oauth/authorize?${params}`, { maxRedirects: 0 });
  const location = resp.headers()['location'];
  const url = new URL(location);
  const requestParams = new URLSearchParams(url.hash.split('?').slice(1).join('?'));
  return { client, verifier, requestId: requestParams.get('request_id')!, redirectUri };
}

async function loginAs(page: Page, email: string) {
  const { token } = makeJwt(email);
  // Seed the token before any app code runs — App.tsx's auth useEffect runs
  // exactly once on first render and snapshots localStorage. Setting the
  // token after a goto would leave that snapshot empty, so subsequent
  // hash-only navigations (e.g. `/#/oauth/consent?...`) would render the
  // unauthenticated LoginPage.
  await page.context().addInitScript((t: string) => {
    localStorage.setItem('kalepin_token', t);
  }, token);
  await page.goto(FRONTEND);
}

// All claude.ai navigations during these tests are intercepted to keep tests
// hermetic — the consent flow may redirect to claude.ai, and we don't want
// real network traffic going there. (Task 16.10 explicitly requires this.)
async function stubClaudeAi(page: Page) {
  await page.route('https://claude.ai/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>stubbed claude.ai</body></html>',
    });
  });
  await page.route('https://example.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>stubbed redirect target</body></html>',
    });
  });
}

test.describe('OAuth consent UI (16.10)', () => {
  test('renders unverified identity block and downgrades scope on approve', async ({ page, request }) => {
    await stubClaudeAi(page);
    const email = 'consent-ui@example.com';
    await loginAs(page, email);

    // The consent flow uses request.user.sub; we need the backend to know about
    // this user. Hit a JWT-authenticated endpoint to ensureUser.
    await request.get(`${BACKEND}/api/auth/api-keys/whoami`, {
      headers: { authorization: `Bearer ${(await page.evaluate(() => localStorage.getItem('kalepin_token')))}` },
    });

    const { requestId } = await setupConsentRequest(request);
    // Same-origin hash-only navigation does not trigger a full document load,
    // so App.tsx's `parseConsentRoute()` (called only in render) keeps returning
    // null and the workspace stays mounted. Force a reload so the consent
    // route renders fresh.
    await page.goto(`${FRONTEND}/#/oauth/consent?request_id=${requestId}`);
    await page.reload();

    // Identity block shows unverified badge.
    await expect(page.getByText(/Unverified/i)).toBeVisible();
    await expect(page.getByText(/UI test client/)).toBeVisible();
    // The redirect domain renders in its own row with a dedicated class —
    // scope to it so we don't clash with the user's email (which also matches /example\.com/).
    await expect(page.locator('.oauth-consent-identity-value', { hasText: 'example.com' })).toBeVisible();

    // Pick the Read-only tier (downgrade). The radios have composite labels
    // (label + description), so target the input by name+value rather than
    // matching the prefix of the accessible name.
    await page.locator('input[name="scope"][value="notes.read"]').check();
    await page.getByRole('button', { name: 'Allow' }).click();

    // Should navigate (we stubbed example.com so no real net hit).
    await expect(page).toHaveURL(/example\.com/);
  });
});

test.describe('Connect-Claude wizard UI (16.11)', () => {
  test('opens from Settings, copies URL, closes, reopens', async ({ page, context }) => {
    // navigator.clipboard.writeText needs an explicit permission grant in
    // headless Chromium — without it the writeText promise rejects, the wizard
    // swallows the error in its catch, and the "Copied!" state never appears.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubClaudeAi(page);
    await loginAs(page, 'wizard-ui@example.com');
    await page.goto(FRONTEND);

    // Settings now lives behind the TopBar overflow menu (3-dot button labeled "More").
    await page.getByRole('button', { name: /^More$/i }).click();
    await page.getByRole('menuitem', { name: /^Settings$/ }).click();
    await expect(page.getByRole('heading', { name: /Settings/ })).toBeVisible();

    // Click the Claude.ai card connect button.
    await page.getByRole('button', { name: /^Connect$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Connect to Claude\.ai/ })).toBeVisible();

    // Copy URL.
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();

    // Escape closes the modal.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // Reopens cleanly.
    await page.getByRole('button', { name: /^Connect$/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
