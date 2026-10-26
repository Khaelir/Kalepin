// Trash: deleting a note or folder moves it to `.trash/` instead of removing
// it; it can be restored (same path, same /doc/<id>) or deleted forever.
//
//   1. File-tree delete → "Move to trash" confirmation → Undo toast restores.
//   2. Trash dialog: Restore one item, Delete forever another.
//   3. Folder delete shows its file count and restores with its notes.
//   4. A collaborator's open editor closes and the note is not re-created.
//   5. /doc/<handle> shows "no longer exists" while trashed, works after restore.
//   6. Personal trash items are invisible to other users.
//   7. A public share link is dormant while its note is trashed.

import { test, expect, createNote } from '../fixtures';
import type { Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { BACKEND_PORT } from '../playwright.config';

const API_URL = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';

let userCounter = 9500;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function pageToken(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('kalepin_token') as string);
}

async function readStatus(token: string, path: string): Promise<number> {
  return (await api(token, 'GET', `/api/files/read?path=${encodeURIComponent(path)}`)).status;
}

async function trashFile(token: string, path: string): Promise<string> {
  const res = await api(token, 'DELETE', `/api/files/delete?path=${encodeURIComponent(path)}`);
  expect(res.status).toBe(200);
  expect(typeof res.body.trashItemId).toBe('string');
  return res.body.trashItemId;
}

function vaultRow(page: Page, name: string) {
  return page.locator('.file-tree[data-section="shared"] .file-tree-node', { hasText: name });
}

