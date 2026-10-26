// Related notes (openspec/changes/add-related-notes): the "Related" section of
// the Backlinks panel and GET /api/search/related.
//
// The ranking needs the multilingual-e5-base model. The backend loads it from
// packages/backend/models when present (gitignored; `npm run download-model`).
// The spec probes the endpoint once: with the model it checks ranking, the
// "not linked" chip, the Link action and personal-folder isolation; without it
// it checks the unavailable state. Either way one branch is skipped.

import { test, expect, createNote } from '../fixtures';
import type { Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;

let userCounter = 7000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, 'test-secret', { expiresIn: '1h' });
}

interface RelatedItem { path: string; title: string; score: number; linked: boolean }
interface RelatedResponse { available: boolean; items: RelatedItem[] }

async function fetchRelated(token: string, notePath: string, limit = 20): Promise<{ status: number; body: RelatedResponse | null }> {
  const res = await fetch(
    `${API_URL}/api/search/related?path=${encodeURIComponent(notePath)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: res.status, body: res.ok ? ((await res.json()) as RelatedResponse) : null };
}

/** Poll until `predicate` holds for the related list of `notePath`; returns the last response. */
async function waitForRelated(
  token: string,
  notePath: string,
  predicate: (r: RelatedResponse) => boolean,
  timeoutMs = 30_000,
): Promise<RelatedResponse | null> {
  const deadline = Date.now() + timeoutMs;
  let last: RelatedResponse | null = null;
  while (Date.now() < deadline) {
    last = (await fetchRelated(token, notePath)).body;
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

async function authAndOpen(page: Page, token: string, notePath: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(`${BASE_URL}/doc/${notePath.split('/').map(encodeURIComponent).join('/')}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

const RUNBOOK = `# Deployment runbook

## Before you deploy
Check that the main branch is green in CI and that the release notes are written. Announce the deployment in the releases channel and make sure nobody else is rolling out a change to production at the same time.

## Rolling out
Build the Docker image with the release tag, push it to the registry, then update the image tag in the Helm values for the production cluster. Run helm upgrade and watch the rollout until every pod is ready.

## Rollback
If error rates climb or health checks fail, run helm rollback to the previous revision immediately. Then open an incident channel and page the on-call engineer.
`;

const POSTMORTEM = `# Postmortem: API outage

## Summary
The public API returned 502 errors for 38 minutes after a deployment exhausted the database connection pool.

## Timeline
The new release went out at 14:02. Alerts fired at 14:05 when the error rate crossed 5%. The on-call engineer rolled back with helm rollback at 14:31.

## Action items
Add a connection-pool saturation alert and run load tests before production rollouts.
`;

const PLUMBER = 'Call the plumber about the leaking kitchen tap before Friday.\n';

test.describe.configure({ mode: 'serial' });

test.describe('Related notes', () => {
  const run = `${Date.now()}`;
  const dir = `related-${run}`;
  const runbook = `${dir}/Deployment runbook ${run}.md`;
  const postmortem = `${dir}/API outage postmortem ${run}.md`;
  const plumber = `${dir}/Call plumber ${run}.md`;
  const email = `related-${run}@example.com`;
  let token: string;
  let modelLoaded = false;

  test.beforeAll(async () => {
    createNote(runbook, RUNBOOK);
    createNote(postmortem, POSTMORTEM);
    createNote(plumber, PLUMBER);
    token = makeToken(email);
    // The model loads during boot; once it is ready the watcher embeds the new
    // notes within a second or two. Wait for both, or conclude it is missing.
    const res = await waitForRelated(token, runbook, (r) => r.available && r.items.some((i) => i.path === postmortem));
    modelLoaded = !!res?.available;
  });

  test('lists semantically related notes with a "not linked" chip', async ({ page }) => {
    test.skip(!modelLoaded, 'embedding model not loaded');
    const api = (await fetchRelated(token, runbook)).body!;
    expect(api.items[0]?.path).toBe(postmortem);
    expect(api.items.map((i) => i.path)).not.toContain(plumber);
    expect(api.items.map((i) => i.path)).not.toContain(runbook);

    await authAndOpen(page, token, runbook);
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    const section = page.locator('[data-testid="related-section"]');
    await expect(section).toBeVisible({ timeout: 10_000 });
    const entry = section.locator(`[data-testid="related-entry"][data-path="${postmortem}"]`);
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(entry.locator('.backlink-title')).toHaveText(`API outage postmortem ${run}`);
    await expect(entry.locator('.related-folder')).toHaveText(dir);
    await expect(entry.locator('[data-testid="related-not-linked"]')).toBeVisible();
    await expect(entry.locator('.related-reason')).toContainText('§');
    await expect(section.locator(`[data-testid="related-entry"][data-path="${plumber}"]`)).toHaveCount(0);
  });

  test('Link appends a wikilink and clears the chip', async ({ page }) => {
    test.skip(!modelLoaded, 'embedding model not loaded');
    await authAndOpen(page, token, runbook);
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    const entry = page.locator(`[data-testid="related-entry"][data-path="${postmortem}"]`);
    await expect(entry).toBeVisible({ timeout: 10_000 });

    await entry.locator('[data-testid="related-insert-link"]').click();
    await expect(entry.locator('[data-testid="related-not-linked"]')).toHaveCount(0);
    await expect(page.locator('.editor-content .tiptap .node-wikilink').last()).toContainText(`API outage postmortem ${run}`);

    // The save reaches the link index; the server now reports the pair as linked.
    const linked = await waitForRelated(token, runbook, (r) => r.items.some((i) => i.path === postmortem && i.linked), 15_000);
    expect(linked?.items.find((i) => i.path === postmortem)?.linked).toBe(true);
  });

  test('clicking a related note opens it', async ({ page }) => {
    test.skip(!modelLoaded, 'embedding model not loaded');
    await authAndOpen(page, token, runbook);
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    await page.locator(`[data-testid="related-entry"][data-path="${postmortem}"]`).click();
    await expect(page.locator('.editor-content .tiptap h1').first()).toContainText('Postmortem: API outage', { timeout: 10_000 });
  });

  test("never surfaces another user's personal notes", async () => {
    test.skip(!modelLoaded, 'embedding model not loaded');
    const alice = makeToken(`alice-${run}@example.com`);
    const bob = makeToken(`bob-${run}@example.com`);
    await fetch(`${API_URL}/api/files/tree`, { headers: { Authorization: `Bearer ${alice}` } });
    await fetch(`${API_URL}/api/files/tree`, { headers: { Authorization: `Bearer ${bob}` } });
    const aliceNote = `_users/alice-${run}@example.com/Private runbook.md`;
    const create = await fetch(`${API_URL}/api/files/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: aliceNote, content: RUNBOOK }),
    });
    expect(create.ok).toBeTruthy();

    // Alice's copy is the closest possible match, so she sees it once embedded…
    const forAlice = await waitForRelated(alice, runbook, (r) => r.items.some((i) => i.path === aliceNote));
    expect(forAlice?.items.map((i) => i.path)).toContain(aliceNote);
    // …while Bob never does, and cannot query from her note either.
    const forBob = (await fetchRelated(bob, runbook)).body!;
    expect(forBob.items.some((i) => i.path.startsWith(`_users/alice-${run}@example.com/`))).toBe(false);
    expect((await fetchRelated(bob, aliceNote)).status).toBe(404);
  });

  test('shows the unavailable state without the embedding model', async ({ page }) => {
    test.skip(modelLoaded, 'embedding model is loaded');
    await authAndOpen(page, token, runbook);
    await page.locator('[data-testid="rail-tab-backlinks"]').click();
    await expect(page.locator('[data-testid="related-unavailable"]')).toBeVisible({ timeout: 10_000 });
  });

  test('encrypted notes are never ranked', async () => {
    const res = await fetchRelated(token, `_users/${email}/_secure/journal.md`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, items: [] });
  });

  test('rejects a request without a path', async () => {
    const res = await fetch(`${API_URL}/api/search/related`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
  });
});
