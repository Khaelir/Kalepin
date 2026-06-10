// Phase 15 — UI surfaces for the personal-folders feature, exercised across
// chromium / firefox / webkit. See openspec/changes/add-personal-user-folders/
// design.md and tasks.md §15. The config in playwright.config.ts pins this file
// to all three browser projects via testMatch; other specs stay chromium-only.
//
// Each test plants its own fixtures so the order across projects is independent.
// Helpers run via the HTTP API (tokens minted with the same JWT_SECRET the
// backend was started with) — no UI login flow.

import { test, expect, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import { FRONTEND_PORT, BACKEND_PORT } from '../playwright.config';

const BASE_URL = `http://localhost:${FRONTEND_PORT}`;
const API_URL = `http://localhost:${BACKEND_PORT}`;
const JWT_SECRET = 'test-secret';

let userCounter = 5000;
function makeToken(email: string): string {
  return jwt.sign({ sub: ++userCounter, email }, JWT_SECRET, { expiresIn: '1h' });
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function ensureFolderExists(token: string): Promise<void> {
  // Any authenticated request triggers ensurePersonalFolder once for the user.
  const res = await fetch(`${API_URL}/api/files/tree`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`tree fetch failed: ${res.status}`);
}

async function createNoteAt(token: string, path: string, content: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(`create note failed: ${res.status} ${await res.text()}`);
}

/** Wait until /api/files/search returns at least one hit for `query`, or throw. */
async function waitForIndex(token: string, query: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/api/files/search?q=${encodeURIComponent(query)}`, {
      headers: bearer(token),
    });
    if (res.ok) {
      const hits = await res.json() as unknown[];
      if (Array.isArray(hits) && hits.length > 0) return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for search index to include "${query}"`);
}

async function authAndOpen(page: Page, token: string, notePath: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  await page.goto(`${BASE_URL}/doc/${encoded}`);
  await expect(page.locator('.editor-content .tiptap')).toBeVisible({ timeout: 15_000 });
}

async function authAndOpenWorkspace(page: Page, token: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.evaluate((t) => localStorage.setItem('kalepin_token', t), token);
  await page.goto(BASE_URL);
  // Wait for the file tree to render. With Phase 15 the sidebar splits into
  // two `.file-tree` instances (personal / shared) — use .first() to avoid
  // the strict-mode "2 elements" error.
  await expect(page.locator('.file-tree').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('Phase 15 — Personal folder UI surfaces', () => {
  // ---------- 15.1 PersonalSection renders ----------

  test('15.1 personal section appears with a lock icon when the user has personal notes', async ({ page }) => {
    const email = `phase15-tree-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    const personalNote = `_users/${email}/PersonalDiary.md`;
    await createNoteAt(token, personalNote, '# My Diary\n\nPrivate thoughts.\n');

    await authAndOpenWorkspace(page, token);

    // The "Personal" section header appears above the personal file-tree.
    await expect(
      page.locator('.kp-side-section-title', { hasText: 'Personal' }),
    ).toBeVisible();

    // The personal-root row is rendered with the lock affordance and is the
    // sole row in the section's file-tree (data-section="personal").
    const personalTree = page.locator('.file-tree[data-section="personal"]');
    const personalRow = personalTree.locator('.file-tree-node.personal-root');
    await expect(personalRow).toBeVisible();
    await expect(personalRow.locator('.personal-lock-icon')).toBeVisible();

    // The user's file should appear nested below — the personal row is auto-expanded.
    await expect(personalTree.locator('.file-tree-node', { hasText: 'PersonalDiary.md' })).toBeVisible();
  });

  test('15.1 personal section is empty when the user has no personal notes yet', async ({ page }) => {
    // A fresh user that has authenticated (so ensurePersonalFolder has created
    // an empty `personal/{email}/` directory) but has not created any personal
    // note. The section header + locked root row still appear (a nudge to drop
    // notes there). Below the personal root the UI also surfaces the always-on
    // `Encrypted Folder` placeholder (the E2E `_secure/` entry — see FileTree's
    // personalRootWithPlaceholder), so the section contains exactly two rows:
    // the personal-root and the encrypted-folder placeholder, and no real notes.
    const email = `phase15-empty-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);

    await authAndOpenWorkspace(page, token);

    const personalTree = page.locator('.file-tree[data-section="personal"]');
    await expect(personalTree.locator('.file-tree-node.personal-root')).toBeVisible();
    // Personal-root + Encrypted Folder placeholder, nothing else.
    await expect(personalTree.locator('.file-tree-node')).toHaveCount(2);
    await expect(
      personalTree.locator('.file-tree-node', { hasText: 'Encrypted Folder' }),
    ).toBeVisible();
  });

  // ---------- 15.2 Personal-root context menu is stripped ----------

  test('15.2 right-click on the personal root hides Rename and Delete', async ({ page }) => {
    const email = `phase15-menu-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    await createNoteAt(token, `_users/${email}/note.md`, '# n\n');

    await authAndOpenWorkspace(page, token);

    const personalRow = page
      .locator('.file-tree[data-section="personal"]')
      .locator('.file-tree-node.personal-root');
    await personalRow.click({ button: 'right' });

    // The menu should appear with the limited item set.
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('New note here')).toBeVisible();
    await expect(menu.getByText('New folder here')).toBeVisible();
    await expect(menu.getByText('Copy path')).toBeVisible();

    // These actions are forbidden on the personal root — they must NOT appear.
    await expect(menu.getByText('Rename…')).toHaveCount(0);
    await expect(menu.getByText(/^Delete/)).toHaveCount(0);
  });

  // ---------- 15.5 ShareDialog gates the public link ----------
  //
  // Pre-v0.5.70 the share button auto-minted a public code and surfaced a
  // confirm modal asking the user whether they really wanted to copy the URL.
  // v0.5.70 ("explicit mint + expiry + revoke UI") replaced that with the
  // unified ShareDialog: opening it never mints anything, and the user has to
  // click "Generate public link" to opt in. These tests guard the new gate —
  // open + close must NOT produce a code or a copy toast.

  test('15.5 ShareDialog opens for a personal note without minting; close suppresses copy', async ({ page }) => {
    const email = `phase15-share-personal-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    const notePath = `_users/${email}/Secret.md`;
    await createNoteAt(token, notePath, '# Secret\n\nshhh\n');

    await authAndOpen(page, token, notePath);

    await page.locator('.kp-share-btn').click();

    const dialog = page.locator('.modal-card.share-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Share "Secret.md"');
    // Public-link panel is in its "none" state — explanatory copy + a
    // Generate button, no URL field yet.
    const publicLink = dialog.locator('.share-dialog-public-link');
    await expect(publicLink).toHaveAttribute('data-public-link-state', 'none');
    await expect(publicLink.getByRole('button', { name: /Generate public link/ })).toBeVisible();
    await expect(dialog.locator('.share-dialog-public-link-url')).toHaveCount(0);

    // Close without generating — dialog goes away and no "copied" toast surfaces.
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast', { hasText: /Share link copied/ })).toHaveCount(0);
  });

  test('15.5 ShareDialog opens for a shared-vault note with the same gated panel', async ({ page }) => {
    const email = `phase15-share-shared-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    const notePath = `Phase15-shared-${Date.now()}.md`;
    await createNoteAt(token, notePath, '# shared\n');

    await authAndOpen(page, token, notePath);

    await page.locator('.kp-share-btn').click();

    // Same dialog, same gate — no auto-mint, no auto-copy regardless of zone.
    const dialog = page.locator('.modal-card.share-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.share-dialog-public-link')).toHaveAttribute('data-public-link-state', 'none');
    await expect(page.locator('.toast', { hasText: /Share link copied/ })).toHaveCount(0);
  });

  // ---------- 15.6 Mention warning banner above the comment composer ----------

  test('15.6 personal-note comment composer shows the mention-suppression notice', async ({ page }) => {
    const email = `phase15-mention-personal-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    const notePath = `_users/${email}/Notes.md`;
    await createNoteAt(token, notePath, '# Note\n\nselectable paragraph.\n');

    await authAndOpen(page, token, notePath);

    // Triple-click selects the paragraph reliably across all three browser engines.
    const para = page.locator('.editor-content .tiptap p', { hasText: 'selectable paragraph' });
    await para.click({ clickCount: 3 });

    // Right-click anywhere inside the editor to open its context menu.
    await para.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByText('Add Comment').click();

    // FloatingInput appears with the personal-folder notice.
    const floating = page.locator('.floating-input');
    await expect(floating).toBeVisible();
    await expect(floating.locator('.floating-input-notice')).toBeVisible();
    await expect(floating.locator('.floating-input-notice')).toContainText("don't notify");
  });

  // ---------- Cross-user UI leak property: two users, each plants in their
  // own personal area, and the UI surfaces the other user's content nowhere.

  test('cross-user: Alice and Bob each have private notes; neither sees the other', async ({ browser }) => {
    const aliceEmail = `phase15-alice-${Date.now()}@example.com`;
    const bobEmail = `phase15-bob-${Date.now()}@example.com`;
    const aliceToken = makeToken(aliceEmail);
    const bobToken = makeToken(bobEmail);

    // Plant: each user authenticates (creates their personal folder), then
    // creates a uniquely-named, uniquely-bodied note inside their personal area.
    await ensureFolderExists(aliceToken);
    await ensureFolderExists(bobToken);

    const aliceTitle = `AliceSecret-${Date.now()}.md`;
    const bobTitle = `BobJournal-${Date.now()}.md`;
    // Single-token bodies — FTS5's default tokenizer splits on underscores, so
    // a body like "ALICE_BODY_TOKEN_1234" would share three of four tokens
    // with "BOB_BODY_TOKEN_1234" and produce false-positive cross-hits via
    // FTS OR-mode fallback. Letters+digits-only keeps each body to one token.
    const aliceBody = `qzwxalicebody${Date.now()}`;
    const bobBody = `qzwxbobbody${Date.now()}`;
    const alicePath = `_users/${aliceEmail}/${aliceTitle}`;
    const bobPath = `_users/${bobEmail}/${bobTitle}`;

    await createNoteAt(aliceToken, alicePath, `# Alice\n\n${aliceBody}\n`);
    await createNoteAt(bobToken, bobPath, `# Bob\n\n${bobBody}\n`);

    // Indexing is hooked through the chokidar file watcher (async). Block here
    // until each user's own body token is searchable so the UI search probes
    // below have a deterministic ground truth.
    await waitForIndex(aliceToken, aliceBody);
    await waitForIndex(bobToken, bobBody);

    // Each user gets an isolated browser context so localStorage tokens don't
    // collide. We exercise the UI for both users in the same test for symmetry.
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    try {
      await authAndOpenWorkspace(alicePage, aliceToken);
      await authAndOpenWorkspace(bobPage, bobToken);

      // ---- File tree: each user's tree contains only their own personal file.
      // Scan the union of both file-tree sections (personal + shared) per page.
      // .allTextContents() avoids the strict-mode "2 elements" error and lets
      // us assert membership on the concatenated text in one go.
      const treeText = async (page: Page): Promise<string> =>
        (await page.locator('.file-tree').allTextContents()).join(' ');

      const aliceTrees = await treeText(alicePage);
      expect(aliceTrees).toContain(aliceTitle);
      expect(aliceTrees).not.toContain(bobTitle);
      expect(aliceTrees).not.toContain(bobEmail);

      const bobTrees = await treeText(bobPage);
      expect(bobTrees).toContain(bobTitle);
      expect(bobTrees).not.toContain(aliceTitle);
      expect(bobTrees).not.toContain(aliceEmail);

      // ---- Search: the leak property is "no result reveals the other user's
      // personal namespace". Hybrid search (FTS + vector) may surface the
      // viewer's OWN note for any query — that's fine. What must NEVER happen:
      // (a) a result whose path lives under the other user's `_users/{X}/`,
      // (b) the other user's body token appearing anywhere in the rendered
      //     search modal (paths, snippets, headings).
      const probeSearch = async (
        page: Page,
        query: string,
      ): Promise<{ paths: string[]; modalText: string }> => {
        await page.locator('.kp-topbar-search').click();
        const input = page.locator('.search-modal-input');
        await expect(input).toBeVisible();
        await input.fill(query);
        await page.waitForTimeout(800); // debounce + network settle
        const paths = await page
          .locator('.search-modal-result-dir, .search-modal-result-name')
          .allTextContents();
        const modalText = await page.locator('.search-modal-card').innerText();
        await page.keyboard.press('Escape');
        await expect(page.locator('.search-modal-input')).toHaveCount(0);
        return { paths, modalText };
      };

      // Search modal strips the `.md` extension when rendering result names —
      // strip it here too for the title-membership assertions.
      const aliceTitleStem = aliceTitle.replace(/\.md$/, '');
      const bobTitleStem = bobTitle.replace(/\.md$/, '');

      const aliceFindsOwn = await probeSearch(alicePage, aliceBody);
      expect(aliceFindsOwn.modalText).toContain(aliceTitleStem);

      const bobFindsOwn = await probeSearch(bobPage, bobBody);
      expect(bobFindsOwn.modalText).toContain(bobTitleStem);

      // Cross-user probes — the actual leak assertion.
      const aliceProbesBob = await probeSearch(alicePage, bobBody);
      expect(aliceProbesBob.modalText).not.toContain(bobBody);
      expect(aliceProbesBob.modalText).not.toContain(bobEmail);
      expect(aliceProbesBob.modalText).not.toContain(bobTitleStem);

      const bobProbesAlice = await probeSearch(bobPage, aliceBody);
      expect(bobProbesAlice.modalText).not.toContain(aliceBody);
      expect(bobProbesAlice.modalText).not.toContain(aliceEmail);
      expect(bobProbesAlice.modalText).not.toContain(aliceTitleStem);

      // ---- Direct URL probe: navigating to a foreign personal-note URL leaves
      // the editor unrendered (the placeholder stays visible). The backend
      // returns 404 on REST and emits a not_found error frame on WS.
      const encodedAlicePath = alicePath.split('/').map(encodeURIComponent).join('/');
      await bobPage.goto(`${BASE_URL}/doc/${encodedAlicePath}`);
      // Give the WS open + REST fallback (~2s) time to run and fail.
      await bobPage.waitForTimeout(3500);
      await expect(bobPage.locator('.editor-placeholder')).toBeVisible();
      await expect(bobPage.locator('.editor-content .tiptap')).toHaveCount(0);
      // Belt-and-braces: Alice's body never landed in Bob's DOM.
      await expect(bobPage.locator('body')).not.toContainText(aliceBody);
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('15.6 shared-note comment composer omits the personal-folder notice', async ({ page }) => {
    const email = `phase15-mention-shared-${Date.now()}@example.com`;
    const token = makeToken(email);
    await ensureFolderExists(token);
    const notePath = `Phase15-shared-mention-${Date.now()}.md`;
    await createNoteAt(token, notePath, '# Note\n\nselectable paragraph.\n');

    await authAndOpen(page, token, notePath);

    const para = page.locator('.editor-content .tiptap p', { hasText: 'selectable paragraph' });
    await para.click({ clickCount: 3 });
    await para.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByText('Add Comment').click();

    const floating = page.locator('.floating-input');
    await expect(floating).toBeVisible();
    await expect(floating.locator('.floating-input-notice')).toHaveCount(0);
  });
});