test.describe('Trash', () => {
  test('deleting from the file tree moves the note to the trash and Undo restores it', async ({ editorPage }) => {
    const { page, notePath } = editorPage;
    const token = await pageToken(page);

    const row = vaultRow(page, notePath);
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: 'Delete', exact: true }).click();

    const confirm = page.getByRole('dialog', { name: 'Move to trash?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Move to trash' }).click();

    await expect(row).toHaveCount(0);
    await expect(page.locator('.editor-content .tiptap')).toHaveCount(0);
    expect(await readStatus(token, notePath)).toBe(404);

    const toast = page.locator('.toast', { hasText: 'to trash' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    await expect(vaultRow(page, notePath)).toBeVisible();
    await expect(page.locator('.editor-content .tiptap')).toContainText('Hello world.');
    expect(await readStatus(token, notePath)).toBe(200);
  });

  test('the Trash dialog restores one item and deletes another forever', async ({ editorPage }) => {
    const { page } = editorPage;
    const token = await pageToken(page);
    const stamp = Date.now();
    const keep = createNote(`trash-keep-${stamp}.md`, '# Keep\n');
    const drop = createNote(`trash-drop-${stamp}.md`, '# Drop\n');
    await expect.poll(() => readStatus(token, drop)).toBe(200);
    await trashFile(token, keep);
    const dropId = await trashFile(token, drop);

    await page.locator('.kp-trash-entry').click();
    const dialog = page.locator('.trash-dialog');
    await expect(dialog).toBeVisible();
    const keepRow = dialog.locator('.trash-item', { hasText: `trash-keep-${stamp}` });
    const dropRow = dialog.locator('.trash-item', { hasText: `trash-drop-${stamp}` });
    await expect(keepRow).toBeVisible();
    await expect(dropRow).toBeVisible();

    await keepRow.getByRole('button', { name: 'Restore' }).click();
    await expect(keepRow).toHaveCount(0);
    expect(await readStatus(token, keep)).toBe(200);

    await dropRow.locator('.trash-item-purge').click();
    const confirm = page.getByRole('dialog', { name: 'Delete forever?' });
    await confirm.getByRole('button', { name: 'Delete forever' }).click();
    await expect(dropRow).toHaveCount(0);

    const listing = await api(token, 'GET', '/api/trash');
    expect(listing.body.items.map((i: { id: string }) => i.id)).not.toContain(dropId);
    expect(await readStatus(token, drop)).toBe(404);
  });

  test('a trashed folder shows its file count and restores with its notes', async ({ editorPage }) => {
    const { page } = editorPage;
    const token = await pageToken(page);
    const folder = `trash-folder-${Date.now()}`;
    createNote(`${folder}/a.md`, 'A\n');
    createNote(`${folder}/sub/b.md`, 'B\n');
    await expect.poll(() => readStatus(token, `${folder}/sub/b.md`)).toBe(200);

    const del = await api(token, 'DELETE', `/api/files/directory?path=${encodeURIComponent(folder)}`);
    expect(del.status).toBe(200);
    expect(typeof del.body.trashItemId).toBe('string');

    await page.locator('.kp-trash-entry').click();
    const row = page.locator('.trash-dialog .trash-item', { hasText: folder });
    await expect(row).toContainText('2 files');
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row).toHaveCount(0);

    expect(await readStatus(token, `${folder}/a.md`)).toBe(200);
    expect(await readStatus(token, `${folder}/sub/b.md`)).toBe(200);
  });

  test("a collaborator's open editor closes and the note is not re-created", async ({ collaborationPair }) => {
    const { pageA, pageB, notePath } = collaborationPair;
    const tokenA = await pageToken(pageA);

    await pageB.locator('.editor-content .tiptap').click();
    await pageB.keyboard.type('typed before delete');
    const id = await trashFile(tokenA, notePath);

    await expect(pageB.locator('.editor-content .tiptap')).toHaveCount(0);
    const toast = pageB.locator('.toast', { hasText: 'was moved to trash' });
    await expect(toast).toBeVisible();

    // Past the 3s OT flush debounce: nothing writes the old path back.
    await pageB.waitForTimeout(4_500);
    expect(await readStatus(tokenA, notePath)).toBe(404);

    await toast.getByRole('button', { name: 'Restore' }).click();
    await expect(pageB.locator('.editor-content .tiptap')).toBeVisible();
    expect(await readStatus(tokenA, notePath)).toBe(200);
    const listing = await api(tokenA, 'GET', '/api/trash');
    expect(listing.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
  });

  test('/doc/<handle> shows "no longer exists" while trashed and the note after restore', async ({ editorPage }) => {
    const { page, notePath } = editorPage;
    const token = await pageToken(page);
    await expect(page).toHaveURL(/\/doc\/[A-Z2-7]{16}/);
    const handleUrl = page.url();

    const id = await trashFile(token, notePath);
    await page.goto(handleUrl);
    await expect(page.getByText('This note no longer exists')).toBeVisible();

    const restored = await api(token, 'POST', `/api/trash/${id}/restore`);
    expect(restored.status).toBe(201);
    expect(restored.body.path).toBe(notePath);
    await page.goto(handleUrl);
    await expect(page.locator('.editor-content .tiptap')).toContainText('Hello world.');
  });

  test('personal trash items are invisible to other users', async () => {
    const stamp = Date.now();
    const alice = `trash-alice-${stamp}@example.com`;
    const bob = `trash-bob-${stamp}@example.com`;
    const aliceToken = makeToken(alice);
    const bobToken = makeToken(bob);
    await api(aliceToken, 'GET', '/api/files/tree');
    const notePath = `_users/${alice}/Private-${stamp}.md`;
    expect((await api(aliceToken, 'POST', '/api/files/create', { path: notePath, content: 'mine' })).status).toBe(201);

    const id = await trashFile(aliceToken, notePath);

    const bobList = await api(bobToken, 'GET', '/api/trash');
    expect(bobList.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
    expect((await api(bobToken, 'POST', `/api/trash/${id}/restore`)).status).toBe(404);
    expect((await api(bobToken, 'DELETE', `/api/trash/${id}`)).status).toBe(404);

    const aliceList = await api(aliceToken, 'GET', '/api/trash');
    const item = aliceList.body.items.find((i: { id: string }) => i.id === id);
    expect(item).toMatchObject({ zone: 'personal', kind: 'file', canPurge: true });
    expect((await api(aliceToken, 'POST', `/api/trash/${id}/restore`)).status).toBe(201);
    expect(await readStatus(aliceToken, notePath)).toBe(200);
  });

  test('a public share link is dormant while its note is trashed', async () => {
    const token = makeToken(`trash-share-${Date.now()}@example.com`);
    const notePath = createNote(`trash-share-${Date.now()}.md`, 'shared body\n');
    await expect.poll(() => readStatus(token, notePath)).toBe(200);
    const minted = await api(token, 'POST', '/api/share-links', { path: notePath });
    expect(minted.status).toBe(201);
    const code = minted.body.code as string;

    expect((await api(token, 'GET', `/api/share-links/resolve/${code}`)).status).toBe(200);
    const id = await trashFile(token, notePath);
    expect((await api(token, 'GET', `/api/share-links/resolve/${code}`)).status).toBe(404);
    await api(token, 'POST', `/api/trash/${id}/restore`);
    const resolved = await api(token, 'GET', `/api/share-links/resolve/${code}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.path).toBe(notePath);
  });
});
