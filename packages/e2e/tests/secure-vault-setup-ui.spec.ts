// End-to-end coverage for the `_secure/` vault feature, driven through the
// browser. The previous regression where setup itself broke (atob on undefined)
// would have surfaced here — and the create-note / create-folder failures the
// user reported once setup succeeded are covered too.
//
// Each test runs sequentially against a single shared user. Playwright's
// default mode runs against `vite dev`; setting `E2E_USE_BUILD=1` repoints it
// at `vite build && vite preview` so production-only bundling regressions
// (e.g. @rollup/plugin-commonjs reactivating a Node-only branch) reproduce.

import { test, expect, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { BACKEND_PORT, DB_PATH, FRONTEND_PORT, PERSONAL_PATH } from '../playwright.config';

const JWT_SECRET = 'test-secret';
const baseURL = `http://localhost:${FRONTEND_PORT}`;
const apiBase = `http://localhost:${BACKEND_PORT}`;
const ENCRYPTED_FOLDER_LABEL = 'Encrypted Folder';
const ENVELOPE_MAGIC = Buffer.from([0x4b, 0x45, 0x31, 0x00]); // "KE1\0"

let counter = 7000;
function signJwt(email: string, sub: number): string {
  return jwt.sign({ sub, email }, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Sign a temp token, hit a CombinedAuthGuard-protected endpoint to
 * auto-provision the user via `ensureUser`, then read the real DB id and
 * return a token whose `sub` matches it. The vault-meta endpoint indexes
 * users by `req.user.sub`, so a fixture token with an arbitrary counter
 * value silently 404s on every meta call.
 */
async function provisionUserAndToken(email: string): Promise<string> {
  const tmpSub = ++counter;
  const tmpToken = signJwt(email, tmpSub);
  // CombinedAuthGuard on /api/files/tree calls AuthService.ensureUser which
  // upserts by email and is the canonical bootstrap path.
  const res = await fetch(`${apiBase}/api/files/tree`, {
    headers: { Authorization: `Bearer ${tmpToken}` },
  });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status} ${await res.text()}`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
    if (!row) throw new Error(`user not found in DB after bootstrap: ${email}`);
    return signJwt(email, row.id);
  } finally {
    db.close();
  }
}

async function authenticateAtRoot(page: Page, token: string): Promise<void> {
  await page.goto(baseURL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(baseURL);
  await expect(
    page.locator('.file-tree-node').filter({ hasText: ENCRYPTED_FOLDER_LABEL }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

async function dismissOnboardingIfShown(page: Page): Promise<void> {
  const onboarding = page.getByRole('dialog').filter({ hasText: 'Welcome to your Encrypted Folder' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: 'Got it' }).click();
  }
}

function secureEntry(page: Page, label: string) {
  // Distinguish the click-target row inside the Encrypted Folder. Match on the
  // file-tree-node carrying the label text, not the surrounding container.
  return page.locator('.file-tree-node').filter({ hasText: label }).first();
}

async function setupVault(page: Page, passphrase: string): Promise<void> {
  await page.locator('.file-tree-node').filter({ hasText: ENCRYPTED_FOLDER_LABEL }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Set up your Encrypted Folder' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#vault-pass').fill(passphrase);
  await dialog.locator('#vault-pass-confirm').fill(passphrase);
  await dialog.locator('#vault-typed').fill('I understand');
  await dialog.getByRole('radio', { name: /Skip/ }).check();
  const putPromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/users/me/vault-meta') && r.request().method() === 'PUT',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: 'Create vault' }).click();
  const putRes = await putPromise.catch(async (err) => {
    const dialogText = await dialog.innerText().catch(() => '<unavailable>');
    throw new Error(`PUT vault-meta never fired. Dialog:\n${dialogText}\n\nUnderlying: ${err.message}`);
  });
  expect(putRes.status()).toBe(200);
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
}

async function unlockVault(page: Page, passphrase: string): Promise<void> {
  await page.locator('.file-tree-node').filter({ hasText: ENCRYPTED_FOLDER_LABEL }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: /Unlock/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // The unlock dialog has a single passphrase field — match generically.
  await dialog.locator('input[type="password"]').first().fill(passphrase);
  await dialog.getByRole('button', { name: /Unlock|Sign in|Continue/ }).first().click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

async function expandSecureFolder(page: Page, currentUserEmail: string): Promise<void> {
  // Click the Encrypted Folder until at least one child is visible. The first
  // click also fires handleSecureFolderActivate which may show the unlock
  // dialog on a fresh context; in tests where the master-KEK is already
  // cached we just toggle expansion.
  void currentUserEmail;
  for (let attempt = 0; attempt < 3; attempt++) {
    const node = page.locator('.file-tree-node').filter({ hasText: ENCRYPTED_FOLDER_LABEL }).first();
    await node.click();
    // Wait briefly for React to render the children. The file tree shows
    // a child node as `.file-tree-node` with depth padding > parent — any
    // child entry counts as proof of expansion.
    const anyChild = page.locator('.file-tree-node').filter({ hasText: /Untitled note|New folder|\.md/ });
    if (await anyChild.first().isVisible().catch(() => false)) return;
    // Click again to re-toggle if the first click closed an expanded folder
    // (state preserved across re-renders); a third attempt is the upper bound.
  }
}

async function clickNewNoteIn(page: Page, folderLabel: string): Promise<void> {
  const node = page.locator('.file-tree-node').filter({ hasText: folderLabel }).first();
  await node.hover();
  await node.getByRole('button', { name: `New note in ${folderLabel}` }).click();
}

async function clickNewFolderIn(page: Page, folderLabel: string): Promise<void> {
  const node = page.locator('.file-tree-node').filter({ hasText: folderLabel }).first();
  await node.hover();
  await node.getByRole('button', { name: `New folder in ${folderLabel}` }).click();
}

test.describe.configure({ mode: 'serial' });

test.describe('Encrypted Folder lifecycle (single browser)', () => {
  const email = `vault-lifecycle-${Date.now()}@example.com`;
  const passphrase = 'correct-horse-battery-staple-9!';
  let token: string;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    token = await provisionUserAndToken(email);
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    // Keep page errors visible — silent failures here previously led the
    // first regression (atob on undefined) to surface only as a frozen
    // dialog instead of a clear test failure.
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log('[browser pageerror]', err.message);
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('1. set up the vault from the sidebar', async () => {
    await authenticateAtRoot(page, token);
    await setupVault(page, passphrase);
    // After setup, master-KEK is cached in IndexedDB and the on-disk
    // _secure/ folder exists server-side.
    const personalDir = path.join(PERSONAL_PATH, email, '_secure');
    await expect.poll(() => fs.existsSync(personalDir), { timeout: 5_000 }).toBe(true);
  });

  test('2. create a note inside _secure/', async () => {
    await expandSecureFolder(page, email);
    await dismissOnboardingIfShown(page);
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/files/secure/create') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      clickNewNoteIn(page, ENCRYPTED_FOLDER_LABEL),
    ]);
    expect(createRes.status()).toBe(201);

    // No "Failed to create note" toast.
    await expect(page.getByText('Failed to create note')).toHaveCount(0);

    // The new note shows up in the tree under Encrypted Folder.
    await expect(
      page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // On-disk: the file is an envelope, not plaintext.
    const secureDir = path.join(PERSONAL_PATH, email, '_secure');
    const entries = fs.readdirSync(secureDir).filter((n) => n.endsWith('.md'));
    expect(entries.length).toBeGreaterThan(0);
    const bytes = fs.readFileSync(path.join(secureDir, entries[0]));
    expect(bytes.length).toBeGreaterThanOrEqual(4);
    expect(bytes.slice(0, 4).equals(ENVELOPE_MAGIC)).toBe(true);
  });

  test('3. edit, save, reload the note round-trips plaintext', async () => {
    await dismissOnboardingIfShown(page);
    // Open the note (it may already be active from test 2).
    await page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).first().click();
    await dismissOnboardingIfShown(page);
    const editor = page.locator('.secure-editor-textarea');
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor).toBeEnabled({ timeout: 10_000 });

    const body = `# Confidential\n\nNonce ${Date.now()}\n`;
    await editor.fill(body);
    // Trigger an immediate save with Cmd+S to avoid racing the 800ms debounce.
    const [writeRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/files/secure/write') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s'),
    ]);
    expect(writeRes.status()).toBe(201);
    await expect(page.locator('.secure-editor-status[data-state="saved"]')).toBeVisible();

    // Reload the page, master-KEK persists in IndexedDB → readSecureNote
    // returns the plaintext we just wrote.
    await page.reload();
    await dismissOnboardingIfShown(page);
    await page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).first().click();
    await dismissOnboardingIfShown(page);
    await expect(page.locator('.secure-editor-textarea')).toHaveValue(body, { timeout: 15_000 });
  });

  test('4. create a subfolder inside _secure/ and a note inside it', async () => {
    await expandSecureFolder(page, email);
    await dismissOnboardingIfShown(page);
    // Wait for both the create POST AND the follow-up tree refresh — the
    // tree fetch races the assertion, and a slow refresh under load lets the
    // assertion fire before "New folder" is in the DOM.
    const [folderRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/vault/items') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.waitForResponse(
        (r) => r.url().includes('/api/files/tree') && r.request().method() === 'GET',
        { timeout: 15_000 },
      ),
      clickNewFolderIn(page, ENCRYPTED_FOLDER_LABEL),
    ]);
    expect(folderRes.status()).toBe(201);
    await expect(page.getByText('Failed to create folder')).toHaveCount(0);

    // Disk: the subfolder exists.
    const subDir = path.join(PERSONAL_PATH, email, '_secure', 'New folder');
    await expect.poll(() => fs.existsSync(subDir), { timeout: 5_000 }).toBe(true);

    // The Encrypted Folder may have collapsed during the tree refresh in some
    // browser/state combinations (React reconciles the path-keyed node, but
    // any earlier toggle survives). Re-expand if `New folder` isn't on screen
    // yet — this is a no-op when it's already visible.
    if (!(await page.locator('.file-tree-node').filter({ hasText: 'New folder' }).first().isVisible().catch(() => false))) {
      await expandSecureFolder(page, email);
    }
    await expect(
      page.locator('.file-tree-node').filter({ hasText: 'New folder' }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Now create a note inside that subfolder.
    const [noteRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/files/secure/create') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      clickNewNoteIn(page, 'New folder'),
    ]);
    expect(noteRes.status()).toBe(201);
    const subFiles = fs.readdirSync(subDir).filter((n) => n.endsWith('.md'));
    expect(subFiles.length).toBeGreaterThan(0);
    const subBytes = fs.readFileSync(path.join(subDir, subFiles[0]));
    expect(subBytes.slice(0, 4).equals(ENVELOPE_MAGIC)).toBe(true);
  });

  test('5. delete a note from _secure/', async () => {
    await dismissOnboardingIfShown(page);
    const noteCountBefore = await page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).count();
    expect(noteCountBefore).toBeGreaterThan(0);
    const note = page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).first();
    await note.click({ button: 'right' });
    const deleteItem = page.locator('.context-menu .context-menu-item').filter({ hasText: /^Delete$/ }).first();
    await deleteItem.click();
    // _secure/ notes skip the trash, so the confirmation says so.
    const confirm = page.getByRole('dialog', { name: 'Delete permanently?' });
    await expect(confirm).toBeVisible();
    const [delRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/files/delete') && r.request().method() === 'DELETE',
        { timeout: 15_000 },
      ),
      confirm.getByRole('button', { name: 'Delete permanently' }).click(),
    ]);
    expect(delRes.status()).toBe(200);
    // After delete, exactly one of the two test-created "Untitled note" entries
    // is gone (top-level vs. the one inside "New folder"). Both deletions
    // exercise the same DELETE /api/files/delete codepath.
    await expect.poll(
      async () => page.locator('.file-tree-node').filter({ hasText: 'Untitled note' }).count(),
      { timeout: 5_000 },
    ).toBe(noteCountBefore - 1);

    // Verify the on-disk file vanished from whichever folder backed the
    // selected entry. We don't track which one .first() resolved to, so
    // require that the total count of .md files in _secure decreased.
    const baseDir = path.join(PERSONAL_PATH, email, '_secure');
    const allMd = collectMd(baseDir);
    expect(allMd.length).toBe(noteCountBefore - 1);
  });
});

