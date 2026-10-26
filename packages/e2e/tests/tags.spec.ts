// Tags — see openspec/changes/add-tag-index. Covers the sidebar tag tree,
// click-to-search (sidebar and doc-header pill), live refresh after typing a
// tag, personal-folder isolation and the `_secure/` exclusion.
//
// Every test uses tag names unique to the run so counts are not disturbed by
// other specs writing to the shared vault.

import { test, expect, createNote } from '../fixtures';
import type { Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { FRONTEND_PORT, BACKEND_PORT, PERSONAL_PATH } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';

let userCounter = 7000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Lowercase, starts with letters: a valid, run-unique tag stem. */
function uniqueTag(stem: string): string {
  return `${stem}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function api<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...bearer(token), ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function createNoteAt(token: string, notePath: string, content: string): Promise<void> {
  await api(token, '/api/files/create', { method: 'POST', body: JSON.stringify({ path: notePath, content }) });
}

type TagCount = { tag: string; count: number };

const listTags = (token: string) => api<TagCount[]>(token, '/api/tags');

/** Wait until `/api/tags` reports `tag` with `count` for this user. */
async function waitForTag(token: string, tag: string, count: number): Promise<void> {
  await expect(async () => {
    const tags = await listTags(token);
    expect(tags.find((t) => t.tag === tag)?.count).toBe(count);
  }).toPass({ timeout: 15_000 });
}

async function authAndOpen(page: Page, token: string, notePath: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  await page.goto(`${BASE_URL}/doc/${encoded}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

async function expandTagsSection(page: Page): Promise<void> {
  const title = page.locator('.kp-tags-section .kp-side-section-title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  if ((await page.locator('.kp-tags-section [role="tree"]').count()) === 0) await title.click();
  await expect(page.locator('.kp-tags-section [role="tree"]')).toBeVisible();
}

const tagRow = (page: Page, tag: string) => page.locator(`.kp-tag-node[data-tag="${tag}"]`);

test.describe('Tags', () => {
  test('sidebar shows nested tags with counts; clicking one opens a tag search', async ({ page }) => {
    const token = makeToken(`tags-tree-${Date.now()}@example.com`);
    const tag = uniqueTag('proj');
    const parentNote = `tags-parent-${Date.now()}.md`;
    const childNote = `tags-child-${Date.now()}.md`;
    // One external write (watcher path), one API write (internal-write path).
    createNote(parentNote, `---\ntags: [${tag}]\n---\n# Parent\n\nRoadmap.\n`);
    await createNoteAt(token, childNote, `# Child\n\nShipping #${tag}/kalepin soon.\n`);
    await waitForTag(token, tag, 2);
    await waitForTag(token, `${tag}/kalepin`, 1);

    await authAndOpen(page, token, parentNote);
    await expandTagsSection(page);

    const parentRow = tagRow(page, tag);
    await expect(parentRow.locator('.kp-node-meta')).toHaveText('2');
    await expect(tagRow(page, `${tag}/kalepin`)).toHaveCount(0); // collapsed by default
    await parentRow.locator('.kp-tag-node-caret').click();
    const childRow = tagRow(page, `${tag}/kalepin`);
    await expect(childRow.locator('.kp-tag-node-label')).toHaveText('#kalepin');
    await expect(childRow.locator('.kp-node-meta')).toHaveText('1');

    await childRow.locator('.kp-tag-node-label').click();
    await expect(page.locator('.search-modal-input')).toHaveValue(`tag:${tag}/kalepin`);
    const names = page.locator('.search-modal-result-name');
    await expect(names).toHaveText([childNote.replace(/\.md$/, '')]);
    // Tag-only results are ordered by recency and show a relative time, not a score.
    await expect(page.locator('.search-modal-result .search-modal-recent-time')).toHaveCount(1);
    await expect(page.locator('.search-modal-result .search-modal-score')).toHaveCount(0);

    // Refining the query keeps the tag filter: an untagged note matching the
    // text is excluded (vector hits may add the other tagged note — that is fine).
    const untagged = `tags-untagged-${Date.now()}.md`;
    createNote(untagged, '# Other\n\nRoadmap for later.\n');
    await expect.poll(async () => {
      const res = await fetch(`${API_URL}/api/files/search?q=roadmap`, { headers: bearer(token) });
      return ((await res.json()) as { path: string }[]).map((r) => r.path);
    }, { timeout: 15_000 }).toContain(untagged);
    await page.locator('.search-modal-input').fill(`tag:${tag} roadmap`);
    await expect.poll(() => names.allTextContents(), { timeout: 10_000 }).toContain(parentNote.replace(/\.md$/, ''));
    expect(await names.allTextContents()).not.toContain(untagged.replace(/\.md$/, ''));
  });

  test('clicking a tag pill opens a prefix-inclusive tag search', async ({ page }) => {
    const token = makeToken(`tags-pill-${Date.now()}@example.com`);
    const tag = uniqueTag('area');
    const noteA = `tags-pill-a-${Date.now()}.md`;
    const noteB = `tags-pill-b-${Date.now()}.md`;
    createNote(noteA, `---\ntags:\n  - ${tag}\n---\n# A\n`);
    createNote(noteB, `# B\n\n#${tag}/sub\n`);
    await waitForTag(token, tag, 2);

    await authAndOpen(page, token, noteA);
    // Top-bar pills read the raw file; the doc-header pills read the editor's
    // re-serialised markdown (see design.md, known limitations).
    const pill = page.locator('.kp-inline-tags button.kp-tag-link', { hasText: tag });
    await expect(pill).toBeVisible();
    await pill.click();

    await expect(page.locator('.search-modal-input')).toHaveValue(`tag:${tag}`);
    await expect
      .poll(() => page.locator('.search-modal-result-name').allTextContents(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([noteA.replace(/\.md$/, ''), noteB.replace(/\.md$/, '')]));
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-modal-input')).toHaveCount(0);

    // ⌘K after a tag search starts from an empty query again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.locator('.search-modal-input')).toHaveValue('');
  });

  test('a tag typed in the editor appears in the sidebar without a reload', async ({ page }) => {
    const token = makeToken(`tags-live-${Date.now()}@example.com`);
    const seed = uniqueTag('seed');
    const fresh = uniqueTag('fresh');
    const note = `tags-live-${Date.now()}.md`;
    createNote(note, `# Live\n\nStart #${seed}\n`);
    await waitForTag(token, seed, 1);

    await authAndOpen(page, token, note);
    await expandTagsSection(page);
    await expect(tagRow(page, seed)).toBeVisible();

    await page.locator('.editor-content .tiptap p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(` #${fresh} `);

    await expect(tagRow(page, fresh)).toBeVisible({ timeout: 20_000 });
  });

  test('personal-folder tags are visible to their owner only', async () => {
    const aliceEmail = `tags-alice-${Date.now()}@example.com`;
    const bobEmail = `tags-bob-${Date.now()}@example.com`;
    const alice = makeToken(aliceEmail);
    const bob = makeToken(bobEmail);
    await api(alice, '/api/files/tree');
    await api(bob, '/api/files/tree');

    const secret = uniqueTag('secretplan');
    await createNoteAt(alice, `_users/${aliceEmail}/plan.md`, `# Plan\n\n#${secret}\n`);
    await waitForTag(alice, secret, 1);

    expect((await listTags(bob)).some((t) => t.tag === secret)).toBe(false);
    expect(await api(bob, `/api/tags/notes?tag=${encodeURIComponent(secret)}`)).toEqual([]);
    expect(await api(bob, `/api/files/search?q=${encodeURIComponent(`tag:${secret}`)}`)).toEqual([]);

    const aliceNotes = await api<{ path: string }[]>(alice, `/api/tags/notes?tag=${encodeURIComponent(secret)}`);
    expect(aliceNotes.map((n) => n.path)).toEqual([`_users/${aliceEmail}/plan.md`]);
  });

  test('notes under _secure/ are never indexed', async () => {
    const email = `tags-secure-${Date.now()}@example.com`;
    const token = makeToken(email);
    await api(token, '/api/files/tree');

    const secureTag = uniqueTag('securetag');
    const control = uniqueTag('control');
    // Worst case: plaintext lands on disk under _secure/ (normally an envelope).
    const secureDir = path.join(PERSONAL_PATH, email, '_secure');
    fs.mkdirSync(secureDir, { recursive: true });
    fs.writeFileSync(path.join(secureDir, 'diary.md'), `# Diary\n\n#${secureTag}\n`, 'utf-8');
    // A later control note proves the watcher has caught up before asserting absence.
    fs.writeFileSync(path.join(PERSONAL_PATH, email, 'control.md'), `# Control\n\n#${control}\n`, 'utf-8');
    await waitForTag(token, control, 1);

    expect((await listTags(token)).some((t) => t.tag === secureTag)).toBe(false);
    expect(await api(token, `/api/tags/notes?tag=${encodeURIComponent(secureTag)}`)).toEqual([]);
  });

  test('GET /api/tags/notes without a tag is a 400', async () => {
    const token = makeToken(`tags-400-${Date.now()}@example.com`);
    const res = await fetch(`${API_URL}/api/tags/notes`, { headers: bearer(token) });
    expect(res.status).toBe(400);
  });
});
