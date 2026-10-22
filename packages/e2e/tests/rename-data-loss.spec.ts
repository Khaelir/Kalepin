import type { Page } from '@playwright/test';
import { test, expect, createNote } from '../fixtures';

// Regression for "renaming a file caused to lose it".
//
// Renaming the open doc used to move the file on disk while the live OT
// session stayed keyed by the old path: edits typed after the rename were
// rejected, and edits still pending at rename time were flushed back to the
// old path, resurrecting it. The server now flushes and re-keys the session
// on move, and clients re-open the doc at its new path.

async function readViaApi(page: Page, path: string): Promise<{ status: number; content?: string }> {
  return page.evaluate(async (p) => {
    const token = localStorage.getItem('kalepin_token');
    const res = await fetch(`/api/files/read?path=${encodeURIComponent(p)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: res.status };
    const body = await res.json();
    return { status: res.status, content: body.content as string };
  }, path);
}

async function renameViaTitle(page: Page, newTitle: string) {
  const title = page.locator('.kp-doc-title');
  await title.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(newTitle);
  await page.keyboard.press('Enter');
}

async function typeAtEndOfBody(page: Page, text: string) {
  const body = page.locator('.editor-content .tiptap');
  await body.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

async function waitForFlush(page: Page) {
  // OT flush is debounced 3s server-side.
  await page.waitForTimeout(5_000);
}

test('edits typed after renaming the open note are persisted to the new path', async ({ editorPage }) => {
  const { page, notePath } = editorPage;
  const newTitle = `renamed-${Date.now()}`;
  const newPath = `${newTitle}.md`;

  await renameViaTitle(page, newTitle);
  await expect.poll(() => readViaApi(page, newPath).then((r) => r.status)).toBe(200);

  await typeAtEndOfBody(page, ' AFTER-RENAME');
  await waitForFlush(page);

  const renamed = await readViaApi(page, newPath);
  const old = await readViaApi(page, notePath);
  expect(renamed.content).toContain('AFTER-RENAME');
  expect(old.status).toBe(404);
});

test('renaming right after typing keeps the latest edits and does not resurrect the old path', async ({ editorPage }) => {
  const { page, notePath } = editorPage;
  const newTitle = `renamed-fast-${Date.now()}`;
  const newPath = `${newTitle}.md`;

  await typeAtEndOfBody(page, ' BEFORE-RENAME');
  // Rename inside the 3s flush debounce window.
  await renameViaTitle(page, newTitle);
  await waitForFlush(page);

  const renamed = await readViaApi(page, newPath);
  const old = await readViaApi(page, notePath);
  expect(renamed.content).toContain('BEFORE-RENAME');
  expect(old.status).toBe(404);
});

test('a collaborator with the note open follows the rename', async ({ collaborationPair }) => {
  const { pageA, pageB, notePath } = collaborationPair;
  const newTitle = `renamed-collab-${Date.now()}`;
  const newPath = `${newTitle}.md`;

  await renameViaTitle(pageA, newTitle);
  await expect(pageB.locator('.kp-doc-title')).toHaveText(newTitle);

  await typeAtEndOfBody(pageB, 'FROM-COLLABORATOR');
  await waitForFlush(pageB);

  const renamed = await readViaApi(pageB, newPath);
  const old = await readViaApi(pageB, notePath);
  expect(renamed.content).toContain('FROM-COLLABORATOR');
  expect(old.status).toBe(404);
});

test('renaming onto an existing note is refused and both notes survive', async ({ editorPage }) => {
  const { page, notePath } = editorPage;
  const otherTitle = `existing-${Date.now()}`;
  createNote(`${otherTitle}.md`, 'Do not overwrite me.\n');

  await renameViaTitle(page, otherTitle);
  await expect(page.getByText('already exists')).toBeVisible();

  const original = await readViaApi(page, notePath);
  const other = await readViaApi(page, `${otherTitle}.md`);
  expect(original.content).toContain('Hello world.');
  expect(other.content).toBe('Do not overwrite me.\n');
});
