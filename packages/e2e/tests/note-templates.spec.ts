// Note templates and daily notes — see openspec/changes/add-note-templates.
//
// Runs serially: the first test asserts the empty state of the shared
// `Templates/` folder, which later tests populate. Personal notes are
// encrypted at rest in this suite, so assertions read through the API.

import { test, expect, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { FRONTEND_PORT, BACKEND_PORT, VAULT_PATH } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const RUN = Date.now();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

let userCounter = 7000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, 'test-secret', { expiresIn: '1h' });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function api<T = any>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${url}`, {
    method,
    headers: bearer(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function readNote(token: string, notePath: string): Promise<string> {
  const data = await api<{ content: string }>(token, 'GET', `/api/files/read?path=${encodeURIComponent(notePath)}`);
  return data.content;
}

/** Local calendar day, as the browser (same machine) computes it. */
function localDateKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function openWorkspace(page: Page, token: string): Promise<void> {
  await api(token, 'GET', '/api/files/tree'); // provisions the personal folder
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(BASE_URL);
  await expect(page.locator('.file-tree').first()).toBeVisible({ timeout: 15_000 });
}

async function openTemplatePicker(page: Page): Promise<void> {
  await page.locator('.kp-newbtn-split__chevron').click();
  const popover = page.locator('.kp-create-popover');
  await expect(popover).toBeVisible();
  await popover.locator('[data-action="from-template"]').click();
  await expect(page.locator('.kp-create-popover[aria-label="New note from template"]')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Note templates', () => {
  test('empty state offers a sample template', async ({ page }) => {
    const sharedTemplates = path.join(VAULT_PATH, 'Templates');
    test.skip(
      fs.existsSync(sharedTemplates) && fs.readdirSync(sharedTemplates).some((f) => f.endsWith('.md')),
      'shared Templates folder already populated in this data dir',
    );
    const token = makeToken(`tpl-empty-${RUN}@example.com`);
    await openWorkspace(page, token);
    await openTemplatePicker(page);

    const empty = page.locator('.kp-template-empty');
    await expect(empty).toContainText('Add notes to a Templates folder to use them here.');
    await empty.getByRole('button', { name: 'Create a sample template' }).click();

    await expect(page.locator('.kp-template-group[aria-label="Shared"] .kp-template-row', { hasText: 'Meeting notes' })).toBeVisible();
    const sample = await readNote(token, 'Templates/Meeting notes.md');
    expect(sample).toContain('{{title}}');
    expect(sample).toContain('{{author}}');
  });

  test('new from template creates the note in the folder and opens it', async ({ page }) => {
    const email = `tpl-create-${RUN}@example.com`;
    const token = makeToken(email);
    const templateName = `E2E Standup ${RUN}`;
    await api(token, 'POST', '/api/files/create', {
      path: `Templates/${templateName}.md`,
      content: '# {{title}}\n\nOwner: {{author_email}}\n\nDate: {{date}}\n',
    });
    await openWorkspace(page, token);
    await openTemplatePicker(page);

    const noteName = `Standup ${RUN}`;
    await page.locator('.kp-template-name').fill(noteName);
    await page.locator('.kp-template-row', { hasText: templateName }).click();

    await expect(page.locator('.editor-content .tiptap h1')).toContainText(noteName, { timeout: 15_000 });
    await expect(page.locator('.editor-content .tiptap')).toContainText(`Owner: ${email}`);

    const content = await readNote(token, `${noteName}.md`);
    expect(content).toMatch(new RegExp(`^# ${noteName}\\n\\nOwner: ${email.replace(/\./g, '\\.')}\\n\\nDate: \\d{4}-\\d{2}-\\d{2}\\n`));
  });

  test('personal templates are grouped and never shown to other users', async ({ page }) => {
    const alice = `tpl-alice-${RUN}@example.com`;
    const bob = `tpl-bob-${RUN}@example.com`;
    const aliceToken = makeToken(alice);
    const bobToken = makeToken(bob);
    const privateName = `Private ${RUN}`;
    await api(aliceToken, 'GET', '/api/files/tree');
    await api(aliceToken, 'POST', '/api/files/create', {
      path: `_users/${alice}/Templates/${privateName}.md`,
      content: 'secret {{title}}',
    });

    // Bob: not listed, and not usable by path.
    const bobList = await api<{ templates: { path: string }[] }>(bobToken, 'GET', '/api/templates');
    expect(JSON.stringify(bobList)).not.toContain(alice);
    const steal = await fetch(`${API_URL}/api/vault/items`, {
      method: 'POST',
      headers: bearer(bobToken),
      body: JSON.stringify({ kind: 'note', parent_path: '', name: `stolen-${RUN}`, template: `_users/${alice}/Templates/${privateName}.md` }),
    });
    expect(steal.status).toBe(404);

    // Alice sees it in the Personal group.
    await openWorkspace(page, aliceToken);
    await openTemplatePicker(page);
    await expect(
      page.locator('.kp-template-group[aria-label="Personal"] .kp-template-row', { hasText: privateName }),
    ).toBeVisible();
  });
});

test.describe('Daily notes', () => {
  test("⌘⇧D / Ctrl+Shift+D opens today's note from the editor, once", async ({ page }) => {
    const email = `daily-key-${RUN}@example.com`;
    const token = makeToken(email);
    const notePath = `_users/${email}/Start ${RUN}.md`;
    await api(token, 'POST', '/api/files/create', { path: notePath, content: '# Start\n\nHello.\n' });
    await api(token, 'GET', '/api/files/tree');
    await page.goto(BASE_URL);
    await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
    await page.goto(`${BASE_URL}/doc/${notePath.split('/').map(encodeURIComponent).join('/')}`);
    await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });

    await page.locator('.editor-content .tiptap p').first().click();
    await page.keyboard.press(`${MOD}+Shift+D`);

    const heading = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
    await expect(page.locator('.editor-content .tiptap h1')).toContainText(heading, { timeout: 15_000 });

    const dailyPath = `_users/${email}/Journal/${localDateKey()}.md`;
    expect(await readNote(token, dailyPath)).toBe(`# ${heading}\n\n`);

    // Idempotent: a second request returns the same note untouched.
    const again = await api<{ path: string; created: boolean }>(token, 'POST', '/api/daily-notes', { date: localDateKey() });
    expect(again).toMatchObject({ path: dailyPath, created: false });
  });

  test("Today's note entry in the create popover uses the Daily template", async ({ page }) => {
    const email = `daily-popover-${RUN}@example.com`;
    const token = makeToken(email);
    await api(token, 'GET', '/api/files/tree');
    await api(token, 'POST', '/api/files/create', {
      path: `_users/${email}/Templates/Daily.md`,
      content: '# Journal {{title}}\n\n## Wins\n',
    });
    await openWorkspace(page, token);

    await page.locator('.kp-newbtn-split__chevron').click();
    await page.locator('.kp-create-popover [data-action="today-note"]').click();

    await expect(page.locator('.kp-create-popover')).toHaveCount(0);
    await expect(page.locator('.editor-content .tiptap h1')).toContainText(`Journal ${localDateKey()}`, { timeout: 15_000 });
    await expect(page.locator('.editor-content .tiptap h2')).toContainText('Wins');
  });
});