function collectMd(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

test.describe('Encrypted Folder unlock from a fresh browser context', () => {
  // A second context (no IndexedDB → no cached master-KEK) for the same user
  // must land on the unlock dialog, not the setup dialog. This is the bug the
  // user hit: cross-browser the GET vault-meta race meant the dialog still
  // said "Set up" even after a successful first-time PUT.
  const email = `vault-unlock-${Date.now()}@example.com`;
  const passphrase = 'correct-horse-battery-staple-9!';

  test('first browser sets up; second browser sees unlock', async ({ browser }) => {
    const token = await provisionUserAndToken(email);
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await authenticateAtRoot(pageA, token);
    await setupVault(pageA, passphrase);
    await ctxA.close();

    const ctxB = await browser.newContext(); // fresh storage state
    const pageB = await ctxB.newPage();
    // Same JWT (same user) but no IndexedDB master-KEK and no cached
    // vaultMeta state. handleSecureFolderActivate must re-read meta and
    // route to the unlock dialog.
    await authenticateAtRoot(pageB, token);
    await pageB.locator('.file-tree-node').filter({ hasText: ENCRYPTED_FOLDER_LABEL }).first().click();
    // Either an unlock dialog (vault recognised) or the setup dialog (bug).
    const setupDialog = pageB.getByRole('dialog').filter({ hasText: 'Set up your Encrypted Folder' });
    const unlockDialog = pageB.getByRole('dialog').filter({ hasText: /Unlock/i });
    await Promise.race([
      unlockDialog.waitFor({ state: 'visible', timeout: 10_000 }),
      setupDialog.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
    expect(await unlockDialog.isVisible(), 'second browser must see the unlock dialog, not setup').toBe(true);
    expect(await setupDialog.isVisible()).toBe(false);
    await ctxB.close();
  });
});
